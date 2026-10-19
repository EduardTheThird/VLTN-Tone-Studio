import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type { T3kArchitecture, T3kGear, ToneSort } from "@shared/host/tones";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { loadSearch, useTones } from "./store";

const SORTS: [ToneSort, string][] = [
  ["trending", "Trending"],
  ["best-match", "Best match"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["downloads-all-time", "Most downloaded"],
];
const GEARS: [T3kGear, string][] = [
  ["amp", "Amp"],
  ["amp-cab", "Amp + cab"],
  ["pedal", "Pedal"],
  ["cab", "Cab"],
];
const ANY = "any";
const DEBOUNCE_MS = 400;

/** Search box and filters for the Search tab. Any change (or the shared format toggle) searches again after a short pause. */
export function SearchBar() {
  const search = useTones((s) => s.search);
  const format = useTones((s) => s.format);
  const first = useRef(true);
  const patch = (p: Partial<typeof search>) => useTones.setState((s) => ({ search: { ...s.search, ...p } }));

  useEffect(() => {
    // First run: load immediately; later runs: wait for the typing to stop.
    const t = window.setTimeout(() => void loadSearch(), first.current ? 0 : DEBOUNCE_MS);
    first.current = false;
    return () => window.clearTimeout(t);
  }, [search, format]);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-52 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-silkscreen-3" />
        <Input
          type="search"
          value={search.query}
          maxLength={100}
          placeholder="Search tones: amp, pedal, artist…"
          aria-label="Search TONE3000"
          className="pl-9"
          onChange={(e) => patch({ query: e.target.value })}
        />
      </div>
      <ToggleGroup type="multiple" spacing={1.5} value={search.gears} onValueChange={(v) => patch({ gears: v as T3kGear[] })} aria-label="Gear">
        {GEARS.map(([v, label]) => (
          <ToggleGroupItem key={v} value={v}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select value={search.architecture ?? ANY} onValueChange={(v) => patch({ architecture: v === ANY ? null : (v as T3kArchitecture) })}>
        <SelectTrigger size="sm" aria-label="NAM architecture" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any NAM</SelectItem>
          <SelectItem value="1">A1</SelectItem>
          <SelectItem value="2">A2</SelectItem>
        </SelectContent>
      </Select>
      <Select value={search.sort} onValueChange={(v) => patch({ sort: v as ToneSort })}>
        <SelectTrigger size="sm" aria-label="Sort by" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map(([v, label]) => (
            <SelectItem key={v} value={v}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
