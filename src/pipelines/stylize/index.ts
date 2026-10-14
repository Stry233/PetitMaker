// Public entry point for the illustration UI; feature code does not import implementation modules directly.
export { STYLE_PACKS, CUSTOM_DIRECTION_ID, type DirectionId, type StylePack, type StylizeDirection } from './presets';
export { PROC_PACK_META, isProcPackId, procPackMeta, type ProcPackMeta, type ProcPackId } from './proc/packs/manifest';
export { loadProcRenderer, loadNeuralSession } from './loaders';
export { CUSTOM_PROMPT_MAX, appendFragment, BASE_CONTRACT } from './prompt/contract';
export { runEngine, type EngineDeps } from './engine/run';
export { resolveRecipe, type Recipe } from './engine/recipe';
export { STYLIZE_PROVIDERS, type StylizeProvider } from './providers';
export {
  DIALECTS,
  StylizeError,
  toStylizeStatus,
  type DialectId,
  type StylizeStatus,
  type StylizeDialect,
  type DialectConfig,
  type StylizeImage,
} from './dialects';

export { retainNeuralRuntime } from './neural/lifecycle';
export { neuralPacksUsable, neuralPacksUsableNow } from './neural/capability';
