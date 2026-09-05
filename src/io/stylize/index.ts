// Public entry point for the illustration UI; feature code does not import implementation modules directly.
export { STYLE_PACKS, CUSTOM_DIRECTION_ID, type DirectionId, type StylePack } from './presets';
export { PROC_PACK_META, isProcPackId, procPackMeta, type ProcPackMeta, type ProcPackId } from './proc/packs/manifest';
/** Load the local draw engine on first use. */
export const loadProcRenderer = () => import('./proc/render');
export { CUSTOM_PROMPT_MAX, appendFragment, BASE_CONTRACT } from './prompt';
export { versionStore, type StylizeVersion, type VersionState, type VersionKind, type StylizeDirection } from './versions';
export { runEngine, type EngineDeps } from './engine/run';
export { resolveRecipe, LAYOUT_CONDITION_ENABLED, type Recipe } from './engine/recipe';
export { STYLIZE_PROVIDERS, type StylizeProvider } from './providers';
export {
  loadStylizeSettings,
  saveStylizeSettings,
  loadStylizeKey,
  saveStylizeKey,
  clearStylizeKey,
  type StylizeSettings,
} from './settings';
export {
  DIALECTS,
  StylizeError,
  type DialectId,
  type StylizeStatus,
  type StylizeDialect,
  type DialectConfig,
  type StylizeImage,
} from './dialects';
