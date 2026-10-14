/**
 * Registry of every persisted key. Each preference defines its parser and fallback. New keys use
 * the `petit-planet-` prefix; existing non-prefixed keys remain stable for saved preferences.
 */
import { LOCALES, type Locale } from '../../core/model/locale';

export const HINT_LEVELS = ['full', 'concise', 'off'] as const;
export type HintLevel = typeof HINT_LEVELS[number];
/** The 3D scene's quality choice: 'auto' follows the GL probe (device-quality), the others pin it. */
export const QUALITIES_3D = ['auto', 'full', 'lite'] as const;
export type Quality3d = typeof QUALITIES_3D[number];
export const VIEW_MODES = ['2d', '3d'] as const;
export type ViewMode = typeof VIEW_MODES[number];
/** Animation preference: 'system' follows the OS prefers-reduced-motion, the others override it. */
export const MOTION_PREFS = ['system', 'reduced', 'full'] as const;
export type MotionPref = typeof MOTION_PREFS[number];
/** Which end of the window the assistant's panel docks at. */
export const DOCK_SIDES = ['left', 'right'] as const;
export type DockSide = typeof DOCK_SIDES[number];

/** Browser language by prefix (`fr-CA` to `fr`, `zh-Hant` to `zh`), else English. */
function browserLocale(): Locale {
  if (typeof navigator === 'undefined' || !navigator.language) return 'en';
  const tag = navigator.language.toLowerCase();
  return LOCALES.find((locale) => tag.startsWith(locale)) ?? 'en';
}

interface PrefDef<T> {
  key: string;
  /** Return null to fall back. */
  parse: (raw: string) => T | null;
  /** Evaluated lazily: the locale fallback reads `navigator`. */
  fallback: () => T;
  write?: (value: T) => string;
}

const pref = <T,>(def: PrefDef<T>): PrefDef<T> => def;

/** A structured record stored as JSON text; it is read through `jsonPref` and written through
 *  `writeJsonPref`, never parsed by hand. */
const jsonRecord = (key: string): PrefDef<string> & { readonly json: true } => ({ key, parse: raw, fallback: none, json: true });

const oneOf = <T extends string>(members: readonly T[]) => (raw: string): T | null =>
  (members as readonly string[]).includes(raw) ? (raw as T) : null;

const inRange = (lo: number, hi: number) => (raw: string): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

const asBool = (raw: string): boolean | null => (raw === '1' ? true : raw === '0' ? false : null);
const fromBool = (v: boolean): string => (v ? '1' : '0');

/** For blobs another module parses: store and return the string untouched. */
const raw = (r: string): string => r;
const none = (): string => '';

/** The UI scale preference's range. */
export const UI_ZOOM_MIN = 0.6;
export const UI_ZOOM_MAX = 1.8;
export const UI_ZOOM_DEFAULT = 1;

/** A UI scale clamped to its range and rounded to two decimals, as the preference stores it. */
export function clampUiZoom(z: number): number {
  return Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, +z.toFixed(2)));
}

export const PREFS = {
  locale:         pref<Locale>({    key: 'petit-planet-locale',          parse: oneOf(LOCALES), fallback: browserLocale }),
  uiZoom:         pref<number>({    key: 'petit-planet-ui-zoom',         parse: inRange(UI_ZOOM_MIN, UI_ZOOM_MAX), fallback: () => UI_ZOOM_DEFAULT }),
  viewMode:       pref<ViewMode>({  key: 'petit-planet-view-mode',       parse: oneOf(VIEW_MODES), fallback: () => '2d' }),
  hintLevel:      pref<HintLevel>({ key: 'petit-planet-hint-level',      parse: oneOf(HINT_LEVELS), fallback: () => 'full' }),
  quality3d:      pref<Quality3d>({ key: 'petit-planet-3d-quality',      parse: oneOf(QUALITIES_3D), fallback: () => 'auto' }),
  // Build tag of the last completed asset preload.
  splashDone:     pref<string>({    key: 'petit-planet-splash-done',     parse: raw, fallback: none }),
  // Wayland Chromium can mis-size custom cursor bitmaps under fractional display scaling.
  systemCursors:  pref<boolean>({   key: 'petit-planet-system-cursors',  parse: asBool, fallback: () => false, write: fromBool }),
  motionPref:     pref<MotionPref>({ key: 'petit-planet-motion',         parse: oneOf(MOTION_PREFS), fallback: () => 'system' }),
  // Dock state persists; transient open/closed state does not.
  assistantPinned: pref<boolean>({  key: 'petit-planet-assistant-pinned', parse: asBool, fallback: () => false, write: fromBool }),
  assistantDockSide: pref<DockSide>({ key: 'petit-planet-assistant-dock-side', parse: oneOf(DOCK_SIDES), fallback: () => 'left' }),
  enforceChunkLoad: pref<boolean>({ key: 'petit-planet-enforce-chunk-load', parse: asBool, fallback: () => true, write: fromBool }),
  showGrid:       pref<boolean>({   key: 'petit-planet-show-grid',       parse: asBool, fallback: () => true, write: fromBool }),
  showChunkBounds: pref<boolean>({  key: 'petit-planet-chunk-bounds',    parse: asBool, fallback: () => true, write: fromBool }),
  keybinds:       pref<string>({    key: 'petit-planet-keybinds',        parse: raw, fallback: none }),

  // Existing hint keys remain stable so dismissed hints stay dismissed.
  navGestureHint:  pref<boolean>({ key: 'petit.navGestureHintSeen',       parse: asBool, fallback: () => false, write: fromBool }),
  inAppBrowserSeen:pref<boolean>({ key: 'petit.inAppBrowserNoticeSeen',   parse: asBool, fallback: () => false, write: fromBool }),
  // The app version this browser last opened; empty until a first visit records one.
  lastSeenVersion: pref<string>({  key: 'petit-planet-last-seen-version', parse: raw, fallback: none }),

  // Blobs their owning modules parse. `tourSeen` is read through
  // `readStoredPref` because an unset flag means unseen, while unavailable storage suppresses the tour.
  tourSeen:      pref<string>({ key: 'petit-planet-tour-seen',  parse: raw, fallback: none }),
  autosave:      pref<string>({ key: 'petit-planet-autosave',    parse: raw, fallback: none }),
  // Undo history is separate so quota pressure cannot discard the autosaved map.
  autosaveHistory: pref<string>({ key: 'petit-planet-autosave-history', parse: raw, fallback: none }),
  agentSettings: pref<string>({ key: 'petit-agent-settings-v1',  parse: raw, fallback: none }),
  // A null Agent log means no persisted session.
  agentLogV3:    pref<string | null>({ key: 'petit-agent-log-v3', parse: raw, fallback: () => null }),
  // Filed and cleared Agent records are keyed to the current session log.
  agentMarksV3:  pref<string | null>({ key: 'petit-agent-marks-v3', parse: raw, fallback: () => null }),

  // Structured records, read through `jsonPref` with their owner's validator.
  // Illustration settings and an optional vault-sealed key.
  stylize:       jsonRecord('petit-planet-stylize-v1'),
  // Content digests of this browser's own image exports, never included in shared files.
  ownImageExports: jsonRecord('petit-planet-own-image-exports'),
  // Export preset, parts, footer template, and size; title and description are not persisted.
  exportOptions: jsonRecord('petit-planet-export-options'),
  // Custom planets the player saved or opened, in the owner's record envelope.
  customPlanets: jsonRecord('petit-planet-custom-planets'),
} as const;

