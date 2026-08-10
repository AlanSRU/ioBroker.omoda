import { expect } from 'chai';
import { STATES } from './objects';

/**
 * The state-role contract for every role this adapter uses, transcribed from
 * ioBroker.repochecker's STATE_ROLE_RULES (lib/config_StateRoles.js), which implements
 * https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md
 *
 * Only the roles actually in use are pinned here, deliberately: introducing a state with a new
 * role should be a conscious act — look the role up in the spec and add its contract below.
 *
 * repochecker cannot check any of this itself. It validates `common.role` only for objects
 * declared statically in io-package.json, and this adapter builds its whole per-VIN tree at
 * runtime, so every state here is invisible to it.
 */
interface RoleRule {
    types: string[];
    read?: boolean;
    write?: boolean;
}

const ROLE_RULES: Record<string, RoleRule> = {
    button: { types: ['boolean'], read: false, write: true },
    indicator: { types: ['boolean'], read: true, write: false },
    'indicator.reachable': { types: ['boolean'], read: true, write: false },
    'info.model': { types: ['string'], read: true, write: false },
    'info.name': { types: ['string'], read: true },
    'level.temperature': { types: ['number'], read: true, write: true },
    'sensor.door': { types: ['boolean'], read: true, write: false },
    'sensor.window': { types: ['boolean'], read: true, write: false },
    switch: { types: ['boolean'], read: true, write: true },
    'switch.lock': { types: ['boolean'], read: true, write: true },
    text: { types: ['string'] },
    value: { types: ['number'], read: true, write: false },
    'value.battery': { types: ['number'], read: true, write: false },
    'value.direction': { types: ['number'], read: true, write: false },
    'value.distance': { types: ['number'], read: true, write: false },
    'value.gps.latitude': { types: ['number'], read: true, write: false },
    'value.gps.longitude': { types: ['number'], read: true, write: false },
    'value.power': { types: ['number'], read: true, write: false },
    'value.pressure': { types: ['number'], read: true, write: false },
    'value.speed': { types: ['number'], read: true, write: false },
    'value.temperature': { types: ['number'], read: true, write: false },
    'value.time': { types: ['number'], read: true, write: false },
};

/**
 * `info.*` roles that name one specific attribute of a device rather than describing a generic
 * string. Misusing one of these is what shipped in 0.1.1: info.model and info.brand both carried
 * role `info.name`. A validity check cannot catch that — `info.name` is a perfectly legal role
 * and the states satisfied its type/read/write contract. The rule that does catch it: an identity
 * role may only sit on the state it names, i.e. the id's last segment matches the role's.
 *
 * A state with no matching identity role (info.brand — the spec has no `info.brand`) must fall
 * back to the generic `text` role instead of borrowing a neighbouring one.
 */
const IDENTITY_ROLES = new Set([
    'info.address',
    'info.firmware',
    'info.hardware',
    'info.ip',
    'info.mac',
    'info.model',
    'info.name',
    'info.port',
    'info.serial',
]);

const lastSegment = (id: string): string => id.slice(id.lastIndexOf('.') + 1);

describe('objects/STATES roles', () => {
    it('uses only roles with a pinned contract', () => {
        const unknown = STATES.filter(s => !ROLE_RULES[s.common.role]).map(s => `${s.id} → ${s.common.role}`);
        expect(unknown, 'add the role contract from the ioBroker stateroles spec').to.deep.equal([]);
    });

    it('satisfies each role type/read/write contract', () => {
        const violations: string[] = [];
        for (const { id, common } of STATES) {
            const rule = ROLE_RULES[common.role];
            if (!rule) {
                continue; // reported by the previous test
            }
            if (!rule.types.includes(common.type)) {
                violations.push(`${id}: role ${common.role} requires type ${rule.types.join('|')}, got ${common.type}`);
            }
            if (rule.read !== undefined && common.read !== rule.read) {
                violations.push(`${id}: role ${common.role} requires read=${rule.read}, got ${common.read}`);
            }
            if (rule.write !== undefined && common.write !== rule.write) {
                violations.push(`${id}: role ${common.role} requires write=${rule.write}, got ${common.write}`);
            }
        }
        expect(violations).to.deep.equal([]);
    });

    it('does not put an identity info.* role on a differently-named state', () => {
        const misused = STATES.filter(
            s => IDENTITY_ROLES.has(s.common.role) && lastSegment(s.common.role) !== lastSegment(s.id),
        ).map(s => `${s.id} carries role ${s.common.role}`);
        expect(misused, 'use the role that names this state, or the generic "text" role').to.deep.equal([]);
    });

    it('gives every writable state a writable role', () => {
        const wrong = STATES.filter(s => s.common.write && ROLE_RULES[s.common.role]?.write === false).map(
            s => `${s.id} is writable but role ${s.common.role} is read-only`,
        );
        expect(wrong).to.deep.equal([]);
    });
});
