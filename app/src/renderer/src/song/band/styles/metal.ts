// Metal: double kick. Pairs of kicks on the eighths and sixteenths, a snare on 2 and 4 and tom fills that use the whole kit.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { EIGHTHS, ODD_SIXTEENTHS, QUARTERS, SIXTEENTHS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

export const METAL: Style = {
  id: "metal",
  name: "Metal",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Kick quarters and cross-stick", 16, lane(KICK, VEL.normal, [0, 8]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse double kick", 16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove("Kick pairs", 16, lane(KICK, VEL.normal, [0, 2, 8, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove(
        "Kick pairs with more pairs",
        16,
        lane(KICK, VEL.normal, [0, 2, 4, 8, 10, 12]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    3: [
      groove("Eighth double kick", 16, lane(KICK, VEL.normal, [...EIGHTHS]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove(
        "Eighth kick with a hit on the and",
        16,
        lane(KICK, VEL.normal, [0, 2, 3, 4, 6, 8, 10, 11, 12, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
      ),
    ],
    4: [
      groove("Sixteenth double kick", 16, lane(KICK, VEL.normal, [0, 1, 4, 5, 8, 9, 12, 13]), lane(SNARE, VEL.normal, [4, 12]), lane(RIDE, VEL.hat, EIGHTHS)),
      groove(
        "Eighth kick and open hat",
        16,
        lane(KICK, VEL.normal, [...EIGHTHS]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [14]),
      ),
    ],
    5: [
      groove(
        "Full double kick",
        16,
        lane(KICK, VEL.normal, [...EIGHTHS]),
        lane(KICK, VEL.normal, ODD_SIXTEENTHS, { optional: true }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(OPEN_HAT, VEL.hat, [6, 14]),
      ),
      groove(
        "Crash and busy double kick",
        16,
        lane(CRASH, VEL.crash, [0]),
        lane(KICK, VEL.normal, [0, 2, 3, 4, 6, 8, 10, 11, 12, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(KICK, VEL.normal, [8, 10, 12, 14]), lane(SNARE, VEL.normal, [9, 11, 13]), lane(LOW_TOM, VEL.normal, [15])),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [8, 9]),
        lane(MID_TOM, VEL.normal, [10, 11]),
        lane(LOW_TOM, VEL.normal, [12, 13]),
        lane(SNARE, VEL.normal, [14]),
        lane(KICK, VEL.normal, [15]),
      ),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.normal, [...EIGHTHS]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(HIGH_TOM, VEL.normal, [10]),
        lane(MID_TOM, VEL.normal, [13]),
        lane(LOW_TOM, VEL.normal, [14, 15]),
      ),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
        lane(KICK, VEL.accent, [0, 8]),
      ),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [
        [0, 8],
        [0, 4, 8, 12],
      ],
      2: [
        [0, 2, 8, 10],
        [0, 4, 8, 12],
      ],
      3: [[...EIGHTHS], [0, 2, 8, 10]],
      4: [[...EIGHTHS], [0, 1, 4, 5, 8, 9, 12, 13]],
      5: [[...EIGHTHS], [...SIXTEENTHS]],
    },
  },
};
