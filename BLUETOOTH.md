# GP-180 Bluetooth and read-only hardware inspection

## Current hardware result

On 21 October 2026, after the user resolved Windows connectivity, the physical GP-180 connected over USB and reported firmware **1.1.1**. Read-only inspection retrieved 200 preset names, settings and the active preset. A full backup read **all 200 slots**, with valid framing/message checksums, signal chains and finite parameter values. Every model ID used by those presets was present in the catalog. This establishes compatibility with those presets, not every model available in the firmware.

The offline log audit checked **2,329 incoming frames and 419 outgoing frames**, covering 202 preset replies (the bank plus active-preset reads). Every outgoing frame passed the read-only allowlist. The active preset remained slot 015. The backup is local under the application's `backups/gp180-2026-10-21` directory; raw captures are retained in gitignored `docs/hardware/gp180-2026-10-21`. No preset writes were tested or enabled.

The real **GP-180 BLE** connected through the standard BLE-MIDI service and enabled notifications. Two guarded editor hello requests over Bluetooth received no response, so wireless preset/settings management is **not yet verified**. Connection success alone does not establish MIDI control-message delivery. A separate Valeton wireless editor protocol remains a possibility, not a confirmed finding.

Hardware testing also exposed a backup labelling bug: the shared GP-150/180 format defaulted to GP-150. Backups now preserve the connected model after validating file-format compatibility. Device → GP-180 preset inspection displays knob assignments, expression records and footswitch masks from the read preset, without sending commands. Unknown special targets remain numeric.

Repeat the offline audit with `node app/scripts/audit-gp180-log.mjs <session.log>`. It only reads a local log and never opens MIDI.

## Connection implementation

Device and Performance now offer **Connect Bluetooth MIDI**. The desktop app presents a device chooser; Chrome/Edge use their browser chooser. Select an advertising MIDI device, rather than the Bluetooth audio pairing. Bluetooth audio and Bluetooth MIDI are separate services.

The transport uses the standard BLE-MIDI service (`03b80e5a-ede8-4b33-a751-6ce34ec4c700`) and characteristic (`7772e5db-3868-4112-a1a9-f2669d106bf3`). It implements timestamp framing, fragmented SysEx, serialized GATT writes, notifications, disconnect cleanup, and bounded queues. Performance can route cues, transport input and MIDI clock through the selected wireless connection. Bluetooth scheduling is best effort; it is not sample accurate.

**Manage GP-180 (experimental)** tries the existing GP-150-family editor handshake over BLE-MIDI. It does not assume that Valeton's proprietary mobile editor uses this service. A missing MIDI service or unanswered handshake means wireless management is unavailable with that firmware/advertising mode. It is not evidence that the pedal lacks Bluetooth.

## Read-only boundary

Real GP-180 editor connections default to a transport allowlist: handshake, ACK/resend, known state/settings/name queries and mode-1 preset reads. Preset selection, live edits, saves, uploads and unknown commands are rejected before transmission. Simulators remain editable. This is separate from the pre-existing lock on unverified flash writes. The independent Performance MIDI output can deliberately send MIDI commands when armed; the editor inspection guard does not filter that general-purpose output.

## USB and Bluetooth coexistence & MIDI routing

If the USB connection drops or becomes unresponsive to MIDI when Bluetooth is active:

1. **Check the pedal's MIDI In Source**:
   On the GP-180 hardware panel, navigate to **GLOBAL > MIDI Settings > MIDI In Source**.
   - Available options: `TRS Only`, `USB Only`, `BT Only`, `Mixed` (default).
   - If set to `BT Only`, the GP-180 firmware **completely ignores incoming SysEx and MIDI on the USB port**.
   - Set it to **`Mixed`** (or **`USB Only`**) so USB MIDI remains active.

2. **Windows Bluetooth Audio vs USB Audio collision**:
   When Windows pairs with `GP-180 Audio` (Bluetooth Audio profile), Windows audio stack attempts to claim it while USB is connected. The USB audio interface (`84EF:0188&MI_00`) frequently enters a Code 10 fault, triggering a USB bus reset that closes open WebMIDI ports. Disconnect `GP-180 Audio` from Windows Bluetooth settings and pair only the BLE MIDI device if audio streaming is not needed on the same PC.

3. **Valeton Suite mobile app exclusive control**:
   If the official Valeton Suite mobile app is actively connected to the pedal via Bluetooth, the pedal locks out editor commands over USB. Close the mobile app when using Tone Studio on your computer.

4. **Tone Studio editor mode switch**:
   Tone Studio manages one primary editor connection at a time (`webmidi` vs `bluetooth`). Clicking "Manage GP-180 (experimental)" disconnects the active USB session. If the experimental Bluetooth handshake receives no reply, use **Look for the pedal** or **Reconnect** to re-engage USB.