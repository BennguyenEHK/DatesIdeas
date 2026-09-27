import { LAYOUT_MAX, type Placement } from "./types";
import type { BoardState, PlaceOp, Stamp } from "./contract";

/** Later shared-clock writes win; identities make simultaneous writes deterministic. */
export function newer(a: Stamp, b: Stamp): boolean {
  return a.at > b.at || (a.at === b.at && a.by > b.by);
}

export function boardFrom(layout: Placement[], stamp: Stamp): BoardState {
  const placed: BoardState["placed"] = {};
  for (const place of layout) placed[place.pieceId] = { place, stamp };
  return { placed, removed: {} };
}

/**
 * Keep tombstones as well as placements: otherwise an old move arriving after a
 * removal would put a piece back on one screen only.
 */
export function applyPlace(board: BoardState, op: PlaceOp): BoardState {
  const current = board.placed[op.pieceId];
  const removed = board.removed[op.pieceId];
  const latest =
    current !== undefined && (removed === undefined || newer(current.stamp, removed))
      ? current.stamp
      : removed;
  if (latest !== undefined && !newer(op.stamp, latest)) return board;

  if (
    op.place !== null &&
    current === undefined &&
    Object.keys(board.placed).length >= LAYOUT_MAX
  ) {
    return board;
  }

  const placed = { ...board.placed };
  const removals = { ...board.removed };
  if (op.place === null) {
    delete placed[op.pieceId];
    removals[op.pieceId] = op.stamp;
  } else {
    placed[op.pieceId] = { place: { pieceId: op.pieceId, ...op.place }, stamp: op.stamp };
    delete removals[op.pieceId];
  }
  return { placed, removed: removals };
}

export function boardLayout(board: BoardState): Placement[] {
  return Object.values(board.placed)
    .map(({ place }) => place)
    .sort((a, b) => a.z - b.z || a.pieceId.localeCompare(b.pieceId));
}

export function nextZ(board: BoardState): number {
  return Object.values(board.placed).reduce((max, { place }) => Math.max(max, place.z), -1) + 1;
}
