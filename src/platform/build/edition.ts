/**
 * The edition profile: what this build can do and the copy it speaks with.
 *
 * Interface code asks a capability or reads a copy variant here, and a record that only some
 * editions offer carries `lite` (see `EditionVariant`), so no surface tests the edition by id.
 * `IS_LITE` itself is read by the version identity, the brand name and the renderer's quality tuning.
 */

/** The offline Xiaohongshu edition is selected at build time. Defined here, beside the constants
 *  derived from it, so the build folds them and drops what the edition cannot use. */
export const IS_LITE = typeof __PETIT_LITE__ !== 'undefined' && __PETIT_LITE__;

// Named constants keep unavailable imports removable from the offline bundle.
export const SUPPORTS_ASSISTANT = !IS_LITE;
export const SUPPORTS_JSON_FILES = !IS_LITE;
export const SUPPORTS_CLIPBOARD = !IS_LITE;
export const SUPPORTS_EXTERNAL_LINKS = !IS_LITE;
export const SUPPORTS_WORKERS = !IS_LITE;
export const SUPPORTS_FULLSCREEN = !IS_LITE;
export const SUPPORTS_DOWNLOADS = !IS_LITE;
/** Reading a planet from a recorded game video: a worker and a full-size video decode. */
export const SUPPORTS_VIDEO_IMPORT = SUPPORTS_WORKERS;
/** The licence texts travel inside the bundle where the edition cannot link out to them. */
export const BUNDLES_LICENSE_TEXTS = !SUPPORTS_EXTERNAL_LINKS;
/** A phone held in portrait is asked to rotate; the offline edition turns its own body instead. */
export const BLOCKS_PORTRAIT = !IS_LITE;
/** CSS `min()` in inline sizes; the offline container's WebView may predate it. */
export const SUPPORTS_CSS_MIN = !IS_LITE;
/** The export window's segmented options wrap their labels, which run longer in the offline copy. */
export const WRAPS_EXPORT_OPTION_LABELS = IS_LITE;

/** The copy that differs between editions, as i18n keys. Null where the edition shows none. */
export const EDITION_COPY = IS_LITE ? {
  badge: 'lite.badge',
  exportResponsibility: 'lite.responsibility',
  importPick: 'lite.import_pick',
  importNote: 'lite.import_hint',
  teamOrder: null,
} as const : {
  badge: null,
  exportResponsibility: 'export.notice.responsibility',
  importPick: null,
  importNote: 'import.note',
  teamOrder: 'about.team_order',
} as const;

/** A record's edition fields: `lite: false` leaves it out of the offline edition, and an object
 *  replaces those fields there. */
export interface EditionVariant<T> { lite?: false | Partial<T> }

/** Whether this edition offers `record`. */
export function inEdition(record: { lite?: unknown }): boolean {
  return !IS_LITE || record.lite !== false;
}

/** `records` as this edition offers them, in order: the ones it leaves out dropped, its replacements
 *  applied and the edition field removed. */
export function forEdition<T extends object>(records: readonly (T & EditionVariant<T>)[]): T[] {
  return records.filter(inEdition).map(({ lite, ...record }) => (
    IS_LITE && lite ? { ...record, ...lite } : record
  ) as T);
}
