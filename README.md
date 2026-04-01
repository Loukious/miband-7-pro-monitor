# Xiaomi Band 7 Pro Monitor

Browser-based real-time monitoring for Xiaomi encrypted BLE V1 devices, focused on stable authentication and live heart-rate streaming.

Live demo: https://miband-7-pro-monitor.pages.dev/

## What This Project Do

- Connects to compatible Xiaomi wearables over Web Bluetooth.
- Authenticates using the modern encrypted Xiaomi V1 flow.
- Streams real-time heart rate.
- Shows steps and calories from real-time packets.
- Renders a live chart (last 60 readings).
- Tracks session min/avg/max heart rate and reading count.

## Requirements

1. A Bluetooth-enabled computer.
2. A Chromium-based browser with Web Bluetooth support.
3. A valid 16-byte (32 hex characters) auth key for your device.

Auth key reference:
https://gadgetbridge.org/basics/pairing/#authentication-key

## Supported Protocol and Devices

This project targets the Xiaomi encrypted BLE V1 protocol:

- Service UUID: `0000fe95-0000-1000-8000-00805f9b34fb`
- Characteristic UUIDs: `00000051/52/53-0000-1000-8000-00805f9b34fb`

Known compatible devices include:

- Xiaomi Smart Band 7 Pro
- Xiaomi Smart Band 8
- Redmi Smart Band 2
- Redmi Watch 2 Lite
- Redmi Watch 3 Active (BLE mode)
- Xiaomi Watch S1 (BLE mode)
- Xiaomi Watch S1 Active (BLE mode)

Not supported:

- Devices that only expose Bluetooth Classic transport.
- Xiaomi BLE V2 devices using `0000005e/5f-0000-1000-8000-00805f9b34fb`.

## Quick Start

```bash
npm install
npm run serve
```

Then open `http://localhost:8081` in your browser.

## Usage

1. Enter your auth key.
2. Click **Connect via Bluetooth**.
3. Complete pairing and authentication.
4. Wear the band and wait for live heart rate updates.
5. Use **Clear** to reset the chart view.
6. Use **Disconnect** to stop streaming.

The app stores the auth key locally in your browser (`localStorage`) for convenience.

## Development Commands

- `npm run build` - Bundle app files into `dist/`.
- `npm run serve` - Build and serve the app on port `8081`.
- `npm run lint` - Run Prettier formatting for `src/`.
- `npm run clean` - Remove build output from `dist/`.

## Troubleshooting

- Device not listed: Use a supported Chromium browser, and make sure another app is not currently connected to the band.
- Authentication failed: Confirm your auth key is correct and in plain hex format (no separators).
- No heart rate values: Wear the band snugly and wait a few seconds for non-zero readings.
- Need lower-level diagnostics: Open the browser developer console to inspect BLE and protocol logs.

## Inspiration

- [patyork/miband-7-monitor](https://github.com/patyork/miband-7-monitor)
- [gzalo/miband-6-heart-rate-monitor](https://github.com/gzalo/miband-6-heart-rate-monitor)
- [Freeyourgadget/Gadgetbridge](https://codeberg.org/Freeyourgadget/Gadgetbridge)
- [Jaapp-/miband-5-heart-rate-monitor](https://github.com/Jaapp-/miband-5-heart-rate-monitor)
- [satcar77/miband4](https://github.com/satcar77/miband4)
- [vshymanskyy/miband-js](https://github.com/vshymanskyy/miband-js)
- [VladKolerts/miband4](https://github.com/VladKolerts/miband4)

## External Tools

- [Wireshark](https://www.wireshark.org/)
- [Windows Bluetooth Virtual Sniffer](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/testing-btp-tools-btvs)
