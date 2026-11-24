import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DrumPattern } from "@/song/band/arrangement";

export function DrumPatternPicker({
  label,
  value,
  inherited = false,
  disabled,
  onChange,
}: {
  label: string;
  value: DrumPattern | undefined;
  inherited?: boolean;
  disabled: boolean;
  onChange(value: DrumPattern | undefined): void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      Pattern
      <Select
        value={value ?? "song"}
        disabled={disabled}
        onValueChange={(value) => onChange(value === "song" ? undefined : value === "original" ? "original" : "style")}
      >
        <SelectTrigger size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {inherited && <SelectItem value="song">Song setting</SelectItem>}
          <SelectItem value="style">From the style</SelectItem>
          <SelectItem value="original">From the original drummer</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}
