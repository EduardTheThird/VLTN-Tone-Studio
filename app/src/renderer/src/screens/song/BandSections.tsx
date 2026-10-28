import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENERGIES, STYLE_IDS, STYLES, type StyleId } from "@/song/band/styles";
import type { SectionPlan } from "@/song/band/arrangement";

export interface BandSectionRow {
  plan: SectionPlan;
  name: string;
}

/**
 * One row per section plan: name, style, energy, the fill at its end, and whether drums and bass play in it. The whole-song row (a song
 * with no sections) takes its style and parts from the settings above; energy and fill are fixed for it, so they are shown but not edited.
 */
export function BandSections({
  rows,
  disabled,
  selected,
  onSelect,
  onChange,
}: {
  rows: readonly BandSectionRow[];
  disabled: boolean;
  /** The index of the row that previews start from, or null to start from the playhead. */
  selected: number | null;
  onSelect(index: number | null): void;
  onChange(sectionId: string | null, patch: Partial<SectionPlan>): void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="text-silkscreen-3">
          <tr>
            <th className="py-1 pr-2 font-normal">Section</th>
            <th className="py-1 pr-2 font-normal">Style</th>
            <th className="py-1 pr-2 font-normal">Energy</th>
            <th className="py-1 pr-2 font-normal">Fill</th>
            <th className="py-1 pr-2 font-normal">Drums</th>
            <th className="py-1 pr-2 font-normal">Bass</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ plan, name }, index) => {
            const whole = plan.sectionId === null;
            return (
              <tr key={plan.sectionId ?? "whole"} className="border-t border-seam">
                <td className="py-1.5 pr-2">
                  <button
                    type="button"
                    aria-pressed={selected === index}
                    disabled={disabled}
                    onClick={() => onSelect(selected === index ? null : index)}
                    className={`rounded px-1 text-left ${selected === index ? "text-led-on" : ""}`}
                  >
                    {name}
                  </button>
                </td>
                <td className="py-1.5 pr-2">
                  <Select value={plan.style} disabled={disabled} onValueChange={(value) => onChange(plan.sectionId, { style: value as StyleId })}>
                    <SelectTrigger size="sm" aria-label={`Style of ${name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_IDS.map((id) => (
                        <SelectItem key={id} value={id}>
                          {STYLES[id].name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-1.5 pr-2">
                  <Select
                    value={String(plan.energy)}
                    disabled={disabled || whole}
                    onValueChange={(value) => onChange(plan.sectionId, { energy: Number(value) as SectionPlan["energy"] })}
                  >
                    <SelectTrigger size="sm" aria-label={`Energy of ${name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENERGIES.map((level) => (
                        <SelectItem key={level} value={String(level)}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-1.5 pr-2">
                  <Checkbox
                    aria-label={`Fill at the end of ${name}`}
                    disabled={disabled || whole}
                    checked={plan.fill}
                    onCheckedChange={(checked) => onChange(plan.sectionId, { fill: checked === true })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Checkbox
                    aria-label={`Drums in ${name}`}
                    disabled={disabled}
                    checked={plan.play.drums}
                    onCheckedChange={(checked) => onChange(plan.sectionId, { play: { ...plan.play, drums: checked === true } })}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Checkbox
                    aria-label={`Bass in ${name}`}
                    disabled={disabled}
                    checked={plan.play.bass}
                    onCheckedChange={(checked) => onChange(plan.sectionId, { play: { ...plan.play, bass: checked === true } })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
