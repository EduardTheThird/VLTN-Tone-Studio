import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LyricsBatchSettings } from "./LyricsBatchSettings";

afterEach(cleanup);

it("shows the download size and a rough time for the songs chosen", () => {
  const noop = vi.fn();
  render(
    <LyricsBatchSettings
      choice={{ model: "small", quality: "fast" }}
      onChoice={noop}
      which="empty"
      onWhich={noop}
      retime
      onRetime={noop}
      disabled={false}
      songs={3}
    />,
  );
  expect(screen.getAllByText(/Downloads about 249 MB once/).length).toBeGreaterThan(0);
  expect(screen.getByText(/About 10 min for 3 songs/)).toBeTruthy();
  expect(screen.getByText("Songs with no lyrics")).toBeTruthy();
  expect(screen.getByText("Songs whose lyrics were made with another model")).toBeTruthy();
});
