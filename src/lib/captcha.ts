/*
 * captcha.ts — solves the OMODA "legend" gateway's AJ-Captcha blockPuzzle, required to
 * send the OTP email code. Pure TypeScript port of core/captcha_solver.py (numpy/Pillow),
 * using jimp for PNG decode and typed arrays for the image math — no native deps.
 *
 * Gap-finding: outline of the sliding piece (3×3 morphological gradient) matched against
 * white outlines drawn on the background via normalized cross-correlation (TM_CCORR_NORMED).
 * The point y is a constant 5 (from the decompiled app).
 */
import { Jimp } from 'jimp';
import { aesEcbEncryptB64 } from './crypto/aes';
import type { Logger } from './types';
import type { OmodaClient } from './client';
import { str } from './util';

interface Gray {
    w: number;
    h: number;
    /** RGBA raw pixels, length w*h*4. */
    data: Uint8Array;
}

async function decode(b64: string): Promise<Gray> {
    const img = await Jimp.fromBuffer(Buffer.from(b64, 'base64'));
    return { w: img.bitmap.width, h: img.bitmap.height, data: new Uint8Array(img.bitmap.data) };
}

/**
 * 3×3 max (dilation) or min (erosion) with edge-clamped padding.
 *
 * @param src
 * @param w
 * @param h
 * @param dilate
 */
function morph(src: Int16Array, w: number, h: number, dilate: boolean): Int16Array {
    const out = new Int16Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let acc = dilate ? -32768 : 32767;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = Math.min(h - 1, Math.max(0, y + dy));
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = Math.min(w - 1, Math.max(0, x + dx));
                    const v = src[yy * w + xx];
                    acc = dilate ? Math.max(acc, v) : Math.min(acc, v);
                }
            }
            out[y * w + x] = acc;
        }
    }
    return out;
}

export interface Template {
    T: Float64Array;
    T2: number;
    px: number;
    py: number;
    pw: number;
    ph: number;
}

/**
 * Build the outline template of the sliding piece: bounding box from the jigsaw alpha,
 * then the 3×3 morphological gradient (dilate−erode) of its silhouette.
 *
 * @param jig
 */
export function buildTemplate(jig: Gray): Template {
    let minX = jig.w;
    let minY = jig.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < jig.h; y++) {
        for (let x = 0; x < jig.w; x++) {
            if (jig.data[(y * jig.w + x) * 4 + 3] > 128) {
                if (x < minX) {
                    minX = x;
                }
                if (y < minY) {
                    minY = y;
                }
                if (x > maxX) {
                    maxX = x;
                }
                if (y > maxY) {
                    maxY = y;
                }
            }
        }
    }
    if (maxX < 0) {
        return { T: new Float64Array(0), T2: 0, px: 0, py: 0, pw: 0, ph: 0 };
    }
    const px = minX;
    const py = minY;
    const pw = maxX - minX + 1;
    const ph = maxY - minY + 1;
    const sil = new Int16Array(pw * ph);
    for (let j = 0; j < ph; j++) {
        for (let i = 0; i < pw; i++) {
            sil[j * pw + i] = jig.data[((py + j) * jig.w + (px + i)) * 4 + 3] > 128 ? 255 : 0;
        }
    }
    const dil = morph(sil, pw, ph, true);
    const ero = morph(sil, pw, ph, false);
    const T = new Float64Array(pw * ph);
    let T2 = 0;
    for (let k = 0; k < T.length; k++) {
        let g = dil[k] - ero[k];
        if (g < 0) {
            g = 0;
        } else if (g > 255) {
            g = 255;
        }
        T[k] = g;
        T2 += g * g;
    }
    return { T, T2, px, py, pw, ph };
}

/**
 * Find the pointJson x for the puzzle. Returns (left edge of the hole) − (x0 of the piece
 * in the jigsaw image). Mirrors captcha_solver.trova_gap_x.
 *
 * @param orig
 * @param jig
 */
export function findGapX(orig: Gray, jig: Gray): number {
    const { T, T2, px, pw, ph } = buildTemplate(jig);
    if (pw === 0) {
        return 0;
    }

    // "white outline" mask of the background (R,G,B all > 185)
    const W = orig.w;
    const H = orig.h;
    const white = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4;
            white[y * W + x] = orig.data[o] > 185 && orig.data[o + 1] > 185 && orig.data[o + 2] > 185 ? 1 : 0;
        }
    }
    if (T2 <= 0 || H < ph || W < pw) {
        return 0;
    }

    // 4) normalized cross-correlation; candidates start at gx = pw (left edge zeroed out)
    let bestScore = -1;
    let bestX = pw;
    for (let gy = 0; gy <= H - ph; gy++) {
        for (let gx = pw; gx <= W - pw; gx++) {
            let num = 0;
            let sumSq = 0;
            for (let j = 0; j < ph; j++) {
                const rowW = (gy + j) * W + gx;
                const rowT = j * pw;
                for (let i = 0; i < pw; i++) {
                    const wv = white[rowW + i];
                    num += wv * T[rowT + i];
                    sumSq += wv * wv;
                }
            }
            let den = Math.sqrt(sumSq * T2);
            if (den === 0) {
                den = 1e-9;
            }
            const res = num / den;
            if (res > bestScore) {
                bestScore = res;
                bestX = gx;
            }
        }
    }
    return bestX - px; // gapLeft - x0_jig
}

/**
 * create + solve + check until it passes (single-use token per attempt). Returns the
 * captchaVerification string to pass to sendMailCode, or null after exhausting attempts.
 *
 * @param client
 * @param log
 * @param delay
 * @param maxAttempts
 */
export async function solveCaptcha(
    client: OmodaClient,
    log: Logger,
    delay: (ms: number) => Promise<void>,
    maxAttempts = 12,
): Promise<string | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const rep = await client.captchaCreate();
        const token = rep && typeof rep.token === 'string' ? rep.token : '';
        const secret = rep && typeof rep.secretKey === 'string' ? rep.secretKey : '';
        const origB64 = rep && typeof rep.originalImageBase64 === 'string' ? rep.originalImageBase64 : '';
        const jigB64 = rep && typeof rep.jigsawImageBase64 === 'string' ? rep.jigsawImageBase64 : '';
        if (!token || !secret || !origB64 || !jigB64) {
            log.debug(`captcha attempt ${attempt}: create returned an invalid puzzle`);
            await delay(300);
            continue;
        }
        try {
            const orig = await decode(origB64);
            const jig = await decode(jigB64);
            const x = findGapX(orig, jig);
            const point = { x, y: 5 };
            const pointJson = JSON.stringify(point);
            const enc = aesEcbEncryptB64(pointJson, secret);
            const res = await client.captchaCheck(token, enc);
            const d = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>;
            if (d.repCode === '0000') {
                const cv = aesEcbEncryptB64(`${token}---${pointJson}`, secret);
                log.debug(`captcha solved on attempt ${attempt} (x=${x})`);
                return cv;
            }
            log.debug(`captcha attempt ${attempt}: x=${x} → ${str(d.repCode)} ${str(d.repMsg)}`);
        } catch (e) {
            log.debug(`captcha attempt ${attempt} error: ${(e as Error).message}`);
        }
        await delay(300);
    }
    return null;
}
