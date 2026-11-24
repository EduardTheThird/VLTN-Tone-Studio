import type { OctaveJumps } from "@/song/band/arrangement";
import { BandSections, type BandSectionRow } from "./BandSections";
import type { SectionOverride } from "@/song/band/arrangement";

/** The Parts tab: the sections table, where the performer changes what the band plays in each part of the song. */
export function BandTabParts({
  rows,
  disabled,
  selected,
  onSelect,
  onChange,
  onCopyToSameKind,
  onReset,
  onLock,
  canLock,
  defaultOctaveJumps,
  beatsPerBar,
  drumPhrases,
  hasOriginalDrums,
}: {
  rows: readonly BandSectionRow[];
  disabled: boolean;
  selected: number | null;
  onSelect(index: number | null): void;
  onChange(sectionId: string | null, patch: SectionOverride): void;
  onCopyToSameKind(sectionId: string | null): void;
  onReset(sectionId: string | null): void;
  onLock?(sectionId: string | null): void;
  canLock?: boolean;
  defaultOctaveJumps?: OctaveJumps;
  beatsPerBar?: number;
  drumPhrases?: boolean;
  hasOriginalDrums?: boolean;
}) {
  return (
    <section aria-label="Sections" className="flex flex-col gap-2">
      <BandSections
        rows={rows}
        disabled={disabled}
        selected={selected}
        onSelect={onSelect}
        onChange={onChange}
        onCopyToSameKind={onCopyToSameKind}
        onReset={onReset}
        onLock={onLock}
        canLock={canLock}
        defaultOctaveJumps={defaultOctaveJumps}
        beatsPerBar={beatsPerBar}
        drumPhrases={drumPhrases}
        hasOriginalDrums={hasOriginalDrums}
      />
    </section>
  );
}
