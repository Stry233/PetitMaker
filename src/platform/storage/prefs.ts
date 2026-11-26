/**
 * Registry of every persisted key. Each preference defines its parser and fallback. New keys use
 * the `petit-planet-` prefix; existing non-prefixed keys remain stable for saved preferences.
 */
import { LOCALES, type Locale } from '../../core/model/locale';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../core/game/profile';
import { stepIn } from '../../core/base/cycle';
import type { InputMode } from '../device/input-mode';
import type { LayoutShape } from '../device/layout-shape';

const HINT_LEVELS = ['full', 'concise', 'off'] as const;
export type HintLevel = typeof HINT_LEVELS[number];
/** The 3D scene's quality choice: 'auto' follows the GL probe (device-quality), the others pin it. */
export const QUALITIES_3D = ['auto', 'full', 'lite'] as const;
export type Quality3d = typeof QUALITIES_3D[number];
export const VIEW_MODES = ['2d', '3d'] as const;
export type ViewMode = typeof VIEW_MODES[number];
/** Animation preference: 'system' follows the OS prefers-reduced-motion, the others override it. */
export const MOTION_PREFS = ['system', 'reduced', 'full'] as const;
export type MotionPref = typeof MOTION_PREFS[number];
/** Whether motion is reduced under `pref` on a device whose own setting asks for it (`os`) or not:
 *  the one resolution every reduced-motion gate is published from. */
export function resolveReducedMotion(pref: MotionPref, os: boolean): boolean {
  return pref === 'reduced' || (pref === 'system' && os);
}
/** Which grid the map draws: the one the active tool works on (`auto`), the placement or terrain
 *  grid always, or none, in the order the Settings grid tile cycles through them. The half grid
 *  only places notes and is never drawn. */
export const GRID_MODES = ['auto', PLACEMENT_GRID, TERRAIN_GRID, 'off'] as const;
export type GridMode = typeof GRID_MODES[number];
/** The mode the Settings grid tile moves to from `mode`, wrapping from the last to the first. */
export function nextGridMode(mode: GridMode): GridMode {
  return stepIn(GRID_MODES, mode, 1);
}
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
  /** The stored text; null removes the entry, so the fallback reads next. */
  write?: (value: T) => string | null;
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

const parseNames = (raw: string): string[] | null => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((n) => typeof n === 'string') ? v : null;
  } catch { return null; }
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
/** Touch mode's default UI scale on an upright screen: a fingertip reads and reaches a larger interface. */
export const TOUCH_UI_ZOOM_DEFAULT = 1.25;
/** Touch mode's default UI scale on a wide screen, whose short height crowds the upright size. */
export const TOUCH_WIDE_UI_ZOOM_DEFAULT = 1.05;

/** Which UI scale is in force: PC mode's, or touch mode's on an upright or on a wide screen. */
type ScaleProfile = 'pc' | 'touch' | 'touchWide';

/** The scale profile for an input mode and arrangement. */
export function scaleProfileOf(mode: InputMode, shape: LayoutShape): ScaleProfile {
  return mode === 'pc' ? 'pc' : shape === 'portrait' ? 'touch' : 'touchWide';
}

/** Each profile keeps its own UI scale; the one in force is the current mode's and arrangement's. */
export const UI_ZOOM_PREFS = { pc: 'uiZoom', touch: 'touchUiZoom', touchWide: 'touchWideUiZoom' } as const satisfies Record<ScaleProfile, string>;
export const UI_ZOOM_DEFAULTS: Readonly<Record<ScaleProfile, number>> = {
  pc: UI_ZOOM_DEFAULT, touch: TOUCH_UI_ZOOM_DEFAULT, touchWide: TOUCH_WIDE_UI_ZOOM_DEFAULT,
};

/** One step of the UI scale, for the Settings slider and the scale shortcuts alike. */
export const UI_SCALE_STEP = 0.05;

/** The UI scale's stops for a scale whose default is `anchor`: the default plus or minus whole steps,
 *  from the lowest at or above `UI_ZOOM_MIN` to the highest at or below `reach`, never short of the
 *  default, so every default sits on its own track. */
