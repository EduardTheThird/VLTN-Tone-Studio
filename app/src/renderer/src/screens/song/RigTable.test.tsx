import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RigStageNext, RigTable } from "./RigTable";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { setClockPosition } from "@/song/performance/playback-clock";

const sections = [{ id: "verse", name: "Verse", start: 1, end: 6, mode: "continue" }] as const;

afterEach(() => {
  cleanup();
  usePedalLibrary.setState({ owned: [], channels: {}, assignments: {}, presets: {} });
  setClockPosition(0);
});

it("selects a named preset and keeps the rhythm memory read-only", () => {
  usePedalLibrary.setState({
    owned: ["strymon-timeline", "boss-rc10r"],
    presets: { "strymon-timeline": [{ slot: 24, name: "Dotted eighth" }] },
  });
  const saved = vi.fn();
  const view = render(<RigTable value={undefined} chart="" sections={sections} bpm={120} beats={4} duration={6} memory={8} locked={false} onSave={saved} />);
  const header = view.getByRole("button", { name: "Song Rig table" });
  if (header.getAttribute("aria-expanded") === "false") fireEvent.click(header);
  expect(view.getByLabelText("Song load RC-10R memory").textContent).toBe("Memory 8");
  expect(view.queryByRole("combobox", { name: /RC-10R/ })).toBeNull();
  fireEvent.change(view.getByRole("combobox", { name: "Verse TimeLine preset" }), { target: { value: "24" } });
  expect(saved.mock.calls[0][1]).toContain("TimeLine 12A Dotted eighth");
});

it("shows the upcoming section's named rig change on stage", () => {
  usePedalLibrary.setState({
    owned: ["strymon-timeline"],
    presets: { "strymon-timeline": [{ slot: 24, name: "Dotted eighth" }] },
  });
  const view = render(<RigStageNext sections={sections} value={{ rows: [{ id: "section:verse", cells: { "strymon-timeline": { preset: 24 } } }] }} />);
  expect(view.getByText("Next: TimeLine 12A Dotted eighth")).toBeTruthy();
});
