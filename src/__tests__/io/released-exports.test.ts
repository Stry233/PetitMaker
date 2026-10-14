/**
 * Every export a released version could write imports into the current version.
 *
 * `fixtures/compat/<release>/` holds maps that release built with its own code and exported through
 * its own paths (JSON with every section, minimal JSON, the share-code payload, glyph images and
 * the autosave record), with the digest that release itself read back from each one. Each export
 * enters through the entry point the app uses for it, and must load without an unexpected warning,
 * match the release's own reading except for the documented migrations its manifest names, replay
 * its imported undo history to a legal map and back, and re-export to the same bytes.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectImportFile, type ImportWarning } from '../../io/import/file';
import { getImportFileDeps } from '../../editor/session/import-deps';
import { importFromBytes, importFromRaster } from '../../io/share';
import { encodeGlyph } from '../../io/share/glyph/encode';
import { moduleBaseFor } from '../../io/share/glyph/geometry';
import { serialize } from '../../io/save/json-codec';
import { carrying, serializeWithSections } from '../../io/save/sections';
import type { PersistedCamera } from '../../io/save/format';
import { exportableState } from '../../io/export/exportable';
import { planetNaming } from '../../editor/session/planet-names';
import { readRestorableAutosave } from '../../io/storage/autosave';
import { PREFS } from '../../platform/storage/prefs';
import { createDefaultRegistry } from '../../rules';
import { useEditorStore } from '../../state/store';
import type { GridState } from '../../core/model/types';
import { readPlanetFile } from '../../io/save/planet-codec';
import { isCustomTemplate } from '../../core/model/planet';
import { digestPlanet, digestSave, type MapDigest } from '../_support/compat-digest';

vi.setConfig({ testTimeout: 300_000 });

const ROOT = join(__dirname, '..', 'fixtures', 'compat');

/** The reasons a released export may legitimately read differently today. Each manifest entry that
 *  departs from the release's own reading names one or more of these. */
const MIGRATIONS = JSON.parse(readFileSync(join(ROOT, 'migrations.json'), 'utf8')) as Record<string, string>;

type Part = keyof Omit<MapDigest, 'counts'>;
const PARTS: Part[] = ['cells', 'objects', 'annotations', 'notes'];

interface Reading {
  status: string;
  /** Planet files: the planet's name and the digest of its ground. */
  name?: string;
  planet?: string;
  warnings?: unknown[];
  digest?: MapDigest;
  undoDepth?: number;
  history?: number;
}

interface ExportEntry {
  file?: string;
  payload?: string;
  reference: Reading;
  /** The documented migrations this export goes through, and what it reads as afterwards. */
  current?: { migrations: string[]; digest?: Partial<Record<Part, string>>; undoDepth?: number; history?: number; warnings?: string[] };
}

interface Manifest {
  release: string;
  covers: string[];
  cases: { id: string; exports: Record<string, ExportEntry> }[];
}

const releases = existsSync(ROOT) ? readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'manifest.json'))).sort() : [];

/** What the current build read from one export. */
interface Observed {
  status: string;
  warnings: string[];
  digest?: MapDigest;
  undoDepth?: number;
  history?: number;
  /** Rule violations after undoing the whole imported history, and after redoing it. */
  undoneViolations?: string[];
  redoneViolations?: string[];
  roundTrip?: boolean;
  roundTripDiff?: string;
  name?: string;
  planet?: string;
}

const observedLog: Record<string, Record<string, Observed>> = {};

const warningText = (w: ImportWarning | string) => (typeof w === 'string' ? w : w.kind);
const ruleIds = (state: GridState) => [...new Set(createDefaultRegistry().validatePostStroke(state).map((v) => v.ruleId))].sort();

async function digestOf(state: GridState): Promise<MapDigest> {
  return digestSave(JSON.parse(serialize(state)) as Record<string, unknown>);
}

/** A custom planet's name and ground as a map carries it, to set beside its planet file. */
async function planetOf(state: GridState): Promise<Pick<Observed, 'name' | 'planet'>> {
  if (!isCustomTemplate(state.template)) return {};
  return { name: state.template.name.en ?? '', planet: await digestPlanet(state.template) };
}

