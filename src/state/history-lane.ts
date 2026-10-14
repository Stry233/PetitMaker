/**
 * A capped undo and redo history of snapshots, for the editor's own lanes beside the map's: the
 * painted region and the plan notes. The map's history is the command executor's and does not run
 * through here. Lanes are plain arrays the store holds, newest last; every step returns new arrays.
 */

/** How many snapshots a lane's undo side keeps; the oldest goes first. */
const LANE_LIMIT = 60;

export interface HistoryLane<T> {
  readonly undo: readonly T[];
  readonly redo: readonly T[];
}

/** `lane` with `current` recorded as the newest undo step, past the limit dropping the oldest, and
 *  the redo side cleared: a new edit ends the redo branch. */
export function laneRecord<T>(lane: HistoryLane<T>, current: T, limit = LANE_LIMIT): HistoryLane<T> {
  return { undo: [...lane.undo.slice(Math.max(0, lane.undo.length - (limit - 1))), current], redo: [] };
}

/** One step back (`'undo'`) or forward (`'redo'`): the snapshot to restore and the lane after the
 *  step, with `current` moved to the other side. Null when that side is empty. */
export function laneStep<T>(lane: HistoryLane<T>, current: T, dir: 'undo' | 'redo'): { lane: HistoryLane<T>; restored: T } | null {
  const from = dir === 'undo' ? lane.undo : lane.redo;
  const to = dir === 'undo' ? lane.redo : lane.undo;
  if (from.length === 0) return null;
  const restored = from[from.length - 1]!;
  const rest = from.slice(0, -1);
  const moved = [...to, current];
  return { lane: dir === 'undo' ? { undo: rest, redo: moved } : { undo: moved, redo: rest }, restored };
}
