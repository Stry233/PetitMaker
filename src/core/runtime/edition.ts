/** The offline Xiaohongshu edition is selected at build time. */
export const IS_LITE = typeof __PETIT_LITE__ !== 'undefined' && __PETIT_LITE__;

// Named constants keep unavailable imports removable from the offline bundle.
export const SUPPORTS_ASSISTANT = !IS_LITE;
export const SUPPORTS_JSON_FILES = !IS_LITE;
export const SUPPORTS_CLIPBOARD = !IS_LITE;
export const SUPPORTS_EXTERNAL_LINKS = !IS_LITE;
export const SUPPORTS_WORKERS = !IS_LITE;
export const SUPPORTS_FULLSCREEN = !IS_LITE;
export const SUPPORTS_DOWNLOADS = !IS_LITE;

export function editionSupportsCommand(id: string): boolean {
  if (id === 'app.export_json') return SUPPORTS_JSON_FILES;
  if (id === 'app.assistant') return SUPPORTS_ASSISTANT;
  return true;
}
