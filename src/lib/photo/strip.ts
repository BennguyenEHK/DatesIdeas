export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Panel extends Rect {
  /** Where each person is drawn inside this photograph. */
  left: Rect;
  right: Rect;
}

export interface StripLayout {
  width: number;
  height: number;
  panels: Panel[];
  /** The band under the photographs, for a date and the room's name. */
  caption: Rect;
}

export const SHOT_COUNTS = [2, 4] as const;
export type ShotCount = (typeof SHOT_COUNTS)[number];

export const STRIP_WIDTH = 1080;
export const PANEL_ASPECT = 16 / 9;

const MARGIN_FRACTION = 0.04;
const PANEL_GAP_FRACTION = 0.03;
const PERSON_GUTTER_FRACTION = 0;
const CAPTION_HEIGHT_FRACTION = 0.09;

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive, finite number`);
  }
}

function requireShotCount(shots: number): asserts shots is ShotCount {
  if (shots !== 2 && shots !== 4) {
    throw new TypeError("shots must be 2 or 4");
  }
}

/**
 * Scaling every spacing measurement from the requested width preserves the
 * composition when the renderer needs a different export resolution.
 */
export function stripLayout(
  shots: ShotCount,
  width = STRIP_WIDTH,
): StripLayout {
  requireShotCount(shots);
  requirePositiveFinite(width, "width");

  const margin = width * MARGIN_FRACTION;
  const panelGap = width * PANEL_GAP_FRACTION;
  const personGutter = width * PERSON_GUTTER_FRACTION;
  const captionHeight = width * CAPTION_HEIGHT_FRACTION;
  const contentWidth = width - margin * 2;
  const panelHeight = contentWidth / PANEL_ASPECT;
  const personWidth = (contentWidth - personGutter) / 2;
  const panelsHeight = panelHeight * shots;
  const gapsHeight = panelGap * (shots - 1);
  const captionY = margin + panelsHeight + gapsHeight;
  const height = captionY + captionHeight + margin;

  const panels = Array.from({ length: shots }, (_, index): Panel => {
    const y = margin + index * (panelHeight + panelGap);
    const left = { x: margin, y, width: personWidth, height: panelHeight };
    const right = {
      x: left.x + left.width + personGutter,
      y,
      width: personWidth,
      height: panelHeight,
    };

    return { x: margin, y, width: contentWidth, height: panelHeight, left, right };
  });

  return {
    width,
    height,
    panels,
    caption: { x: margin, y: captionY, width: contentWidth, height: captionHeight },
  };
}
