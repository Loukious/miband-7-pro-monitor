// Crypto helpers for the Xiaomi V1 BLE protocol
// Ported from XiaomiAuthService.java (Gadgetbridge project)
// Uses the Web Crypto API — no external libraries needed.

import { concat } from "./proto.js";

// ── HMAC-SHA256 ───────────────────────────────────────────────────────────────

export async function hmacSHA256(keyBytes, dataBytes) {
    const key = await crypto.subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

// ── Key derivation (computeAuthStep3Hmac) ────────────────────────────────────

export async function computeSessionKeys(secretKey, phoneNonce, watchNonce) {
    const miwearAuth = new TextEncoder().encode("miwear-auth");
    const combinedNonce = concat(phoneNonce, watchNonce);

    // Derive HMAC key
    const hmacKey = await hmacSHA256(combinedNonce, secretKey);

    // Expand 64 bytes
    const output = new Uint8Array(64);
    let tmp = new Uint8Array(0);
    let bCounter = 1;
    let i = 0;
    while (i < 64) {
        const update = concat(tmp, miwearAuth, new Uint8Array([bCounter]));
        tmp = await hmacSHA256(hmacKey, update);
        for (let j = 0; j < tmp.length && i < 64; j++, i++) {
            output[i] = tmp[j];
        }
        bCounter++;
    }
    return {
        decKey: output.slice(0, 16),
        encKey: output.slice(16, 32),
        decNonce: output.slice(32, 36),
        encNonce: output.slice(36, 40),
        decIndex: 0,
        encIndex: 1,
    };
}

// ── AES-CCM (tag = 4 bytes, nonce = 12 bytes) ────────────────────────────────
// Web Crypto doesn't expose CCM; we implement it manually.
// CCM = CTR for encryption + CBC-MAC for authentication.

function buildPacketNonce(nonce4, counter) {
    const n = new Uint8Array(12);
    n.set(nonce4, 0);
    // bytes 4-7 are zero (already zero)
    new DataView(n.buffer).setUint32(8, counter, true); // LE
    return n;
}

// Generate the keystream block for AES-CTR mode
async function aesBlock(key, blockBytes) {
    const k = await crypto.subtle.importKey(
        "raw", key, { name: "AES-CBC" }, false, ["encrypt"]
    );
    // Encrypt a zero block padding to get a single ECB block output
    const iv = new Uint8Array(16);
    const raw = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k, blockBytes);
    return new Uint8Array(raw).slice(0, 16);
}

async function aesCcmCtr(key, nonce12, data, counterStart) {
    // CCM CTR with L=3 (for 12-byte nonce: n=12, L=15-12=3).
    // Flags byte = L-1 = 2 (0x02). Counter occupies last 3 bytes of block.
    const flags = 0x02; // L-1 = 2 (L=3: 3-byte counter)
    const out = new Uint8Array(data.length);
    const blockSize = 16;

    for (let i = 0; i < data.length; i += blockSize) {
        const q = counterStart + Math.floor(i / blockSize);
        const block = new Uint8Array(16);
        block[0] = flags;
        block.set(nonce12, 1);            // bytes 1-12
        block[13] = (q >> 16) & 0xff;    // counter high byte
        block[14] = (q >> 8) & 0xff;
        block[15] = q & 0xff;            // counter low byte
        const ks = await aesBlock(key, block);
        for (let j = 0; j < blockSize && (i + j) < data.length; j++) {
            out[i + j] = data[i + j] ^ ks[j];
        }
    }
    return out;
}

async function aesCcmMac(key, nonce12, plaintext, tagLen) {
    const L = 3; // L=3 for 12-byte nonce (n=12, L=15-12=3)
    // Flags byte for B0: Adata=0, M'=(tagLen-2)/2, L'=L-1
    const flagsB0 = (((tagLen - 2) / 2) << 3) | (L - 1); // = (1<<3)|2 = 0x0A for tagLen=4
    const B0 = new Uint8Array(16);
    B0[0] = flagsB0;
    B0.set(nonce12, 1);                           // bytes 1-12
    // Encode plaintext length in last L=3 bytes of B0
    B0[13] = (plaintext.length >> 16) & 0xff;
    B0[14] = (plaintext.length >> 8) & 0xff;
    B0[15] = plaintext.length & 0xff;

    // CBC-MAC: XOR each block with previous ciphertext, then AES-encrypt
    let X = await aesBlock(key, B0);             // B0 XOR zeros = B0

    // Pad plaintext to block boundary
    const padLen = (16 - (plaintext.length % 16)) % 16;
    const padded = concat(plaintext, new Uint8Array(padLen));
    for (let i = 0; i < padded.length; i += 16) {
        const block = new Uint8Array(16);
        for (let j = 0; j < 16; j++) block[j] = padded[i + j] ^ X[j];
        X = await aesBlock(key, block);
    }
    return X.slice(0, tagLen);
}

export async function aesCcmEncrypt(keyBytes, nonce4, counter, plaintext) {
    const nonce12 = buildPacketNonce(nonce4, counter);
    const tagLen = 4;

    // Compute MAC over plaintext
    const rawMac = await aesCcmMac(keyBytes, nonce12, plaintext, tagLen);

    // Encrypt plaintext with CTR starting at counter=1
    const ciphertext = await aesCcmCtr(keyBytes, nonce12, plaintext, 1);

    // Encrypt MAC with CTR at counter=0
    const encMac = await aesCcmCtr(keyBytes, nonce12, rawMac, 0);

    return concat(ciphertext, encMac);
}

export async function aesCcmDecrypt(keyBytes, nonce4, counter, data) {
    const nonce12 = buildPacketNonce(nonce4, counter);
    const tagLen = 4;

    const ciphertext = data.slice(0, data.length - tagLen);
    const encTag = data.slice(data.length - tagLen);

    // Decrypt ciphertext
    const plaintext = await aesCcmCtr(keyBytes, nonce12, ciphertext, 1);

    // Decrypt tag
    const decTag = await aesCcmCtr(keyBytes, nonce12, encTag, 0);

    // Compute expected MAC
    const expectedTag = await aesCcmMac(keyBytes, nonce12, plaintext, tagLen);

    // Verify
    for (let i = 0; i < tagLen; i++) {
        if (decTag[i] !== expectedTag[i]) throw new Error("CCM tag mismatch");
    }
    return plaintext;
}

export { buildPacketNonce };
