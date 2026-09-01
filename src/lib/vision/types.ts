export interface Point {
  x: number;
  y: number;
}

export interface FingerStates {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/**
 * The compact per-hand summary the worker emits. Deliberately NOT the full
 * 21-landmark array — serializing those 30x/second costs more than the
 * inference itself.
 */
export interface HandSummary {
  handedness: "Left" | "Right";
  extended: FingerStates;
  thumbTip: Point;
  indexTip: Point;
  wrist: Point;
  /** Wrist to middle-finger MCP distance, used to normalize other distances. */
  scale: number;
}

export interface VisionFrame {
  /** Milliseconds, monotonic. Supplied by the caller; never read from a clock. */
  timestamp: number;
  /** Max of the mouthSmileLeft / mouthSmileRight ARKit blendshapes, 0..1. */
  smileScore: number;
  /** ARKit mouthPucker, 0..1. Pursed lips — a kiss. */
  puckerScore: number;
  /**
   * ARKit eyeBlinkLeft / eyeBlinkRight, 0..1, kept separate on purpose: a
   * wink is the DIFFERENCE between them, and a combined value cannot tell a
   * wink from an ordinary blink.
   */
  blinkLeft: number;
  blinkRight: number;
  /**
   * Centre of the mouth in normalized image coordinates, null when no face is
   * found. Needed to tell a hand raised over the mouth from a hand raised
   * anywhere else.
   */
  mouth: Point | null;
  hands: HandSummary[];
}
