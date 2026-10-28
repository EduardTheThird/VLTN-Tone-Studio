// Country: the train beat. Kick on the one, backbeat on 2 and 4, and steady eighths on the hat, with busier energies adding kicks
// and a ride.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { EIGHTHS, ODD_SIXTEENTHS, QUARTERS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

export const COUNTRY: Style = {
  id: "country",
  name: "Country",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Cross-stick and quarters", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse train", 16, lane(KICK, VEL.normal, [0, 8]), lane(SIDE_STICK, VEL.normal, [4, 12])),
    ],
    2: [
      groove("Train beat", 16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove("Kick on the and of three", 16, lane(KICK, VEL.normal, [0, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
    ],
    3: [
      groove("Kick push", 16, lane(KICK, VEL.normal, [0, 6, 8]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove(
        "Ghost on the and of three",
        16,
        lane(KICK, VEL.normal, [0, 8, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [10], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    4: [
      groove(
        "Country eighths",
        16,
        lane(KICK, VEL.normal, [0, 6, 8, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, [0, 2, 4, 6, 8, 10, 12]),
        lane(OPEN_HAT, VEL.hat, [14]),
      ),
      groove("Ride eighths", 16, lane(KICK, VEL.normal, [0, 8, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(RIDE, VEL.hat, EIGHTHS)),
    ],
    5: [
      groove(
        "Busy country",
        16,
        lane(KICK, VEL.normal, [0, 2, 6, 8, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(OPEN_HAT, VEL.hat, [10]),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { optional: true }),
      ),
      groove(
        "Ride and crash",
        16,
        lane(CRASH, VEL.crash, [0]),
        lane(KICK, VEL.normal, [0, 6, 8, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(OPEN_HAT, VEL.hat, [14]),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 13]), lane(MID_TOM, VEL.normal, [14]), lane(LOW_TOM, VEL.normal, [15])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8, 10]), lane(SNARE, VEL.normal, [12, 14]), lane(LOW_TOM, VEL.normal, [15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [2]),
        lane(MID_TOM, VEL.normal, [4]),
        lane(LOW_TOM, VEL.normal, [6]),
        lane(SNARE, VEL.normal, [8, 10, 12, 14]),
      ),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [0, 4]),
        lane(MID_TOM, VEL.normal, [8]),
        lane(LOW_TOM, VEL.normal, [12]),
        lane(SNARE, VEL.normal, [14, 15]),
        lane(KICK, VEL.accent, [0, 8]),
      ),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [[0], [0, 8]],
      2: [
        [0, 8],
        [0, 4, 8, 12],
      ],
      3: [
        [0, 8],
        [0, 6, 8, 12],
      ],
      4: [
        [0, 6, 8, 14],
        [0, 4, 8, 12],
      ],
      5: [
        [0, 2, 6, 8, 14],
        [0, 3, 6, 8, 10, 14],
      ],
    },
  },
};
