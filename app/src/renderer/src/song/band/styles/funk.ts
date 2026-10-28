// Funk: sixteenth-note grooves, with kick and snare placed on the off-beats and ghost notes between the backbeats.

import { CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, SNARE, CLOSED_HAT, SIDE_STICK } from "../note";
import { EIGHTHS, ODD_SIXTEENTHS, QUARTERS, SIXTEENTHS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

export const FUNK: Style = {
  id: "funk",
  name: "Funk",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Sidestick funk", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse funk", 16, lane(KICK, VEL.normal, [0, 11]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove(
        "Ghosts between the backbeats",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
      groove(
        "Kick on three",
        16,
        lane(KICK, VEL.normal, [0, 3, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [6, 14], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    3: [
      groove(
        "Sixteenth hats",
        16,
        lane(KICK, VEL.normal, [0, 3, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 11, 15], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
      ),
      groove(
        "Syncopated kick",
        16,
        lane(KICK, VEL.normal, [0, 6, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [2, 9, 14], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    4: [
      groove(
        "Funk groove",
        16,
        lane(KICK, VEL.normal, [0, 3, 8, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 11, 15], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
      ),
      groove(
        "Open hat funk",
        16,
        lane(KICK, VEL.normal, [0, 3, 6, 10, 11]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [9, 14], { ghost: true }),
        lane(OPEN_HAT, VEL.hat, [14]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS.slice(0, 7)),
      ),
    ],
    5: [
      groove(
        "Busy funk",
        16,
        lane(KICK, VEL.normal, [0, 3, 6, 10, 13]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(OPEN_HAT, VEL.hat, [2, 10]),
        lane(SNARE, VEL.ghost, [7, 11, 15], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
      ),
      groove(
        "Crash funk",
        16,
        lane(CRASH, VEL.crash, [0]),
        lane(KICK, VEL.normal, [0, 2, 3, 6, 10, 11]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 14], { ghost: true }),
        lane(OPEN_HAT, VEL.hat, [14]),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(SNARE, VEL.ghost, [9, 11, 13, 15], { ghost: true }), lane(KICK, VEL.normal, [14])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8, 10]), lane(MID_TOM, VEL.normal, [12, 13]), lane(LOW_TOM, VEL.normal, [14]), lane(SNARE, VEL.normal, [15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0, 8, 14]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
      ),
      bar(16, lane(KICK, VEL.accent, [0, 8]), lane(SNARE, VEL.normal, [2, 4, 6, 8, 10, 12, 14]), lane(SNARE, VEL.ghost, ODD_SIXTEENTHS, { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [[0, 11], [0]],
      2: [
        [0, 3, 10],
        [0, 6, 10],
      ],
      3: [
        [0, 3, 6, 10],
        [0, 3, 8, 10, 14],
      ],
      4: [
        [0, 3, 6, 10, 11],
        [0, 3, 8, 10, 13],
      ],
      5: [
        [0, 2, 3, 6, 8, 10, 11, 14],
        [0, 3, 6, 7, 10, 13, 14],
      ],
    },
  },
};
