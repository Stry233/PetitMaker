// The browser's library of custom planets: one record in `PREFS.customPlanets`, gzip-enveloped
// past the autosave threshold. Entries are keyed by `entryId`; `adoptPlanet` dedups by template id,
// which is a content hash, so the same planet opened twice is one entry. An entry's name is its
// template's display name: every template leaving the library carries it (the id hash excludes it).
// A name that arrived with an adopted planet is unreviewed until `settlePlanetName` records the
// text check's outcome. `shownPlanetName` is the one reader of a planet's name for display and
// export: it gives the approved name, or the default name while a name is unchecked or refused.
// An entry saved from the planet session keeps `rimSand`, the sand its rim hides, beside the template
// and outside its id; an entry without it reads the rim's ground from the neighbouring sand.
import { CellZone, type GridState, type Locale, type MapTemplate } from '../core/model/types';
import { isCustomTemplate } from '../core/model/planet';
import { readPref, writePref } from '../core/runtime/prefs';
import { localizedName, translateFor } from '../i18n/context';
import { decodeAutosave, encodeAutosave } from './autosave-codec';
import { parseTemplate, serializeTemplate, type SerializedTemplate } from './planet-codec';
import { generateId } from '../core/model/object-id';
import { createSignal } from '../core/runtime/signal';

export interface PlanetEntry {
  entryId: string; name: string; nameReviewed: boolean; template: MapTemplate; createdAt: number; updatedAt: number;
  /** Row-major indices of the template's rim cells whose ground is sand (`core/model/planet.ts:rimSandOf`). */
  rimSand?: readonly number[];
}

interface StoredEntry { entryId: string; name: string; nameReviewed?: boolean; template: SerializedTemplate; createdAt: number; updatedAt: number; rimSand?: number[] }
interface StoredLibrary { v: 1; entries: StoredEntry[] }

export type SavePlanetResult = { ok: true; entry: PlanetEntry } | { ok: false; reason: 'quota' };

let version = 0;
// A failing subscriber must not turn a completed write into a failed save.
const changed = createSignal<void>(undefined, (err) => console.error('[planet-library] listener failed:', err));
// Check outcomes for planet names that no library entry carries, by exact name text; page-local.
const verdicts = new Map<string, boolean>();
// Decoded entries, reused within one task: render passes read the library many times.
let cached: { raw: string | null; entries: PlanetEntry[] } | null = null;
let cacheHeld = false;

/** Bumped after every successful write; a cheap freshness key for subscribers. */
export function planetLibraryVersion(): number { return version; }

export function onPlanetLibraryChange(fn: () => void): () => void {
  return changed.subscribe(fn);
}

function newEntryId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return generateId('p');
}

/** The rim cells of `template` among `stored`, or undefined when `stored` is not such a list. */
function rimSandFor(template: MapTemplate, stored: unknown): number[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const { width, zones } = template;
  return stored.filter((i): i is number => Number.isInteger(i) && i >= 0 && zones[Math.floor(i / width)]?.[i % width] === CellZone.Boundary);
}

/** The name the library entry at `index` is shown under: its approved name, or its default name while unchecked or refused. */
export function shownEntryName(entry: Pick<PlanetEntry, 'name' | 'nameReviewed'>, index: number, locale: Locale): string {
  return entry.nameReviewed && entry.name.trim() ? entry.name : defaultPlanetName(locale, index);
}

/** `entry` as shown under `name`, its template carrying that name too. */
export function shownAs(entry: PlanetEntry, name: string): PlanetEntry {
  return { ...entry, name, template: named(entry.template, name) };
}

/** `template` carrying `name` as its display name. */
function named(template: MapTemplate, name: string): MapTemplate {
  return template.name.en === name && Object.keys(template.name).length === 1 ? template : { ...template, name: { en: name } };
}

