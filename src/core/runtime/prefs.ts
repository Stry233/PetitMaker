/**
 * Registry of every persisted key. Each preference defines its parser and fallback. New keys use
 * the `petit-planet-` prefix; existing non-prefixed keys remain stable for saved preferences.
 */
import type { Locale } from '../model/types';

export type HintLevel = 'full' | 'concise' | 'off';
/** The 3D scene's quality choice: 'auto' follows the GL probe (device-quality), the others pin it. */
export type Quality3d = 'auto' | 'full' | 'lite';
export type ViewMode = '2d' | '3d';
/** Animation preference: 'system' follows the OS prefers-reduced-motion, the others override it. */
export type MotionPref = 'system' | 'reduced' | 'full';
/** Which end of the window the assistant's panel docks at. */
export type DockSide = 'left' | 'right';

/** UI locales in browser-prefix matching order, with type-level coverage of `Locale`. */
const SUPPORTED_LOCALES = ['zh', 'ja', 'ru', 'th', 'id', 'fr', 'en'] as const satisfies readonly Locale[];
type _AssertNoMissingLocale = Exclude<Locale, (typeof SUPPORTED_LOCALES)[number]> extends never ? true : ['SUPPORTED_LOCALES is missing a Locale member'];
const _localeCoverage: _AssertNoMissingLocale = true;
void _localeCoverage;

/** Browser language by prefix (`fr-CA` to `fr`, `zh-Hant` to `zh`), else English. */
function browserLocale(): Locale {
  if (typeof navigator === 'undefined' || !navigator.language) return 'en';
  const lang = navigator.language.toLowerCase();
  return SUPPORTED_LOCALES.find((loc) => lang.startsWith(loc)) ?? 'en';
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

export const PREFS = {
  locale:         pref<Locale>({    key: 'petit-planet-locale',          parse: oneOf(SUPPORTED_LOCALES), fallback: browserLocale }),
  uiZoom:         pref<number>({    key: 'petit-planet-ui-zoom',         parse: inRange(0.6, 1.8),        fallback: () => 1 }),
  viewMode:       pref<ViewMode>({  key: 'petit-planet-view-mode',       parse: oneOf(['2d', '3d'] as const), fallback: () => '2d' }),
  hintLevel:      pref<HintLevel>({ key: 'petit-planet-hint-level',      parse: oneOf(['full', 'concise', 'off'] as const), fallback: () => 'full' }),
  quality3d:      pref<Quality3d>({ key: 'petit-planet-3d-quality',      parse: oneOf(['auto', 'full', 'lite'] as const), fallback: () => 'auto' }),
  // Build tag of the last completed asset preload.
  splashDone:     pref<string>({    key: 'petit-planet-splash-done',     parse: raw, fallback: none }),
  // Wayland Chromium can mis-size custom cursor bitmaps under fractional display scaling.
  systemCursors:  pref<boolean>({   key: 'petit-planet-system-cursors',  parse: asBool, fallback: () => false, write: fromBool }),
  motionPref:     pref<MotionPref>({ key: 'petit-planet-motion',         parse: oneOf(['system', 'reduced', 'full'] as const), fallback: () => 'system' }),
  // Dock state persists; transient open/closed state does not.
  assistantPinned: pref<boolean>({  key: 'petit-planet-assistant-pinned', parse: asBool, fallback: () => false, write: fromBool }),
  assistantDockSide: pref<DockSide>({ key: 'petit-planet-assistant-dock-side', parse: oneOf(['left', 'right'] as const), fallback: () => 'left' }),
  showGrid:       pref<boolean>({   key: 'petit-planet-show-grid',       parse: asBool, fallback: () => true, write: fromBool }),
  showChunkBounds: pref<boolean>({  key: 'petit-planet-chunk-bounds',    parse: asBool, fallback: () => true, write: fromBool }),
  keybinds:       pref<string>({    key: 'petit-planet-keybinds',        parse: raw, fallback: none }),

  // Existing hint keys remain stable so dismissed hints stay dismissed.
  navGestureHint:  pref<boolean>({ key: 'petit.navGestureHintSeen',       parse: asBool, fallback: () => false, write: fromBool }),
  inAppBrowserSeen:pref<boolean>({ key: 'petit.inAppBrowserNoticeSeen',   parse: asBool, fallback: () => false, write: fromBool }),
  // The app version this browser last opened; empty until a first visit records one.
  lastSeenVersion: pref<string>({  key: 'petit-planet-last-seen-version', parse: raw, fallback: none }),

  // Structured blobs are parsed by their owning modules. `tourSeen` is accessed directly because
  // missing storage means unseen, while unavailable storage suppresses the tour.
  tourSeen:      pref<string>({ key: 'petit-planet-tour-seen',  parse: raw, fallback: none }),
  autosave:      pref<string>({ key: 'petit-planet-autosave',    parse: raw, fallback: none }),
  // Undo history is separate so quota pressure cannot discard the autosaved map.
  autosaveHistory: pref<string>({ key: 'petit-planet-autosave-history', parse: raw, fallback: none }),
  agentSettings: pref<string>({ key: 'petit-agent-settings-v1',  parse: raw, fallback: none }),
  // A null Agent log means no persisted session.
  agentLogV3:    pref<string | null>({ key: 'petit-agent-log-v3', parse: raw, fallback: () => null }),
  // Filed and cleared Agent records are keyed to the current session log.
  agentMarksV3:  pref<string | null>({ key: 'petit-agent-marks-v3', parse: raw, fallback: () => null }),
  // IndexedDB database name, included so this registry covers both browser stores.
  agentVault:    pref<string>({ key: 'petit-agent-vault',        parse: raw, fallback: none }),
  // Illustration settings and an optional vault-sealed key.
  stylize:       pref<string>({ key: 'petit-planet-stylize-v1',  parse: raw, fallback: none }),
  // Content digests of this browser's own image exports, never included in shared files.
  ownImageExports: pref<string>({ key: 'petit-planet-own-image-exports', parse: raw, fallback: none }),
  // Export preset, parts, footer template, and size; title and description are not persisted.
  exportOptions: pref<string>({ key: 'petit-planet-export-options', parse: raw, fallback: none }),
} as const;

export type PrefId = keyof typeof PREFS;
type ValueOf<K extends PrefId> = (typeof PREFS)[K] extends PrefDef<infer T> ? T : never;

/** Every storage key this app persists, for enumeration and for the declaration test. */
export const PREF_STORAGE_KEYS: readonly string[] = Object.values(PREFS).map((d) => d.key);

export function readPref<K extends PrefId>(id: K): ValueOf<K> {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  let stored: string | null = null;
  try { stored = localStorage.getItem(def.key); } catch { /* storage disabled */ }
  if (stored === null) return def.fallback();
  return def.parse(stored) ?? def.fallback();
}

/** Whether localStorage accepted the write. */
export function writePref<K extends PrefId>(id: K, value: ValueOf<K>): boolean {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  try { localStorage.setItem(def.key, def.write ? def.write(value) : String(value)); return true; } catch { /* storage disabled, or quota exceeded */ }
  return false;
}
