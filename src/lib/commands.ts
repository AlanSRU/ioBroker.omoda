/*
 * commands.ts — catalog + dispatch of Omoda / Jaecoo car commands (tspconsole REST).
 * Port of core/commands.py. Preserves the safety-critical behaviour:
 *   - taskId minted via queryList → setVecDefault → checkPassword(sm4(md5(pin)), scene=0)
 *   - taskId cache/TTL + one re-mint retry on A00089/A00546
 *   - PIN ANTI-LOCKOUT: stop after N wrong checkPassword within a window (a wrong command PIN
 *     can lock the Chery account) — never guess the PIN
 *   - command QUEUE: the car runs one command at a time (A00082), so sends are serialized
 *
 * ⚠️ Every send() with a valid taskId ACTS on the car — only invoke on explicit user intent.
 */
import { createHash } from 'node:crypto';
import { EP, FAILURE_CODES, RETRYABLE_CODES, codeMeaning } from './constants';
import { sm4Code } from './crypto/sm4';
import type { SignParams } from './crypto/sign';
import type { OmodaClient } from './client';
import type { Logger } from './types';
import { str } from './util';

export type CommandReason = 'pin' | 'reauth' | null;

/** A command the backend/car REFUSED (not executed). `reason` routes the remedy. */
export class CommandError extends Error {
    readonly code: string | null;
    readonly reason: CommandReason;
    readonly retryable: boolean;
    constructor(message: string, code: string | null = null, reason: CommandReason = null) {
        super(message);
        this.name = 'CommandError';
        this.code = code;
        this.reason = reason;
        this.retryable = code != null && RETRYABLE_CODES.has(code);
    }
}

interface CommandDef {
    endpoint?: string; // under /asc/vehicleControl/
    path?: string; // absolute path on the TSP host (e.g. /act/…)
    body: SignParams;
    name: string;
    group: string;
}

/** Full catalog (ported 1:1). MVP wires only lock + climate + locate; the rest is future-ready. */
export const COMMAND_CATALOG: Record<string, CommandDef> = {
    // Doors / locks
    sblocca: { endpoint: 'lockControl', body: { lockType: '1' }, name: 'Unlock doors', group: 'Access' },
    blocca: { endpoint: 'lockControl', body: { lockType: '0' }, name: 'Lock doors', group: 'Access' },
    baule_apri: { endpoint: 'powerLiftgateControl', body: { controlType: '1' }, name: 'Open trunk', group: 'Access' },
    baule_chiudi: {
        endpoint: 'powerLiftgateControl',
        body: { controlType: '0' },
        name: 'Close trunk',
        group: 'Access',
    },
    // Climate
    clima_on: {
        endpoint: 'airControl',
        body: { airControlType: '1', airType: '1', temperature: '21.0', times: '15' },
        name: 'Climate ON',
        group: 'Climate',
    },
    clima_off: {
        endpoint: 'airControl',
        body: { airControlType: '0', airType: '1', temperature: '21.0', times: '15' },
        name: 'Climate OFF',
        group: 'Climate',
    },
    // Windows / roof
    finestrini_apri: { endpoint: 'windowControl', body: { controlType: '1' }, name: 'Open windows', group: 'Windows' },
    finestrini_chiudi: {
        endpoint: 'windowControl',
        body: { controlType: '0' },
        name: 'Close windows',
        group: 'Windows',
    },
    ventilate_windows: {
        endpoint: 'windowControl',
        body: { controlType: '2' },
        name: 'Ventilate windows',
        group: 'Windows',
    },
    tetto_apri: {
        endpoint: 'skylightControl',
        body: { controlType: '1', skylightType: '1' },
        name: 'Open sunroof',
        group: 'Windows',
    },
    tetto_chiudi: {
        endpoint: 'skylightControl',
        body: { controlType: '0', skylightType: '1' },
        name: 'Close sunroof',
        group: 'Windows',
    },
    // EV charging
    ricarica_start: {
        endpoint: 'chargeStartStopControl',
        body: { controlType: '1' },
        name: 'Start charging',
        group: 'Charging',
    },
    ricarica_stop: {
        endpoint: 'chargeStartStopControl',
        body: { controlType: '0' },
        name: 'Stop charging',
        group: 'Charging',
    },
    // Other
    find_car: { endpoint: 'findCar', body: {}, name: 'Find car (flash)', group: 'Other' },
    locate_car: { endpoint: 'vehicleLocation', body: {}, name: 'Locate car (GPS)', group: 'Other' },
};

const NON_PIN_CODES = new Set(['A00000']);
const TASKID_TTL_MS = 600 * 1000;
const PIN_FAIL_MAX = 2;
const PIN_FAIL_WINDOW_MS = 600 * 1000;
const SETTLE_MS = 5 * 1000;

export interface CommandConfig {
    vin: string;
    pin: string;
    channelId: string;
}

