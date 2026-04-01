// Minimal protobuf encoder/decoder
// Supports: varint (wire 0), len-delimited (wire 2), 32-bit float (wire 5)

export function varintEncode(value) {
    const out = [];
    while (true) {
        const bits = value & 0x7f;
        value >>>= 7;
        if (value) { out.push(bits | 0x80); }
        else { out.push(bits); break; }
    }
    return new Uint8Array(out);
}

export function varintDecode(data, pos) {
    let result = 0, shift = 0;
    while (pos < data.length) {
        const b = data[pos++];
        result |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
    }
    return { value: result >>> 0, pos };
}

function fieldTag(fn, wt) {
    return varintEncode((fn << 3) | wt);
}

export function protoFieldVarint(fn, val) {
    return concat(fieldTag(fn, 0), varintEncode(val));
}

export function protoFieldBytes(fn, val) {
    return concat(fieldTag(fn, 2), varintEncode(val.length), val);
}

export function protoFieldMessage(fn, msg) {
    return protoFieldBytes(fn, msg);
}

export function protoFieldFloat(fn, val) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, val, true);
    return concat(fieldTag(fn, 5), new Uint8Array(buf));
}

export function protoFieldString(fn, str) {
    return protoFieldBytes(fn, new TextEncoder().encode(str));
}

export function protoParse(data) {
    const result = {};
    let pos = 0;
    while (pos < data.length) {
        let r = varintDecode(data, pos); pos = r.pos;
        const fn = r.value >>> 3;
        const wt = r.value & 0x07;
        let val;
        if (wt === 0) {      // varint
            r = varintDecode(data, pos); pos = r.pos; val = r.value;
        } else if (wt === 2) { // len-delimited
            r = varintDecode(data, pos); pos = r.pos;
            val = data.slice(pos, pos + r.value); pos += r.value;
        } else if (wt === 5) { // 32-bit
            val = new DataView(data.buffer, data.byteOffset + pos).getFloat32(0, true);
            pos += 4;
        } else if (wt === 1) { // 64-bit (skip)
            pos += 8; continue;
        } else { break; }
        if (!result[fn]) result[fn] = [];
        result[fn].push(val);
    }
    return result;
}

// Concatenate Uint8Arrays
export function concat(...arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
}
