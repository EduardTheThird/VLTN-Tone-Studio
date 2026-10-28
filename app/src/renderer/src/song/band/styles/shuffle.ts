// Shuffle: a triplet grid of three steps to a beat. The swing is in the pattern itself, so the first and third triplet steps carry
// the ride and the middle one is left out. Walking bass fits this style.

import { CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE, CLOSED_HAT } from "../note";
import { VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

/** Ride on the first and third step of each triplet beat: "ding, ding-a, ding, ding-a". */
const SWUNG = [0, 2, 3, 5, 6, 8, 9, 11];

export const SHUFFLE: Style = {
  id: "shuffle",
  name: "Shuffle",
  meter: { beatsPerBar: 4, stepsPerBeat: 3 },
  swingDefault: 0.5,
  grooves: {
    1: [
      groove("Sidestick shuffle", 12, lane(SIDE_STICK, VEL.normal, [3, 9]), lane(CLOSED_HAT, VEL.hat, [0, 3, 6, 9])),
      groove("Sparse shuffle", 12, lane(KICK, VEL.normal, [0, 6]), lane(SIDE_STICK, VEL.normal, [3, 9]), lane(CLOSED_HAT, VEL.hat, [0, 6])),
    ],
    2: [
      groove("Hat quarters", 12, lane(KICK, VEL.normal, [0, 6]), lane(SNARE, VEL.normal, [3, 9]), lane(CLOSED_HAT, VEL.hat, [0, 3, 6, 9])),
      groove("Swung ride", 12, lane(KICK, VEL.normal, [0, 6]), lane(SNARE, VEL.normal, [3, 9]), lane(RIDE, VEL.hat, SWUNG)),
    ],
    3: [
      groove(
        "Ghost on the last triplet",
        12,
        lane(KICK, VEL.normal, [0, 6]),
        lane(SNARE, VEL.normal, [3, 9]),
        lane(SNARE, VEL.ghost, [8, 11], { ghost: true }),
        lane(RIDE, VEL.hat, SWUNG),
      ),
      groove("Kick on the and of three", 12, lane(KICK, VEL.normal, [0, 6, 9]), lane(SNARE, VEL.normal, [3, 9]), lane(RIDE, VEL.hat, SWUNG)),
    ],
    4: [
      groove(
        "Ride accents",
        12,
        lane(KICK, VEL.normal, [0, 6, 8]),
        lane(SNARE, VEL.normal, [3, 9]),
        lane(RIDE, VEL.accent, [0, 6]),
        lane(RIDE, VEL.normal, [2, 3, 5, 8, 9, 11]),
      ),
      groove(
        "Open hat on the end",
        12,
        lane(KICK, VEL.normal, [0, 6, 9]),
        lane(SNARE, VEL.normal, [3, 9]),
        lane(RIDE, VEL.hat, SWUNG),
        lane(OPEN_HAT, VEL.hat, [11]),
      ),
    ],
    5: [
      groove(
        "Busy shuffle",
        12,
        lane(KICK, VEL.normal, [0, 2, 6, 8]),
        lane(SNARE, VEL.normal, [3, 9]),
        lane(RIDE, VEL.hat, SWUNG),
        lane(OPEN_HAT, VEL.hat, [11]),
      ),
      groove(
        "Ghosts and crash",
        12,
        lane(CRASH, VEL.crash, [0]),
        lane(KICK, VEL.normal, [0, 6, 8, 11]),
        lane(SNARE, VEL.normal, [3, 9]),
        lane(SNARE, VEL.ghost, [5, 11], { ghost: true }),
        lane(RIDE, VEL.hat, SWUNG),
      ),
    ],
  },
  fills: {
    half: [
      bar(12, lane(HIGH_TOM, VEL.normal, [6]), lane(MID_TOM, VEL.normal, [8]), lane(LOW_TOM, VEL.normal, [9]), lane(SNARE, VEL.normal, [10, 11])),
      bar(12, lane(SNARE, VEL.normal, [6, 8, 9, 11]), lane(KICK, VEL.normal, [6])),
    ],
    bar: [
      bar(
        12,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 3]),
        lane(MID_TOM, VEL.normal, [6]),
        lane(LOW_TOM, VEL.normal, [9]),
        lane(SNARE, VEL.normal, [11]),
      ),
      bar(12, lane(KICK, VEL.accent, [0, 6]), lane(SNARE, VEL.normal, [3, 6, 9]), lane(SNARE, VEL.ghost, [2, 5, 8, 11], { ghost: true })),
    ],
  },
  bass: {
    walking: true,
    rhythms: {
      1: [
        [0, 6],
        [0, 9],
      ],
      2: [
        [0, 3, 6, 9],
        [0, 6, 9],
      ],
      3: [
        [0, 3, 6, 9],
        [0, 2, 6, 8],
      ],
      4: [
        [0, 2, 3, 6, 8, 9],
        [0, 3, 5, 6, 9, 11],
      ],
      5: [
        [0, 2, 3, 5, 6, 8, 9, 11],
        [0, 2, 4, 6, 8, 10],
      ],
    },
  },
};
