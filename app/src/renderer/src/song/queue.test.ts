import { describe, expect, it } from "vitest";
import { QUEUE_MAX, addToQueue, isEditable, moveInQueue, moveToBottom, moveToTop, playNext, removeFromQueue, upcoming, type QueueState } from "./queue";

/** A queue where "a" is playing, "b" and "c" are played before it, and "d" "e" "f" are still to come. */
const state: QueueState = { queue: ["b", "c", "a", "d", "e", "f"], position: 2 };

describe("what plays next", () => {
  it("lists only the songs still to come", () => {
    expect(upcoming(state)).toEqual(["d", "e", "f"]);
    expect(upcoming({ queue: ["x"], position: -1 })).toEqual(["x"]);
  });

  it("locks the playing song and the songs before it", () => {
    expect([0, 1, 2, 3].map((i) => isEditable(state, i))).toEqual([false, false, false, true]);
  });
});

describe("play next", () => {
  it("puts a song straight after the playing one", () => {
    expect(playNext(state, "z")).toEqual({ ok: true, queue: ["b", "c", "a", "z", "d", "e", "f"], position: 2 });
  });

  it("moves an upcoming copy up rather than repeating it", () => {
    expect(playNext(state, "e")).toEqual({ ok: true, queue: ["b", "c", "a", "e", "d", "f"], position: 2 });
  });

  it("refuses the song that is already playing", () => {
    expect(playNext(state, "a")).toEqual({ ok: false, reason: "That song is already playing." });
  });

  it("works with nothing loaded", () => {
    expect(playNext({ queue: [], position: -1 }, "a")).toEqual({ ok: true, queue: ["a"], position: -1 });
  });

  it("refuses when the queue is full", () => {
    const full: QueueState = { queue: Array.from({ length: QUEUE_MAX }, (_, i) => `s${i}`), position: 0 };
    expect(playNext(full, "x")).toEqual({ ok: false, reason: `The queue holds up to ${QUEUE_MAX} songs.` });
  });
});

describe("add to queue", () => {
  it("appends songs in order", () => {
    expect(addToQueue(state, ["x", "y"])).toEqual({ ok: true, queue: ["b", "c", "a", "d", "e", "f", "x", "y"], position: 2 });
  });

  it("adds nothing for an empty list", () => {
    expect(addToQueue(state, [])).toEqual({ ok: true, queue: state.queue, position: 2 });
  });

  it("holds the queue to 128 songs, and refuses the whole addition when it would not fit", () => {
    const nearly: QueueState = { queue: Array.from({ length: QUEUE_MAX - 1 }, (_, i) => `s${i}`), position: -1 };
    expect(addToQueue(nearly, ["one"]).ok).toBe(true);
    expect(addToQueue(nearly, ["one", "two"])).toEqual({ ok: false, reason: `The queue holds up to ${QUEUE_MAX} songs.` });
  });
});

describe("removing and moving entries", () => {
  it("removes an upcoming entry", () => {
    expect(removeFromQueue(state, 4)).toEqual({ ok: true, queue: ["b", "c", "a", "d", "f"], position: 2 });
  });

  it("will not remove the playing song or a played one", () => {
    expect(removeFromQueue(state, 2).ok).toBe(false);
    expect(removeFromQueue(state, 0).ok).toBe(false);
  });

  it("moves an entry down the upcoming songs", () => {
    expect(moveInQueue(state, 3, 5)).toEqual({ ok: true, queue: ["b", "c", "a", "e", "f", "d"], position: 2 });
  });

  it("moves an entry up, but never above the playing song", () => {
    expect(moveInQueue(state, 5, 0)).toEqual({ ok: true, queue: ["b", "c", "a", "f", "d", "e"], position: 2 });
  });

  it("moves an entry to the top or the bottom of the upcoming songs", () => {
    expect(moveToTop(state, 5)).toEqual({ ok: true, queue: ["b", "c", "a", "f", "d", "e"], position: 2 });
    expect(moveToBottom(state, 3)).toEqual({ ok: true, queue: ["b", "c", "a", "e", "f", "d"], position: 2 });
  });

  it("leaves the queue alone when an entry is dropped where it already is", () => {
    expect(moveInQueue(state, 4, 4)).toEqual({ ok: true, queue: state.queue, position: 2 });
  });

  it("refuses to move a locked entry", () => {
    expect(moveInQueue(state, 1, 4).ok).toBe(false);
  });

  it("never changes the playing position through an edit", () => {
    const edits = [playNext(state, "z"), addToQueue(state, ["z"]), removeFromQueue(state, 3), moveInQueue(state, 5, 3)];
    for (const edit of edits) if (edit.ok) expect(edit.position).toBe(2);
  });
});
