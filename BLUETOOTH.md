# Bluetooth MIDI and GP-180 USB support

## Supported connections

Use **Connect Bluetooth MIDI** in Device or Song → Performance to select a device advertising the standard BLE-MIDI service. The desktop app provides a device chooser; supported browsers use their own chooser. Bluetooth audio and Bluetooth MIDI are separate services.

Bluetooth MIDI remains available for performance cues, transport input and MIDI clock. **Bluetooth editor management is disabled.** Connect by USB to inspect or manage presets and pedal settings. There is no Manage GP-180 action over Bluetooth, and editor connection requests using that transport are rejected.

The BLE-MIDI transport implements timestamp framing, fragmented SysEx, serialized GATT writes, notification decoding, disconnect cleanup and bounded queues. Scheduling is best effort, not sample accurate. A successful service connection does not establish that a particular pedal accepts performance commands.

## GP-180 hardware results — 21 October 2026

GP-180 firmware **1.1.1** passed USB read-only inspection: 200 preset names, settings, the active preset and a complete backup of all 200 slots. The offline log audit checked **2,329 incoming frames and 419 outgoing frames**, covering 202 preset replies. Every outgoing frame passed the read-only allowlist. No preset selection, edits, uploads or firmware operations were tested.

These results establish compatibility with the inspected presets, not every model or write operation available in the firmware. Backups preserve the connected GP-180 model. The inspection panel displays knob assignments, expression records and footswitch masks without changing the pedal; unknown special targets remain numeric.

The **GP-180 BLE** standard MIDI service connected and notification subscription succeeded. Two editor hello writes completed at the GATT layer, but **zero notifications** were received. Bluetooth editor management was disabled following this result. Physical performance MIDI input/output on this pedal remains unverified.

Repeat an offline USB log audit with `node app/scripts/audit-gp180-log.mjs <session.log>`. This reads a local log and never opens MIDI.

## Read-only inspection

Real GP-180 USB editor sessions default to read-only. The transport allows handshake, ACK/resend, known queries and preset reads, while rejecting preset selection, edits, saves, uploads and unknown commands before transmission. **Unlock writes for testing** explicitly removes this restriction; it does not indicate that writes have passed hardware verification. Simulators remain editable.

Independent Performance MIDI output sends commands when explicitly configured and armed. The editor's read-only guard does not filter that output. Reopening a saved song does not restore output selection or arm cues.

## Troubleshooting and diagnostics

- For presets and settings, connect the powered pedal by USB and use **Look for the pedal**. Ensure the pedal's MIDI input routing permits USB. Close other MIDI/editor applications that may hold the port.
- For wireless performance controls, use **Connect Bluetooth MIDI** and choose the MIDI device, rather than its audio pairing. Then select the connection in Performance and explicitly enable the desired MIDI output.
- If USB stops responding while Bluetooth is active, check the pedal's MIDI routing and test with Bluetooth audio and other MIDI applications disconnected. A USB fault alone does not establish its cause.
- **Copy diagnostic report** includes the editor transport, Bluetooth availability, current connection, last session device, completed GATT writes, received notifications and decoded MIDI message counts. Last-session counts survive connection cleanup.
- **Save log** in Diagnostics includes editor handshake attempts and decoded MIDI traffic even when the MIDI monitor is off. Desktop logs are stored locally; browser logs live in the current tab. Save the log before reloading or closing that tab.

The standard BLE-MIDI service is `03b80e5a-ede8-4b33-a751-6ce34ec4c700`; its characteristic is `7772e5db-3868-4112-a1a9-f2669d106bf3`.
