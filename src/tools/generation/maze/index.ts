/**
 * THE MAZE MODULE'S DOOR: a labyrinth carved into the buildable region.
 *
 * Behind it:
 *
 *   maze-generator.ts  the recursive-backtracker carve, its footprint on a template, and
 *                      `latticeField` — the seed-independent room skeleton every carve opens, which
 *                      is what lets a mark be snapped before a run exists
 *   maze-endpoints.ts  the two ends the visitor asks for: where a mark may stand, which of them the
 *                      mainland can join, and the walk between the pair
 *
 * WHAT CROSSES IT. The shelf alone: it snaps the two draggable marks and draws them, which is why
 * the field and the ring test are here and not private. `terrain-generator.ts` runs the carve, but
 * it is a peer inside `tools/` and imports `maze-generator.ts` directly (see the paint door for why),
 * so `generateMaze` does not cross this door and is not exported through it.
 */
export { latticeField, mazeFootprint } from './maze-generator';
export { onRing, resolveEnd, type MazeEnd, type MazeField } from './maze-endpoints';
