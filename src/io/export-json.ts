/**
 * Section assembly for the "keep everything" JSON export.
 *
 * `serializeWithSections` wraps the plain json-codec `serialize` output with the
 * user-chosen OPTIONAL top-level sections (notes / generation / history / session /
 * stats / catalogInfo) plus an always-on `manifest`. All sections are additive —
 * today's loader ignores unknown keys, so the output stays loadable by every build.
 *
 * Pure module: it must NOT import the store — history entries are passed in by the
 * caller (CommandExecutor.getUndoEntries()), session/camera come pre-built.
 */

import type { GridState, MapNotes } from '../core/model/types';
import type { HistoryEntry } from '../core/commands/command-apply';
import { ELEVATION_MAX } from '../core/model/constants';
import { buildSaveFile } from './json-codec';
import { encodeHistory } from './history-codec';
import { getCatalogItem } from '../state/catalog';
import { templateHash, catalogHash } from './share/canonical';
import { crc32 } from './share/crypto/crc32';
import { APP_VERSION } from '../version';
import { CURRENT_VERSION, type SaveFile } from './save-format';

export type { MapNotes };

export interface SessionSection {
  v: 1;
  lockedLayers: number[];
  camera?: { x: number; y: number; zoom: number };
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
  /** Tamper-check code over the whole file minus this field (see integrityOf). Written last by
   *  serializeWithSections; absent on hand-made / legacy files. Not a security seal — a CRC that
   *  flags accidental or manual edits so import can warn. */
  integrity?: string;
}

export interface ExportJsonOptions {
  /** Notes section. undefined → keep whatever plain serialize wrote (state.notes);
   *  null → force NO notes section; object → override. Pure — never written back to state. */
  notes?: MapNotes | null;
  /** Defaults to true; false omits the complete planning-annotation layer. */
  includeAnnotations?: boolean;
  includeGeneration: boolean;
  /** false → strip provenance from the output even though serialize embeds it. */
  includeProvenance: boolean;
  history?: { entries: HistoryEntry[]; depth: 'all' | number } | null;
  session?: SessionSection | null;
  includeStats: boolean;
  includeCatalogInfo: boolean;
  pretty: boolean;
}

export interface SectionSizes {
  core: number;
  annotations: number;
  notes: number;
  generation: number;
  provenance: number;
  history: number;
  session: number;
  stats: number;
  catalogInfo: number;
  manifest: number;
  total: number;
}

/* ── Section builders ────────────────────────────────────── */

/** TerrainType (None/Mountain/Water) → the stats vocabulary. `None` reads as 'ground'. Single
 *  source for both the tally keys and the per-cell name lookup below. */
const TYPE_NAMES: Record<number, string> = { 0: 'ground', 1: 'mountain', 2: 'water' };

/** Derived map statistics (never imported). Cells with no terrain count as 'ground'
 *  at elevation 0; locked structures (the plaza) are excluded like in serialize. */
export function buildStats(state: GridState): StatsSection {
  const byType: Record<string, number> = {};
  for (const name of Object.values(TYPE_NAMES)) byType[name] = 0;
  const byElevation: number[] = Array.from({ length: ELEVATION_MAX + 1 }, () => 0);
  const { width, height } = state.template;
  for (let y = 0; y < height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const t = row[x]?.terrain ?? null;
      const name = t ? (TYPE_NAMES[t.type] ?? 'ground') : 'ground';
      byType[name] = (byType[name] ?? 0) + 1;
      const e = t ? Math.min(Math.max(t.elevation, 0), ELEVATION_MAX) : 0;
      byElevation[e] = (byElevation[e] ?? 0) + 1;
    }
  }

  const byCategory: Record<string, number> = {};
  let total = 0;
  let load = 0;
  for (const obj of state.objects.values()) {
    if (obj.locked) continue;
    total++;
    const item = getCatalogItem(obj.catalogId);
    const cat = item?.category ?? 'unknown';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    load += item?.loadValue ?? 0;
  }

  return { cells: { byType, byElevation }, objects: { total, byCategory }, load: { total: load } };
}

