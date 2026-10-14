/** Assembles additive JSON sections from explicit map, history and session inputs. Older readers ignore unknown sections. */

import { attributedNotes } from '../../state/notes-attribution';
import { TerrainType, type GridState, type MapNotes } from '../../core/model/types';
import type { HistoryEntry } from '../../core/commands/command-apply';
import { buildSaveFile } from './json-codec';
import { encodeHistory } from './history-codec';
import { getCatalogItem } from '../../state/catalog';
import { getMapStats, placedLoad } from '../../state/map-stats';
import { templateHash, catalogHash } from './canonical';
import { crc32 } from '../../core/base/crc32';
import { APP_VERSION } from '../../platform/build/build-info';
import { CURRENT_VERSION, type PersistedCamera, type SaveFile } from './format';
import { roundLoad } from '../../core/model/load';
import type { ExportableState } from './exportable-state';

export type { MapNotes };

/** The map data a section cannot be written without. */
export type SectionNeed = 'generation' | 'provenance';

interface SectionSpec {
  /** The export's choice. */
  readonly key: string;
  /** The save-file fields it writes; the section's size is theirs. */
  readonly fields: readonly (keyof SaveFile)[];
  readonly needs?: SectionNeed;
  /** Whether a new export carries it (a section with `needs`, when the map has that data). */
  readonly byDefault?: true;
  /** Writes or removes the section's fields on the file `buildSaveFile` began. */
  readonly write: (file: SaveFile, state: GridState, opts: ExportJsonOptions) => void;
}

/**
 * The optional sections of a sectioned export, in the order the file writes them. Every other
 * field is the core, which travels with the manifest whatever is chosen. The export's options, the
 * size of each section and the window's estimate all read this table.
 */
export const SECTIONS = [
  { key: 'annotations', fields: ['annotations'], byDefault: true, write: (file, _state, opts) => { if (!opts.carry.annotations) delete file.annotations; } },
  // Attributed notes travel whatever is chosen.
  { key: 'notes', fields: ['notes'], write: (file, state, opts) => { file.notes = attributedNotes(state, chosenNotes(opts, file.notes)); } },
  { key: 'generation', fields: ['generation'], needs: 'generation', write: (file, state, opts) => { if (opts.carry.generation && state.generation) file.generation = state.generation; } },
  { key: 'provenance', fields: ['provenance'], needs: 'provenance', write: (file, _state, opts) => { if (!opts.carry.provenance) delete file.provenance; } },
  { key: 'history', fields: ['history'], write: (file, _state, opts) => { const history = historySection(opts); if (history) file.history = history; } },
  // The camera is begun with the file, where autosave writes it too (`save/camera.ts`).
  { key: 'session', fields: ['session', 'camera'], write: (file, _state, opts) => {
    if (opts.carry.session && opts.session) file.session = { v: 1, lockedLayers: [...opts.session.lockedLayers] } satisfies SessionSection;
  } },
  { key: 'stats', fields: ['stats'], write: (file, state, opts) => { if (opts.carry.stats) file.stats = buildStats(state); } },
  { key: 'catalog', fields: ['catalogInfo'], write: (file, state, opts) => { if (opts.carry.catalog) file.catalogInfo = buildCatalogInfo(state); } },
] as const satisfies readonly SectionSpec[];

export type SectionKey = (typeof SECTIONS)[number]['key'];

/** A carry record with exactly `keys` on. */
export function carrying(...keys: SectionKey[]): Record<SectionKey, boolean> {
  return Object.fromEntries(SECTIONS.map(({ key }) => [key, keys.includes(key)])) as Record<SectionKey, boolean>;
}

/** The session section's wire shape. Files written before the camera moved to `camera` carry a 2D
 *  `camera: { x, y, zoom }` here too, which import still reads. */
export interface SessionSection {
  v: 1;
  lockedLayers: number[];
}

export interface StatsSection {
  cells: { byType: Record<string, number>; byElevation: number[] };
  objects: { total: number; byCategory: Record<string, number> };
  load: { total: number };
}

