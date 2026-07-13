/*
 * telemetry.ts — mutual-TLS MQTT connection to the car's EMQX broker (coordinator._connect_car
 * + _on_car_message). One client per VIN/account. Parses the car's pushes and forwards them via
 * callbacks; the controller turns them into ioBroker state writes.
 *
 *   client_id = "app_<channelId>_<tUserId>"      username = <tUserId>
 *   password  = md5(<tUserId> + CAR_SEED)         topic    = app/<ch>/<tUserId>/account/msgCenter/msg
 *   TLS: pinned CA chain validated, hostname check skipped (vendor CN mismatch).
 */
import { createHash } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import { CAR_SEED } from './constants';
import type { CertSet } from './certs';
import type { Logger } from './types';
import { str } from './util';

/** Command-confirmation meta-fields — NOT vehicle telemetry (coordinator.CMD_CONFIRM_META). */
const CMD_CONFIRM_META = new Set(['result', 'resultTime', 'seq', 'reason', 'hasAsy']);

export interface TelemetryHandlers {
    /** Vehicle state fields from a 5A02 (or the state part of a confirmation) push. */
    onFields(fields: Record<string, string>): void;
    /** GPS geolocation from a 1301 push. */
    onGeo(data: Record<string, unknown>): void;
    /** A command-confirmation push (has `result`/`seq`). */
    onConfirmation(data: Record<string, unknown>): void;
    /** MQTT connection state changes. */
    onConnected(connected: boolean): void;
    /** First push after the car was idle (edge) — used to trigger a realtime probe. */
    onWake(): void;
}

function isObj(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

export class MqttTelemetry {
    private client: MqttClient | null = null;
    private lastMsgTs = 0;
    private readonly awakeWindowMs: number;

    constructor(
        private readonly opts: {
            host: string;
            port: number;
            channelId: string;
            tuserId: string;
            certs: CertSet;
            awakeWindowSec: number;
        },
        private readonly log: Logger,
        private readonly handlers: TelemetryHandlers,
    ) {
        this.awakeWindowMs = opts.awakeWindowSec * 1000;
    }

    connect(): void {
        const { host, port, channelId, tuserId, certs } = this.opts;
        const password = createHash('md5').update(`${tuserId}${CAR_SEED}`).digest('hex');
        const clientId = `app_${channelId}_${tuserId}`;
        const topic = `app/${channelId}/${tuserId}/account/msgCenter/msg`;

        const client = mqtt.connect(`mqtts://${host}:${port}`, {
            clientId,
            username: tuserId,
            password,
            protocolVersion: 4, // MQTT 3.1.1
            clean: false,
            keepalive: 60,
            reconnectPeriod: 10000,
            connectTimeout: 30000,
            ca: certs.ca,
            cert: certs.cert,
            key: certs.key,
            // Validate the chain against the pinned CA, but skip hostname verification —
            // the broker cert CN does not match the host (coordinator tls_insecure_set).
            // checkServerIdentity is a pass-through TLS option not in mqtt's typings.
            rejectUnauthorized: true,
            checkServerIdentity: () => undefined,
        } as mqtt.IClientOptions);

        client.on('connect', () => {
            this.log.info(`[${tuserId}] car MQTT connected → subscribing ${topic}`);
            this.handlers.onConnected(true);
            client.subscribe(topic, { qos: 1 }, err => {
                if (err) {
                    this.log.warn(`car MQTT subscribe failed: ${err.message}`);
                }
            });
        });
        client.on('reconnect', () => this.log.debug('car MQTT reconnecting…'));
        client.on('close', () => this.handlers.onConnected(false));
        client.on('error', err => this.log.warn(`car MQTT error: ${err.message}`));
        client.on('message', (_t, payload) => this.onMessage(payload));

        this.client = client;
    }

    private onMessage(payload: Buffer): void {
        let obj: unknown;
        try {
            obj = JSON.parse(payload.toString('utf-8'));
        } catch (err) {
            this.log.debug(`undecodable MQTT payload: ${(err as Error).message}`);
            return;
        }
        const content = isObj(obj) && isObj(obj.content) ? obj.content : isObj(obj) ? obj : {};
        const data = isObj(content.data) ? content.data : {};
        const svc = content.serviceType != null ? str(content.serviceType) : '';

        const now = Date.now();
        const wasAwake = this.lastMsgTs > 0 && now - this.lastMsgTs < this.awakeWindowMs;
        this.lastMsgTs = now;

        if (svc === '1301' && 'lat' in data && 'lon' in data) {
            this.handlers.onGeo(data);
        }

        const isConfirmation = 'result' in data || 'seq' in data;

        // State fields = everything except "time" and the confirmation meta-fields.
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
            if (k !== 'time' && !CMD_CONFIRM_META.has(k)) {
                fields[k] = str(v);
            }
        }
        if (Object.keys(fields).length) {
            this.handlers.onFields(fields);
        }
        if (isConfirmation) {
            this.handlers.onConfirmation(data);
        }
        if (!wasAwake) {
            this.handlers.onWake();
        }
    }

    /** Graceful shutdown (force=false lets in-flight publishes drain). */
    async close(): Promise<void> {
        const c = this.client;
        this.client = null;
        if (!c) {
            return;
        }
        await new Promise<void>(resolve => {
            c.end(false, {}, () => resolve());
        });
    }
}
