/*
 * ioBroker.omoda — Omoda / Jaecoo (Chery) vehicle adapter.
 * Ported from the Home Assistant integration JackRonan/omoda-jaecoo-ha.
 */
import * as utils from '@iobroker/adapter-core';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { APP_VERSION } from './lib/constants';
import { OmodaClient } from './lib/client';
import { TokenStore } from './lib/tokenStore';
import { VehicleController } from './lib/controller';
import { solveCaptcha } from './lib/captcha';
import { availableRegions, decryptRegion, loadStore, type CertSet } from './lib/certs';
import { ensureObjects } from './lib/objects';
import type { RuntimeConfig } from './lib/types';
import { clamp, str } from './lib/util';

class Omoda extends utils.Adapter {
    private client!: OmodaClient;
    private tokens!: TokenStore;
    private runtimeCfg!: RuntimeConfig;
    private controllers = new Map<string, VehicleController>();
    private starting = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'omoda' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private buildConfig(): RuntimeConfig {
        const c = this.config;
        return {
            bff: c.bff,
            tspHost: c.tspHost,
            mqttHost: c.mqttHost,
            mqttPort: Number(c.mqttPort) || 8083,
            tenant: c.tenant,
            channelId: c.channelId,
            countryId: c.countryId,
            deptId: c.deptId,
            language: c.language || 'en-GB',
            email: (c.email || '').trim(),
            pin: c.pin || '',
            appVersion: APP_VERSION,
            // Clamp in code (jsonConfig min/max is not sufficient). 0 = off for the polls;
            // caps keep every derived setTimeout/Interval well under 2^31 ms.
            pollNormalMin: c.pollNormalMin ? clamp(Number(c.pollNormalMin), 5, 10080, 60) : 0,
            sessionEverySec: clamp(Number(c.sessionEverySec), 60, 86400, 900),
            wakeCooldownSec: clamp(Number(c.wakeCooldownSec), 60, 86400, 300),
        };
    }

    /** Locate the bundled region cert store (data/certs-store.json) beside the compiled code. */
    private async certStorePath(): Promise<string> {
        const candidates = [
            path.join(__dirname, '..', 'data', 'certs-store.json'),
            path.join(__dirname, '..', '..', 'data', 'certs-store.json'),
        ];
        for (const p of candidates) {
            try {
                await fs.access(p);
                return p;
            } catch {
                /* try next */
            }
        }
        return candidates[0];
    }

    private async loadCerts(): Promise<CertSet | null> {
        try {
            const store = await loadStore(await this.certStorePath());
            const certs = decryptRegion(store, this.runtimeCfg.mqttHost);
            if (!certs) {
                this.log.error(
                    `No MQTT certificates bundled for region "${this.runtimeCfg.mqttHost}". ` +
                        `Available: ${availableRegions(store).join(', ')}`,
                );
            }
            return certs;
        } catch (e) {
            this.log.error(`Failed to load cert store: ${(e as Error).message}`);
            return null;
        }
    }

    private async onReady(): Promise<void> {
        void this.setState('info.connection', false, true);
        this.runtimeCfg = this.buildConfig();

        const dataDir = utils.getAbsoluteInstanceDataDir(this);
        this.tokens = new TokenStore(dataDir, this.log);
        this.client = new OmodaClient(this.runtimeCfg, this.tokens, this.log);

        this.subscribeStates('*.commands.*');
        this.subscribeStates('*.climate.targetTemperature');

        await this.tokens.load();
        if (!this.tokens.hasToken()) {
            this.log.warn('No session token yet — open the adapter settings and complete the OTP login.');
            return;
        }
        await this.startVehicles();
    }

    /** Discover vehicles and start a controller per VIN. Safe to call again after OTP login. */
    private async startVehicles(): Promise<void> {
        if (this.starting) {
            return;
        }
        this.starting = true;
        try {
            const { userToken, tUserId } = await this.client.bffLogin();
            if (!userToken || !tUserId) {
                this.log.warn('Session invalid — request a new OTP code in the adapter settings.');
                return;
            }
            const certs = await this.loadCerts();
            if (!certs) {
                return;
            }
            const vehicles = await this.client.discoverVehicles();
            if (!vehicles.length) {
                this.log.warn('No vehicles found on this account (queryList empty).');
                return;
            }
            for (const v of vehicles) {
                await ensureObjects(this, v);
                let ctrl = this.controllers.get(v.id);
                if (!ctrl) {
                    ctrl = new VehicleController(this, this.client, this.runtimeCfg, v, certs);
                    this.controllers.set(v.id, ctrl);
                }
                ctrl.start(tUserId);
                void this.setState(`${v.id}.info.sessionStatus`, { val: 'Session active', ack: true });
            }
            void this.setState('info.connection', true, true);
            this.log.info(`Started ${vehicles.length} vehicle(s): ${vehicles.map(v => v.vin).join(', ')}`);
        } catch (e) {
            this.log.error(`Startup failed: ${(e as Error).message}`);
        } finally {
            this.starting = false;
        }
    }

