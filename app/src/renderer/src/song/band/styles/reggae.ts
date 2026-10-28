// Reggae: the one drop. The kick and the rim or snare land together on beat 3 only, and the hat plays the off-beats (the skank).

import { CLOSED_HAT, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { EIGHTHS, ODD_SIXTEENTHS, QUARTERS, SIXTEENTHS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

/** The off-beats, the skank that the hat or the guitar plays. */
const SKANK = [2, 6, 10, 14];

export const REGGAE: Style = {
  id: "reggae",
  name: "Reggae",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Sidestick one drop", 16, lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, SKANK)),
      groove("Kick and sidestick", 16, lane(KICK, VEL.normal, [8]), lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, SKANK)),
    ],
    2: [
      groove("One drop", 16, lane(KICK, VEL.normal, [8]), lane(SNARE, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, SKANK)),
      groove(
        "One drop with quarter hats",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(SNARE, VEL.normal, [8]),
        lane(SNARE, VEL.ghost, [14], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
      ),
    ],
    3: [
      groove("One drop eighths", 16, lane(KICK, VEL.normal, [8]), lane(SNARE, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove("One drop with open skank", 16, lane(KICK, VEL.normal, [8]), lane(SNARE, VEL.normal, [8]), lane(OPEN_HAT, VEL.hat, SKANK)),
    ],
    4: [
      groove(
        "One drop with ride",
        16,
        lane(KICK, VEL.normal, [8, 14]),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, SKANK),
      ),
      groove("Kick on the and of four", 16, lane(KICK, VEL.normal, [8, 14]), lane(SNARE, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
    ],
    5: [
      groove(
        "Busy one drop",
        16,
        lane(KICK, VEL.normal, [8, 11, 14]),
        lane(SNARE, VEL.normal, [8, 12]),
        lane(OPEN_HAT, VEL.hat, SKANK),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
      ),
      groove(
        "Sixteenth hats",
        16,
        lane(KICK, VEL.normal, [8, 10, 14]),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
        lane(OPEN_HAT, VEL.hat, [14]),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(MID_TOM, VEL.normal, [13]), lane(LOW_TOM, VEL.normal, [15])),
      bar(
        16,
        lane(KICK, VEL.normal, [8]),
        lane(HIGH_TOM, VEL.normal, [10]),
        lane(MID_TOM, VEL.normal, [12]),
        lane(LOW_TOM, VEL.normal, [14]),
        lane(SNARE, VEL.normal, [15]),
      ),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.normal, [8]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
      ),
      bar(16, lane(KICK, VEL.normal, [8]), lane(SNARE, VEL.normal, EIGHTHS), lane(SNARE, VEL.ghost, ODD_SIXTEENTHS, { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [[8], [0, 8]],
      2: [[8], [2, 8]],
      3: [[8], [2, 8, 10]],
      4: [
        [0, 8],
        [2, 6, 8, 10],
      ],
      5: [
        [0, 2, 8, 10],
        [2, 6, 8, 14],
      ],
    },
  },
};