export interface CatalogInfoEntry {
  name: string;
  w: number;
  h: number;
  category: string;
  loadValue: number;
}

export interface ManifestSection {
  appVersion: string;
  saveVersion: number;
  templateHash: number;
  catalogHash: number;
  exportedAt: string;
  /** CRC of the file excluding this field. Detects edits but cannot authenticate or recover content. */
  integrity?: string;
}

export interface ExportJsonOptions {
  /** The optional sections the file carries; one the map has no data for is left out. */
  carry: Readonly<Record<SectionKey, boolean>>;
  /** The title and description written when notes are carried; the map's own when absent. Pure:
   *  never written back to the map. */
  notes?: MapNotes;
  /** The undo entries written when history is carried. */
  history?: { entries: HistoryEntry[]; depth: 'all' | number };
  /** The locked layers and camera poses written when the session is carried. */
  session?: { lockedLayers: Iterable<number>; camera?: PersistedCamera };
  pretty: boolean;
}

/** Each section's size in bytes, the core's and the manifest's. */
export type SectionSizes = Record<'core' | SectionKey | 'manifest', number>;

/* ── Section builders ────────────────────────────────────── */

/** Each terrain type's name in the statistics section. */
const TYPE_NAMES: Record<TerrainType, string> = { [TerrainType.None]: 'ground', [TerrainType.Mountain]: 'mountain', [TerrainType.Water]: 'water' };

/** Derived map statistics (never imported). Cells with no terrain count as 'ground'
 *  at elevation 0; locked structures (the plaza) are excluded like in serialize. */
function buildStats(state: GridState): StatsSection {
  const stats = getMapStats(state);
  const byType: Record<string, number> = {};
  for (const [type, name] of Object.entries(TYPE_NAMES)) byType[name] = stats.cellsByTerrain[Number(type) as TerrainType];
  const byElevation = [...stats.cellsAtElevation];

  const byCategory: Record<string, number> = {};
  let total = 0;
  let load = 0;
  for (const obj of state.objects.values()) {
    if (obj.locked) continue;
    total++;
    const item = getCatalogItem(obj.catalogId);
    const cat = item?.category ?? 'unknown';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    load = roundLoad(load + placedLoad(obj));
  }

  return { cells: { byType, byElevation }, objects: { total, byCategory }, load: { total: load } };
}

/** Self-describing reference for only the catalog ids actually used on the map. */
function buildCatalogInfo(state: GridState): Record<string, CatalogInfoEntry> {
  const info: Record<string, CatalogInfoEntry> = {};
  for (const obj of state.objects.values()) {
    if (obj.locked || info[obj.catalogId]) continue;
    const item = getCatalogItem(obj.catalogId);
    if (!item) continue;
    info[obj.catalogId] = {
      name: item.name.en,
      w: item.width,
      h: item.height,
      category: item.category,
      loadValue: item.loadValue,
    };
  }
  return info;
}

/** Diagnostics-only manifest (always written by serializeWithSections). */
function buildManifest(state: GridState): ManifestSection {
  return {
    appVersion: APP_VERSION,
    saveVersion: CURRENT_VERSION,
    templateHash: templateHash(state.template),
    catalogHash: catalogHash(),
    exportedAt: new Date().toISOString(),
  };
}

/* ── Assembly ────────────────────────────────────────────── */

function hasNotes(n: MapNotes | undefined | null): n is MapNotes {
  return !!n && !!(n.title || n.description);
}

/** The notes an export carries before attribution: none unless carried, the given ones when there
 *  are some, otherwise the map's own. */
function chosenNotes(opts: ExportJsonOptions, own: MapNotes | undefined): MapNotes | null {
  if (!opts.carry.notes) return null;
  if (opts.notes !== undefined) return hasNotes(opts.notes) ? opts.notes : null;
  return own ?? null;
}

