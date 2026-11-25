import { useNav } from "@/state/nav";
import { useSong } from "@/song/store";
import { describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "@/song/types";
import { openSong, songHeadline } from "./SongScreen";

const HINT = "Split a song into stems on this computer, then find a GP-5 tone for its guitar.";
const audio: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(4)] };

describe("songHeadline", () => {
  it("shows the hint when no song is open", () => {
    expect(songHeadline(null, undefined, HINT)).toBe(HINT);
  });

  it("shows the file name for an unsaved file", () => {
    expect(songHeadline({ name: "5. Burn.wav", audio }, undefined, HINT)).toBe("5. Burn.wav");
  });

  it("shows the saved song's title and artist, not its file name", () => {
    const saved = { title: "Burn", artist: "WakingHollowPandas" };
    expect(songHeadline({ name: "5. Burn.wav", libraryId: "song-1", audio }, saved, HINT)).toBe("Burn · WakingHollowPandas");
  });

  it("shows only the title of a saved song with no artist", () => {
    expect(songHeadline({ name: "5. Burn.wav", libraryId: "song-1", audio }, { title: "Burn", artist: "  " }, HINT)).toBe("Burn");
  });

  it("falls back to the file name while the library does not list the saved song yet", () => {
    expect(songHeadline({ name: "5. Burn.wav", libraryId: "song-1", audio }, undefined, HINT)).toBe("5. Burn.wav");
  });
});

it("opens a first import in Songs & sets and preserves explicit Stems imports", async () => {
  const load = vi.spyOn(useSong.getState(), "load").mockResolvedValue(undefined);
  const track = new File([], "Backing.wav");
  try {
    useNav.getState().go("song", "songs");
    await openSong(track);
    expect(load).toHaveBeenCalledWith(track);
    expect(useNav.getState().param).toBe("songs");
    useNav.getState().go("song", "stems");
    await openSong(track);
    expect(useNav.getState().param).toBe("stems");
  } finally {
    load.mockRestore();
    useNav.getState().go("rig");
  }
});