function readEntries(): PlanetEntry[] {
  const stored = readPref('customPlanets');
  if (!stored) return [];
  let parsed: Partial<StoredLibrary> | null;
  try { parsed = JSON.parse(decodeAutosave(stored)) as Partial<StoredLibrary> | null; } catch { return []; }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return [];
  const out: PlanetEntry[] = [];
  for (const e of parsed.entries as Partial<StoredEntry>[]) {
    if (!e || typeof e.entryId !== 'string' || typeof e.name !== 'string') continue;
    let template: MapTemplate;
    try { template = named(parseTemplate(e.template), e.name); } catch { continue; }
    const createdAt = Number.isFinite(e.createdAt) ? e.createdAt! : 0;
    const rimSand = rimSandFor(template, e.rimSand);
    out.push({
      entryId: e.entryId, name: e.name, nameReviewed: e.nameReviewed === true, template, createdAt, updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt! : createdAt,
      ...(rimSand ? { rimSand } : {}),
    });
  }
  return out;
}

function announce(): void {
  version++;
  changed.emit();
}

function writeEntries(entries: PlanetEntry[]): boolean {
  cached = null;
  const record: StoredLibrary = {
    v: 1,
    entries: entries.map((e) => ({
      entryId: e.entryId, name: e.name, nameReviewed: e.nameReviewed, template: serializeTemplate(e.template), createdAt: e.createdAt, updatedAt: e.updatedAt,
      ...(e.rimSand ? { rimSand: [...e.rimSand] } : {}),
    })),
  };
  if (!writePref('customPlanets', encodeAutosave(JSON.stringify(record)))) return false;
  announce();
  return true;
}

/**
 * The stored entries; callers must not mutate them. The record is read at most once per task and
 * decoded only when it changed, so a write from another tab shows from the next task on.
 */
export function listPlanets(): PlanetEntry[] {
  if (cached && cacheHeld) return cached.entries;
  const raw = readPref('customPlanets');
  if (cached?.raw !== raw) cached = { raw, entries: readEntries() };
  cacheHeld = true;
  queueMicrotask(() => { cacheHeld = false; });
  return cached.entries;
}

/** The default name of the library entry at `index`, or of the next planet at the library's length. */
export function defaultPlanetName(locale: Locale, index: number): string {
  return translateFor(locale, 'planet.default_name', { n: index + 1 });
}

export type PlanetNameStatus = 'approved' | 'pending' | 'refused';

/**
 * The library entry that names a map's planet. A copy shares its original's shape and so its
 * template id; among the entries of that shape it is the one carrying the map's own name, or the
 * only one, so a rename there renames the planet wherever it stands.
 */
export function planetEntryFor(template: MapTemplate): PlanetEntry | null {
  if (!isCustomTemplate(template)) return null;
  const same = listPlanets().filter((e) => e.template.id === template.id);
  return same.find((e) => e.name === template.name.en) ?? (same.length === 1 ? same[0]! : null);
}

/** Whether `template`'s name may be shown, and the approved name when it may. */
function nameVerdict(template: MapTemplate): { status: PlanetNameStatus; name: string; index: number } {
  const entries = listPlanets();
  const entry = planetEntryFor(template);
  if (entry) return { status: !entry.nameReviewed ? 'pending' : entry.name.trim() ? 'approved' : 'refused', name: entry.name, index: entries.indexOf(entry) };
  const name = template.name.en ?? '';
  const verdict = name.trim() ? verdicts.get(name) : false;
  return { status: verdict === undefined ? 'pending' : verdict ? 'approved' : 'refused', name, index: entries.length };
}

export function planetNameStatus(template: MapTemplate): PlanetNameStatus {
  return isCustomTemplate(template) ? nameVerdict(template).status : 'approved';
}

/** A planet's name as shown and exported: a built-in's own name, or a custom planet's approved name or default name. */
export function shownPlanetName(template: MapTemplate, locale: Locale): string {
  if (!isCustomTemplate(template)) return localizedName(template.name, locale);
  const verdict = nameVerdict(template);
  return verdict.status === 'approved' ? verdict.name : defaultPlanetName(locale, verdict.index);
}

/** `state` with its planet carrying the shown name, for anything that leaves the browser. */
export function withShownPlanetName<S extends Pick<GridState, 'template'>>(state: S, locale: Locale): S {
  if (!isCustomTemplate(state.template)) return state;
  const template = named(state.template, shownPlanetName(state.template, locale));
  return template === state.template ? state : { ...state, template };
}

/** A custom planet's name that no entry carries and no check has answered yet. */
export function uncheckedPlanetName(template: MapTemplate): string | null {
  if (!isCustomTemplate(template) || planetEntryFor(template)) return null;
  const name = template.name.en ?? '';
  return name.trim() && !verdicts.has(name) ? name : null;
}

