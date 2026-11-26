/** Smart Build builders, scratch execution and previews. Pointer tools register through runtime. */
export {
  MACRO_IDS, SHELF_MACRO_IDS, macroForShelfCategory, macroForSurface, macroLabel, applyMacro, buildMacroRun,
  MacroRunnerUnavailable,
  type MacroBuild, type MacroId, type MacroOpts,
} from './run';
export type { MacroContext, MacroOffThread } from './context';

// The bodies the agent's terraform tools call.
export { buildRiver, RIVER_WIDTH_MAX } from './terrain/river';
export { layDrawnGround, type GroundAsk } from './terrain/drawn-ground';
export { sculptTerrace, sculptWall, sinkPoolCourt, wallRectAtEdge, ISLET_PITCH } from './terrain/sculpt';
// The live-map terrain stroke the Help figures paint with.
export { paint } from './terrain/terrain';
// The point-to-point route the agent's route tool lays.
export { layRoadLink } from './roads/road-link';

export { detachedContext } from './runtime/scratch';
export { previewMacro, type MacroPreview } from './runtime/preview';
