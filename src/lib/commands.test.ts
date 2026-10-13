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
    tspCalls: Array<{ path: string; body: Record<string, unknown> }> = [];

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
    signedTspPost(_token: string, path: string, body: Record<string, unknown>): Promise<TspResult> {
        this.tspCalls.push({ path, body });
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

    it('re-mints once when the car answers a command with A00567 (taskId invalid)', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ data: { taskId: 'T1' } }, { data: { taskId: 'T2' } }];
        fc.tspQueue = [
            { status: 200, code: 'A00567', json: { code: 'A00567' } },
            { status: 200, code: '000000', json: {} },
        ];
        const out = await runner(fc).send('blocca');
        expect(checkPwCount(fc)).to.equal(2);
        expect(out).to.contain('Lock doors');
    });

    // The backend has no documented "wrong PIN" code — a wrong PIN falls through to the default
    // branch, so an unrecognised code is what exercises it. A00567 is NOT that: it means
    // "incomplete checkPassword parameters", i.e. a request-construction fault (see CONFIG_CODES).
    it('raises a pin CommandError when checkPassword returns no taskId', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ code: 'A09999' }];
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

    it('routes a config code (A00567) to a config CommandError without counting the lockout', async () => {
        const fc = new FakeClient();
        // Three config-code rejections in a row: none may count towards the anti-lockout, so all
        // three still reach the backend rather than the third being blocked locally.
        fc.checkPasswordQueue = [{ code: 'A00567' }, { code: 'A00567' }, { code: 'A00567' }];
        const r = runner(fc);
        for (let i = 0; i < 3; i++) {
            try {
                await r.send('blocca');
                expect.fail('expected CommandError');
            } catch (e) {
                expect(e).to.be.instanceOf(CommandError);
                expect((e as CommandError).reason).to.equal('config');
            }
        }
        expect(checkPwCount(fc)).to.equal(3);
    });

    it('does not count busy/asleep/permission answers towards the lockout', async () => {
        const fc = new FakeClient();
        // Each would have burned an attempt before, so the third would be blocked locally and
        // the user told their (correct) PIN was wrong.
        const codes = ['A00084', 'A00082', 'A07900', 'A07312', 'A00089', 'A00546', '000000'];
        fc.checkPasswordQueue = codes.map(code => ({ code }));
        const r = runner(fc);
        for (const code of codes) {
            try {
                await r.send('blocca');
                expect.fail('expected CommandError');
            } catch (e) {
                expect(e).to.be.instanceOf(CommandError);
                expect((e as CommandError).reason, code).to.equal(code === 'A00084' ? 'config' : null);
            }
        }
        expect(checkPwCount(fc)).to.equal(codes.length);
    });

    it('blocks after repeated wrong PINs (anti-lockout) before hitting the account', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ code: 'A09999' }, { code: 'A09999' }, { code: 'A09999' }];
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

    for (const [key, controlType, name] of [
        ['ricarica_start', '1', 'Start charging'],
        ['ricarica_stop', '0', 'Stop charging'],
    ]) {
        it(`sends ${key} to chargeStartStopControl with controlType ${controlType}`, async () => {
            const fc = new FakeClient();
            fc.checkPasswordQueue = [{ data: { taskId: 'T1' } }];
            fc.tspQueue = [{ status: 200, code: 'A00079', json: {} }];
            const out = await runner(fc).send(key);
            expect(fc.tspCalls).to.have.length(1);
            const { path, body } = fc.tspCalls[0];
            expect(path).to.match(/\/asc\/vehicleControl\/chargeStartStopControl$/);
            expect(body).to.include({ controlType, taskId: 'T1', vin: 'VIN1', clientType: '1' });
            expect(out).to.contain(name);
        });
    }

    it('reports a charge command the car refuses (A00084, A00082) as a non-PIN CommandError', async () => {
        for (const code of ['A00084', 'A00082']) {
            const fc = new FakeClient();
            fc.checkPasswordQueue = [{ data: { taskId: 'T1' } }];
            fc.tspQueue = [{ status: 200, code, json: { code } }];
            try {
                await runner(fc).send('ricarica_stop');
                expect.fail('expected CommandError');
            } catch (e) {
                expect(e).to.be.instanceOf(CommandError);
                expect((e as CommandError).code, code).to.equal(code);
                expect((e as CommandError).reason, code).to.equal(null);
                expect((e as Error).message).to.contain('Stop charging');
            }
        }
    });

    it('sends a scheduled-charging plan as a nested array, overriding the catalog default', async () => {
        const fc = new FakeClient();
        fc.checkPasswordQueue = [{ data: { taskId: 'T1' } }];
        fc.tspQueue = [{ status: 200, code: 'A00079', json: {} }];
        const plan = { cycleData: [1, 2, 3, 4, 5, 6, 7], startTime: 1290, switchStatus: 1, timeConsuming: 570 };
        await runner(fc).send('ricarica_prog_on', { mainSwitch: 1, chargeAppointPlans: [plan] });
        const { path, body } = fc.tspCalls[0];
        expect(path).to.match(/\/asc\/vehicleControl\/chargeAppointControl$/);
        expect(body.mainSwitch).to.equal(1);
        expect(body.chargeAppointPlans).to.deep.equal([plan]);
        expect(body).to.include({ taskId: 'T1', vin: 'VIN1' });
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
