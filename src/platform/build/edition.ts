/**
 * The edition profile: what this build can do and the copy it speaks with.
 *
 * Interface code asks a capability or reads a copy variant here, and a record that only some
 * editions offer carries `lite` or `needs` (see `EditionVariant`), so no surface tests the edition
 * or the Lite host by id. `IS_LITE` itself is read by the version identity, the brand name and the
 * renderer's quality tuning.
 */
import { activeLiteHost } from './lite-hosts';

/** The offline edition is selected at build time. Defined here, beside the constants derived from
 *  it, so the build folds them and drops what the edition cannot use. */
export const IS_LITE = typeof __PETIT_LITE__ !== 'undefined' && __PETIT_LITE__;
/** The container a Lite build is packaged for (`lite-hosts.ts`); null in the web edition. */
const LITE_HOST = IS_LITE ? activeLiteHost() : null;

// Named constants keep unavailable imports removable from the offline bundle.
export const SUPPORTS_ASSISTANT = !IS_LITE;
export const SUPPORTS_JSON_FILES = !IS_LITE;
export const SUPPORTS_CLIPBOARD = !IS_LITE;
export const SUPPORTS_EXTERNAL_LINKS = !IS_LITE;
export const SUPPORTS_WORKERS = !IS_LITE;
export const SUPPORTS_FULLSCREEN = !IS_LITE;
export const SUPPORTS_DOWNLOADS = !IS_LITE;
/** The welcome tips' reels: the offline package cannot hold them, and its container has no fetch. */
export const SUPPORTS_TOUR_REELS = !IS_LITE;
/** Reading a planet from a recorded game video: a worker and a full-size video decode. */
export const SUPPORTS_VIDEO_IMPORT = SUPPORTS_WORKERS;
/** The licence texts travel inside the bundle where the edition cannot link out to them. */
export const BUNDLES_LICENSE_TEXTS = !SUPPORTS_EXTERNAL_LINKS;
/** Reading a map from its exported picture, which the visitor picks from the device. */
export const SUPPORTS_PICTURE_IMPORT = LITE_HOST ? LITE_HOST.pictureImport : true;
/** Letter generation, which lays words the visitor may type. */
export const SUPPORTS_LETTER_GENERATION = LITE_HOST ? LITE_HOST.letterGeneration : true;
/** Whether a player types the author a blueprint names, rather than taking the name the platform gives. */
export const SUPPORTS_TYPED_AUTHOR = LITE_HOST ? LITE_HOST.typedAuthor : true;
/** Saving the share window's picture as a browser download. */
export const SUPPORTS_PICTURE_DOWNLOAD = LITE_HOST ? LITE_HOST.pictureDownload : SUPPORTS_DOWNLOADS;
/** Picture generation from the package's own character portraits. */
export const SUPPORTS_PICTURE_GENERATION = LITE_HOST ? LITE_HOST.pictureGeneration : true;
/** CSS `min()` in inline sizes; the offline container's WebView may predate it. */
export const SUPPORTS_CSS_MIN = !IS_LITE;
/** The export window's segmented options wrap their labels, which run longer in the offline copy. */
export const WRAPS_EXPORT_OPTION_LABELS = IS_LITE;

/** The Lite hint about keeping a map: only a host that reads a picture back may promise that the
 *  picture reopens the map. Records name it in their Lite variant, so both editions carry it. */
const LITE_SAVE_HINT = SUPPORTS_PICTURE_IMPORT ? 'lite.save_hint' : 'lite.save_hint_device';

/** The copy that differs between editions, as i18n keys. Null where the edition shows none. */
export const EDITION_COPY = IS_LITE ? {
  badge: 'lite.badge',
  exportResponsibility: 'lite.responsibility',
  importPick: 'lite.import_pick',
  importNote: 'lite.import_hint',
  saveHint: LITE_SAVE_HINT,
  teamOrder: null,
} as const : {
  badge: null,
  exportResponsibility: 'export.notice.responsibility',
  importPick: null,
  importNote: 'import.note',
  saveHint: LITE_SAVE_HINT,
  teamOrder: 'about.team_order',
} as const;

/** What a record may need from the build: it is offered only where the capability holds. */
const NEEDS = {
  pictureImport: SUPPORTS_PICTURE_IMPORT,
  letterGeneration: SUPPORTS_LETTER_GENERATION,
  pictureGeneration: SUPPORTS_PICTURE_GENERATION,
} as const;
export type EditionNeed = keyof typeof NEEDS;

/** A record's edition fields: `lite: false` leaves it out of the offline edition and an object
 *  replaces those fields there; `needs` leaves it out of every build that lacks that capability,
 *  which is how a record differs between Lite hosts without naming one. */
export interface EditionVariant<T> { lite?: false | Partial<T>; needs?: EditionNeed }

/** Whether this build offers `record`. */
export function inEdition(record: { lite?: unknown; needs?: EditionNeed }): boolean {
  return (!IS_LITE || record.lite !== false) && (!record.needs || NEEDS[record.needs]);
}

/** `records` as this build offers them, in order: the ones it leaves out dropped, its replacements
 *  applied and the edition fields removed. */
export function forEdition<T extends object>(records: readonly (T & EditionVariant<T>)[]): T[] {
  return records.filter(inEdition).map(({ lite, needs: _needs, ...record }) => (
    IS_LITE && lite ? { ...record, ...lite } : record
  ) as T);
}
