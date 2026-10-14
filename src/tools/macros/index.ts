/** Smart Build builders, scratch execution and previews. Pointer tools register through runtime. */
export {
  MACRO_IDS, SHELF_MACRO_IDS, macroForShelfCategory, applyMacro, buildMacroRun,
  MacroRunnerUnavailable,
  type MacroBuild, type MacroId, type MacroOpts,
} from './run';
export type { MacroContext, MacroOffThread } from './context';

// The bodies the agent's director, terraform and figure tools call.
export { plantPatch } from './planting/patch';
export { PATCH_SPAN } from './planting/habitat';
export { layRoadNetwork } from './roads/roads';
export { buildRiver, RIVER_WIDTH_MAX } from './terrain/river';
export { decorateRoom, frameCrossingNear, ROOM_THEMES, type FramedCrossing, type RoomTheme } from './rooms/room-themes';
export { sculptTerrace, sculptWall, sinkPoolCourt, wallRectAtEdge } from './terrain/sculpt';
export { FIGURE_SHAPES, figureCells, figureRing } from './terrain/figures';
// The live-map terrain stroke the Help figures paint with.
export { paint } from './terrain/terrain';

export { detachedContext } from './runtime/scratch';
export { previewMacro, type MacroPreview } from './runtime/preview';
