import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { BASS_MODES, BASS_RANGES, BASS_SOUNDS, HUMANISE_CHOICES, type BandSettings, type FollowSource, type HumaniseChoice } from "@/song/band/arrangement";
import { STYLE_IDS, STYLES, type Style, type StyleId } from "@/song/band/styles";

const BASS_MODE_LABELS: Record<(typeof BASS_MODES)[number], string> = {
  roots: "Roots",
  fifths: "Roots and fifths",
  octaves: "Octaves",
  melodic: "Melodic (approach notes)",
  walking: "Walking",
};
const BASS_SOUND_LABELS: Record<(typeof BASS_SOUNDS)[number], string> = { finger: "Finger", pick: "Pick" };
const BASS_RANGE_LABELS: Record<(typeof BASS_RANGES)[number], string> = { low: "Low", normal: "Normal", high: "High" };
const FOLLOW_LABELS: Record<FollowSource, string> = { auto: "Auto", guitar: "Guitar", piano: "Piano", other: "Other", mix: "Mix" };
const HUMANISE_LABELS: Record<HumaniseChoice, string> = {
  style: "Style default",
  tight: "Tight",
  natural: "Natural",
  "laid-back": "Laid back",
  pushed: "Pushed",
};

export interface BandSettingsFormProps {
  settings: BandSettings;
  /** The style the settings name, for the walking bass option. */
  style: Style;
  /** The follow sources the song can read: auto, then the stems that were split, then the mix. */
  followSources: readonly FollowSource[];
  onChange(patch: Partial<BandSettings>): void;
  /** Changes the style, which also sets its swing default. */
  onStyle(id: StyleId): void;
}

/** The song-wide band settings. Changing one saves it; nothing is generated until Generate. */
export function BandSettingsForm({ settings, style, followSources, onChange, onStyle }: BandSettingsFormProps) {
  return (
    <section aria-label="Band settings" className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">Settings</h3>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <Switch aria-label="Generate drums" checked={settings.parts.drums} onCheckedChange={(on) => onChange({ parts: { ...settings.parts, drums: on } })} />
          Drums
        </label>
        <label className="flex items-center gap-2">
          <Switch aria-label="Generate bass" checked={settings.parts.bass} onCheckedChange={(on) => onChange({ parts: { ...settings.parts, bass: on } })} />
          Bass
        </label>
      </div>
      <label className="flex items-center gap-3">
        Style
        <Select value={settings.style} onValueChange={(value) => onStyle(value as StyleId)}>
          <SelectTrigger aria-label="Style" className="w-44">
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
      </label>
      <label className="flex items-center gap-3">
        Complexity {Math.round(settings.complexity * 100)}%
        <Slider
          aria-label="Complexity"
          min={0}
          max={100}
          step={5}
          value={[Math.round(settings.complexity * 100)]}
          onValueChange={([percent]) => onChange({ complexity: percent / 100 })}
        />
      </label>
      <label className="flex items-center gap-3">
        Swing {Math.round(settings.swing * 100)}%
        <Slider
          aria-label="Swing"
          min={0}
          max={75}
          step={5}
          value={[Math.round(settings.swing * 100)]}
          onValueChange={([percent]) => onChange({ swing: percent / 100 })}
        />
      </label>
      <label className="flex items-center gap-3">
        Humanise {Math.round(settings.humanise.amount * 100)}%
        <Slider
          aria-label="Humanise"
          min={0}
          max={100}
          step={5}
          value={[Math.round(settings.humanise.amount * 100)]}
          onValueChange={([percent]) => onChange({ humanise: { ...settings.humanise, amount: percent / 100 } })}
        />
      </label>
      <label className="flex items-center gap-3">
        Feel
        <Select value={settings.humanise.feel} onValueChange={(value) => onChange({ humanise: { ...settings.humanise, feel: value as HumaniseChoice } })}>
          <SelectTrigger aria-label="Humanise feel" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HUMANISE_CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {HUMANISE_LABELS[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Ghost notes" checked={settings.ghostNotes} onCheckedChange={(on) => onChange({ ghostNotes: on })} />
        Ghost notes
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Crash on section starts" checked={settings.crashOnSections} onCheckedChange={(on) => onChange({ crashOnSections: on })} />
        Crash on section starts
      </label>
      <label className="flex items-center gap-3">
        Bass sound
        <Select value={settings.bassSound} onValueChange={(value) => onChange({ bassSound: value as BandSettings["bassSound"] })}>
          <SelectTrigger aria-label="Bass sound" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASS_SOUNDS.map((sound) => (
              <SelectItem key={sound} value={sound}>
                {BASS_SOUND_LABELS[sound]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-3">
        Bass range
        <Select value={settings.bassRange} onValueChange={(value) => onChange({ bassRange: value as BandSettings["bassRange"] })}>
          <SelectTrigger aria-label="Bass range" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASS_RANGES.map((range) => (
              <SelectItem key={range} value={range}>
                {BASS_RANGE_LABELS[range]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-3">
        Bass mode
        <Select value={settings.bassMode} onValueChange={(value) => onChange({ bassMode: value as BandSettings["bassMode"] })}>
          <SelectTrigger aria-label="Bass mode" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASS_MODES.filter((mode) => mode !== "walking" || style.bass.walking).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {BASS_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Lock bass to kick" checked={settings.lockToKick} onCheckedChange={(on) => onChange({ lockToKick: on })} />
        Lock bass to kick
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Follow my playing" checked={settings.followPlaying} onCheckedChange={(on) => onChange({ followPlaying: on })} />
        Follow my playing
      </label>
      <label className="flex items-center gap-3">
        Follow source
        <Select
          value={followSources.includes(settings.followSource) ? settings.followSource : "auto"}
          disabled={!settings.followPlaying}
          onValueChange={(value) => onChange({ followSource: value as FollowSource })}
        >
          <SelectTrigger aria-label="Follow source" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {followSources.map((source) => (
              <SelectItem key={source} value={source}>
                {FOLLOW_LABELS[source]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </section>
  );
}
