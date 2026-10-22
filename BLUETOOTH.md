# Bluetooth MIDI and GP-180 USB support

## Supported connections

Use **Connect Bluetooth MIDI** in Device or Song → Performance to select a device advertising the standard BLE-MIDI service. The desktop app provides a device chooser; supported browsers use their own chooser. Bluetooth audio and Bluetooth MIDI are separate services.

Bluetooth MIDI remains available for performance cues, transport input and MIDI clock. **Bluetooth editor management is disabled.** Connect by USB to inspect or manage presets and pedal settings. There is no Manage GP-180 action over Bluetooth, and editor connection requests using that transport are rejected.

The BLE-MIDI transport implements timestamp framing, fragmented SysEx, serialized GATT writes, notification decoding, disconnect cleanup and bounded queues. Scheduling is best effort, not sample accurate. A successful service connection does not establish that a particular pedal accepts performance commands.

## Wireless song cues through the GP-180

The intended route is **Performance → Bluetooth MIDI → GP-180 → physical MIDI OUT/THRU → downstream MIDI pedals**. USB and the USB editor connection are not required. This route sends ordinary MIDI PC/CC/note/SysEx messages, not editor commands or preset uploads.

1. Open **Song → Performance → Bluetooth MIDI controller**, click **Connect Bluetooth MIDI**, and select the GP-180 MIDI service. Connecting here selects Bluetooth as the performance output. An already-connected Bluetooth output is also available when opening a song. **Enable USB / system MIDI** is optional and is only for operating-system MIDI ports.
2. On the pedal, configure **MIDI IN Source** as **BT Only** or **Mixed**. Configure **EXP/FS jack 2** for MIDI OUT and use the appropriate TRS MIDI connection to the next pedal. Set the receiving pedals' channels and check any input/output channel filtering or remapping on the GP-180.
3. In **Song MIDI cues**, choose the time, destination channel and PC or CC command. **Add MIDI cue** adds a timestamped command to the song's saved chart. Different channels can address different downstream pedals. PC numbers are 0–127 on the wire; pedal displays may number programs 1–128.
4. Enable **Send cues**, then use **Send MIDI now** to check the selected command on the downstream pedal. A queued command or completed Bluetooth write does not prove it reached the physical MIDI output. Check the target pedal's response.
5. Play the song to send the timed cues. Pause, seeking, changing outputs and leaving Performance clear pending output. Manually reopening a song or replacing a Bluetooth session requires enabling **Send cues** again. During automatic playlist playback, an armed output carries across songs only while the same device stays connected. Bluetooth disconnect is independent of USB editor activity. MIDI clock is optional and needs separate clock-routing verification on the GP-180.

The [manufacturer's specifications](https://www.valeton.net/product/gp-180/) list MIDI OUT/THRU, and the [GP-180 manual's MIDI settings](https://www.manualslib.com/manual/4540022/Valeton-Gp-180.html?page=31) describe BT input routing. These do **not** clearly document arbitrary Bluetooth-to-TRS message forwarding. That final hop remains dependent on pedal routing/firmware and requires a physical test; the app cannot enable or implement an unsupported internal forwarding route.

## GP-180 hardware results — 21 October 2026

GP-180 firmware **1.1.1** passed USB read-only inspection: 200 preset names, settings, the active preset and a complete backup of all 200 slots. The offline log audit checked **2,329 incoming frames and 419 outgoing frames**, covering 202 preset replies. Every outgoing frame passed the read-only allowlist. No preset selection, edits, uploads or firmware operations were tested.

These results establish compatibility with the inspected presets, not every model or write operation available in the firmware. Backups preserve the connected GP-180 model. The inspection panel displays knob assignments, expression records and footswitch masks without changing the pedal; unknown special targets remain numeric.

The **GP-180 BLE** standard MIDI service connected and notification subscription succeeded. Two editor hello writes completed at the GATT layer, but **zero notifications** were received. Bluetooth editor management was disabled following this result. Physical performance MIDI input/output on this pedal remains unverified.

Repeat an offline USB log audit with `node app/scripts/audit-gp180-log.mjs <session.log>`. This reads a local log and never opens MIDI.

## Read-only inspection

Real GP-180 USB editor sessions default to read-only. The transport allows handshake, ACK/resend, known queries and preset reads, while rejecting preset selection, edits, saves, uploads and unknown commands before transmission. **Unlock writes for testing** explicitly removes this restriction; it does not indicate that writes have passed hardware verification. Simulators remain editable.

Independent Performance MIDI output sends commands when explicitly configured and armed. The editor's read-only guard does not filter that output. Saved songs do not store an output device ID or armed state. An existing Bluetooth connection can be selected automatically when opening a song, but cue sending remains off until enabled.

## Troubleshooting and diagnostics

- For presets and settings, connect the powered pedal by USB and use **Look for the pedal**. Ensure the pedal's MIDI input routing permits USB. Close other MIDI/editor applications that may hold the port.
- For wireless performance controls, use **Connect Bluetooth MIDI** and choose the MIDI device, rather than its audio pairing. Then select the connection in Performance and explicitly enable the desired MIDI output.
- If USB stops responding while Bluetooth is active, check the pedal's MIDI routing and test with Bluetooth audio and other MIDI applications disconnected. A USB fault alone does not establish its cause.
- **Copy diagnostic report** includes the editor transport, Bluetooth availability, current connection, last session device, completed GATT writes, received notifications and decoded MIDI message counts. Last-session counts survive connection cleanup.
- **Save log** in Diagnostics includes editor handshake attempts and decoded MIDI traffic even when the MIDI monitor is off. Desktop logs are stored locally; browser logs live in the current tab. Save the log before reloading or closing that tab.

The standard BLE-MIDI service is `03b80e5a-ede8-4b33-a751-6ce34ec4c700`; its characteristic is `7772e5db-3868-4112-a1a9-f2669d106bf3`.
