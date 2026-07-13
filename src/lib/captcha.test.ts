import { expect } from 'chai';
import { buildTemplate, findGapX } from './captcha';

interface Gray {
    w: number;
    h: number;
    data: Uint8Array;
}

/**
 * Build an RGBA image; `paint(x,y)` returns [r,g,b,a] or null for transparent/black.
 *
 * @param w
 * @param h
 * @param paint
 */
function makeImage(
    w: number,
    h: number,
    paint: (x: number, y: number) => [number, number, number, number] | null,
): Gray {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = paint(x, y);
            const o = (y * w + x) * 4;
            if (p) {
                data[o] = p[0];
                data[o + 1] = p[1];
                data[o + 2] = p[2];
                data[o + 3] = p[3];
            }
        }
    }
    return { w, h, data };
}

describe('captcha/findGapX', () => {
    // Jigsaw piece = a filled circle (non-trivial outline so the template has energy).
    const jig = makeImage(60, 60, (x, y) => {
        const d = Math.hypot(x - 30, y - 30);
        return d <= 15 ? [0, 0, 0, 255] : null;
    });

    it('builds a non-empty morphological-gradient template from the piece alpha', () => {
        const tpl = buildTemplate(jig);
        expect(tpl.pw).to.be.greaterThan(0);
        expect(tpl.ph).to.be.greaterThan(0);
        expect(tpl.T2).to.be.greaterThan(0); // ring outline has energy
    });

    it('locates the gap column: returns gapLeft - pieceX0', () => {
        const tpl = buildTemplate(jig);
        const gx0 = 120; // where we paint the matching white outline in the background
        const gy0 = 20;

        // Background: dark everywhere, white (R,G,B > 185) exactly on the template support,
        // shifted to (gx0, gy0). findGapX must peak there and return gx0 - px.
        const orig = makeImage(300, 80, (x, y) => {
            const i = x - gx0;
            const j = y - gy0;
            if (i >= 0 && i < tpl.pw && j >= 0 && j < tpl.ph && tpl.T[j * tpl.pw + i] > 0) {
                return [255, 255, 255, 255];
            }
            return [0, 0, 0, 255];
        });

        const x = findGapX(orig, jig);
        expect(x).to.equal(gx0 - tpl.px);
    });
});
