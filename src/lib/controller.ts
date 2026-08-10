/*
 * controller.ts — per-VIN runtime: owns the MQTT telemetry client, the REST probe/wake,
 * the polling timers, and the command runner. The ioBroker equivalent of coordinator.py,
 * condensed for the MVP scope (read-only telemetry + lock + climate + locate + refresh).
 *
 * Timers use the adapter's framework-managed setInterval/setTimeout so they are tracked and
 * cleared on unload; stop() also clears them explicitly and closes MQTT.
 */
import { EP, TIMING } from './constants';
import { OmodaClient } from './client';
import { MqttTelemetry } from './telemetry';
import { CommandRunner, CommandError } from './commands';
import type { CertSet } from './certs';
import { GEO_MAP, MQTT_MAP, RT_MAP } from './objects';
import type { RuntimeConfig, Vehicle } from './types';
import { str } from './util';

/** Same strictness as objects.toNumStrict: null/'' mean "not reported", never 0. */
function toNum(v: unknown): number | undefined {
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
        return undefined;
    }
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
}
/**
 * Charge plug connected when chargeGunState is present and non-zero (entity.field_on).
 *
 * @param v
 */
function fieldOn(v: unknown): boolean {
    const n = toNum(v);
    return n !== undefined && n !== 0;
}

export class VehicleController {
    private mqtt: MqttTelemetry | null = null;
    private readonly cmd: CommandRunner;
    private keepaliveTimer?: ioBroker.Interval;
    private normalTimer?: ioBroker.Interval;
    private followTimer?: ioBroker.Timeout;
    private followCount = 0;
    private followActive = false;
    private lastWakeMs = 0;
    private stopped = false;

    constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly client: OmodaClient,
        private readonly cfg: RuntimeConfig,
        private readonly vehicle: Vehicle,
        private readonly certs: CertSet,
    ) {
        this.cmd = new CommandRunner(
            client,
            { vin: vehicle.vin, pin: cfg.pin, channelId: cfg.channelId },
            adapter.log,
            ms => this.adapter.delay(ms),
        );
    }

    /** Real VIN (backend/API + display). */
    get vin(): string {
        return this.vehicle.vin;
    }

    /** Sanitized id segment used in ioBroker object paths. */
    get id(): string {
        return this.vehicle.id;
    }

    /**
     * Start MQTT + initial probe + polling. `tuserId` comes from a successful bffLogin.
     *
     * @param tuserId
     */
    async start(tuserId: string): Promise<void> {
        // Idempotent: a re-login (confirmOtp after controllers already exist) calls start()
        // again — tear down the previous MQTT client + timers first, or they leak.
        if (this.mqtt || this.keepaliveTimer || this.normalTimer) {
            await this.stop();
        }
        this.stopped = false;
        this.mqtt = new MqttTelemetry(
            {
                host: this.cfg.mqttHost,
                port: this.cfg.mqttPort,
                channelId: this.cfg.channelId,
                tuserId,
                certs: this.certs,
                awakeWindowSec: TIMING.awakeWindowSec,
            },
            this.adapter.log,
            {
                onFields: f => this.applyFields(f),
                onGeo: d => this.applyGeo(d),
                onConfirmation: d => this.applyConfirmation(d),
                onConnected: c => this.setOnline(c),
                onWake: () => void this.probe().catch(() => undefined),
            },
        );
        this.mqtt.connect();

        // Initial read so a parked car shows last-known values at startup.
        void this.probe().catch(e => this.adapter.log.debug(`initial probe failed: ${(e as Error).message}`));

        // Keepalive: refresh the session token periodically (configurable, clamped in main).
        // This is also the adapter's liveness signal: the session dies whenever the official app
        // logs in on the same account, and without reporting that, info.connection would stay
        // true forever while every poll silently returned nothing.
        this.keepaliveTimer = this.adapter.setInterval(() => {
            void this.client
                .refreshToken()
                .then(ok => this.setSessionAlive(ok))
                .catch(() => this.setSessionAlive(false));
        }, this.cfg.sessionEverySec * 1000);

        // Normal poll: wake + realtime + GPS (for parked telemetry). 0 disables.
        const normalMs = this.cfg.pollNormalMin > 0 ? this.cfg.pollNormalMin * 60 * 1000 : 0;
        if (normalMs > 0) {
            this.normalTimer = this.adapter.setInterval(() => {
                void this.wakeAndProbe().catch(() => undefined);
            }, normalMs);
        }
    }

    async stop(): Promise<void> {
        this.stopped = true;
        for (const t of [this.keepaliveTimer, this.normalTimer]) {
            if (t) {
                this.adapter.clearInterval(t);
            }
        }
        this.keepaliveTimer = this.normalTimer = undefined;
        this.stopFollow();
        await this.mqtt?.close();
        this.mqtt = null;
    }

    // ── state writers ────────────────────────────────────────────────────────────
    private set(id: string, val: ioBroker.StateValue): void {
        void this.adapter.setState(`${this.vehicle.id}.${id}`, { val, ack: true });
    }

    private setOnline(connected: boolean): void {
        this.set('info.online', connected);
    }

    /**
     * Adapter-level connection indicator. The session is shared by every vehicle (one account),
     * so this is a global state, not a per-VIN one.
     */
    private setSessionAlive(ok: boolean): void {
        void this.adapter.setState('info.connection', { val: ok, ack: true });
        this.set('info.sessionStatus', ok ? 'Session active' : 'Session expired — request a new OTP');
    }

    private applyFields(fields: Record<string, string>): void {
        for (const [key, target] of Object.entries(MQTT_MAP)) {
            if (key in fields) {
                const v = target.conv(fields[key]);
                if (v !== undefined) {
                    this.set(target.id, v);
                }
            }
        }
        this.set('info.lastUpdate', Date.now());
        this.maybeStartFollow(fields);
    }

    private applyGeo(data: Record<string, unknown>): void {
        for (const [key, target] of Object.entries(GEO_MAP)) {
            if (key in data) {
                const v = target.conv(data[key]);
                if (v !== undefined) {
                    this.set(target.id, v);
                }
            }
        }
        const ptime = data.positionTime ?? data.gpsTime;
        if (ptime !== undefined) {
            const n = toNum(ptime);
            if (n !== undefined) {
                this.set('location.positionTime', n);
            }
        }
    }

    private applyRealtime(payload: Record<string, unknown>): void {
        for (const [key, target] of Object.entries(RT_MAP)) {
            if (key in payload) {
                const v = target.conv(payload[key]);
                if (v !== undefined) {
                    this.set(target.id, v);
                }
            } else if (target.volatile) {
                this.set(target.id, null); // absent = no longer applicable, not "unchanged"
            }
        }
        // Total range = electric + petrol range (HA _range_totale); electric-only on a BEV.
        const elec = toNum(payload.pureElectricRange) ?? toNum(payload.dynamicPureElectricRange);
        if (elec !== undefined) {
            const fuel = toNum(payload.mileageSurplus) ?? 0;
            this.set('battery.rangeTotal', elec + fuel);
        }
        this.set('info.lastUpdate', Date.now());
    }

    private applyConfirmation(data: Record<string, unknown>): void {
        const result = str(data.result).trim();
        const reason = Array.isArray(data.reason) ? data.reason : [];
        // The backend lists the climate module (modelId 0) in `reason` even on success — a code
        // arrives on nearly every OFF command — so a climate-only reason is NOT a failure and
        // must not raise the alarm. A malformed reason stays cautious and counts as a failure.
        const climateOnly =
            reason.length > 0 &&
            reason.every(r => !!r && typeof r === 'object' && str((r as Record<string, unknown>).modelId) === '0');
        let suffix = '';
        if (reason.length && !climateOnly) {
            suffix = ' — check failed';
        } else if (climateOnly) {
            // Keep the raw codes for diagnosis, but say plainly that this is expected.
            const codes = reason
                .map(r => str((r as Record<string, unknown>).code))
                .filter(Boolean)
                .join(', ');
            suffix = codes ? ` (climate module reported code ${codes} — this is normal)` : '';
        }
        this.set('commands.result', `car reported result=${result || '?'}${suffix}`);
    }

    // ── REST probe / wake ────────────────────────────────────────────────────────
    /** Read realtime telemetry + GPS location (read-only, no wake). */
    async probe(): Promise<Record<string, unknown> | null> {
        const { userToken } = await this.client.bffLogin();
        if (!userToken) {
            return null;
        }
        const vin = this.vehicle.vin;
        const rt = await this.client.signedTspPost(userToken, EP.realtime, { vin });
        const rtPayload = OmodaClient.payload(rt);
        if (rtPayload) {
            this.applyRealtime(rtPayload);
        }
        const loc = await this.client.signedTspPost(userToken, EP.vehicleLocation, { vin });
        const locPayload = OmodaClient.payload(loc);
        if (locPayload) {
            this.applyGeo(locPayload);
        }
        return rtPayload;
    }

    /** Wake the car (rate-limited smsAwaken), wait, then probe. Used by the normal poll + refresh. */
    async wakeAndProbe(): Promise<void> {
        const now = Date.now();
        if (now - this.lastWakeMs >= this.cfg.wakeCooldownSec * 1000) {
            const { userToken } = await this.client.bffLogin();
            if (userToken) {
                this.lastWakeMs = now;
                const r = await this.client.signedTspPost(userToken, EP.smsAwaken, { vin: this.vehicle.vin });
                this.adapter.log.debug(`smsAwaken → ${r.code}`);
                await this.adapter.delay(TIMING.pollWakeWaitSec * 1000);
            }
        }
        await this.probe();
    }

    // ── driving/charging fast-follow (read-only realtime bursts) ───────────────────
    private maybeStartFollow(fields: Record<string, string>): void {
        const driving = toNum(fields.engineState) === 1 || (toNum(fields.vehicleSpeed) ?? 0) > 0;
        const plugged = fieldOn(fields.chargeGunState);
        if ((driving || plugged) && !this.followActive) {
            this.startFollow(plugged);
        }
    }

    private startFollow(charging: boolean): void {
        this.followActive = true;
        this.followCount = 0;
        const everyMs = (charging ? TIMING.chargingPollEverySec : TIMING.hvOnPollEverySec) * 1000;
        const cap = charging ? TIMING.chargingPollMax : TIMING.hvOnPollMax;
        this.adapter.log.debug(
            `starting ${charging ? 'charging' : 'HV'} follow (every ${everyMs / 1000}s, cap ${cap})`,
        );
        // self-scheduling timeout (not setInterval) so a slow probe can never overlap the next one
        const scheduleNext = (): void => {
            this.followTimer = this.adapter.setTimeout(() => {
                this.followTimer = undefined;
                void (async () => {
                    this.followCount++;
                    const payload = await this.probe().catch(() => null);
                    const hvOn = payload ? toNum(payload.hVoltageState) === 1 : false;
                    if (this.stopped || this.followCount >= cap || !hvOn) {
                        this.stopFollow();
                    } else {
                        scheduleNext();
                    }
                })();
            }, everyMs);
        };
        scheduleNext();
    }

    private stopFollow(): void {
        if (this.followTimer) {
            this.adapter.clearTimeout(this.followTimer);
            this.followTimer = undefined;
        }
        this.followActive = false;
    }

    // ── commands (MVP) ─────────────────────────────────────────────────────────────
    async lock(shouldLock: boolean): Promise<string> {
        return this.cmd.send(shouldLock ? 'blocca' : 'sblocca');
    }

    async climate(on: boolean, temperatureC?: number): Promise<string> {
        const params = on && temperatureC != null ? { temperature: temperatureC.toFixed(1) } : undefined;
        return this.cmd.send(on ? 'clima_on' : 'clima_off', params);
    }

    async locate(): Promise<string> {
        return this.cmd.send('locate_car');
    }

    /**
     * Surface a command outcome/failure to commands.result.
     *
     * @param text
     */
    reportCommandResult(text: string): void {
        this.set('commands.result', text);
    }

    isCommandError(e: unknown): e is CommandError {
        return e instanceof CommandError;
    }
}
