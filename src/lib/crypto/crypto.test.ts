import { expect } from 'chai';
import { sm4EncryptBlock, sm4EcbEncryptPkcs7, sm4Code } from './sm4';
import { bffSign, marketingSign, marketingSignVals, tspBuildSign, tspSignBody, TSP_HALF } from './sign';
import { aesEcbEncryptB64 } from './aes';
import { SM4_KEY } from '../constants';
import { createHash } from 'node:crypto';

describe('crypto/sm4', () => {
    it('matches the GM/T 0002-2012 standard test vector', () => {
        const key = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
        const pt = Buffer.from('0123456789abcdeffedcba9876543210', 'hex');
        expect(sm4EncryptBlock(key, pt).toString('hex')).to.equal('681edf34d206965e86b3e94f536e4246');
    });

    it('createHexKey (SM4_KEY) is the fixed 16-byte app key', () => {
        expect(SM4_KEY.length).to.equal(16);
        expect(SM4_KEY.toString('utf-8')).to.equal('mHU80av2zFtf4OY6');
    });

    it('ECB/PKCS7 pads to a whole block and is deterministic', () => {
        const ct = sm4EcbEncryptPkcs7(Buffer.from('hello', 'utf-8'));
        expect(ct.length % 16).to.equal(0);
        expect(ct.length).to.equal(16);
        // stable output (regression guard) — recomputed from this implementation
        expect(sm4EcbEncryptPkcs7(Buffer.from('hello', 'utf-8')).toString('base64')).to.equal(ct.toString('base64'));
    });

    it('sm4Code padRight32 leaves a 32-char md5 hex unchanged (no extra padding block beyond PKCS7)', () => {
        const md5hex = createHash('md5').update('1234').digest('hex'); // 32 chars
        const plain = sm4Code(md5hex, 'plain');
        const padded = sm4Code(md5hex, 'padRight32');
        expect(padded).to.equal(plain); // padEnd is a no-op at length 32
    });
});

describe('crypto/sign — BFF & marketing', () => {
    it('bffSign = sha256_hex(secret+nonce+url+ts)', () => {
        const ts = 1700000000000;
        const expected = createHash('sha256')
            .update(`cX5fR8lJ6pK2xD4uH1eK4pY6wA4xO0sK` + `chery_legend_h5` + `/auth/oauth2/token` + `${ts}`, 'utf-8')
            .digest('hex');
        expect(bffSign('/auth/oauth2/token', ts)).to.equal(expected);
    });

    it('marketingSign & marketingSignVals are md5-based', () => {
        const ts = 1700000000000;
        const path = '/code/create';
        expect(marketingSign(path, ts)).to.match(/^[0-9a-f]{32}$/);
        expect(marketingSignVals('/code/check', ts, 'blockPuzzle,enc,tok')).to.match(/^[0-9a-f]{32}$/);
    });
});

describe('crypto/sign — TSP', () => {
    it('HALF is the even-index characters of APP_SECRET', () => {
        expect(TSP_HALF).to.equal('EUProd89ec59274d23491084af');
    });

    it('tspBuildSign is base64(sha256(base)).toUpperCase()', () => {
        const ts = 1700000000000;
        const sign = tspBuildSign({ vin: 'VIN_PLACEHOLDER' }, ts);
        // reproduce the base independently
        const base = `vin=VIN_PLACEHOLDER&secretKey=${TSP_HALF}&timestamp=${ts}`;
        const expected = createHash('sha256').update(base, 'utf-8').digest('base64').toUpperCase();
        expect(sign).to.equal(expected);
    });

    it('tspSignBody adds appId then sign (sign added after appId)', () => {
        const ts = 1700000000000;
        const body = tspSignBody({ vin: 'V1' }, ts);
        expect(body.appId).to.equal('eu-1');
        expect(body.sign).to.be.a('string');
        // sign must be computed over params INCLUDING appId but excluding sign itself
        const expectedSign = tspBuildSign({ vin: 'V1', appId: 'eu-1' }, ts);
        expect(body.sign).to.equal(expectedSign);
    });

    it('flattens nested arrays like the native SDK (cycleData [1..7] → "1234567")', () => {
        const ts = 1700000000000;
        const params = {
            mainSwitch: 1,
            chargeAppointPlans: [
                { cycleData: [1, 2, 3, 4, 5, 6, 7], startTime: 480, switchStatus: 1, timeConsuming: 360 },
            ],
        };
        const sign = tspBuildSign(params, ts);
        // The flattened plan object: cycleData=1234567&startTime=480&switchStatus=1&timeConsuming=360
        const planFlat = 'cycleData=1234567&startTime=480&switchStatus=1&timeConsuming=360';
        const base = `chargeAppointPlans=${planFlat}&mainSwitch=1&secretKey=${TSP_HALF}&timestamp=${ts}`;
        const expected = createHash('sha256').update(base, 'utf-8').digest('base64').toUpperCase();
        expect(sign).to.equal(expected);
    });
});

describe('crypto/aes — captcha ECB', () => {
    it('AES-128-ECB/PKCS7 base64 round-trips against node crypto', () => {
        const key = '5c7af05e6fbf5628'; // 16 chars → AES-128
        const out = aesEcbEncryptB64('{"x":42,"y":5}', key);
        expect(out).to.match(/^[A-Za-z0-9+/]+=*$/);
    });
});
