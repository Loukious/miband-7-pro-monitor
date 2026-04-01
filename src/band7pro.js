// Mi Band 7 Pro – main device class
// Implements the Xiaomi V1 BLE protocol (auth + real-time heart rate)
// Ported from miband7pro_heartrate.py / Gadgetbridge XiaomiAuthService.java

import {
    SERVICE_UUID, CHAR_UUIDS,
    AUTH_CMD_TYPE, AUTH_CMD_NONCE, AUTH_CMD_AUTH, AUTH_CMD_SEND_USERID,
    HEALTH_CMD_TYPE, HEALTH_CMD_REALTIME_START, HEALTH_CMD_REALTIME_STOP,
    HEALTH_CMD_REALTIME_EVENT,
} from "./constants.js";

import {
    protoFieldVarint, protoFieldBytes, protoFieldMessage,
    protoFieldFloat, protoFieldString, protoParse, concat,
} from "./proto.js";

import {
    hmacSHA256, computeSessionKeys,
    aesCcmEncrypt, aesCcmDecrypt, buildPacketNonce,
} from "./crypto.js";

import {
    parseFrame, buildPlainFrame, buildEncFrame,
    ACK_FRAME, CHUNK_START_ACK, CHUNK_END_ACK,
} from "./framing.js";

// ── Protobuf builders ─────────────────────────────────────────────────────────

function makeCommand(type, subtype, extra) {
    let msg = concat(protoFieldVarint(1, type), protoFieldVarint(2, subtype));
    if (extra) msg = concat(msg, extra);
    return msg;
}

function buildAuthPhoneNonce(nonce16) {
    const phoneNonceMsg = protoFieldBytes(1, nonce16);         // PhoneNonce.nonce
    const authMsg = protoFieldMessage(30, phoneNonceMsg); // Auth.phoneNonce
    return protoFieldMessage(3, authMsg);                       // Command.auth
}

function buildAuthStep3(encNonces, encDeviceInfo) {
    const step3 = concat(protoFieldBytes(1, encNonces), protoFieldBytes(2, encDeviceInfo));
    const authMsg = protoFieldMessage(32, step3);
    return protoFieldMessage(3, authMsg);
}

function buildAuthDeviceInfo() {
    return concat(
        protoFieldVarint(1, 0),
        protoFieldFloat(2, 30.0),
        protoFieldString(3, "WebBluetooth"),
        protoFieldVarint(4, 224),
        protoFieldString(5, "EN"),
    );
}

function buildRealtimeCmd(subtype) {
    return makeCommand(HEALTH_CMD_TYPE, subtype);
}

// ── Main class ────────────────────────────────────────────────────────────────

export class Band7Pro extends EventTarget {
    constructor(authKeyHex) {
        super();
        this.authKey = hexToBytes(authKeyHex.replace(/^0x/, "")).slice(0, 16);
        this._device = null;
        this._server = null;
        this._charRead = null;
        this._charWrite = null;
        this._session = null;
        this._frameEncrypt = false;

        this._phoneNonce = crypto.getRandomValues(new Uint8Array(16));
        this._chunkNum = 0;
        this._chunks = {};
        this._chunkEncrypted = false;

        // Promise chain that serialises every BLE write.
        // Appending via .then() guarantees strict FIFO order with no concurrency,
        // eliminating the "GATT operation already in progress" race entirely.
        this._writeChain = Promise.resolve();
    }

    // ── Connect + Auth ────────────────────────────────────────────────────────

