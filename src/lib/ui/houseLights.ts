/**
 * How far the house lights go down, and how long they take.
 *
 * The fade itself belongs to CSS rather than to JavaScript. `--dim` is a
 * registered custom property, so the browser interpolates it natively and, when
 * somebody pauses halfway down, reverses from the value actually on screen. A
 * script-driven state machine used to live here to do that job by hand; it was
 * removed once the transition became the browser's, because the two would
 * otherwise disagree about where the lights had got to.
 */

/** The room closes down promptly, so the film can begin without a long wait. */
export const DIM_DOWN_MS = 3000;

/** Coming back up takes longer, which makes the return feel unhurried. */
export const DIM_UP_MS = 5000;

/**
 * How dark the room gets, as a fraction towards black.
 *
 * Not all the way. A cinema is dark and is never pitch black, and the controls
 * still have to be findable -- somebody hunting for the pause button in total
 * darkness is a worse experience than a room that stayed a little lit.
 */
export const DIM_DEPTH = 0.72;