export function scaleLattice(anchor: number, reach: number): { lo: number; hi: number; snap: (z: number) => number } {
  const at = (k: number) => +(anchor + k * UI_SCALE_STEP).toFixed(2);
  const lo = at(-Math.floor((anchor - UI_ZOOM_MIN) / UI_SCALE_STEP + 1e-6));
  const hi = Math.max(at(Math.max(0, Math.floor((reach - anchor) / UI_SCALE_STEP + 1e-6))), +(lo + UI_SCALE_STEP).toFixed(2));
  const snap = (z: number) => Math.min(hi, Math.max(lo, at(Math.round((z - anchor) / UI_SCALE_STEP))));
  return { lo, hi, snap };
}

/**
 * The stored UI scale `steps` stops from the stored one, as the Settings slider's arrows and the scale
 * shortcuts step: on the stops of the scale in force (each through its own default) up to `reach`,
 * the window's reach, past which a step changes nothing; null where the step would not move the scale
 * its way, so a preference saved past the reach steps down from the reach and never up toward it.
 */
export function uiZoomStep(s: { uiZoom: number; inputMode: InputMode; layoutShape: LayoutShape }, reach: number, steps: number): number | null {
  const { snap } = scaleLattice(UI_ZOOM_DEFAULTS[scaleProfileOf(s.inputMode, s.layoutShape)], reach);
  const next = snap(snap(s.uiZoom) + steps * UI_SCALE_STEP);
  return (steps > 0 ? next > s.uiZoom : next < s.uiZoom) ? next : null;
}

/** A UI scale clamped to its range and rounded to two decimals, as the preference stores it. */
export function clampUiZoom(z: number): number {
  return Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, +z.toFixed(2)));
}

