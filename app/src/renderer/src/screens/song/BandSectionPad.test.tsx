import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BandSectionPad } from "./BandSectionPad";

afterEach(cleanup);

it("snaps a drag, auditions on release, and clears at the hollow cell", () => {
  const change = vi.fn();
  render(<BandSectionPad value={{ busy: 1, loud: 5 }} automatic={{ busy: 1, loud: 5 }} overridden={false} onChange={change} />);
  const pad = screen.getByRole("group");
  vi.spyOn(pad, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 65, bottom: 65, width: 65, height: 65, toJSON: () => ({}) });
  fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 44, clientY: 44 });
  expect(change).not.toHaveBeenCalled();
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 44, clientY: 44 });
  expect(change).toHaveBeenLastCalledWith({ busy: 4, loud: 2 }, true);
  fireEvent.pointerDown(pad, { pointerId: 2, button: 0, clientX: 5, clientY: 5 });
  fireEvent.pointerUp(pad, { pointerId: 2, clientX: 5, clientY: 5 });
  expect(change).toHaveBeenLastCalledWith(null, true);
});

it("moves one cell by keyboard and clears with Delete", () => {
  const change = vi.fn();
  render(<BandSectionPad value={{ busy: 3, loud: 3 }} automatic={{ busy: 2, loud: 2 }} overridden onChange={change} />);
  const pad = screen.getByRole("group");
  fireEvent.keyDown(pad, { key: "ArrowLeft" });
  expect(change).toHaveBeenLastCalledWith({ busy: 2, loud: 3 }, false);
  fireEvent.keyDown(pad, { key: "ArrowUp" });
  expect(change).toHaveBeenLastCalledWith({ busy: 3, loud: 4 }, false);
  fireEvent.keyDown(pad, { key: "Delete" });
  expect(change).toHaveBeenLastCalledWith(null, false);
});
