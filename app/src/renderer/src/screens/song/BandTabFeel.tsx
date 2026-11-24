import type { BandSettings, FollowSource } from "@/song/band/arrangement";
import type { StyleId } from "@/song/band/styles";
import type { PcmAudio } from "@/song/types";
import { BandSettingsForm } from "./BandSettingsForm";
import { CountInControls } from "./CountInControls";
import { EndingControls } from "./EndingControls";

/** The Feel tab: how the drums and the bass play, in two columns. */
export function BandTabFeel({
  settings,
  hasOriginalDrums,
  followSources,
  onChange,
  onStyle,
  beatsPerBar,
  songSeconds,
  sections = [],
  keptAudio,
}: {
  settings: BandSettings;
  hasOriginalDrums?: boolean;
  followSources: readonly FollowSource[];
  onChange(patch: Partial<BandSettings>): void;
  onStyle(id: StyleId): void;
  beatsPerBar?: number;
  songSeconds: number;
  /** The song's sections, for the ending's "End after". */
  sections?: readonly { id: string; name: string }[];
  /** The original tracks that keep playing under the band, for the ending's fade notice. */
  keptAudio?: readonly PcmAudio[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <BandSettingsForm hasOriginalDrums={hasOriginalDrums} settings={settings} followSources={followSources} onChange={onChange} onStyle={onStyle} beatsPerBar={beatsPerBar} songSeconds={songSeconds} />
      <CountInControls settings={settings} onChange={onChange} />
      <EndingControls settings={settings} sections={sections} keptAudio={keptAudio} onChange={onChange} />
    </div>
  );
}
