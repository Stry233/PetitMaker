/** Smart Build builders, scratch execution and previews. Pointer tools register through runtime. */
export {
  MACRO_IDS, EMPTY_KEY, applyMacro, buildMacroRun, installMacroBuildRunner,
  type MacroBuild, type MacroId, type MacroOpts, type MacroOutcome,
} from './run';
export type { MacroContext } from './context';

// The two bodies the agent's director tools call.
export { plantPatch } from './patch';
export { layRoadNetwork } from './roads';

export { detachCommand, mapFingerprint } from './scratch';
export { installMacroPreviewRunner, previewMacro, type MacroPreview } from './preview';