export const PREFS = {
  locale:         pref<Locale>({    key: 'petit-planet-locale',          parse: oneOf(LOCALES), fallback: browserLocale }),
  uiZoom:         pref<number>({    key: 'petit-planet-ui-zoom',         parse: inRange(UI_ZOOM_MIN, UI_ZOOM_MAX), fallback: () => UI_ZOOM_DEFAULT }),
  touchUiZoom:    pref<number>({    key: 'petit-planet-touch-ui-zoom',   parse: inRange(UI_ZOOM_MIN, UI_ZOOM_MAX), fallback: () => TOUCH_UI_ZOOM_DEFAULT }),
  touchWideUiZoom: pref<number>({   key: 'petit-planet-touch-wide-ui-zoom', parse: inRange(UI_ZOOM_MIN, UI_ZOOM_MAX), fallback: () => TOUCH_WIDE_UI_ZOOM_DEFAULT }),
  viewMode:       pref<ViewMode>({  key: 'petit-planet-view-mode',       parse: oneOf(VIEW_MODES), fallback: () => '2d' }),
  hintLevel:      pref<HintLevel>({ key: 'petit-planet-hint-level',      parse: oneOf(HINT_LEVELS), fallback: () => 'full' }),
  quality3d:      pref<Quality3d>({ key: 'petit-planet-3d-quality',      parse: oneOf(QUALITIES_3D), fallback: () => 'auto' }),
  // Build tag of the last completed asset preload.
  splashDone:     pref<string>({    key: 'petit-planet-splash-done',     parse: raw, fallback: none }),
  // Wayland Chromium can mis-size custom cursor bitmaps under fractional display scaling.
  systemCursors:  pref<boolean>({   key: 'petit-planet-system-cursors',  parse: asBool, fallback: () => false, write: fromBool }),
  // Whether an installed app enters immersive mode at its first tap; the Settings button sets it.
  installedImmersive: pref<boolean>({ key: 'petit-planet-installed-immersive', parse: asBool, fallback: () => true, write: fromBool }),
  motionPref:     pref<MotionPref>({ key: 'petit-planet-motion',         parse: oneOf(MOTION_PREFS), fallback: () => 'system' }),
  // Dock state persists; transient open/closed state does not.
  assistantPinned: pref<boolean>({  key: 'petit-planet-assistant-pinned', parse: asBool, fallback: () => false, write: fromBool }),
  assistantDockSide: pref<DockSide>({ key: 'petit-planet-assistant-dock-side', parse: oneOf(DOCK_SIDES), fallback: () => 'left' }),
  enforceChunkLoad: pref<boolean>({ key: 'petit-planet-enforce-chunk-load', parse: asBool, fallback: () => true, write: fromBool }),
  gridMode:       pref<GridMode>({  key: 'petit-planet-grid-mode',       parse: oneOf(GRID_MODES), fallback: migratedGridMode }),
  // The grid switch `gridMode` replaced, read once to carry its choice over and removed on the first write.
  legacyShowGrid: pref<boolean | null>({ key: 'petit-planet-show-grid', parse: asBool, fallback: () => null }),
  showChunkBounds: pref<boolean>({  key: 'petit-planet-chunk-bounds',    parse: asBool, fallback: () => true, write: fromBool }),
  keybinds:       pref<string>({    key: 'petit-planet-keybinds',        parse: raw, fallback: none }),
  // The keymap revision the saved keybinds were written at (`state/keymap/registry.ts:KEYMAP_REVISION`); 0 before it was kept.
  keybindsRevision: pref<number>({  key: 'petit-planet-keybinds-revision', parse: inRange(0, 1e6), fallback: () => 0 }),

  // Existing hint keys remain stable so dismissed hints stay dismissed.
  navGestureHint:  pref<boolean>({ key: 'petit.navGestureHintSeen',       parse: asBool, fallback: () => false, write: fromBool }),
  inAppBrowserSeen:pref<boolean>({ key: 'petit.inAppBrowserNoticeSeen',   parse: asBool, fallback: () => false, write: fromBool }),
  // The object shelf's brush button has been pointed out once, or pressed before it was.
  brushHintSeen:   pref<boolean>({ key: 'petit-planet-brush-hint-seen',  parse: asBool, fallback: () => false, write: fromBool }),
  // The blueprint library has been given its examples once, so a deleted one never comes back.
  blueprintExamplesGiven: pref<boolean>({ key: 'petit-planet-blueprint-examples-given', parse: asBool, fallback: () => false, write: fromBool }),
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
  // The last blueprint author name used; null reads as anonymous.
  blueprintAuthor: pref<string | null>({ key: 'petit-planet-blueprint-author', parse: raw, fallback: () => null, write: (v) => v }),
  // Blueprint folder names in order, so a folder holding nothing survives.
  blueprintFolders: pref<string[]>({ key: 'petit-planet-blueprint-folders', parse: parseNames, fallback: () => [], write: (v) => JSON.stringify(v) }),
  // Blueprint record ids in the order the library shows them, never written into a file.
  blueprintOrder: pref<string[]>({ key: 'petit-planet-blueprint-order', parse: parseNames, fallback: () => [], write: (v) => JSON.stringify(v) }),
} as const;

/** The IndexedDB databases this app opens, declared beside the localStorage keys. */
export const BROWSER_DATABASES = {
  agentVault: 'petit-agent-vault',
  /** Help figures' computed worlds, keyed by build (`figure-cache.ts`). */
  figureCache: 'petit-figure-cache',
  /** The blueprint library's records (`blueprint-db.ts`). */
  blueprints: 'petit-blueprints',
} as const;

/** A grid switched off stays off; a grid that was on follows the active tool. */
function migratedGridMode(): GridMode {
  return readPref('legacyShowGrid') === false ? 'off' : 'auto';
}

export type PrefId = keyof typeof PREFS;
/** The preferences that hold a JSON record. */
type JsonPrefId = { [K in PrefId]: (typeof PREFS)[K] extends { readonly json: true } ? K : never }[PrefId];
export type ValueOf<K extends PrefId> = (typeof PREFS)[K] extends PrefDef<infer T> ? T : never;

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
  try {
    const text = def.write ? def.write(value) : String(value);
    if (text === null) localStorage.removeItem(def.key); else localStorage.setItem(def.key, text);
    return true;
  } catch { /* storage disabled, or quota exceeded */ }
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
