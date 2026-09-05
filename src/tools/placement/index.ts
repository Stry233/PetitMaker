/**
 * Public placement surface for analyzing existing ground, validating object placement, locating
 * crossings, and decorating regions. Internal placement modules import one another directly.
 */
export { analyzeTerrain } from './analysis';
export { makeCtx, tryPlace, forEachFootprintCell } from './object';
export { scanPortals } from './portals';
export { decorateZone, decorateCrossing, type Zone } from './themes';
