/**
 * THE PLACEMENT MODULE'S DOOR: how a thing gets onto ground that already exists, legally.
 *
 * Behind it:
 *
 *   object.ts         makeCtx/tryPlace/tryDecorate — the one path an object reaches a map by here —
 *                     plus buildingGate (a house's door and the strip in front of it) and the
 *                     clearance set that keeps a gate or a crossing end walkable
 *   analysis.ts       the map read ONCE: the placeable mask, the elevation-aware regions and the
 *                     distance-to-water field every later pass asks its questions of
 *   network.ts        buildNetwork — the whole-map road network, directed A* through the portals
 *   network-variation.ts  the seeded decisions a network's shape turns on, so one map can be paved
 *                     more than one way
 *   portals.ts        scanPortals — the bridge/ramp crossings between adjacent regions, found by
 *                     dry-run validation rather than guessed at
 *   route.ts          planRoute — ONE route between two points, straightened rather than stumbled into
 *   route-offers.ts   that same A* over three cost profiles, near-identical offers collapsed
 *   road-style.ts     what kind of roads the map ALREADY has, measured: bend density into an A* turn
 *                     cost, so a new lane matches the streets it grows out of
 *   nature.ts         placeNature — the layered ecology: stands with glades, biome bands by
 *                     elevation and moisture, waterside flora in drifts
 *   themes.ts         the six themed room decorators and the mirrored crossing scene
 *   tuning.ts         every knob the files above read, and `macros/road-paving.ts` with them
 *
 * WHY IT IS NOT FILED UNDER `generation/`: nothing here is a generator stage. It puts objects on
 * ground that already exists, whoever made the ground — the island generator reaches exactly one
 * file of it (`object.ts`), while the smart-build macros reach eight and the agent's director tools
 * four.
 *
 * WHAT CROSSES IT. The agent's director tools, which adapt a model's arguments to this machinery (a
 * rect becomes the cells of one themed room, a region becomes an analysis). Modules inside `tools/`
 * import these files directly rather than through here: they are peers of one implementation (see
 * the paint door for why a barrel between peers is worse than the direct import).
 */
export { analyzeTerrain } from './analysis';
export { makeCtx, tryPlace, forEachFootprintCell } from './object';
export { scanPortals } from './portals';
export { decorateZone, decorateCrossing, type Zone } from './themes';
