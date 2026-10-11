# Plan: wire the GP-200 family into the app (phase 6, remaining work)

Status 2026-10-11, branch `feature/gp50-support`. Follows `docs/device-expansion-plan.md` phase 6. Line numbers are as of commit `be7de7b`; expect drift.

## Where we are
| piece | state |
|---|---|
| GP-200 protocol lib `app/src/renderer/src/gp200/lib` (codec, `.prst`, catalog builder, session, `MockGp200`) | done, 115 toolkit tests green, nothing run on hardware |
| `Gp200Driver` (`state/driver/gp200-driver.ts`) + `gp200-globals.ts` | done, driver tests green; **not registered** (`DRIVER_FAMILIES = ["gp5"]`) |
| effect-catalog import from the user's `algorithm.xml` (host API, IPC, web host, `gp200/app/catalog-store.ts`, `catalog-adapter.ts`, `screens/device/Gp200CatalogPanel.tsx`) | done; **panel not mounted** |
| registry profiles `gp200` / `gp200lt` / `gp200jr` (`shared/devices.ts`) | done; `simulator: false` |
| store, screens | GP-5 preset model only. A GP-200 connects to "not supported yet" |

The GP-5 and GP-50 work, the ponytail cuts and the UI fixes U1–U14 are committed. Gates: `npm run typecheck`, `npm test`, `npm run test:toolkit` from `app/`, plus browser smoke runs on `?mock=gp200`, `?mock=gp200lt`, `?mock=gp200jr`, and `?mock=gp5` / `?mock=gp50` unchanged.

## Step 1: foundation (one agent; everything else depends on it)
1. **Preset model per family.** Today `toPresetState` / `editLocal` / `saveToSlot` / `rename` in `state/device.ts` (~L63-85, 162-166, 663, 675) and `library/RenameConfirmDialog.tsx` parse and edit through the GP-5 `parsePrst` / `applyEdits`, which throw on GP-200 bytes. The rename path throws *after* the pedal was already renamed. Add one family codec seam (`parse`, `applyEdits`, `rebuild`), with GP-200 built on `gp200/lib/prst.mjs` (`parsePrst`, `parsePatch`, `applyEdits`, `buildPrst`). Map the GP-200 vocabulary: `tempo` vs `bpm`, `chain{order,sendPos,returnPos}` vs `order`, `ctrl[8]` masks vs fs1/fs2, `exp[9]`, `quickAccess[3]`, pan, loop mode, send/return level, style, author, note.
2. **Types.** `BlockCode` needs WAH and VOL. `PresetState.device` widens beyond `Gp5FamilyKey`. Footswitches become generic controls (fs1/fs2 on the GP-5 family, CTRL 1-8 on the GP-200), and there is an EXP per family. `Globals` / `GlobalName` become family-aware (`setGlobal` already accepts GP-200 names in the driver).
3. **Catalog.** Load `useGp200Catalog` on connect. Map models with `catalog-adapter.ts` (block-aware lookup, menu values with gaps). Re-model the open preset when the catalog loads. If no catalog is present, show blocks as "Unknown model" with a clear state, not a crash.
4. **Block roles from the profile, not indices:** AMP, CAB (5 on the GP-200, 4 on the GP-5), capture block (NS on the GP-5 family; AMP or DST by SnapTone slot on the GP-200), movable/core sets, FX-loop nodes. Hard-coded spots: `Pedalboard.tsx` (blocks[9] as NS), `ChainOverview.tsx`, `AmpCabView.tsx` (blocks[4] as CAB), `ModelPicker.tsx`, `rig/order.ts` (AMP=3, CAB=4, MOVABLE, GP-5 `validateOrder`), `components/write/MiniChain.tsx`, `library/Inspector.tsx`, `song/tonematch/ir-store.ts` (`CAB = 4` would switch NR off on a GP-200).
5. **Register:** `DRIVER_FAMILIES` + `FACTORIES` (`state/driver/types.ts`, `index.ts`), `simulator: true` on the GP-200 profiles. Map the `bootloader` code (`Gp200UpdaterError`) and the `Gp200Error` codes in `state/connection-error.ts`. Gate features per family: `exportPreset` / `liveBpm` are verified features on the GP-200 and must not hide behind "GP-50 extras".
6. **Files and writes:**
   - `ConfirmWriteDialog.tsx` `writeFrameCount` uses the GP-5 encoder, so it crashes for 1224-byte files. Use a per-family frame count, and no "frames acknowledged" copy (the GP-200 sends no ACKs).
   - `sniffPrst` reports LT/JR files as `gp200`; compare by family where the model doesn't matter.
   - `conversion.ts`: GP-200 ↔ LT/JR is the same format, not lossy.
   - `preset-summary.ts` returns null for GP-200 files.
   - `library/import.ts` rejects GP-200 files.
   - "Clear" needs an empty slot, which the GP-200 doesn't have.
