/*
 * certs.ts — provisioning of the MQTT mutual-TLS certificates for the car's EMQX broker.
 *
 * Port of cert_bundle.py. The client certs (CN=client) are UNIVERSAL per-region constants
 * taken verbatim from the app's PUBLIC APK assets — NOT per-account data. Account isolation
 * happens via the MQTT username/password + topic ACLs. In the bundle they are obfuscated with
 * a fixed XOR keystream (length-preserving), exactly as libapp.so deobfuscates them at runtime.
 *
 * The certs are returned as in-memory Buffers and handed straight to mqtt.connect — no files.
 */
import { promises as fs } from 'node:fs';

export interface CertSet {
    ca: Buffer;
    cert: Buffer;
    key: Buffer;
}

interface Store {
    ks: string;
    regions: Record<string, { 'ca.pem'?: string; 'client.pem'?: string; 'client.key'?: string }>;
}

let cache: Store | null = null;

/**
 * Load and cache the bundled region cert store from disk.
 *
 * @param storePath
 */
export async function loadStore(storePath: string): Promise<Store> {
    if (!cache) {
        cache = JSON.parse(await fs.readFile(storePath, 'utf-8')) as Store;
    }
    return cache;
}

/**
 * MQTT broker hosts (regions) for which a bundled cert set exists.
 *
 * @param store
 */
export function availableRegions(store: Store): string[] {
    return Object.keys(store.regions ?? {}).sort();
}

function xor(ctB64: string, ks: Buffer): Buffer | null {
    const ct = Buffer.from(ctB64, 'base64');
    if (ct.length > ks.length) {
        return null;
    }
    const out = Buffer.alloc(ct.length);
    for (let i = 0; i < ct.length; i++) {
        out[i] = ct[i] ^ ks[i];
    }
    return out;
}

/**
 * Deobfuscate the mutual-TLS certs for MQTT broker `host`, or null if the region is not
 * bundled. Mirrors cert_bundle.decrypt_region (XOR with the fixed keystream).
 *
 * @param store
 * @param host
 */
export function decryptRegion(store: Store, host: string): CertSet | null {
    const reg = store.regions?.[host];
    if (!reg) {
        return null;
    }
    const ks = Buffer.from(store.ks, 'base64');
    const ca = reg['ca.pem'] ? xor(reg['ca.pem'], ks) : null;
    const cert = reg['client.pem'] ? xor(reg['client.pem'], ks) : null;
    const key = reg['client.key'] ? xor(reg['client.key'], ks) : null;
    if (!ca || !cert || !key) {
        return null;
    }
    return { ca, cert, key };
}
