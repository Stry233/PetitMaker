// The browser's library of custom planets: one record in `PREFS.customPlanets`, gzip-enveloped
// past the autosave threshold. Entries are keyed by `entryId`; `adoptPlanet` dedups by template id,
// which is a content hash, so the same planet opened twice is one entry. An entry's name is its
// template's display name: every template leaving the library carries it (the id hash excludes it).
// A name that arrived with an adopted planet is unreviewed until `settlePlanetName` records the
// text check's outcome; `state/planet-name-verdict.ts` says from the entries whether a name may be shown.
// An entry saved from the planet session keeps `rimSand`, the sand its rim hides, beside the template
// and outside its id; an entry without it reads the rim's ground from the neighbouring sand.
import { type GridState, type MapTemplate } from '../../core/model/types';
import { isRimZone } from '../../core/game/zones';
import { isCustomTemplate } from '../../core/model/planet';
import { jsonObject, jsonPref, readPref, writeJsonPref } from '../../platform/storage/prefs';
import { decodeRecord, encodeRecord } from './record-codec';
import { parseTemplate, serializeTemplate, type SerializedTemplate } from '../save/planet-codec';
import { isInputRefusal } from '../save/import-error';
import { generateRecordId } from '../../core/model/object-id';
import { createSignal } from '../../core/base/signal';
import { onTextVerdicts, textVerdictsVersion } from '../../state/text-verdicts';
import { planetEntryAmong } from '../../state/planet-name-verdict';

export interface PlanetEntry {
  entryId: string; name: string; nameReviewed: boolean; template: MapTemplate; createdAt: number; updatedAt: number;
  /** Row-major indices of the template's rim cells whose ground is sand (`core/model/shore.ts:rimSandOf`). */
  rimSand?: readonly number[];
}

interface StoredEntry {
  entryId: string;
  name: string;
  nameReviewed?: boolean;
  template: SerializedTemplate;
  createdAt: number;
  updatedAt: number;
  rimSand?: number[];
}
interface StoredLibrary { v: 1; entries: StoredEntry[] }

type SavePlanetResult = { ok: true; entry: PlanetEntry } | { ok: false; reason: 'quota' };

let version = 0;
// A failing subscriber must not turn a completed write into a failed save.
const changed = createSignal<void>(undefined, (err) => console.error('[planet-library] listener failed:', err));
// Decoded entries, reused within one task: render passes read the library many times.
let cached: { raw: string | null; entries: PlanetEntry[] } | null = null;
let cacheHeld = false;

/** Grows after every successful write and every text verdict, which can change a shown name; a
 *  cheap freshness key for subscribers. */
export function planetLibraryVersion(): number { return version + textVerdictsVersion(); }

export function onPlanetLibraryChange(fn: () => void): () => void {
  const offLibrary = changed.subscribe(fn);
  const offVerdicts = onTextVerdicts(fn);
  return () => { offLibrary(); offVerdicts(); };
}

const newEntryId = (): string => generateRecordId('p');

/** The rim cells of `template` among `stored`, or undefined when `stored` is not such a list. */
function rimSandFor(template: MapTemplate, stored: unknown): number[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const { width, zones } = template;
  return stored.filter((i): i is number => Number.isInteger(i) && i >= 0 && isRimZone(zones[Math.floor(i / width)]?.[i % width]));
}

/** `entry` as shown under `name`, its template carrying that name too. */
export function shownAs(entry: PlanetEntry, name: string): PlanetEntry {
  return { ...entry, name, template: namedTemplate(entry.template, name) };
}

/** `template` carrying `name` as its display name. */
export function namedTemplate(template: MapTemplate, name: string): MapTemplate {
  return template.name.en === name && Object.keys(template.name).length === 1 ? template : { ...template, name: { en: name } };
}

function readEntries(): PlanetEntry[] {
  let parsed: Partial<StoredLibrary> | null;
  try { parsed = jsonPref('customPlanets', jsonObject, decodeRecord) as Partial<StoredLibrary> | null; } catch (err) {
    if (!isInputRefusal(err)) console.error('[planet-library] read failed', err);
    return [];
  }
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return [];
  const out: PlanetEntry[] = [];
  for (const e of parsed.entries as Partial<StoredEntry>[]) {
    if (!e || typeof e.entryId !== 'string' || typeof e.name !== 'string') continue;
    let template: MapTemplate;
    try { template = namedTemplate(parseTemplate(e.template), e.name); } catch (err) {
      if (!isInputRefusal(err)) console.error('[planet-library] entry read failed', err);
      continue;
    }
    const createdAt = Number.isFinite(e.createdAt) ? e.createdAt! : 0;
    const rimSand = rimSandFor(template, e.rimSand);
    out.push({
      entryId: e.entryId, name: e.name, nameReviewed: e.nameReviewed === true, template, createdAt,
      updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt! : createdAt,
      ...(rimSand ? { rimSand } : {}),
    });
  }
  return out;
}

function announce(): void {
  version++;
  changed.emit();
}

