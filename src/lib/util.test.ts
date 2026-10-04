import { expect } from 'chai';
import { telemetryFingerprint } from './util';

describe('util/telemetryFingerprint', () => {
    it('ignores the clock fields, at any depth', () => {
        const a = { dumpEnergy: '80', resultTime: 1, time: 2, nested: { collectTime: 3, x: 1 } };
        const b = { dumpEnergy: '80', resultTime: 9, updateTime: 8, nested: { collectTime: 7, x: 1 } };
        expect(telemetryFingerprint(a)).to.equal(telemetryFingerprint(b));
    });

    it('does not depend on key order', () => {
        expect(telemetryFingerprint({ a: 1, b: { c: 2, d: 3 } })).to.equal(
            telemetryFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
        );
    });

    it('changes when a real value changes', () => {
        expect(telemetryFingerprint({ dumpEnergy: '41' })).to.not.equal(telemetryFingerprint({ dumpEnergy: '40' }));
    });
});
