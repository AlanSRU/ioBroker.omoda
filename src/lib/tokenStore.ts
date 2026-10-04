/*
 * Persistent OAuth token store. Replaces the HA integration's `token.json` on disk
 * (wake.py `_access_token` / atomic write). Tokens live in the adapter's per-instance
 * data dir — NOT in `native` config (writing native restarts the instance, and the
 * refresh_token rotates on every use).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Logger, TokenDoc } from './types';

/**
 * Reads access/refresh from either a flat doc or a {data:{...}} wrapper (like wake._access_token).
 *
 * @param doc
 * @param key
 */
function pick(doc: TokenDoc | null, key: 'access_token' | 'refresh_token'): string | undefined {
    if (!doc || typeof doc !== 'object') {
        return undefined;
    }
    const d = (doc.data && typeof doc.data === 'object' ? doc.data : doc) as Record<string, unknown>;
    const v = d[key] ?? (doc as Record<string, unknown>)[key];
    return typeof v === 'string' && v ? v : undefined;
}

export class TokenStore {
    private readonly file: string;
    private doc: TokenDoc | null = null;

    constructor(
        dataDir: string,
        private readonly log: Logger,
    ) {
        this.file = path.join(dataDir, 'token.json');
    }

    /** Load token.json from disk into memory. Safe to call repeatedly. */
    async load(): Promise<TokenDoc | null> {
        try {
            const raw = await fs.readFile(this.file, 'utf-8');
            this.doc = JSON.parse(raw) as TokenDoc;
        } catch {
            this.doc = null;
        }
        return this.doc;
    }

    /**
     * Atomic write (tmp + rename), owner-only perms — mirrors prova_token/refresh writes.
     *
     * @param doc
     */
    async save(doc: TokenDoc): Promise<void> {
        this.doc = doc;
        const dir = path.dirname(this.file);
        await fs.mkdir(dir, { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(doc), { encoding: 'utf-8', mode: 0o600 });
        await fs.rename(tmp, this.file);
    }

    hasToken(): boolean {
        return !!pick(this.doc, 'access_token');
    }

    getAccessToken(): string | undefined {
        return pick(this.doc, 'access_token');
    }

    getRefreshToken(): string | undefined {
        return pick(this.doc, 'refresh_token');
    }

    /**
     * Seconds since token.json was last written, and the access token's declared lifetime
     * (`expires_in`). The token is opaque (not a JWT), so the file's mtime is the only record of
     * when it was issued — it is rewritten on every mint/refresh (upstream wake._eta_token).
     * Returns null when either is unknown.
     */
    async age(): Promise<{ ageSec: number; lifeSec: number } | null> {
        try {
            const st = await fs.stat(this.file);
            await this.load();
            const d = this.doc?.data && typeof this.doc.data === 'object' ? this.doc.data : this.doc;
            const lifeSec = Number(d?.expires_in ?? 0);
            if (!(lifeSec > 0)) {
                return null;
            }
            return { ageSec: Math.max(0, (Date.now() - st.mtimeMs) / 1000), lifeSec };
        } catch {
            return null;
        }
    }
}