function writeEntries(entries: readonly PlanetEntry[]): boolean {
  cached = null;
  const record: StoredLibrary = {
    v: 1,
    entries: entries.map((e) => ({
      entryId: e.entryId, name: e.name, nameReviewed: e.nameReviewed, template: serializeTemplate(e.template), createdAt: e.createdAt, updatedAt: e.updatedAt,
      ...(e.rimSand ? { rimSand: [...e.rimSand] } : {}),
    })),
  };
  if (!writeJsonPref('customPlanets', record, encodeRecord)) return false;
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

/** The library entry that names a map's planet (`state/planet-name-verdict.ts:planetEntryAmong`). */
export function planetEntryFor(template: MapTemplate): PlanetEntry | null {
  return planetEntryAmong(listPlanets(), template);
}

interface SavePlanetOptions {
  /** The entry whose planet and name this save replaces, when it exists. */
  replaceEntryId?: string;
  /** False for a name that came from outside and has not passed the text check. Default true. */
  nameReviewed?: boolean;
  /** The sand under the planet's rim; without it the entry reads the rim's ground from the neighbouring sand. */
  rimSand?: readonly number[];
}

/** Adds a planet, or replaces the planet, name and rim sand of `replaceEntryId` when that entry exists. */
export function savePlanet(name: string, planet: MapTemplate, options: SavePlanetOptions = {}): SavePlanetResult {
  return saveAmong(listPlanets(), name, planet, options);
}

/** `savePlanet` over `entries`, the library as its caller just read it. */
function saveAmong(entries: readonly PlanetEntry[], name: string, planet: MapTemplate, options: SavePlanetOptions): SavePlanetResult {
  const { replaceEntryId, nameReviewed = true, rimSand } = options;
  const template = namedTemplate(planet, name);
  const now = Date.now();
  const at = replaceEntryId === undefined ? -1 : entries.findIndex((e) => e.entryId === replaceEntryId);
  const prior = at >= 0 ? entries[at]! : null;
  const entry: PlanetEntry = {
    entryId: prior?.entryId ?? newEntryId(), name, nameReviewed, template, createdAt: prior?.createdAt ?? now, updatedAt: now,
    ...(rimSand ? { rimSand } : {}),
  };
  const next = at >= 0 ? entries.map((e, i) => (i === at ? entry : e)) : [...entries, entry];
  return writeEntries(next) ? { ok: true, entry } : { ok: false, reason: 'quota' };
}

/** `entries` with the entry `entryId` replaced by what `change` makes of it, or null when no entry
 *  is `entryId` or `change` declines it. */
function withEntry(entries: readonly PlanetEntry[], entryId: string, change: (entry: PlanetEntry) => PlanetEntry | null): PlanetEntry[] | null {
  const at = entries.findIndex((x) => x.entryId === entryId);
  const changed = at >= 0 ? change(entries[at]!) : null;
  return changed ? entries.map((e, i) => (i === at ? changed : e)) : null;
}

/**
 * The library entry for this planet, adding one when absent with its name unreviewed. A failed
 * write still returns the unsaved entry.
 */
export function adoptPlanet(template: MapTemplate, name?: string): PlanetEntry {
  const entries = listPlanets();
  const existing = entries.find((e) => e.template.id === template.id);
  if (existing) return existing;
  const saved = saveAmong(entries, name ?? template.name.en ?? '', template, { nameReviewed: false });
  if (saved.ok) return saved.entry;
  const now = Date.now();
  const unsaved = name ?? template.name.en ?? '';
  return { entryId: newEntryId(), name: unsaved, nameReviewed: false, template: namedTemplate(template, unsaved), createdAt: now, updatedAt: now };
}

/** The one adoption rule: a map that was just installed on a custom planet puts that planet in the library. */
export function adoptInstalledPlanet(state: Pick<GridState, 'template'>): void {
  if (isCustomTemplate(state.template)) adoptPlanet(state.template);
}

export function renamePlanet(entryId: string, name: string): boolean {
  const next = withEntry(listPlanets(), entryId, (e) => ({ ...e, name, nameReviewed: true, template: namedTemplate(e.template, name), updatedAt: Date.now() }));
  return next !== null && writeEntries(next);
}

/**
 * Records the text check of an unreviewed name: approved when `replacement` is null, otherwise the
 * entry takes `replacement` for good. Nothing changes when the entry's name is no longer `checked`.
 */
export function settlePlanetName(entryId: string, checked: string, replacement: string | null): boolean {
  const next = withEntry(listPlanets(), entryId, (e) => {
    if (e.nameReviewed || e.name !== checked) return null;
    if (replacement === null) return { ...e, nameReviewed: true };
    return { ...e, nameReviewed: true, name: replacement, template: namedTemplate(e.template, replacement) };
  });
  return next !== null && writeEntries(next);
}

export function duplicatePlanet(entryId: string, name: string): PlanetEntry | null {
  const entries = listPlanets();
  const source = entries.find((x) => x.entryId === entryId);
  if (!source) return null;
  const saved = saveAmong(entries, name, source.template, source.rimSand ? { rimSand: source.rimSand } : {});
  return saved.ok ? saved.entry : null;
}

export function removePlanet(entryId: string): boolean {
  const entries = listPlanets();
  const kept = entries.filter((x) => x.entryId !== entryId);
  if (kept.length === entries.length) return false;
  return writeEntries(kept);
}