/** The current "keep everything" JSON export of the live map, with the same time each call. */
function exportLive(camera: PersistedCamera | undefined): string {
  const { gridState, commandExecutor } = useEditorStore.getState();
  return serializeWithSections(exportableState(gridState!, planetNaming('en')), {
    carry: { ...carrying('annotations', 'notes', 'provenance', 'history', 'session', 'stats', 'catalog'), generation: !!gridState!.generation },
    ...(gridState!.notes ? { notes: gridState!.notes } : {}),
    history: { entries: commandExecutor!.getUndoEntries(), depth: 'all' },
    session: { lockedLayers: [...gridState!.lockedLayers].sort(), ...(camera ? { camera } : {}) },
    pretty: false,
  });
}

/** Imports a JSON file through the app's import path and installs it with the app's dependencies. */
async function installJson(text: string): Promise<{ observed: Observed; camera?: PersistedCamera }> {
  const inspection = await inspectImportFile(new Blob([text], { type: 'application/json' }), 'map.json');
  if (inspection.status !== 'ready') return { observed: { status: inspection.status, warnings: [] } };
  let camera: PersistedCamera | undefined;
  const deps = getImportFileDeps();
  const outcome = inspection.commit({
    ...deps,
    getSectionDeps: () => ({ ...deps.getSectionDeps(), setCamera: (c) => { camera = c; } }),
  });
  if (outcome.status !== 'imported') return { observed: { status: outcome.status, warnings: [] } };
  const { gridState, commandExecutor } = useEditorStore.getState();
  return {
    observed: {
      status: 'imported',
      warnings: [...inspection.preview.warnings, ...outcome.warnings].map(warningText),
      digest: await digestOf(gridState!),
      ...await planetOf(gridState!),
      undoDepth: commandExecutor!.historyDepth(),
    },
    camera,
  };
}

/** Undo the whole imported history and redo it, checking the map is legal at both ends and comes
 *  back to the state it was imported as. */
async function replayHistory(observed: Observed): Promise<void> {
  const { gridState, commandExecutor } = useEditorStore.getState();
  const ex = commandExecutor!;
  const depth = ex.historyDepth();
  if (depth === 0) return;
  for (let i = 0; i < depth; i++) ex.undo();
  observed.undoneViolations = ruleIds(gridState!);
  for (let i = 0; i < depth; i++) ex.redo();
  observed.redoneViolations = ruleIds(gridState!);
  const back = await digestOf(gridState!);
  expect.soft(back, 'redoing the imported history restores the imported map').toEqual(observed.digest);
}

async function readJson(text: string): Promise<Observed> {
  const { observed, camera } = await installJson(text);
  if (observed.status !== 'imported') return observed;
  const before = ruleIds(useEditorStore.getState().gridState!);
  await replayHistory(observed);
  // The map's own legality is the release's; replaying its history must not add violations.
  for (const v of [...(observed.undoneViolations ?? []), ...(observed.redoneViolations ?? [])]) {
    expect.soft(before, `rule ${v} appears only after replaying the imported history`).toContain(v);
  }
  // Re-export in the current format, import that, and export again: the bytes must not move.
  const first = exportLive(camera);
  const again = await installJson(first);
  expect.soft(again.observed.status).toBe('imported');
  const second = exportLive(again.camera);
  observed.roundTrip = second === first;
  if (!observed.roundTrip) {
    let at = 0;
    while (at < first.length && first[at] === second[at]) at++;
    observed.roundTripDiff = `${first.slice(Math.max(0, at - 80), at + 80)} <> ${second.slice(Math.max(0, at - 80), at + 80)}`;
  }
  return observed;
}

async function readShare(payloadB64: string): Promise<Observed> {
  const payload = Uint8Array.from(Buffer.from(payloadB64, 'base64'));
  const glyph = encodeGlyph(payload, moduleBaseFor(1600)!);
  if (!glyph) return { status: 'too-dense', warnings: [] };
  const result = await importFromRaster(glyph.rgba, glyph.width, glyph.height);
  if (!result.ok) return { status: 'failed', warnings: [result.error.code] };
  const warnings: string[] = result.warnings.map((w) => w.kind);
  if (result.cleared && result.cleared.objects + result.cleared.cells > 0) warnings.push('landmark-cleared');
  return { status: 'imported', warnings, digest: await digestOf(result.state), ...await planetOf(result.state) };
}

async function readPng(bytes: Uint8Array): Promise<Observed> {
  const result = await importFromBytes(bytes);
  if (!result.ok) return { status: 'failed', warnings: [result.error.code] };
  const warnings: string[] = result.warnings.map((w) => w.kind);
  if (result.cleared && result.cleared.objects + result.cleared.cells > 0) warnings.push('landmark-cleared');
  return { status: 'imported', warnings, digest: await digestOf(result.state), ...await planetOf(result.state) };
}

