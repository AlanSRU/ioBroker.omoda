import { expect } from 'chai';
import { OmodaClient } from './client';
import { EP } from './constants';
import type { TokenStore } from './tokenStore';
import type { Logger, RuntimeConfig } from './types';

const noopLog = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

/** In-memory TokenStore: only the methods OmodaClient's session path uses. */
class FakeTokens {
    constructor(public doc: Record<string, unknown>) {}
    load(): Promise<unknown> {
        return Promise.resolve(this.doc);
    }
    save(doc: Record<string, unknown>): Promise<void> {
        this.doc = doc;
        return Promise.resolve();
    }
    getAccessToken(): string | undefined {
        return this.doc.access_token as string | undefined;
    }
    getRefreshToken(): string | undefined {
        return this.doc.refresh_token as string | undefined;
    }
    age(): Promise<null> {
        return Promise.resolve(null);
    }
}

type Reply = { status: number; data: unknown } | Error;

/** Replaces the client's axios instance; counts requests per endpoint. */
function client(
    tokens: FakeTokens,
    replies: (url: string) => Reply,
    log: Logger = noopLog,
): { c: OmodaClient; calls: string[] } {
    const c = new OmodaClient(
        { bff: 'https://bff', channelId: '1' } as RuntimeConfig,
        tokens as unknown as TokenStore,
        log,
    );
    const calls: string[] = [];
    (c as unknown as { http: unknown }).http = {
        post: (url: string): Promise<unknown> => {
            calls.push(url);
            const r = replies(url);
            return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
        },
    };
    return { c, calls };
}

const refreshCalls = (calls: string[]): number => calls.filter(u => u.includes(EP.token)).length;
const expired = { status: 200, data: { code: 'A00000', data: {} } };

describe('client/session refresh', () => {
    it('refreshes when login returns data without a userToken', async () => {
        const tokens = new FakeTokens({ access_token: 'AT1', refresh_token: 'RT1' });
        let loggedIn = false;
        const { c, calls } = client(tokens, url => {
            if (url.includes(EP.token)) {
                loggedIn = true;
                return { status: 200, data: { access_token: 'AT2', refresh_token: 'RT2' } };
            }
            return loggedIn ? { status: 200, data: { data: { userToken: 'UT', tUserId: 'TU' } } } : expired;
        });
        const r = await c.bffLogin();
        expect(refreshCalls(calls)).to.equal(1);
        expect(r.userToken).to.equal('UT');
    });

    it('does not resend a refresh_token the server already rejected', async () => {
        const tokens = new FakeTokens({ access_token: 'AT1', refresh_token: 'RT1' });
        const { c, calls } = client(tokens, url =>
            url.includes(EP.token) ? { status: 200, data: { code: '1', msg: 'invalid_grant' } } : expired,
        );
        for (let i = 0; i < 4; i++) {
            await c.checkSession();
        }
        expect(refreshCalls(calls)).to.equal(1);

        // A new refresh_token (fresh OTP) lifts the brake.
        tokens.doc = { access_token: 'AT9', refresh_token: 'RT9' };
        await c.checkSession();
        expect(refreshCalls(calls)).to.equal(2);
    });

    it('a network failure neither burns the token nor reports the session expired', async () => {
        const tokens = new FakeTokens({ access_token: 'AT1', refresh_token: 'RT1' });
        const { c, calls } = client(tokens, url =>
            url.includes(EP.token) ? Object.assign(new Error('timeout'), { name: 'AxiosError' }) : expired,
        );
        const first = await c.checkSession();
        expect(first.ok).to.equal(false);
        expect(first.detail).to.contain('network');
        await c.checkSession();
        expect(refreshCalls(calls)).to.equal(2); // retried: not burnt
    });

    it('warns about a dead session once, not on every check', async () => {
        const warns: string[] = [];
        const log = { ...noopLog, warn: (m: string): void => void warns.push(m) };
        const tokens = new FakeTokens({ access_token: 'AT1', refresh_token: 'RT1' });
        const { c } = client(
            tokens,
            url => (url.includes(EP.token) ? { status: 200, data: { code: '1', msg: 'invalid_grant' } } : expired),
            log,
        );
        for (let i = 0; i < 5; i++) {
            await c.checkSession();
        }
        // login failure + first refresh rejection + "already rejected" — then silence
        expect(warns.length).to.equal(3);
    });
});
