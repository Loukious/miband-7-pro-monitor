// Mi Band 7 Pro – BLE framing layer
// Mirrors XiaomiCharacteristicV1.java (Gadgetbridge)

export const FRAME_CHUNKED_START = 0;
export const FRAME_CHUNKED_ACK = 1;
export const FRAME_SINGLE = 2;
export const FRAME_ACK = 3;

export const ACK_FRAME = new Uint8Array([0x00, 0x00, 0x03, 0x00]);
export const CHUNK_START_ACK = new Uint8Array([0x00, 0x00, 0x01, 0x01]);
export const CHUNK_END_ACK = new Uint8Array([0x00, 0x00, 0x01, 0x00]);

/**
 * Parse inbound BLE frame from the band.
 * Returns { kind, encrypted, payload, numChunks, chunkId, result }
 */
export function parseFrame(data) {
    const view = new DataView(data.buffer, data.byteOffset);
    const chunkId = view.getUint16(0, true);

    if (chunkId !== 0) {
        return { kind: "chunk_data", chunkId, payload: data.slice(2) };
    }

    const msgType = data[2];

    if (msgType === FRAME_CHUNKED_START) {
        const encrypted = data[3] === 1;
        const numChunks = view.getUint16(4, true);
        return { kind: "chunk_start", encrypted, numChunks };
    }
    if (msgType === FRAME_CHUNKED_ACK) {
        return { kind: "chunk_ack", subtype: data[3] };
    }
    if (msgType === FRAME_SINGLE) {
        const encrypted = data[3] === 1;
        // The band's outgoing frames do NOT include an enc_index field in the header.
        // Payload always starts at byte 4, immediately after the enc_flag byte.
        // (We only include enc_index in frames we SEND to the band, not in frames we parse.)
        return { kind: "single", encrypted, payload: data.slice(4) };
    }
    if (msgType === FRAME_ACK) {
        return { kind: "ack", result: data[3] };
    }
    return { kind: "unknown" };
}

/**
 * Build a plain (unencrypted) outbound frame.
 */
export function buildPlainFrame(protoBytes) {
    const frame = new Uint8Array(4 + protoBytes.length);
    frame[2] = FRAME_SINGLE;
    frame[3] = 2; // plain flag
    frame.set(protoBytes, 4);
    return frame;
}

/**
 * Build an encrypted outbound frame.
 */
export function buildEncFrame(encPayload, encIndex) {
    const frame = new Uint8Array(6 + encPayload.length);
    // bytes 0-1: 0x0000
    frame[2] = FRAME_SINGLE;
    frame[3] = 1; // encrypted flag
    new DataView(frame.buffer).setInt16(4, encIndex, true);
    frame.set(encPayload, 6);
    return frame;
}