async function readAutosaveRecord(record: { map: string; history?: string | null }): Promise<Observed> {
  localStorage.removeItem(PREFS.autosave.key);
  localStorage.removeItem(PREFS.autosaveHistory.key);
  localStorage.setItem(PREFS.autosave.key, record.map);
  if (record.history) localStorage.setItem(PREFS.autosaveHistory.key, record.history);
  const restored = readRestorableAutosave();
  if (!restored) return { status: 'failed', warnings: [] };
  const warnings = restored.cleared && restored.cleared.objects + restored.cleared.cells > 0 ? ['landmark-cleared'] : [];
  return { status: 'imported', warnings, digest: await digestOf(restored.state), ...await planetOf(restored.state), history: restored.history?.length ?? 0 };
}

async function observe(dir: string, kind: string, entry: ExportEntry): Promise<Observed> {
  if (kind === 'share') return readShare(entry.payload!);
  const bytes = readFileSync(join(dir, entry.file!));
  if (kind === 'png') return readPng(new Uint8Array(bytes));
  const text = gunzipSync(bytes).toString('utf8');
  if (kind === 'planet') {
    const read = readPlanetFile(text);
    return { status: 'imported', warnings: [], name: read.name, planet: await digestPlanet(read.template) };
  }
  if (kind === 'autosave') return readAutosaveRecord(JSON.parse(text) as { map: string; history?: string | null });
  return readJson(text);
}

/** The digest parts that differ from the release's own reading. */
function departures(observed: Observed, reference: Reading): Part[] {
  if (!observed.digest || !reference.digest) return [];
  return PARTS.filter((p) => observed.digest![p] !== reference.digest![p]);
}

beforeEach(() => {
  localStorage.clear();
  // Exports stamp the time they were written; a still clock lets two exports compare byte for byte.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-11T00:00:00.000Z'));
});

afterAll(() => {
  const out = process.env.PETIT_COMPAT_OBSERVE;
  if (out) writeFileSync(out, JSON.stringify(observedLog, null, 1));
});

describe.each(releases)('exports from release %s', (release) => {
  const dir = join(ROOT, release);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;

  it.each(manifest.cases.map((c) => [c.id, c] as const))('%s imports as the release read it', async (_id, entry) => {
    const readings: [string, ExportEntry, Observed][] = [];
    for (const [kind, exp] of Object.entries(entry.exports)) {
      if (exp.reference.status !== 'imported') continue;
      const observed = await observe(dir, kind, exp);
      (observedLog[`${release}/${entry.id}`] ??= {})[kind] = observed;
      readings.push([kind, exp, observed]);
    }
    if (process.env.PETIT_COMPAT_OBSERVE) return;
    for (const [kind, exp, observed] of readings) {
      const label = `${release} ${entry.id} ${kind}`;
      const migrations = exp.current?.migrations ?? [];
      for (const id of migrations) expect(MIGRATIONS, `${label}: migration ${id} is documented`).toHaveProperty(id);

      expect(observed.status, label).toBe('imported');
      expect(observed.warnings, `${label}: warnings`).toEqual(exp.current?.warnings ?? []);
      const moved = departures(observed, exp.reference);
      if (migrations.length === 0) {
        expect(moved, `${label}: reads as the release read it`).toEqual([]);
      } else {
        for (const part of moved) expect(observed.digest![part], `${label}: ${part} after ${migrations.join(', ')}`).toBe(exp.current!.digest?.[part]);
      }
      if (kind === 'json-full' || kind === 'json-min') {
        expect(observed.undoDepth, `${label}: undo depth`).toBe(exp.current?.undoDepth ?? exp.reference.undoDepth);
        expect(observed.roundTrip, `${label}: re-export round-trips byte for byte`).toBe(true);
      }
      // A custom planet reads with the name and ground its own planet file carries, on every path.
      const planetFile = entry.exports.planet?.reference;
      if (planetFile) expect({ name: observed.name, planet: observed.planet }, `${label}: planet`).toEqual({ name: planetFile.name, planet: planetFile.planet });
      if (kind === 'autosave') expect(observed.history, `${label}: autosave history`).toBe(exp.current?.history ?? exp.reference.history);
    }
  });
});
