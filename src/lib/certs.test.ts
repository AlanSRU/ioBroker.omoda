import { expect } from 'chai';
import * as path from 'path';
import { availableRegions, decryptRegion, loadStore } from './certs';

const STORE = path.join(__dirname, '..', '..', 'data', 'certs-store.json');

describe('certs/decryptRegion', () => {
    it('bundles the EU broker and ~40 regions', async () => {
        const store = await loadStore(STORE);
        const regions = availableRegions(store);
        expect(regions.length).to.be.greaterThan(30);
        expect(regions).to.include('tspemqx-app-eu.cheryinternational.com');
    });

    it('deobfuscates the EU certs into valid PEM buffers', async () => {
        const store = await loadStore(STORE);
        const certs = decryptRegion(store, 'tspemqx-app-eu.cheryinternational.com');
        expect(certs, 'EU region should decode').to.not.equal(null);
        expect(certs!.ca.toString('utf-8')).to.contain('-----BEGIN CERTIFICATE-----');
        expect(certs!.cert.toString('utf-8')).to.contain('-----BEGIN CERTIFICATE-----');
        expect(certs!.key.toString('utf-8')).to.match(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/);
    });

    it('returns null for an unknown region', async () => {
        const store = await loadStore(STORE);
        expect(decryptRegion(store, 'no-such-host')).to.equal(null);
    });
});
