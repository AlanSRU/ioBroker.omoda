import { expect } from 'chai';
import { CommandRunner, CommandError } from './commands';
import type { OmodaClient } from './client';
import type { TspResult } from './types';

const noopLog = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
const noDelay = (): Promise<void> => Promise.resolve();

/** Minimal fake OmodaClient exercising only the methods CommandRunner uses. */
class FakeClient {
    bffCalls: string[] = [];
    checkPasswordQueue: Array<Record<string, unknown>> = [];
    tspQueue: TspResult[] = [];

    bffLogin(): Promise<{ userToken?: string; tUserId?: string }> {
        return Promise.resolve({ userToken: 'UT', tUserId: 'TU' });
    }
    bffPostJson(path: string): Promise<Record<string, unknown>> {
        this.bffCalls.push(path);
        if (path.includes('checkPassword')) {
            return Promise.resolve(this.checkPasswordQueue.shift() ?? {});
        }
        return Promise.resolve({});
    }
    signedTspPost(): Promise<TspResult> {
        return Promise.resolve(this.tspQueue.shift() ?? { status: 200, code: '000000', json: {} });
    }
}

function runner(fc: FakeClient): CommandRunner {
    return new CommandRunner(
        fc as unknown as OmodaClient,
        { vin: 'VIN1', pin: '1234', channelId: '1' },
        noopLog,
        noDelay,
    );
}

const checkPwCount = (fc: FakeClient): number => fc.bffCalls.filter(p => p.includes('checkPassword')).length;

describe('commands/CommandRunner', () => {
    it('mints a taskId once and reuses it from cache for subsequent commands', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ data: { taskId: 'T1' } }];
        fc.tspQueue = [
            { status: 200, code: '000000', json: {} },
            { status: 200, code: '000000', json: {} },
        ];
        const r = runner(fc);
        await r.send('blocca');
        await r.send('sblocca');
        expect(checkPwCount(fc)).to.equal(1); // second command used the cached taskId
    });

    it('re-mints once when the car rejects the cached taskId (A00089)', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ data: { taskId: 'T1' } }, { data: { taskId: 'T2' } }];
        fc.tspQueue = [
            { status: 200, code: 'A00089', json: { code: 'A00089' } },
            { status: 200, code: '000000', json: {} },
        ];
        const out = await runner(fc).send('blocca');
        expect(checkPwCount(fc)).to.equal(2);
        expect(out).to.contain('Lock doors');
    });

    it('raises a pin CommandError when checkPassword returns no taskId', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ code: 'A00567' }];
        try {
            await runner(fc).send('blocca');
            expect.fail('expected CommandError');
        } catch (e) {
            expect(e).to.be.instanceOf(CommandError);
            expect((e as CommandError).reason).to.equal('pin');
        }
    });

    it('routes A00000 (expired token) to a reauth CommandError, not the PIN lockout', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ code: 'A00000' }];
        try {
            await runner(fc).send('blocca');
            expect.fail('expected CommandError');
        } catch (e) {
            expect((e as CommandError).reason).to.equal('reauth');
        }
    });

    it('blocks after repeated wrong PINs (anti-lockout) before hitting the account', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ code: 'A00567' }, { code: 'A00567' }, { code: 'A00567' }];
        const r = runner(fc);
        const attempt = async (): Promise<string> => {
            try {
                return await r.send('blocca');
            } catch (e) {
                return (e as Error).message;
            }
        };
        await attempt();
        await attempt();
        const third = await attempt();
        expect(third.toLowerCase()).to.contain('blocked');
        // Only 2 checkPassword round-trips reached the backend; the 3rd was blocked locally.
        expect(checkPwCount(fc)).to.equal(2);
    });

    it('refuses to mint with an empty PIN', async () => {
        const fc = new FakeClient();
        const r = new CommandRunner(
            fc as unknown as OmodaClient,
            { vin: 'VIN1', pin: '', channelId: '1' },
            noopLog,
            noDelay,
        );
        try {
            await r.send('blocca');
            expect.fail('expected CommandError');
        } catch (e) {
            expect((e as CommandError).reason).to.equal('pin');
            expect(checkPwCount(fc)).to.equal(0);
        }
    });
});
