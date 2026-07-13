/*
 * AES/ECB/PKCS7 helper for the AJ-Captcha blockPuzzle handshake (core/captcha_solver.py).
 * The mode/padding are fixed by the captcha protocol (the server issues a per-request
 * secretKey and expects exactly this) — not our choice. ECB is protocol-mandated here.
 */
import { createCipheriv } from 'node:crypto';

/**
 * base64( AES-ECB-PKCS7( plaintext, key ) ). Key length selects AES-128/192/256.
 *
 * @param plaintext
 * @param key
 */
export function aesEcbEncryptB64(plaintext: string, key: string): string {
    const keyBuf = Buffer.from(key, 'utf-8');
    const algo = keyBuf.length === 16 ? 'aes-128-ecb' : keyBuf.length === 24 ? 'aes-192-ecb' : 'aes-256-ecb';
    // ECB uses no IV.
    const cipher = createCipheriv(algo, keyBuf, null);
    cipher.setAutoPadding(true); // PKCS#7
    return Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf-8')), cipher.final()]).toString('base64');
}
