import { expect } from 'chai';
import { chooseAirDuration, clampTemperature, parseAirDurations, plausibleClimateRange } from './climate';

describe('climate/parseAirDurations', () => {
    it('parses the comma-separated set, deduplicated and sorted', () => {
        expect(parseAirDurations('15,5,10,5')).to.deep.equal([5, 10, 15]);
        expect(parseAirDurations(' 5 , 10.0 ,')).to.deep.equal([5, 10]);
        expect(parseAirDurations(10)).to.deep.equal([10]);
    });

    it('drops implausible values and returns undefined when nothing usable is left', () => {
        expect(parseAirDurations('0,10,61')).to.deep.equal([10]);
        expect(parseAirDurations('0,-5')).to.equal(undefined);
        expect(parseAirDurations('')).to.equal(undefined);
    });

    it('discards the whole field when absent or unparseable', () => {
        expect(parseAirDurations(undefined)).to.equal(undefined);
        expect(parseAirDurations(null)).to.equal(undefined);
        expect(parseAirDurations('5,abc')).to.equal(undefined);
        expect(parseAirDurations('Infinity')).to.equal(undefined);
    });
});

describe('climate/chooseAirDuration', () => {
    it('keeps the wanted value when allowed or when the set is unknown', () => {
        expect(chooseAirDuration(15, [5, 10, 15])).to.equal(15);
        expect(chooseAirDuration(15, undefined)).to.equal(15);
        expect(chooseAirDuration(15, [])).to.equal(15);
    });

    it('takes the largest allowed value not above the wanted one', () => {
        expect(chooseAirDuration(15, [5, 10])).to.equal(10);
        expect(chooseAirDuration(15, [5, 10, 20])).to.equal(10);
    });

    it('takes the smallest allowed value when all are above the wanted one', () => {
        expect(chooseAirDuration(15, [20, 30])).to.equal(20);
    });
});

describe('climate/plausibleClimateRange', () => {
    it('accepts a plausible range and step', () => {
        expect(plausibleClimateRange(16, 30, 1)).to.deep.equal({ min: 16, max: 30, step: 1 });
        expect(plausibleClimateRange(14, 33, 0.5)).to.deep.equal({ min: 14, max: 33, step: 0.5 });
    });

    it('rejects an implausible or inverted pair as a whole, keeping a valid step', () => {
        const noRange = { min: undefined, max: undefined, step: 1 };
        expect(plausibleClimateRange(10, 30, 1)).to.deep.equal(noRange);
        expect(plausibleClimateRange(16, 40, 1)).to.deep.equal(noRange);
        expect(plausibleClimateRange(30, 16, 1)).to.deep.equal(noRange);
        expect(plausibleClimateRange(20, 20, 1)).to.deep.equal(noRange);
        expect(plausibleClimateRange(16, undefined, 1)).to.deep.equal(noRange);
    });

    it('rejects a step other than 0.5 or 1.0', () => {
        expect(plausibleClimateRange(16, 30, 2).step).to.equal(undefined);
        expect(plausibleClimateRange(16, 30, 0).step).to.equal(undefined);
    });
});

describe('climate/clampTemperature', () => {
    it('clamps into the declared range', () => {
        expect(clampTemperature(10, 16, 30)).to.equal(16);
        expect(clampTemperature(35, 16, 30)).to.equal(30);
        expect(clampTemperature(21.5, 16, 30)).to.equal(21.5);
    });

    it('leaves the value untouched when the range is unknown', () => {
        expect(clampTemperature(35, undefined, undefined)).to.equal(35);
        expect(clampTemperature(10, 16, undefined)).to.equal(10);
    });
});
