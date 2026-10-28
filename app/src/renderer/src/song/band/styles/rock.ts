// Rock: straight eighths on the hat, a backbeat on 2 and 4, and kick patterns that get busier with energy.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { EIGHTHS, ODD_SIXTEENTHS, QUARTERS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

export const ROCK: Style = {
  id: "rock",
  name: "Rock",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Cross-stick quarters", 16, lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse kick", 16, lane(KICK, VEL.normal, [0, 8]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove("Straight eighths", 16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove("Kick and eighths", 16, lane(KICK, VEL.normal, [0, 8, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
    ],
    3: [
      groove("Push into two", 16, lane(KICK, VEL.normal, [0, 8, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove(
        "Open hat on the and of four",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, [0, 2, 4, 6, 8, 10, 12]),
        lane(OPEN_HAT, VEL.hat, [14]),
      ),
    ],
    4: [
      groove("Ride eighths", 16, lane(KICK, VEL.normal, [0, 8, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(RIDE, VEL.hat, EIGHTHS)),
      groove("Kick pushes", 16, lane(KICK, VEL.normal, [0, 6, 8, 14]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
    ],
    5: [
      groove("Open hat and four kicks", 16, lane(KICK, VEL.accent, [0, 6, 8, 14]), lane(SNARE, VEL.normal, [4, 12]), lane(OPEN_HAT, VEL.hat, [2, 6, 10, 14])),
      groove(
        "Ride and crash",
        16,
        lane(CRASH, VEL.crash, [0]),
        lane(KICK, VEL.normal, [0, 8, 10, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(HIGH_TOM, VEL.normal, [13]), lane(MID_TOM, VEL.normal, [14]), lane(LOW_TOM, VEL.normal, [15])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8]), lane(MID_TOM, VEL.normal, [10]), lane(LOW_TOM, VEL.normal, [12]), lane(SNARE, VEL.accent, [14, 15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 13, 14, 15]),
      ),
      bar(16, lane(KICK, VEL.accent, [0, 8]), lane(SNARE, VEL.normal, EIGHTHS), lane(SNARE, VEL.ghost, ODD_SIXTEENTHS, { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [[0], [0, 8]],
      2: [
        [0, 8],
        [0, 6, 8],
      ],
      3: [
        [0, 6, 8, 14],
        [0, 4, 8, 12],
      ],
      4: [
        [0, 3, 8, 11],
        [0, 6, 8, 14],
      ],
      5: [[...EIGHTHS], [0, 3, 6, 8, 11, 14]],
    },
  },
};