/** Self-describing reference for only the catalog ids actually used on the map. */
export function buildCatalogInfo(state: GridState): Record<string, CatalogInfoEntry> {
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
export function buildManifest(state: GridState): ManifestSection {
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
  return !!n && !!(n.title || n.description || n.author);
}

/** Builds the sectioned save object (shared by serializeWithSections + sectionSizes). */
function assemble(state: GridState, opts: ExportJsonOptions): SaveFile {
  const out = buildSaveFile(state);

  if (opts.includeAnnotations === false) delete out.annotations;
  if (!opts.includeProvenance) delete out.provenance;

  // notes: undefined → keep serialize's (state.notes); null → drop; object → override.
  if (opts.notes === null) delete out.notes;
  else if (opts.notes !== undefined) {
    if (hasNotes(opts.notes)) out.notes = opts.notes;
    else delete out.notes;
  }

  if (opts.includeGeneration && state.generation) out.generation = state.generation;
  if (opts.history) {
    // History taint deltas require provenance; ordinary undo entries remain valid without them.
    const entries = opts.includeProvenance
      ? opts.history.entries
      : opts.history.entries.map((e) => ({ ...e, taint: undefined }));
    out.history = encodeHistory(entries, opts.history.depth);
  }
  if (opts.session) out.session = opts.session;
  if (opts.includeStats) out.stats = buildStats(state);
  if (opts.includeCatalogInfo) out.catalogInfo = buildCatalogInfo(state);
  out.manifest = buildManifest(state);

  return out;
}

const enc = new TextEncoder();

/** 8-hex-digit CRC-32 over a value's compact JSON. Format-independent (whitespace/pretty-print
 *  never enter it) so it survives re-formatting but changes on any content edit. */
function crcHex(v: unknown): string {
  return (crc32(enc.encode(JSON.stringify(v))) >>> 0).toString(16).padStart(8, '0');
}

/** The integrity code stamped into manifest.integrity: a CRC over the assembled object BEFORE the
 *  code itself is added (so import can recompute it by removing the field). */
function integrityOf(objWithoutIntegrity: SaveFile): string {
  return crcHex(objWithoutIntegrity);
}

export function serializeWithSections(state: GridState, opts: ExportJsonOptions): string {
  const obj = assemble(state, opts);
  // Stamp the integrity code LAST, over the content minus the code, so a manual edit anywhere
  // (a cell, an object, a section, even the manifest) makes import's recomputed code mismatch.
  // assemble always sets manifest; it is typed loosely on SaveFile, so narrow it here.
  const manifest = obj.manifest as ManifestSection | undefined;
  if (manifest) manifest.integrity = integrityOf(obj);
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

/**
 * Bytes of each section's JSON, for the export modal's size chips. Each optional
 * section is measured alone (its marginal cost); `core` is the plain serialize
 * output with provenance measured separately (so the provenance row owns its own
 * chip). `total` is the byte length of the REAL serializeWithSections output — not
 * the sum — so pretty-format overhead is reported honestly.
 *
 * `sizeOpts.withTotal === false` SKIPS the full-file re-serialization behind `total`
 * (returning total: 0). The modal uses this: for a large history the full serialize is
 * the expensive step, so the modal computes per-section sizes ONCE and derives the live
 * total by summing the toggled sections — no re-serialize per toggle.
 */
function sectionValues(state: GridState, opts: ExportJsonOptions): Record<Exclude<keyof SectionSizes, 'total'>, unknown> {
  const plain = buildSaveFile(state);
  const provenance = plain.provenance;
  delete plain.provenance;
  const coreNotes = plain.notes;
  delete plain.notes;
  const annotations = plain.annotations;
  delete plain.annotations;
  const notes = opts.notes === null ? undefined : opts.notes !== undefined
    ? (hasNotes(opts.notes) ? opts.notes : undefined) : coreNotes;
  return {
    core: plain,
    annotations: opts.includeAnnotations === false ? undefined : annotations,
    notes,
    generation: opts.includeGeneration ? state.generation : undefined,
    provenance: opts.includeProvenance ? provenance : undefined,
    history: opts.history ? encodeHistory(opts.history.entries, opts.history.depth) : undefined,
    session: opts.session ?? undefined,
    stats: opts.includeStats ? buildStats(state) : undefined,
    catalogInfo: opts.includeCatalogInfo ? buildCatalogInfo(state) : undefined,
    manifest: buildManifest(state),
  };
}

function measureSections(values: ReturnType<typeof sectionValues>, pretty: boolean): SectionSizes {
  const sizes = { total: 0 } as SectionSizes;
  for (const key of Object.keys(values) as (keyof typeof values)[]) sizes[key] = byteLen(values[key], pretty);
  return sizes;
}

/** Both display formats share one snapshot of the map, history and optional sections. */
export function sectionSizeFormats(state: GridState, opts: ExportJsonOptions): { compact: SectionSizes; pretty: SectionSizes } {
  const values = sectionValues(state, opts);
  return { compact: measureSections(values, false), pretty: measureSections(values, true) };
}

export function sectionSizes(state: GridState, opts: ExportJsonOptions, sizeOpts?: { withTotal?: boolean; pretty?: boolean }): SectionSizes {
  const sizes = measureSections(sectionValues(state, opts), sizeOpts?.pretty ?? false);
  if (sizeOpts?.withTotal !== false) sizes.total = enc.encode(serializeWithSections(state, opts)).length;
  return sizes;
}