    /**
     * Split a full state id into { vin, rel } within this namespace.
     *
     * @param id
     */
    private splitId(id: string): { vehicleId: string; rel: string } | null {
        const local = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
        const dot = local.indexOf('.');
        if (dot < 0) {
            return null;
        }
        return { vehicleId: local.slice(0, dot), rel: local.slice(dot + 1) };
    }

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack) {
            return;
        }
        const parts = this.splitId(id);
        if (!parts) {
            return;
        }
        const ctrl = this.controllers.get(parts.vehicleId);
        if (!ctrl) {
            return;
        }
        void this.dispatchCommand(ctrl, id, parts.rel, state);
    }

    private async dispatchCommand(
        ctrl: VehicleController,
        id: string,
        rel: string,
        state: ioBroker.State,
    ): Promise<void> {
        try {
            let result: string | null = null;
            switch (rel) {
                case 'commands.lock':
                    result = await ctrl.lock(Boolean(state.val));
                    void this.setState(id, { val: Boolean(state.val), ack: true });
                    break;
                case 'commands.climateOn': {
                    const t = await this.getStateAsync(`${ctrl.id}.climate.targetTemperature`);
                    const temp = typeof t?.val === 'number' ? t.val : undefined;
                    result = await ctrl.climate(Boolean(state.val), temp);
                    void this.setState(id, { val: Boolean(state.val), ack: true });
                    break;
                }
                case 'commands.locate':
                    if (state.val) {
                        result = await ctrl.locate();
                    }
                    void this.setState(id, { val: false, ack: true });
                    break;
                case 'commands.refreshStatus':
                    if (state.val) {
                        await ctrl.wakeAndProbe();
                        result = 'Full status refreshed';
                    }
                    void this.setState(id, { val: false, ack: true });
                    break;
                case 'climate.targetTemperature':
                    // Setpoint only — applied on the next climate ON.
                    void this.setState(id, { val: state.val, ack: true });
                    return;
                default:
                    return;
            }
            if (result) {
                ctrl.reportCommandResult(result);
                this.log.info(result);
            }
        } catch (e) {
            const msg = (e as Error).message;
            ctrl.reportCommandResult(msg);
            if (ctrl.isCommandError(e) && e.reason === 'reauth') {
                this.log.warn(`${msg} (request a new OTP in the adapter settings)`);
            } else {
                this.log.warn(`Command failed: ${msg}`);
            }
        }
    }

    private onMessage(obj: ioBroker.Message): void {
        if (typeof obj !== 'object' || !obj.command) {
            return;
        }
        void this.handleMessage(obj);
    }

    private async handleMessage(obj: ioBroker.Message): Promise<void> {
        const reply = (payload: Record<string, unknown>): void => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, payload, obj.callback);
            }
        };
        const msg = (obj.message ?? {}) as Record<string, unknown>;
        try {
            switch (obj.command) {
                case 'requestOtp': {
                    if (!this.client) {
                        this.runtimeCfg = this.buildConfig();
                        this.client = new OmodaClient(
                            this.runtimeCfg,
                            new TokenStore(utils.getAbsoluteInstanceDataDir(this), this.log),
                            this.log,
                        );
                    }
                    const email = (str(msg.email) || this.runtimeCfg.email).trim();
                    if (!email) {
                        return reply({ error: 'Enter your account email first.' });
                    }
                    const cv = await solveCaptcha(this.client, this.log, ms => this.delay(ms));
                    if (!cv) {
                        return reply({ error: 'Captcha could not be solved — try again.' });
                    }
                    const r = await this.client.sendMailCode(email, cv);
                    return reply(
                        r.ok
                            ? { result: `OTP code sent to ${email}. Enter it below and press "Confirm OTP".` }
                            : {
                                  error:
                                      r.key === 'email.not.exists'
                                          ? 'Email not recognised as an account.'
                                          : r.msg || 'Failed to send OTP.',
                              },
                    );
                }
                case 'confirmOtp': {
                    const email = (str(msg.email) || this.runtimeCfg.email).trim();
                    const code = str(msg.code).trim();
                    if (!email || !code) {
                        return reply({ error: 'Email and OTP code are required.' });
                    }
                    const r = await this.client.mintToken(email, code);
                    if (!r.ok) {
                        return reply({ error: r.detail || 'OTP code rejected.' });
                    }
                    void this.startVehicles();
                    return reply({ result: 'Login successful — vehicles are being set up.' });
                }
                case 'checkSession': {
                    const r = await this.client.checkSession();
                    return reply(r.ok ? { result: r.detail } : { error: r.detail });
                }
                default:
                    return reply({ error: `Unknown command: ${obj.command}` });
            }
        } catch (e) {
            reply({ error: (e as Error).message });
        }
    }

    private onUnload(callback: () => void): void {
        void (async () => {
            try {
                await Promise.all([...this.controllers.values()].map(c => c.stop()));
                this.controllers.clear();
                void this.setState('info.connection', false, true);
            } catch (e) {
                this.log.debug(`unload error: ${(e as Error).message}`);
            } finally {
                callback();
            }
        })();
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Omoda(options);
} else {
    (() => new Omoda())();
}
