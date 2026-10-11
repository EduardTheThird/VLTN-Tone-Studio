# Notices

This GP-200 toolkit is written from scratch from protocol facts. No third-party code is included.

- **Protocol facts** come from static reverse engineering of Valeton's official GP-200 editor 1.8.0, cross-checked with open-source hardware work. The test vectors (`tests/vectors.mjs`) are protocol bytes re-encoded by an independent encoder; the User IR and SnapTone payloads in them are synthetic test signals.
- **dax99993/GP200-NAM-Data-analysis** — MIT License. SnapTone upload capture: record layout and checksum facts.
- Facts only, no code copied: phash/gp200editor (GPL-3.0), kabir0st/gp200-studio (GPL-3.0), donpark2000/GP-200-Patch-Manager (GPL-3.0; hardware write/verify behaviour, volatile bytes), Goaltoday/GP200-VST-Editor (GPL-3.0), lshug/valeton-gp200-english-patch (GPL-3.0), jmiskovic/webgp-200, leocosta1/pocket-cortex and tntexplosivesltd/gp200-patcher (no licence), cesardamien/hotone-family-firmware-fix (MIT; USB ids).
- **Not included:** Valeton's `algorithm.xml`, effect descriptions, factory presets and firmware. The effect catalog is built at runtime from the user's own editor installation (`catalog.mjs`); the simulator's bank is generated.

Valeton and GP-200 are trademarks of their owner. This project is not affiliated with Valeton.
