import { describe, expect, it } from "vitest";
import type { Playlist } from "@shared/song-library";
import { changeOf, draftOf, isDirty } from "./playlist-draft";

const saved: Playlist = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Gig",
  songs: ["s1", "s2", "s3"],
  sets: [{ id: "22222222-2222-2222-2222-222222222222", name: "Set 1", start: 0 }],
  overrides: [null, { endBehaviour: "loop" }, null],
};

describe("playlist draft", () => {
  it("starts from the saved playlist, with its overrides lined up with its songs", () => {
    expect(draftOf({ ...saved, overrides: undefined })).toEqual({ name: "Gig", songs: ["s1", "s2", "s3"], sets: saved.sets, overrides: [null, null, null] });
    expect(draftOf(saved)).toEqual({ name: "Gig", songs: ["s1", "s2", "s3"], sets: saved.sets, overrides: saved.overrides });
  });

  it("copies the lists, so an edit to the draft never changes the saved playlist", () => {
    const draft = draftOf(saved);
    draft.songs.push("s4");
    draft.sets.push({ id: "33333333-3333-3333-3333-333333333333", name: "Encore", start: 2 });
    expect(saved.songs).toEqual(["s1", "s2", "s3"]);
    expect(saved.sets).toHaveLength(1);
  });

  it("is dirty only once the draft differs from where it started", () => {
    const base = draftOf(saved);
    expect(isDirty(draftOf(saved), base)).toBe(false);
    expect(isDirty({ ...base, name: "Gig 2" }, base)).toBe(true);
    expect(isDirty({ ...base, songs: ["s2", "s1", "s3"] }, base)).toBe(true);
    expect(isDirty({ ...base, overrides: [null, null, null] }, base)).toBe(true);
  });

  it("writes the whole change with the name trimmed", () => {
    const draft = { ...draftOf(saved), name: "  Friday  ", songs: ["s3"], overrides: [null] };
    expect(changeOf(draft)).toEqual({ name: "Friday", songs: ["s3"], sets: saved.sets, overrides: [null] });
  });
});