    async connect() {
        // Do not filter by name/service at discovery time: many compatible
        // devices advertise different names or primary services.
        // The command service 0xFE95 is still requested as an optional service.
        const ADV_SERVICE = "0000fee0-0000-1000-8000-00805f9b34fb";
        this._device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [SERVICE_UUID, ADV_SERVICE],
        });
        this._device.addEventListener("gattserverdisconnected", () => {
            this.dispatchEvent(new CustomEvent("disconnected"));
        });
        this._server = await this._device.gatt.connect();
        const svc = await this._server.getPrimaryService(SERVICE_UUID);
        this._charRead = await svc.getCharacteristic(CHAR_UUIDS.CMD_READ);
        this._charWrite = await svc.getCharacteristic(CHAR_UUIDS.CMD_WRITE);

        await this._charRead.startNotifications();
        this._charRead.addEventListener("characteristicvaluechanged", (e) => {
            this._onNotify(new Uint8Array(e.target.value.buffer));
        });

        // Some bands also use CMD_WRITE for certain replies
        try {
            await this._charWrite.startNotifications();
            this._charWrite.addEventListener("characteristicvaluechanged", (e) => {
                this._onNotify(new Uint8Array(e.target.value.buffer));
            });
        } catch (_) { /* optional */ }
    }

    async authenticate() {
        return new Promise((resolve, reject) => {
            const onDone = () => {
                this.removeEventListener("auth_done", onDone);
                this.removeEventListener("auth_fail", onFail);
                resolve(true);
            };
            const onFail = () => {
                this.removeEventListener("auth_done", onDone);
                this.removeEventListener("auth_fail", onFail);
                reject(new Error("Authentication failed"));
            };
            this.addEventListener("auth_done", onDone);
            this.addEventListener("auth_fail", onFail);

            // Step 1: send phone nonce via the write queue so it never
            // races with a concurrent GATT operation.
            const payload = buildAuthPhoneNonce(this._phoneNonce);
            const cmd = makeCommand(AUTH_CMD_TYPE, AUTH_CMD_NONCE, payload);
            this._enqueue(buildPlainFrame(cmd));

            // Timeout
            setTimeout(() => {
                reject(new Error("Auth timeout (30s)"));
            }, 30000);
        });
    }

    async startRealtimeHeartRate() {
        const cmd = buildRealtimeCmd(HEALTH_CMD_REALTIME_START);
        await this._sendCommand(cmd);
    }

    async stopRealtimeHeartRate() {
        const cmd = buildRealtimeCmd(HEALTH_CMD_REALTIME_STOP);
        await this._sendCommand(cmd);
    }

    async disconnect() {
        if (this._device && this._device.gatt.connected) {
            await this._device.gatt.disconnect();
        }
    }

    // ── Notification handler ──────────────────────────────────────────────────

    _onNotify(data) {
        const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const frame = parseFrame(data);
        console.log(`[RX] kind=${frame.kind} enc=${frame.encrypted} len=${data.length}`, hex);
        switch (frame.kind) {
            case "chunk_start":
                this._chunkNum = frame.numChunks;
                this._chunkEncrypted = frame.encrypted;
                this._chunks = {};
                console.log(`[chunk_start] numChunks=${frame.numChunks} enc=${frame.encrypted}`);
                this._enqueue(CHUNK_START_ACK);
                break;

            case "chunk_data":
                this._chunks[frame.chunkId] = frame.payload;
                console.log(`[chunk_data] id=${frame.chunkId}/${this._chunkNum}`);
                if (Object.keys(this._chunks).length === this._chunkNum) {
                    this._enqueue(CHUNK_END_ACK);
                    let payload = new Uint8Array(0);
                    for (let i = 1; i <= this._chunkNum; i++) {
                        payload = concat(payload, this._chunks[i]);
                    }
                    if (this._chunkEncrypted && this._session) {
                        this._decrypt(payload).then(p => {
                            console.log('[chunk assembled+decrypted] len=', p.length);
                            this._handleCommand(p);
                        });
                    } else {
                        console.log('[chunk assembled plain] len=', payload.length);
                        this._handleCommand(payload);
                    }
                }
                break;

            case "single":
                this._enqueue(ACK_FRAME);
                if (frame.encrypted && this._session) {
                    this._decrypt(frame.payload, frame.encIndex).then(p => {
                        console.log('[single decrypted] len=', p.length,
                            Array.from(p).map(b => b.toString(16).padStart(2, '0')).join(' '));
                        this._handleCommand(p);
                    });
                } else {
                    console.log('[single plain] len=', frame.payload.length);
                    this._handleCommand(frame.payload);
                }
                break;

            case "ack":
            case "chunk_ack":
                console.log(`[${frame.kind}] result=${frame.result ?? frame.subtype}`);
                break;

            default:
                console.warn('[unknown frame]', hex);
        }
    }

    // ── Command dispatcher ────────────────────────────────────────────────────

    _handleCommand(raw) {
        let cmd;
        try { cmd = protoParse(raw); }
        catch (e) { console.warn("Proto parse error", e); return; }

        const type = cmd[1]?.[0];
        const subtype = cmd[2]?.[0];
        console.log(`[cmd] type=${type} subtype=${subtype}`);

        if (type === AUTH_CMD_TYPE) {
            this._handleAuthCommand(cmd, subtype);
        } else if (type === HEALTH_CMD_TYPE && subtype === HEALTH_CMD_REALTIME_EVENT) {
            this._handleRealtimeStats(cmd);
        } else {
            console.log('[cmd] unhandled — full cmd keys:', Object.keys(cmd));
        }
    }

    _handleAuthCommand(cmd, subtype) {
        if (subtype === AUTH_CMD_NONCE) {
            this._handleWatchNonce(cmd).catch(e => {
                console.error("Auth nonce error", e);
                this.dispatchEvent(new CustomEvent("auth_fail"));
            });
        } else if (subtype === AUTH_CMD_AUTH || subtype === AUTH_CMD_SEND_USERID) {
            this._frameEncrypt = (subtype === AUTH_CMD_AUTH);
            console.log("✓ Auth successful, frameEncrypt=", this._frameEncrypt);
            this.dispatchEvent(new CustomEvent("auth_done"));
            this.dispatchEvent(new CustomEvent("connected"));
        }
    }

    async _handleWatchNonce(cmd) {
        const authBytes = cmd[3]?.[0];
        if (!(authBytes instanceof Uint8Array)) throw new Error("No auth field");

        const auth = protoParse(authBytes);
        const watchNonceBytes = auth[31]?.[0];
        if (!(watchNonceBytes instanceof Uint8Array)) throw new Error("No watchNonce");

        const wn = protoParse(watchNonceBytes);
        const watchNonce = wn[1]?.[0];
        const watchHmac = wn[2]?.[0];
        if (!watchNonce || !watchHmac) throw new Error("Missing nonce/hmac");

        // Derive session keys
        this._session = await computeSessionKeys(this.authKey, this._phoneNonce, watchNonce);

        // Verify watch HMAC: hmacSHA256(decKey, watchNonce || phoneNonce)
        const expected = await hmacSHA256(this._session.decKey, concat(watchNonce, this._phoneNonce));
        if (!bytesEqual(expected, watchHmac)) {
            throw new Error("Watch HMAC mismatch — wrong auth key?");
        }

        // Build AuthStep3 payload
        const encNonces = await hmacSHA256(this._session.encKey, concat(this._phoneNonce, watchNonce));
        const deviceInfo = buildAuthDeviceInfo();
        const encDevInfo = await aesCcmEncrypt(this._session.encKey, this._session.encNonce, 0, deviceInfo);
        const step3Payload = buildAuthStep3(encNonces, encDevInfo);
        const protoCmd = makeCommand(AUTH_CMD_TYPE, AUTH_CMD_AUTH, step3Payload);

        // Step 3 is sent plain (no frame-level encryption yet).
        // IMPORTANT: Use _enqueue() NOT _writeRaw() here.
        // This function is called from within a BLE notification callback;
        // calling writeValueWithoutResponse (or any GATT op) directly from
        // inside a notification handler causes a "GATT operation already in
        // progress" error in Chrome.  Enqueueing schedules the write to run
        // after the notification callback has returned, exactly like the
        // Python script's write_queue.put_nowait() pattern.
        this._enqueue(buildPlainFrame(protoCmd));
    }

    _handleRealtimeStats(cmd) {
        console.log('[realtimeStats] raw cmd keys:', Object.keys(cmd));
        const healthBytes = cmd[10]?.[0];
        if (!(healthBytes instanceof Uint8Array)) {
            console.warn('[realtimeStats] no health field (field 10). cmd=', cmd);
            return;
        }
        const health = protoParse(healthBytes);
        console.log('[realtimeStats] health field keys:', Object.keys(health));
        const rtBytes = health[39]?.[0];
        if (!(rtBytes instanceof Uint8Array)) {
            console.warn('[realtimeStats] no rt field (field 39). health=', health);
            return;
        }
        const rt = protoParse(rtBytes);
        console.log('[realtimeStats] rt fields:', rt);
        const hr = rt[4]?.[0] ?? 0;
        const steps = rt[1]?.[0] ?? 0;
        const cals = rt[2]?.[0] ?? 0;
        console.log(`❤ HR=${hr} steps=${steps} cals=${cals}`);
        this.dispatchEvent(new CustomEvent("heartrate", { detail: { hr, steps, cals, ts: new Date() } }));
    }

    // ── Crypto ────────────────────────────────────────────────────────────────

    async _decrypt(data, _encIndex) {
        const s = this._session;
        console.log(`[decrypt] decIndex=${s.decIndex} dataLen=${data.length}`);
        // Try current dec_index first, then ±1 to tolerate counter drift
        for (const offset of [0, -1, 1]) {
            const idx = Math.max(0, s.decIndex + offset);
            try {
                const plain = await aesCcmDecrypt(s.decKey, s.decNonce, idx, data);
                console.log(`[decrypt] OK at idx=${idx}`);
                s.decIndex = idx + 1;
                return plain;
            } catch (_) { /* try next */ }
        }
        console.warn("Decryption failed at decIndex", s.decIndex, "— returning raw");
        return data;
    }

    async _encrypt(data) {
        const s = this._session;
        const enc = await aesCcmEncrypt(s.encKey, s.encNonce, s.encIndex, data);
        s.encIndex++;
        return enc;
    }

    // ── BLE write helpers ─────────────────────────────────────────────────────

    async _sendCommand(protoBytes) {
        let frame;
        if (this._frameEncrypt && this._session) {
            const enc = await this._encrypt(protoBytes);
            frame = buildEncFrame(enc, this._session.encIndex - 1);
        } else {
            frame = buildPlainFrame(protoBytes);
        }
        // Route through the shared chain so user-initiated writes never
        // race with notification-triggered ACK writes.
        await this._enqueueWrite(frame);
    }

    // ── Write serialisation ───────────────────────────────────────────────────
    //
    // _enqueueWrite(data) – appends one write to the promise chain and returns
    // a promise that resolves/rejects once the write completes.
    //
    // Every write (whether from a BLE notification ACK or a user command) goes
    // through this single chain, making concurrent GATT writes impossible.
    //
    // A setTimeout(0) macrotask yield is inserted before each write so the
    // write never executes inside a characteristicvaluechanged callback task
    // (Chrome's Web Bluetooth rejects GATT ops triggered in that window).
    // This mirrors Python's asyncio Queue + dedicated _writer_loop approach.

    _enqueueWrite(data) {
        let resolve;
        const done = new Promise(res => { resolve = res; });
        this._writeChain = this._writeChain
            .then(() => new Promise(r => setTimeout(r, 0)))   // macrotask yield
            .then(() => this._writeRaw(data))
            .then(resolve, e => { console.warn("Write error", e); resolve(); });
        return done;
    }

    // Fire-and-forget helper for notification handlers (they don't await).
    _enqueue(data) {
        this._enqueueWrite(data);
    }

    async _writeRaw(data) {
        if (!this._charWrite) return;
        // Use writeValueWithoutResponse to match the Python reference script
        // (bleak write_gatt_char with response=False). writeValueWithResponse
        // causes Chrome to hold an ATT-level lock while awaiting the Write
        // Response packet; if a BLE notification arrives in that window Chrome
        // raises "GATT operation already in progress". Edge tolerates this but
        // Chrome does not. The Mi Band 7 Pro does not require ATT write-with-
        // response, so fire-and-forget is both correct and safe.
        try {
            await this._charWrite.writeValueWithoutResponse(data);
        } catch (e) {
            // Some browsers / OS stacks throttle fire-and-forget writes if
            // called too quickly (canWriteValueWithoutResponse === false).
            // Fall back to writeValueWithResponse as a last resort.
            if (e.name === "NotAllowedError" || e.name === "NetworkError") {
                await this._charWrite.writeValueWithResponse(data);
            } else {
                throw e;
            }
        }
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function hexToBytes(hex) {
    hex = hex.replace(/\s+/g, "");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

window.Band7Pro = Band7Pro;
