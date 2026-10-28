// Ballad: slow and soft. Sidestick or light snare on 3, a ride on the beat, and kicks that move only with more energy.

import { CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { EIGHTHS, QUARTERS, VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

export const BALLAD: Style = {
  id: "ballad",
  name: "Ballad",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  grooves: {
    1: [
      groove("Sidestick and ride quarters", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(RIDE, VEL.hat, QUARTERS)),
      groove("Sparse ride", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(RIDE, VEL.hat, [0, 8])),
    ],
    2: [
      groove("Soft backbeat", 16, lane(KICK, VEL.normal, [0, 10]), lane(SNARE, VEL.normal, [8]), lane(RIDE, VEL.hat, QUARTERS)),
      groove("Kick on the and of two", 16, lane(KICK, VEL.normal, [0]), lane(SNARE, VEL.normal, [8]), lane(RIDE, VEL.hat, [0, 8])),
    ],
    3: [
      groove("Ride quarters", 16, lane(KICK, VEL.normal, [0, 10]), lane(SNARE, VEL.normal, [8]), lane(RIDE, VEL.hat, QUARTERS)),
      groove(
        "Ghost on the end",
        16,
        lane(KICK, VEL.normal, [0, 6]),
        lane(SNARE, VEL.normal, [8]),
        lane(SNARE, VEL.ghost, [15], { ghost: true }),
        lane(RIDE, VEL.hat, QUARTERS),
      ),
    ],
    4: [
      groove("Ride eighths", 16, lane(KICK, VEL.normal, [0, 7]), lane(SNARE, VEL.normal, [8]), lane(RIDE, VEL.hat, EIGHTHS)),
      groove(
        "Kick on three",
        16,
        lane(KICK, VEL.normal, [0, 4, 8]),
        lane(SNARE, VEL.normal, [8]),
        lane(SNARE, VEL.ghost, [14], { ghost: true }),
        lane(RIDE, VEL.hat, EIGHTHS),
      ),
    ],
    5: [
      groove("Driving ballad", 16, lane(KICK, VEL.normal, [0, 6, 8, 14]), lane(SNARE, VEL.normal, [8, 12]), lane(RIDE, VEL.hat, EIGHTHS)),
      groove(
        "Open hat ballad",
        16,
        lane(KICK, VEL.normal, [0, 8, 10]),
        lane(SNARE, VEL.normal, [4, 8, 12]),
        lane(OPEN_HAT, VEL.hat, [6, 14]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(CRASH, VEL.crash, [0]),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(MID_TOM, VEL.normal, [13]), lane(LOW_TOM, VEL.normal, [15])),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [9]),
        lane(MID_TOM, VEL.normal, [11]),
        lane(LOW_TOM, VEL.normal, [13]),
        lane(SNARE, VEL.normal, [14]),
        lane(KICK, VEL.normal, [15]),
      ),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.normal, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 4]),
        lane(MID_TOM, VEL.normal, [8]),
        lane(LOW_TOM, VEL.normal, [12]),
        lane(SNARE, VEL.normal, [15]),
      ),
      bar(16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 6, 8, 10, 12, 14]), lane(SNARE, VEL.ghost, [5, 7, 9, 11, 13, 15], { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    rhythms: {
      1: [[0], [0, 8]],
      2: [[0], [0, 8]],
      3: [
        [0, 8],
        [0, 4, 8, 12],
      ],
      4: [
        [0, 4, 8, 12],
        [0, 6, 8],
      ],
      5: [
        [0, 4, 8, 12],
        [0, 2, 4, 6, 8, 10, 12, 14],
      ],
    },
  },
};