/** The IndexedDB databases this app opens, declared beside the localStorage keys. */
export const BROWSER_DATABASES = {
  agentVault: 'petit-agent-vault',
} as const;

export type PrefId = keyof typeof PREFS;
/** The preferences that hold a JSON record. */
export type JsonPrefId = { [K in PrefId]: (typeof PREFS)[K] extends { readonly json: true } ? K : never }[PrefId];
export type ValueOf<K extends PrefId> = (typeof PREFS)[K] extends PrefDef<infer T> ? T : never;

/** Every name this app persists under, localStorage keys and database names, for enumeration
 *  and for the declaration test. */
export const PREF_STORAGE_KEYS: readonly string[] = [
  ...Object.values(PREFS).map((d) => d.key),
  ...Object.values(BROWSER_DATABASES),
];

export function readPref<K extends PrefId>(id: K): ValueOf<K> {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  let stored: string | null = null;
  try { stored = localStorage.getItem(def.key); } catch { /* storage disabled */ }
  if (stored === null) return def.fallback();
  return def.parse(stored) ?? def.fallback();
}

/** A stored value before parsing. `available: false` means storage cannot be read at all, which
 *  some callers treat differently from a key that was never written (`raw: null`). */
type StoredPref = { readonly available: false } | { readonly available: true; readonly raw: string | null };

export function readStoredPref(id: PrefId): StoredPref {
  try { return { available: true, raw: localStorage.getItem(PREFS[id].key) }; } catch { return { available: false }; }
}

/** Whether localStorage can be read in this browser session. */
export function prefStorageAvailable(): boolean {
  try { void localStorage.length; return true; } catch { return false; }
}

/** Whether the key is gone afterwards; false when storage refused the removal. */
export function removePref(id: PrefId): boolean {
  try { localStorage.removeItem(PREFS[id].key); return true; } catch { return false; }
}

/** Whether localStorage accepted the write. */
export function writePref<K extends PrefId>(id: K, value: ValueOf<K>): boolean {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  try { localStorage.setItem(def.key, def.write ? def.write(value) : String(value)); return true; } catch { /* storage disabled, or quota exceeded */ }
  return false;
}

/**
 * A JSON record preference as `validate` accepts it. `decode` unwraps an envelope its owner wrote
 * (`writeJsonPref`'s `encode`) and may throw, which reaches the caller. An unset key, unreadable
 * storage or text that is not JSON reads as null, as does a value `validate` refuses.
 */
export function jsonPref<T>(id: JsonPrefId, validate: (data: unknown) => T | null, decode: (stored: string) => string = (s) => s): T | null {
  const stored = readStoredPref(id);
  if (!stored.available || !stored.raw) return null;
  let data: unknown;
  try { data = JSON.parse(decode(stored.raw)); } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  return validate(data);
}

/** Store `value` as a JSON record, wrapped by `encode`; whether localStorage accepted it. */
export function writeJsonPref(id: JsonPrefId, value: unknown, encode: (json: string) => string = (s) => s): boolean {
  return writePref(id, encode(JSON.stringify(value)));
}

/** `data` when it is a JSON object (not an array), else null; the first check of most validators. */
export function jsonObject(data: unknown): Record<string, unknown> | null {
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
}