7. **Tests to update:** `state/device.registry.test.ts`, `screens/device/guidance.test.ts`, `screens/library/import.test.ts`. Add store tests over `MockGp200` for gp200 / lt / jr: connect + sync, edits, save, rename, write, catalog absent / present.

## Step 2: UI (four agents in parallel, disjoint files, after step 1)
Issue ids come from the UI × model review.

**A. Rig: chain and pedal art** (`screens/rig/{Pedalboard,ChainOverview,AmpCabView,ModelPicker,order}`, `components/gear/**`, `styles/tokens.css`)
- G8: flat 11-block chain with draggable FX-loop send/return nodes. No "fixed order" lock on the GP-200.
- G9: board overflow (up to 10 pedals before the amp): visible scroller, and the selected pedal scrolled into view.
- G10: models with more knobs than the art holds (Tape Delay S 10, Ice Delay 11, Hyper EQ 11 bands) need a "More controls" strip.
- G11: cab Low Cut / High Cut from `model.params`, with OFF at the range ends.
- G12: amp voicing and origin from the catalog category.
- G13: capture art chosen by fxid family (0x0F…), with no NS copy.
- G14: `--block-wah` and `--block-vol` tokens (≥3:1 against `--well`).
- G15: picker categories and copy per family.

**B. Rig: patch controls** (`screens/rig/{RigHeader,FootswitchControl,ExpControl,TempoControl,BlockMenu,edits,tempo}`, a new patch panel)
- G5: CTRL editor from `profile.ctrls` / `profile.footswitches` (GP-200 has 8 CTRL, LT 4 footswitches, JR 3), extending the Footswitches popover from U4.
- G6: GP-200 EXP editor: EXP1A / EXP1B / EXP2, 3 entries each, labelled per model (the LT has no built-in EXP, the JR has a built-in EXP plus one jack).
- G7: Quick Access knobs 1-3.
- G8 (patch side): loop mode, send/return level, pan, style, author, note.
- G23: tempo range from the profile (GP-200 40-250).
- U5 already sizes the name field from `nameLength` (16).

**C. Library, Tones, Song, palette** (`screens/library/**`, `screens/tones/**`, `snaptone/**`, `userir/**`, `song/**`, `app/palette/**`, `components/write/**`)
- G4: slot-label columns sized for `12-C`.
- G19: 16-character names.
- G20: no Empty tab or empty counts; "Clear" becomes "Reset to init patch" (`0x2009` is not verified on hardware).
- G21: factory banks 01-A…25-D dimmed, with a warning before writes.
- G22: confirm copy for the no-ACK write.
- G16: SnapTones grouped AMP 0-4 / DST 5-9, empties counted by `kind`.
- SnapTone conversion produces the GP-200 clone (`snaptone/worker.ts` makes the GP-5 2696-byte file today; the driver refuses it).
- User IR keeps 1024 samples (`userir/convert.ts` cuts to 512); `shared/tone3000.ts` finds empty slots by `kind`.
- G17: copy from the profile (`userIr.samples`, slot count).
- G25: Tone Match hidden or disabled with a reason until a GP-200 model mapping exists.
- Palette "load capture" uses the capture block from the profile (today it looks up `NS`, which gives -1 on the GP-200).

**D. Device and settings** (`screens/device/**`, `app/*.tsx`, `state/driver/gp200-globals.ts`)
- G0: mount `Gp200CatalogPanel`, and show a call to action on Rig / picker / Library while the catalog isn't ready.
- G1: no remembered-GP-50 copy while a GP-200 is attached (Device header, chip, Rig empty state, Diagnostics, Library, Tones, Song).
- G2: header wrap.
- G3: "Simulate a GP-200 / LT / JR" buttons.
- G18: settings per model (`only` restrictions: the JR has no DIN MIDI) and a Global EQ panel (31 values, `0x1005`).
- G26: rename "GP-50 extras" to a family-neutral experimental switch and list what it unlocks per family.
- `midi-log.ts` decodes all traffic as GP-5 SysEx; decode GP-200 frames with `gp200/lib/protocol.mjs`.

## Step 3: docs and release gates
- README support table, CHANGELOG `Unreleased`, `app/README.md` (drivers, `?mock=gp200*`), and the status of `docs/device-expansion-plan.md`.
- Hardware verification (phase 7) on a real GP-200: read-only first, writes on scratch user slots ≥ 100 after a full backup. Open items: CC0 bank polarity, `0x2009` init-patch, the CTRL count on LT/JR, and the GP-200 backup time (the profile's `backupSeconds: 300` is an estimate).

## Decisions already made
- Select a GP-200 patch with `0x1008` only, never CC/PC, until the CC0 polarity is verified.
- Keep the official editor's full sync sequence (including drum/style reads) as the hardware-safety baseline.
- The effect catalog is built from the user's own `algorithm.xml` and never shipped (vendor data).
- `DeviceDriver` capabilities stay optional, plus a `features` list; the families implement different subsets.
- A GP-200 `.prst` is never converted to or from the GP-5 family (no model mapping).
