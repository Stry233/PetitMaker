/**
 * Every preference this origin persists, declared once.
 *
 * A preference is a key, a parser and a fallback. `readPref` returns the fallback for anything
 * absent or unparseable, so a hand-edited or stale value can never reach the app as a bad type.
 *
 * Keys are stored verbatim. `petit-planet-` is the prefix for anything new; the two keys that
 * predate it keep their literal strings, since renaming one silently discards a returning
 * visitor's setting.
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

/** All UI locales, ordered most- to least-specific for prefix matching. `Locale` (core/model/types,
 *  imported far more widely than this array) is the single source of what a locale IS; `satisfies`
 *  below only checks every listed member is a real `Locale` — it does not catch a MISSING one, so
 *  `_localeCoverage` does that half: a `Locale` this array omits fails to typecheck there instead
 *  of silently leaving `browserLocale`/`readPref('locale')` unable to match it. */
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
  // The build tag of the last COMPLETED asset preload. The boot splash shows only when it
  // differs from the running build: same build means the immutable asset URLs were fetched once
  // already, so the browser cache answers and a splash would be a wait in front of nothing.
  splashDone:     pref<string>({    key: 'petit-planet-splash-done',     parse: raw, fallback: none }),
  // Painted cursors by default on every platform — including desktop Linux,
  // where Wayland Chromium under fractional display scaling draws custom bitmaps at the wrong
  // size (see cursor-css.ts's header); the Settings cursor choice is the way out there.
  systemCursors:  pref<boolean>({   key: 'petit-planet-system-cursors',  parse: asBool, fallback: () => false, write: fromBool }),
  motionPref:     pref<MotionPref>({ key: 'petit-planet-motion',         parse: oneOf(['system', 'reduced', 'full'] as const), fallback: () => 'system' }),
  // Whether the assistant's panel is DOCKED to a side of the window rather than standing over the
  // map, and WHICH side. They are the things about the panel that persist, and remembering them is
  // the point: a visitor who has docked the panel works in an interface that has a place for it, at
  // the end of the window they put it at, so the editor opens that way. Whether the panel is merely
  // OPEN is not persisted (`state/slices/shell.ts`).
  assistantPinned: pref<boolean>({  key: 'petit-planet-assistant-pinned', parse: asBool, fallback: () => false, write: fromBool }),
  assistantDockSide: pref<DockSide>({ key: 'petit-planet-assistant-dock-side', parse: oneOf(['left', 'right'] as const), fallback: () => 'left' }),
  showGrid:       pref<boolean>({   key: 'petit-planet-show-grid',       parse: asBool, fallback: () => true, write: fromBool }),
  showChunkBounds: pref<boolean>({  key: 'petit-planet-chunk-bounds',    parse: asBool, fallback: () => true, write: fromBool }),
  keybinds:       pref<string>({    key: 'petit-planet-keybinds',        parse: raw, fallback: none }),

  // Two hints predate the `petit-planet-` prefix. The key is kept verbatim: renaming one
  // re-shows a hint the visitor already dismissed.
  navGestureHint:  pref<boolean>({ key: 'petit.navGestureHintSeen',       parse: asBool, fallback: () => false, write: fromBool }),
  inAppBrowserSeen:pref<boolean>({ key: 'petit.inAppBrowserNoticeSeen',   parse: asBool, fallback: () => false, write: fromBool }),

  // Structured blobs whose own modules own the shape. They are declared here so the app can
  // enumerate everything it persists; `io/autosave`, `agent/security/key-storage` and
  // `agent/session/persist` keep parsing them.
  //
  // `tourSeen` joins this group rather than reading as a plain boolean: its real policy
  // (`ui/chrome/tour/use-tour.ts:hasSeenTour`) is that a functioning browser with the key simply
  // never set reads as NOT seen, while a browser with no localStorage at all, or one whose read
  // throws, reads as SEEN (so a visitor whose storage is broken is never nagged on every visit) —
  // two different fallbacks for the same absence that `readPref`'s one fallback value cannot
  // express, so `hasSeenTour`/`markTourSeen` read and write the key directly instead of going
  // through `readPref`/`writePref`. `parse`/`fallback` below are inert placeholders, kept only so
  // this entry has the shape every `PrefDef` needs.
  tourSeen:      pref<string>({ key: 'petit-planet-tour-seen',  parse: raw, fallback: none }),
  autosave:      pref<string>({ key: 'petit-planet-autosave',    parse: raw, fallback: none }),
  // The undo stack belonging to `autosave`, kept in its own key so a history too big for the quota
  // costs the session its undo steps and never its map. Written and cleared with the map it
  // describes, so the pair cannot come apart (`io/autosave.ts`).
  autosaveHistory: pref<string>({ key: 'petit-planet-autosave-history', parse: raw, fallback: none }),
  agentSettings: pref<string>({ key: 'petit-agent-settings-v1',  parse: raw, fallback: none }),
  // The v3 session log's own versioned envelope (`agent/session/persist.ts`); null means nothing
  // persisted yet, distinct from an empty string.
  agentLogV3:    pref<string | null>({ key: 'petit-agent-log-v3', parse: raw, fallback: () => null }),
  // Which settled records the user has put away, beside the log rather than in it: filing a card
  // away is not something the model or the record is folded from, and the marks are keyed by the
  // log's own order seqs, so they are dropped with the envelope they belong to
  // (`agent/session/persist.ts`).
  agentMarksV3:  pref<string | null>({ key: 'petit-agent-marks-v3', parse: raw, fallback: () => null }),
  // Not a localStorage blob: `agent/security/vault.ts` reads this as an IndexedDB database name. Declared
  // here anyway so this table is the complete list of what the origin persists, to either storage.
  agentVault:    pref<string>({ key: 'petit-agent-vault',        parse: raw, fallback: none }),
} as const;

export type PrefId = keyof typeof PREFS;
type ValueOf<K extends PrefId> = (typeof PREFS)[K] extends PrefDef<infer T> ? T : never;

/** Every storage key this app persists, for enumeration and for the declaration test. */
export const PREF_STORAGE_KEYS: readonly string[] = Object.values(PREFS).map((d) => d.key);

export function readPref<K extends PrefId>(id: K): ValueOf<K> {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  if (typeof localStorage === 'undefined') return def.fallback();
  let stored: string | null = null;
  try { stored = localStorage.getItem(def.key); } catch { /* storage disabled */ }
  if (stored === null) return def.fallback();
  return def.parse(stored) ?? def.fallback();
}

/** True on a successful write; false when storage is unavailable or the write throws (quota,
 *  disabled storage). Most call sites discard the result; `agent/session/persist.ts:saveLog`
 *  reads it to prune and retry once rather than losing the session log silently. */
export function writePref<K extends PrefId>(id: K, value: ValueOf<K>): boolean {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  if (typeof localStorage === 'undefined') return false;
  try { localStorage.setItem(def.key, def.write ? def.write(value) : String(value)); return true; } catch { /* storage disabled, or quota exceeded */ }
  return false;
}
