// Gear drawings: role="img" art + accessible control layer.
export { Pedal, type PedalProps, type PedalLayout } from "./Pedal";
export { EqPedal, Capture, type CaptureProps } from "./EqPedal";
export { AmpHead, Cab, AmpPanel, type AmpProps } from "./Amp";
export { Dial, type DialProps } from "./Dial";
export { GearFor, artFor, isCaptureFxid, isUserIrFxid, knobsForBlock, modelTitle, moreControls, type GearArt, type GearForProps } from "./GearFor";
export { KnobHit } from "./controls";
export { knobFromParam, paramTitle, type GearKnob, type GearBaseProps } from "./types";
export { BLOCK_HEX, voiceFor, voicingOf, type Finish } from "./art";
export * from "./knob-math";