export class CommandRunner {
    private taskId: {
        tid: string | null;
        ts: number;
    } = { tid: null, ts: 0 };
    private pinFail = { n: 0, ts: 0 };
    private queue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly client: OmodaClient,
        private readonly cfg: CommandConfig,
        private readonly log: Logger,
        /** Framework-managed delay (adapter.delay) so the settle pause is tracked/cancellable. */
        private readonly delay: (ms: number) => Promise<void>,
    ) {}

    invalidateTaskId(): void {
        this.taskId = { tid: null, ts: 0 };
    }

    private async mintTaskId(tuid: string): Promise<string> {
        if (!this.cfg.pin.trim()) {
            throw new CommandError('Command PIN not configured — set it in the adapter settings', null, 'pin');
        }
        const now = Date.now();
        if (this.pinFail.n >= PIN_FAIL_MAX && now - this.pinFail.ts < PIN_FAIL_WINDOW_MS) {
            throw new CommandError(
                `Command PIN temporarily blocked (${this.pinFail.n} wrong attempts) — reconfigure the PIN, then retry`,
                null,
                'pin',
            );
        }
        await this.client.bffPostJson(EP.vmcList, {});
        await this.client.bffPostJson(EP.setVecDefault, { vin: this.cfg.vin });
        const md5pin = createHash('md5').update(this.cfg.pin, 'utf-8').digest('hex'); // API-required PIN encoding
        const password = sm4Code(md5pin, 'padRight32');
        const j = await this.client.bffPostJson(EP.checkPassword, {
            vin: this.cfg.vin,
            tUserId: tuid,
            channelId: this.cfg.channelId,
            password,
            needDecode: 0,
            scene: 0,
            type: 0,
        });
        const data = j.data && typeof j.data === 'object' ? (j.data as Record<string, unknown>) : {};
        const tid = (data.taskId ?? j.taskId) as string | undefined;
        if (tid) {
            this.pinFail.n = 0; // success resets the anti-lockout counter
            return str(tid);
        }
        const code = j.code != null ? str(j.code) : null;
        if (code && NON_PIN_CODES.has(code)) {
            throw new CommandError('Session expired — request a new OTP from the adapter settings', code, 'reauth');
        }
        this.pinFail.n += 1;
        this.pinFail.ts = now;
        throw new CommandError('Wrong command PIN — reconfigure it in the adapter settings', code, 'pin');
    }

    private async getTaskId(tuid: string, allowCache: boolean): Promise<string> {
        if (allowCache && this.taskId.tid && Date.now() - this.taskId.ts < TASKID_TTL_MS) {
            return this.taskId.tid;
        }
        const tid = await this.mintTaskId(tuid);
        this.taskId = { tid, ts: Date.now() };
        return tid;
    }

    /**
     * Send a catalog command (serialized). `params` overrides the catalog body (e.g. temperature).
     *
     * @param cmdKey
     * @param params
     */
    async send(cmdKey: string, params?: SignParams): Promise<string> {
        const run = this.queue.then(
            () => this.sendInner(cmdKey, params),
            () => this.sendInner(cmdKey, params), // run even if a previous queued command failed
        );
        // Keep the chain alive but swallow its result/errors for the NEXT queued item;
        // also pause briefly so the car isn't hit while still busy (A00082).
        this.queue = run.then(
            () => this.delay(SETTLE_MS),
            () => this.delay(SETTLE_MS),
        );
        return run;
    }

    private async sendInner(cmdKey: string, params?: SignParams): Promise<string> {
        const c = COMMAND_CATALOG[cmdKey];
        if (!c) {
            throw new CommandError(`Unknown command: ${cmdKey}`);
        }
        const { userToken, tUserId } = await this.client.bffLogin();
        if (!userToken || !tUserId) {
            throw new CommandError('Session expired — request a new OTP from the adapter settings', null, 'reauth');
        }
        const path = c.path ?? `${EP.vehicleControl}${c.endpoint}`;

        for (const attempt of [1, 2]) {
            const taskId = await this.getTaskId(tUserId, attempt === 1);
            const ts = Date.now();
            const body: SignParams = {
                ...c.body,
                ...(params ?? {}),
                clientType: '1',
                seq: `${this.cfg.vin}-${ts}`,
                taskId,
                vin: this.cfg.vin,
            };
            this.log.debug(`sending ${c.name} (attempt ${attempt})`);
            const res = await this.client.signedTspPost(userToken, path, body, 'okhttp/4.9.2');
            const code = res.code;

            // Cached taskId no longer valid → drop it and re-mint once.
            if ((code === 'A00089' || code === 'A00546') && attempt === 1) {
                this.invalidateTaskId();
                continue;
            }

            const out = `${c.name}: HTTP ${res.status} ${code ?? ''} — ${codeMeaning(code, '')}`;
            if (code && FAILURE_CODES.has(code)) {
                const reason: CommandReason = code === 'A00000' ? 'reauth' : null;
                throw new CommandError(out, code, reason);
            }
            return out;
        }
        // Both attempts exhausted without success (only reachable via repeated A00089/A00546).
        throw new CommandError(`${c.name}: taskId rejected twice`, 'A00089', 'pin');
    }
}
