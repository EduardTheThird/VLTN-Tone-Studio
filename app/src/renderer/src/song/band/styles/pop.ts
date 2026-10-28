// Pop: a backbeat on 2 and 4 with kick patterns on the one and the and of two. Busier energies add 16th hats, open hats and crashes.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { EIGHTHS, QUARTERS, SIXTEENTHS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

export const POP: Style = {
  id: "pop",
  name: "Pop",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Sidestick quarters", 16, lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Kick and sidestick", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove("Pop beat", 16, lane(KICK, VEL.normal, [0, 10]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
      groove("Kick on the and of two", 16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, EIGHTHS)),
    ],
    3: [
      groove(
        "Sixteenth hats",
        16,
        lane(KICK, VEL.normal, [0, 8, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
      ),
      groove(
        "Ghost snare before the end",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [14], { ghost: true }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    4: [
      groove("Ride eighths", 16, lane(KICK, VEL.normal, [0, 6, 8, 14]), lane(SNARE, VEL.normal, [4, 12]), lane(RIDE, VEL.hat, EIGHTHS)),
      groove(
        "Open hat lift",
        16,
        lane(KICK, VEL.normal, [0, 8, 10]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, [0, 2, 4, 6, 8, 10, 12]),
        lane(OPEN_HAT, VEL.hat, [14]),
      ),
    ],
    5: [
      groove(
        "Busy pop",
        16,
        lane(KICK, VEL.normal, [0, 3, 8, 11]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, SIXTEENTHS, { optional: true }),
      ),
      groove(
        "Open hat and crash",
        16,
        lane(CRASH, VEL.crash, [0]),
        lane(KICK, VEL.normal, [0, 6, 8, 14]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(OPEN_HAT, VEL.hat, [2, 6, 10, 14]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
      ),
    ],
  },
  fills: {
    half: [
      bar(
        16,
        lane(SNARE, VEL.normal, [8, 10]),
        lane(HIGH_TOM, VEL.normal, [12]),
        lane(MID_TOM, VEL.normal, [13]),
        lane(LOW_TOM, VEL.normal, [14]),
        lane(SNARE, VEL.normal, [15]),
      ),
      bar(16, lane(KICK, VEL.normal, [8]), lane(SNARE, VEL.normal, [10, 14, 15]), lane(MID_TOM, VEL.normal, [12]), lane(LOW_TOM, VEL.normal, [13])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
      ),
      bar(
        16,
        lane(SNARE, VEL.normal, [8, 10, 12, 14]),
        lane(HIGH_TOM, VEL.normal, [9, 11]),
        lane(MID_TOM, VEL.normal, [13]),
        lane(LOW_TOM, VEL.normal, [15]),
        lane(KICK, VEL.accent, [0, 8]),
      ),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [[0], [0, 8]],
      2: [
        [0, 10],
        [0, 8],
      ],
      3: [
        [0, 6, 10],
        [0, 8, 10, 14],
      ],
      4: [
        [0, 6, 8, 14],
        [0, 3, 8, 11],
      ],
      5: [[...EIGHTHS], [0, 3, 6, 8, 11, 14]],
    },
  },
};
