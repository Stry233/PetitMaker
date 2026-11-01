// Public entry point for the illustration UI; feature code does not import implementation modules directly.
export { STYLE_PACKS, CUSTOM_DIRECTION_ID, type DirectionId, type StylizeDirection } from './presets';
export { procPackMeta } from './proc/packs/manifest';
export { loadProcRenderer } from './loaders';
export { CUSTOM_PROMPT_MAX } from './prompt/contract';
export { runEngine, type EngineDeps } from './engine/run';
export { resolveRecipe, type Recipe } from './engine/recipe';
export { STYLIZE_PROVIDERS, type StylizeProvider } from './providers';
export {
  DIALECTS,
  StylizeError,
  toStylizeStatus,
  type StylizeStatus,
  type StylizeDialect,
  type DialectConfig,
} from './dialects';

export { retainNeuralRuntime } from './neural/lifecycle';
export { neuralPacksUsable, neuralPacksUsableNow } from './neural/capability';
