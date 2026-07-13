"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var captcha_exports = {};
__export(captcha_exports, {
  buildTemplate: () => buildTemplate,
  findGapX: () => findGapX,
  solveCaptcha: () => solveCaptcha
});
module.exports = __toCommonJS(captcha_exports);
var import_jimp = require("jimp");
var import_aes = require("./crypto/aes");
var import_util = require("./util");
async function decode(b64) {
  const img = await import_jimp.Jimp.fromBuffer(Buffer.from(b64, "base64"));
  return { w: img.bitmap.width, h: img.bitmap.height, data: new Uint8Array(img.bitmap.data) };
}
function morph(src, w, h, dilate) {
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
function buildTemplate(jig) {
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
function findGapX(orig, jig) {
  const { T, T2, px, pw, ph } = buildTemplate(jig);
  if (pw === 0) {
    return 0;
  }
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
  return bestX - px;
}
async function solveCaptcha(client, log, delay, maxAttempts = 12) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const rep = await client.captchaCreate();
    const token = rep && typeof rep.token === "string" ? rep.token : "";
    const secret = rep && typeof rep.secretKey === "string" ? rep.secretKey : "";
    const origB64 = rep && typeof rep.originalImageBase64 === "string" ? rep.originalImageBase64 : "";
    const jigB64 = rep && typeof rep.jigsawImageBase64 === "string" ? rep.jigsawImageBase64 : "";
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
      const enc = (0, import_aes.aesEcbEncryptB64)(pointJson, secret);
      const res = await client.captchaCheck(token, enc);
      const d = res.data && typeof res.data === "object" ? res.data : {};
      if (d.repCode === "0000") {
        const cv = (0, import_aes.aesEcbEncryptB64)(`${token}---${pointJson}`, secret);
        log.debug(`captcha solved on attempt ${attempt} (x=${x})`);
        return cv;
      }
      log.debug(`captcha attempt ${attempt}: x=${x} \u2192 ${(0, import_util.str)(d.repCode)} ${(0, import_util.str)(d.repMsg)}`);
    } catch (e) {
      log.debug(`captcha attempt ${attempt} error: ${e.message}`);
    }
    await delay(300);
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildTemplate,
  findGapX,
  solveCaptcha
});
//# sourceMappingURL=captcha.js.map
