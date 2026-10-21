import { useMemo } from 'react';
import { useDevice } from '@/state/device';
import { parsePrst, blocksOfMask } from '@/gp150/lib/prst.mjs';
import { BLOCKS } from '@/gp150/lib/protocol.mjs';
import { gp150ModelByFxid } from '@/gp150/app/catalog-adapter';
import { useAppSettings } from './settings-store';
import { notifyError } from '@/app/notify';

/** Read existing preset bytes only; this panel sends no MIDI commands. */
export function Gp180Inspection() {
  const preset = useDevice(s => s.preset);
  const status = useDevice(s => s.status);
  const mode = useDevice(s => s.mode);
  const connect = useDevice(s => s.connect);
  const { settings, patch: patchSettings } = useAppSettings();
  const unlocked = settings.gp180WriteUnlocked;

  const parsedPatch = useMemo(() => {
    if (preset?.device !== 'gp180') return null;
    try { return parsePrst(preset.prst); } catch { return null; }
  }, [preset]);

  const isRealGp180 = preset?.device === 'gp180' || (status === 'connected' && mode !== 'mock');
  if (!isRealGp180 && !parsedPatch) return null;

  const targetName = (target: number) => BLOCKS[target] ?? `Special target ${target}`;
  const parameterName = (target: number, param: number) => {
    if (!parsedPatch) return `Parameter ${param}`;
    const block = parsedPatch.blocks[target];
    if (!block) return `Parameter ${param}`;
    const model = gp150ModelByFxid(block.fxid, target);
    return model?.params.find(p => p.index === param)?.name ?? `Parameter ${param}`;
  };

  const toggleUnlock = async () => {
    const next = !unlocked;
    try {
      await patchSettings({ gp180WriteUnlocked: next });
      // Reconnect so the new readOnly setting takes effect immediately.
      if (status === 'connected' && mode === 'webmidi') {
        void connect('webmidi').catch(() => {});
      }
    } catch (e) {
      notifyError('Could not save GP-180 write setting', e);
    }
  };

  return (
    <section aria-label="GP-180 preset inspection" className="rounded-xl bg-faceplate p-6">
      <h2 className="text-xl font-bold">GP-180 preset inspection</h2>

      {/* Write unlock toggle — shown only for real (non-mock) GP-180 */}
      {mode !== 'mock' && (
        <div className={`mt-3 rounded border p-3 ${unlocked ? 'border-amber-400/60 bg-amber-400/10' : 'border-seam'}`}>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={unlocked}
              onChange={() => void toggleUnlock()}
              aria-label="Unlock GP-180 writes"
            />
            <span className="font-semibold">
              {unlocked ? '⚠ Writes unlocked (testing mode)' : 'Unlock writes for testing'}
            </span>
          </label>
          <p className="mt-1 text-sm text-silkscreen-3">
            {unlocked
              ? 'The read-only guard is OFF. Preset selection, edits, saves, and uploads are forwarded to the physical GP-180. The pedal\'s memory can be changed. Disable when done testing.'
              : 'Enable to remove the read-only safety guard. The app will reconnect and allow preset selection, edits, and uploads on the real GP-180. Use only for testing — enables writes to pedal memory.'}
          </p>
          {unlocked && status === 'connected' && mode === 'webmidi' && (
            <p className="mt-1 text-xs text-amber-300">Reconnected with writes enabled. "Read pedal again" to reload preset list and edit buffer.</p>
          )}
        </div>
      )}

      {parsedPatch && (
        <>
          <p className="mt-3 text-sm text-silkscreen-3">
            {mode === 'mock' ? 'Simulated data' : status === 'connected' ? 'Read from the connected pedal' : 'Last read; pedal disconnected'}
            {' '}· {unlocked && mode !== 'mock' ? 'Writes enabled' : 'Read-only'} · Preset {String(parsedPatch.slot + 1).padStart(3, '0')} · {parsedPatch.tempo} BPM
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">Knobs 1–3</h3>
              <ul className="mt-2 space-y-1 text-sm">{parsedPatch.knobs.map((k, i) => <li key={i}>Knob {i + 1}: {targetName(k.target)} / {parameterName(k.target, k.param)}</li>)}</ul>
              <p className="mt-2 text-xs text-silkscreen-3">Special target IDs are shown as reported; their meaning has not been verified.</p>
              <h3 className="mt-4 font-semibold">Footswitch assignments</h3>
              <ul className="mt-2 space-y-1 text-sm">{parsedPatch.footswitches.map((mask, i) => <li key={i}>{['A', 'B', 'C'][i] ?? i + 1}: {blocksOfMask(mask).map(k => BLOCKS[k]).join(', ') || 'No effect blocks assigned'}</li>)}</ul>
            </div>
            <div className="overflow-x-auto">
              <h3 className="font-semibold">Expression records · target {targetName(parsedPatch.exp.target)}</h3>
              <p className="mt-1 text-xs text-silkscreen-3">Raw records retained by the preset. Flags and unassigned parameter codes are shown without inferring their function.</p>
              <table className="mt-2 w-full text-left text-sm">
                <thead><tr>{['Entry', 'Parameter ID', 'Min', 'Max', 'Flag'].map(h => <th key={h} className="pr-3 pb-1">{h}</th>)}</tr></thead>
                <tbody>{parsedPatch.exp.entries.map((e, i) => <tr key={i}><td>{i + 1}</td><td>{e.param === 0xffff ? 'Unassigned (65535)' : e.param}</td><td>{e.min}</td><td>{e.max}</td><td>{e.flag}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