/** Forgets every page-local verdict; for tests that reuse names. */
export function forgetPlanetNameVerdicts(): void {
  verdicts.clear();
  cached = null;
}

/** Records the text check of a planet name no entry carries, or of a name approved while typed. */
export function recordPlanetNameVerdict(name: string, approved: boolean): void {
  if (verdicts.get(name) === approved) return;
  verdicts.set(name, approved);
  announce();
}

export interface SavePlanetOptions {
  /** The entry whose planet and name this save replaces, when it exists. */
  replaceEntryId?: string;
  /** False for a name that came from outside and has not passed the text check. Default true. */
  nameReviewed?: boolean;
  /** The sand under the planet's rim; without it the entry reads the rim's ground from the neighbouring sand. */
  rimSand?: readonly number[];
}

/** Adds a planet, or replaces the planet, name and rim sand of `replaceEntryId` when that entry exists. */
export function savePlanet(name: string, planet: MapTemplate, options: SavePlanetOptions = {}): SavePlanetResult {
  const { replaceEntryId, nameReviewed = true, rimSand } = options;
  const template = named(planet, name);
  const entries = readEntries();
  const now = Date.now();
  const at = replaceEntryId === undefined ? -1 : entries.findIndex((e) => e.entryId === replaceEntryId);
  const prior = at >= 0 ? entries[at]! : null;
  const entry: PlanetEntry = {
    entryId: prior?.entryId ?? newEntryId(), name, nameReviewed, template, createdAt: prior?.createdAt ?? now, updatedAt: now,
    ...(rimSand ? { rimSand } : {}),
  };
  if (at >= 0) entries[at] = entry; else entries.push(entry);
  return writeEntries(entries) ? { ok: true, entry } : { ok: false, reason: 'quota' };
}

/**
 * The library entry for this planet, adding one when absent with its name unreviewed. A failed
 * write still returns the unsaved entry.
 */
export function adoptPlanet(template: MapTemplate, name?: string): PlanetEntry {
  const existing = readEntries().find((e) => e.template.id === template.id);
  if (existing) return existing;
  const saved = savePlanet(name ?? template.name.en ?? '', template, { nameReviewed: false });
  if (saved.ok) return saved.entry;
  const now = Date.now();
  const unsaved = name ?? template.name.en ?? '';
  return { entryId: newEntryId(), name: unsaved, nameReviewed: false, template: named(template, unsaved), createdAt: now, updatedAt: now };
}

/** The one adoption rule: a map that was just installed on a custom planet puts that planet in the library. */
export function adoptInstalledPlanet(state: Pick<GridState, 'template'>): void {
  if (isCustomTemplate(state.template)) adoptPlanet(state.template);
}

export function renamePlanet(entryId: string, name: string): boolean {
  const entries = readEntries();
  const e = entries.find((x) => x.entryId === entryId);
  if (!e) return false;
  e.name = name;
  e.nameReviewed = true;
  e.template = named(e.template, name);
  e.updatedAt = Date.now();
  return writeEntries(entries);
}

/**
 * Records the text check of an unreviewed name: approved when `replacement` is null, otherwise the
 * entry takes `replacement` for good. Nothing changes when the entry's name is no longer `checked`.
 */
export function settlePlanetName(entryId: string, checked: string, replacement: string | null): boolean {
  const entries = readEntries();
  const e = entries.find((x) => x.entryId === entryId);
  if (!e || e.nameReviewed || e.name !== checked) return false;
  e.nameReviewed = true;
  if (replacement !== null) { e.name = replacement; e.template = named(e.template, replacement); }
  return writeEntries(entries);
}

export function duplicatePlanet(entryId: string, name: string): PlanetEntry | null {
  const source = readEntries().find((x) => x.entryId === entryId);
  if (!source) return null;
  const saved = savePlanet(name, source.template, source.rimSand ? { rimSand: source.rimSand } : {});
  return saved.ok ? saved.entry : null;
}

export function removePlanet(entryId: string): boolean {
  const entries = readEntries();
  const kept = entries.filter((x) => x.entryId !== entryId);
  if (kept.length === entries.length) return false;
  return writeEntries(kept);
}
