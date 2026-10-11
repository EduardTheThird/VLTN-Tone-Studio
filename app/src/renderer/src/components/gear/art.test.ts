import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_HEX } from "./art";

// Read as a file: vitest hands CSS imports over empty
const tokens = readFileSync(join(__dirname, "../../styles/tokens.css"), "utf8");
const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim() ?? "";
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** WCAG relative luminance of 0..255 channels. */
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("block colours", () => {
  it("the drawings use the --block-* token of every block", () => {
    for (const [code, hex] of Object.entries(BLOCK_HEX)) expect(token(`block-${code.toLowerCase()}`).toLowerCase(), code).toBe(hex);
  });

  it("every block colour reads at 3:1 or more on --well", () => {
    // --well is translucent black: composite it over the app canvas
    const alpha = Number(/\/\s*([\d.]+)\s*\)/.exec(token("well"))?.[1]);
    const well = luminance(channels(token("enclosure")).map((c) => c * (1 - alpha)));
    for (const [code, hex] of Object.entries(BLOCK_HEX)) expect((luminance(channels(hex)) + 0.05) / (well + 0.05), code).toBeGreaterThanOrEqual(3);
  });
});
