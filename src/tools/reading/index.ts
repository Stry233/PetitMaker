/**
 * Map readings: what a built map holds, read off a `GridState` (or a pavement mask) without changing
 * it. Generation stages, the designer's evaluation and the assistant's quality report and sketch
 * proposals all read a map through here, so they agree about what land, pavement, a region, a water
 * body or a street end is.
 * Nothing here imports a generator or the evaluation.
 *
 *   masks.ts         the map as parallel masks, the input every other reading takes
 *   regions.ts       open ground cut into runs by pavement, water and terrace step
 *   water-bodies.ts  the water decomposed into bodies
 *   street-ends.ts   where a street stops, on a pavement mask or a finished map
 *   surface.ts       where a 1x1 flat object may stand, and so where a road tile may be laid
 */
export { landAt, readMap, type MapMasks } from './masks';
export { segmentRegions, type Region } from './regions';
export { waterBodies, type WaterBody } from './water-bodies';
export { eachTerminus, streetTermini } from './street-ends';
export { pavableMask, plantableSurface } from './surface';
