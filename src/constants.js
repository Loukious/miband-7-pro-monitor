// Mi Band 7 Pro – BLE UUIDs and Protocol Constants
// Protocol: Xiaomi V1 encrypted (HMAC-SHA256 + AES-CCM) over service 0xfe95
// Source: reverse-engineered via Gadgetbridge / XiaomiAuthService.java

export const SERVICE_UUID = "0000fe95-0000-1000-8000-00805f9b34fb";

export const CHAR_UUIDS = {
    CMD_READ: "00000051-0000-1000-8000-00805f9b34fb",  // notifications from band
    CMD_WRITE: "00000052-0000-1000-8000-00805f9b34fb",  // commands to band
    ACT_DATA: "00000053-0000-1000-8000-00805f9b34fb",  // activity data (optional)
};

// Auth command types
export const AUTH_CMD_TYPE = 1;
export const AUTH_CMD_NONCE = 26;   // band sends its nonce
export const AUTH_CMD_AUTH = 27;   // final auth reply
export const AUTH_CMD_SEND_USERID = 5;    // userId step

// Health / real-time stats
export const HEALTH_CMD_TYPE = 8;
export const HEALTH_CMD_REALTIME_START = 45;
export const HEALTH_CMD_REALTIME_STOP = 46;
export const HEALTH_CMD_REALTIME_EVENT = 47;

// BLE frame type byte (offset 2)
export const FRAME_CHUNKED_START = 0;
export const FRAME_CHUNKED_ACK = 1;
export const FRAME_SINGLE = 2;
export const FRAME_ACK = 3;

export const PAYLOAD_ACK = new Uint8Array([0, 0, 3, 0]);