/** The history section an export carries. Taint deltas require provenance; ordinary undo entries
 *  remain valid without them. */
function historySection(opts: ExportJsonOptions): ReturnType<typeof encodeHistory> | undefined {
  if (!opts.carry.history || !opts.history) return undefined;
  const entries = opts.carry.provenance
    ? opts.history.entries
    : opts.history.entries.map((e) => ({ ...e, taint: undefined }));
  return encodeHistory(entries, opts.history.depth);
}

/** The sectioned save object: the one decision of which sections an export carries, which the
 *  serializer writes and the size estimate measures. */
function assemble(state: GridState, opts: ExportJsonOptions): SaveFile {
  const out = buildSaveFile(state, opts.carry.session ? opts.session?.camera : undefined);
  for (const section of SECTIONS) section.write(out, state, opts);
  out.manifest = buildManifest(state);
  return out;
}

const enc = new TextEncoder();

/** 8-hex-digit CRC-32 over a value's compact JSON. Format-independent (whitespace/pretty-print
 *  never enter it) so it survives re-formatting but changes on any content edit. */
function crcHex(v: unknown): string {
  return (crc32(enc.encode(JSON.stringify(v))) >>> 0).toString(16).padStart(8, '0');
}

export function serializeWithSections(state: ExportableState, opts: ExportJsonOptions): string {
  const obj = assemble(state, opts);
  // The checksum covers every field except itself.
  const manifest = obj.manifest as ManifestSection | undefined;
  if (manifest) manifest.integrity = crcHex(obj);
  return JSON.stringify(obj, null, opts.pretty ? 2 : undefined);
}

/** Verify a parsed export's integrity code. 'absent' = no code to check (hand-made / legacy /
 *  a plain autosave) — do not warn; 'modified' = the file was edited after export; 'ok' = intact. */
export function verifyIntegrity(parsed: unknown): 'ok' | 'modified' | 'absent' {
  if (!parsed || typeof parsed !== 'object') return 'absent';
  const stored = (parsed as { manifest?: { integrity?: unknown } }).manifest?.integrity;
  if (typeof stored !== 'string') return 'absent';
  // Copy only the containers whose keys change; nested values retain their serialized ordering.
  const source = parsed as { manifest: Record<string, unknown> };
  const clone = { ...source, manifest: { ...source.manifest } };
  delete clone.manifest.integrity;
  return crcHex(clone) === stored ? 'ok' : 'modified';
}

/* ── Size estimation ─────────────────────────────────────── */

function byteLen(v: unknown, pretty = false): number {
  return v === undefined ? 0 : enc.encode(JSON.stringify(v, null, pretty ? 2 : undefined)).length;
}

/** The assembled export split into its core, each section's fields and the manifest; the UI sums
 *  their sizes to avoid serializing large histories on each toggle. */
function sectionValues(state: GridState, opts: ExportJsonOptions): Record<keyof SectionSizes, unknown[]> {
  const core: Partial<SaveFile> = assemble(state, opts);
  const values = {} as Record<keyof SectionSizes, unknown[]>;
  for (const { key, fields } of SECTIONS) {
    values[key] = fields.map((field) => core[field]);
    for (const field of fields) delete core[field];
  }
  values.manifest = [core.manifest];
  delete core.manifest;
  values.core = [core];
  return values;
}

function measureSections(values: ReturnType<typeof sectionValues>, pretty: boolean): SectionSizes {
  const sizes = {} as SectionSizes;
  for (const key of Object.keys(values) as (keyof typeof values)[]) sizes[key] = values[key].reduce<number>((sum, v) => sum + byteLen(v, pretty), 0);
  return sizes;
}

/** Both display formats share one snapshot of the map, history and optional sections. */
export function sectionSizeFormats(state: ExportableState, opts: ExportJsonOptions): { compact: SectionSizes; pretty: SectionSizes } {
  const values = sectionValues(state, opts);
  return { compact: measureSections(values, false), pretty: measureSections(values, true) };
}
