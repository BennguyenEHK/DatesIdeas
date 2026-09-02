/**
 * Keeping the grid proportions in one place lets height-based sizing follow
 * the layout when either stage changes, instead of leaving CSS and geometry
 * to drift apart.
 */
export const TILE_ASPECT = 16 / 9;
export const SCREEN_FR = 3;
export const FACES_FR = 1;

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive, finite number`);
  }
}

/**
 * Multiplying by the tile count preserves each tile's native shape as the row
 * grows, which lets height-based CSS sizing account for every tile.
 */
export function sideBySideAspect(tiles = 2): number {
  requirePositiveFinite(tiles, "tiles");
  return TILE_ASPECT * tiles;
}

/**
 * Since the screen fixes the stage height, its width ratio must be expanded by
 * the full grid width; this keeps the face column beside it without changing
 * the screen's 16:9 height relationship.
 */
export function takeoverAspect(
  screenFr = SCREEN_FR,
  facesFr = FACES_FR,
): number {
  requirePositiveFinite(screenFr, "screenFr");
  requirePositiveFinite(facesFr, "facesFr");
  return (TILE_ASPECT * (screenFr + facesFr)) / screenFr;
}
