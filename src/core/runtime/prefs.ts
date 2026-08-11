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
export type ViewMode = '2d' | '3d';

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
  systemCursors:  pref<boolean>({   key: 'petit-planet-system-cursors',  parse: asBool, fallback: () => false, write: fromBool }),
  // The assistant's panel is a card over the map, and the editor opens on the map: closed until
  // the visitor presses its block in the mode row.
  assistantOpen:  pref<boolean>({   key: 'petit-planet-assistant-open',  parse: asBool, fallback: () => false, write: fromBool }),
  keybinds:       pref<string>({    key: 'petit-planet-keybinds',        parse: raw, fallback: none }),

  // Two hints predate the `petit-planet-` prefix. The key is kept verbatim: renaming one
  // re-shows a hint the visitor already dismissed.
  navGestureHint:  pref<boolean>({ key: 'petit.navGestureHintSeen',       parse: asBool, fallback: () => false, write: fromBool }),
  inAppBrowserSeen:pref<boolean>({ key: 'petit.inAppBrowserNoticeSeen',   parse: asBool, fallback: () => false, write: fromBool }),

  // Structured blobs whose own modules own the shape. They are declared here so the app can
  // enumerate everything it persists; `io/autosave`, `agent/key-storage` and `agent/session`
  // keep parsing them.
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
  agentSession:  pref<string>({ key: 'petit-agent-session-v1',   parse: raw, fallback: none }),
  // Not a localStorage blob: `agent/vault.ts` reads this as an IndexedDB database name. Declared
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

export function writePref<K extends PrefId>(id: K, value: ValueOf<K>): void {
  const def = PREFS[id] as unknown as PrefDef<ValueOf<K>>;
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(def.key, def.write ? def.write(value) : String(value)); } catch { /* storage disabled */ }
}
