// The illustration service's light constants, for callers that must not pull the service into the
// eager bundle: every module re-exported here imports only types.
export { CUSTOM_PROMPT_MAX, appendFragment } from './prompt/contract';
export { STYLIZE_PROVIDERS, type StylizeProvider } from './providers';
export { PROC_PACK_META, isProcPackId, type ProcPackMeta } from './proc/packs/manifest';
export { STYLE_PACKS, CUSTOM_DIRECTION_ID, type DirectionId, type StylePack, type StylizeDirection } from './presets';
export type { StylizeStatus } from './dialects/types';
