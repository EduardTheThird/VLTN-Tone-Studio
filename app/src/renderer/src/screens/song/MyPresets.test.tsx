import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { MyPresets } from "./MyPresets";

afterEach(() => {
  cleanup();
  localStorage.clear();
  usePedalLibrary.setState({ presets: {} });
});

it("previews pasted names and unrecognised lines before saving, then edits a note", async () => {
  const { container } = render(<MyPresets disabled={false} />);
  const details = container.querySelector("details")!;
  act(() => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  fireEvent.change(screen.getByLabelText("Paste preset names, one memory and name per line"), { target: { value: "12B Dotted 8th\nInvalid" } });
  fireEvent.click(screen.getByText("Preview pasted names"));
  expect(screen.getByText("12B Dotted 8th")).toBeTruthy();
  expect(screen.getByText("Line 2: Invalid")).toBeTruthy();
  expect(usePedalLibrary.getState().presets).toEqual({});
  fireEvent.click(screen.getByText("Save preset names"));
  expect(screen.getByLabelText<HTMLInputElement>("Name for 12B").value).toBe("Dotted 8th");
  const note = screen.getByLabelText("Note for 12B");
  fireEvent.change(note, { target: { value: "For choruses" } });
  fireEvent.blur(note);
  expect(usePedalLibrary.getState().presets["strymon-timeline"]).toEqual([{ slot: 25, name: "Dotted 8th", note: "For choruses" }]);
});
