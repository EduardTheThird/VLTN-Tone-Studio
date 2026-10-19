import { describe, expect, it } from "vitest";
import { WHATS_NEW_VERSION, shouldShowWhatsNew } from "./whats-new";

describe("shouldShowWhatsNew", () => {
  it("shows to an upgrader who saw older notes", () => expect(shouldShowWhatsNew("0.7.2", true)).toBe(true));
  it("shows to a returning user with no record (upgrade from before the feature)", () => expect(shouldShowWhatsNew(null, true)).toBe(true));
  it("stays quiet for a first-time user", () => expect(shouldShowWhatsNew(null, false)).toBe(false));
  it("stays quiet once seen", () => expect(shouldShowWhatsNew(WHATS_NEW_VERSION, true)).toBe(false));
});
