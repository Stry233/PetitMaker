/**
 * The maze module's door: a labyrinth carved into the buildable region.
 *
 * Behind it:
 *
 *   maze-generator.ts  the recursive-backtracker carve, its footprint on a template, and
 *                      `latticeField` — the seed-independent room skeleton every carve opens, which
 *                      is what lets a mark be snapped before a run exists
 *   maze-endpoints.ts  the two ends the visitor asks for: where a mark may stand, which of them the
 *                      mainland can join, and the walk between the pair
 *
 * what crosses it. The shelf alone: it snaps the two draggable marks and draws them, which is why
 * the field and the ring test are here and not private. The facade (`../generate.ts`) runs the carve,
 * but it is a peer inside `tools/` and imports `maze-generator.ts` directly (see the paint door for
 * why), so `generateMaze` does not cross this door: a caller runs a maze through the generation door.
 */
export { defaultMazeGates, latticeField, mazeFootprint, type MazeFootprint } from './maze-generator';
export { MAZE_MAX_ELEVATION } from '../recipe';
export { onRing, resolveEnd, type MazeEnd, type MazeField } from './maze-endpoints';
