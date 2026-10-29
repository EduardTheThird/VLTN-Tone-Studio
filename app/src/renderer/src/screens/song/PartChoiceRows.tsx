import { Button } from "@/components/ui/button";
import { PART_KINDS, type PartChoice, type PartChoices, type PartKind } from "@/song/band/part-choice";

/** The three choices, in the order the buttons show them. */
const OPTIONS: { choice: PartChoice; label: string }[] = [
  { choice: "original", label: "Original" },
  { choice: "generated", label: "Generated" },
  { choice: "both", label: "Both" },
];
const LABEL: Record<PartKind, string> = { drums: "Drums", bass: "Bass" };

/** The Band panel's "What plays" choice, one row per part. A part with no generated track yet can only play its original. */
export function PartChoiceRows({
  choices,
  generated,
  disabled,
  onChange,
}: {
  choices: PartChoices;
  /** Whether each part has a generated track. Generated and Both need one. */
  generated: Record<PartKind, boolean>;
  /** True while a Band action runs. Playback does not disable the rows: switching only changes mute levels. */
  disabled: boolean;
  onChange(patch: Partial<PartChoices>): void;
}) {
  return (
    <section aria-label="What plays" className="flex flex-col gap-2">
      <h3 className="font-semibold">What plays</h3>
      {PART_KINDS.map((kind) => (
        <div key={kind} role="group" aria-label={LABEL[kind]} className="flex flex-wrap items-center gap-2">
          <span className="w-16">{LABEL[kind]}</span>
          {OPTIONS.map(({ choice, label }) => {
            const needsGenerated = choice !== "original";
            const unavailable = needsGenerated && !generated[kind];
            return (
              <Button
                key={choice}
                size="sm"
                variant={choices[kind] === choice ? "default" : "outline"}
                aria-pressed={choices[kind] === choice}
                disabled={disabled || unavailable}
                onClick={() => onChange({ [kind]: choice })}
              >
                {label}
              </Button>
            );
          })}
          {!generated[kind] && <span className="text-muted-foreground">Generate the {LABEL[kind].toLowerCase()} first.</span>}
        </div>
      ))}
    </section>
  );
}
