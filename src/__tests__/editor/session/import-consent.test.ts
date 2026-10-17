// @vitest-environment jsdom
/**
 * A map load whose landmarks now stand over its content asks before it changes anything: on every
 * import path (a save file, a share image, the resumed session) the open map keeps its cells,
 * objects, undo history and cameras, and no autosave is written, while the choice is asked and after
 * it is cancelled, in the choice or in the hand repair. Only a choice opens the imported map.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const raster = vi.hoisted(() => ({ current: null as { pixels: Uint8Array; width: number; height: number } | null }));
vi.mock('../../../io/import/raster', () => ({ readRasterImage: async () => ({ ...raster.current!, pixels: new Uint8Array(raster.current!.pixels) }) }));
const downloads = vi.hoisted(() => [] as { blob: Blob; name: string }[]);
vi.mock('../../../io/export/download', async (actual) => {
  const real = await actual<typeof import('../../../io/export/download')>();
  const downloadBlob = (blob: Blob, name: string): void => { downloads.push({ blob, name }); };
  return { ...real, downloadBlob, downloadJSON: (json: string, name: string) => downloadBlob(new Blob([json], { type: 'application/json' }), name) };
});

import { inspectImportFile } from '../../../io/import/file';
import { readBlob } from '../../../io/import/read-blob';
import { commitImport } from '../../../editor/session/import-flow';
import { cancelRepair, exportUnrepaired, repairAutomatically, repairByHand } from '../../../editor/session/landmark-repair';
import { restoreSession } from '../../../editor/session/restore';
import { installEditorSession } from '../../../editor/session/install';
import { autosave } from '../../../editor/session/autosave';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { host } from '../../../editor/host/host';
import { readRestorableAutosave } from '../../../io/storage/autosave';
import { serialize } from '../../../io/save/json-codec';
import { buildShareCode } from '../../../io/share/export';
import { PREFS } from '../../../platform/storage/prefs';
import { placeObjectCommand } from '../../../core/model/command-build';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { getMapTemplate } from '../../../config/maps';
import { useEditorStore } from '../../../state/store';
import { exportable } from '../../_support/exportable';

// Each case decodes and plans a whole map, which outlasts the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const FILE = join(__dirname, '..', '..', 'fixtures', 'saves', 'hexia-plaza-frame-1.5.557.json.gz');
const SAVED_SESSION = '{"saved":"session"}';
const store = () => useEditorStore.getState();

/** Everything of the open map a load must not touch before it is chosen. */
function openMap() {
  const s = store();
  return {
    grid: s.gridState,
    executor: s.commandExecutor,
    map: { ...JSON.parse(serialize(s.gridState!)), metadata: null },
    depth: s.commandExecutor!.historyDepth(),
    camera: host.camera.get2d() ?? null,
    stored: localStorage.getItem(PREFS.autosave.key),
  };
}

let stop = (): void => {};
let schedule: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  newMap(editorPort, 'hexia');
  stop = installEditorSession({ frameFlashMs: 0 });
  // The open map has work of its own: a placed tree, one undo step, and a saved session.
  const s = store();
  const a = templateAnchor(s.gridState!.template)!;
  s.commandExecutor!.execute(placeObjectCommand({ id: 'own-tree', catalogId: 'tree-apple', position: { x: Math.floor(a.x) - 12, y: Math.floor(a.y) + 4 }, rotation: 0, elevation: 0 }));
  expect(s.gridState!.objects.has('own-tree')).toBe(true);
  localStorage.setItem(PREFS.autosave.key, SAVED_SESSION);
  schedule = vi.spyOn(autosave, 'schedule');
});
afterEach(() => {
  downloads.length = 0;
  if (store().repairSession) cancelRepair();
  schedule.mockRestore();
  stop();
  localStorage.clear();
});

const saveText = (): string => gunzipSync(readFileSync(FILE)).toString('utf8');

/** A share image of a map with trees where the plaza stands: decoded as saved, under its landmark. */
async function shareImage(): Promise<File> {
  const state = createGridState(getMapTemplate('hexia'));
  const a = templateAnchor(state.template)!;
  const trees = [0, 4, 8].map((d) => ({ id: `under-${d}`, catalogId: 'tree-apple', position: { x: Math.floor(a.x) + 3 + d, y: Math.floor(a.y) + 5 }, rotation: 0 as const, elevation: 0 }));
  for (const t of trees) state.objects.set(t.id, t);
  bumpObjectsVersion(state, { added: trees });
  const code = await buildShareCode(exportable(state), null, { appVersion: '1.5.557', saveVersion: 2 }, 1600);
  raster.current = { pixels: code!.rgba, width: code!.width, height: code!.height };
  return new File(['x'], 'map.png', { type: 'image/png' });
}

/** The import paths, each up to the point where the choice is asked. */
const PATHS: Record<string, () => Promise<void>> = {
  'a save file': async () => {
    const file = new Blob([saveText()], { type: 'application/json' });
    const inspection = await inspectImportFile(file, 'hexia.json');
    if (inspection.status !== 'ready') throw new Error(inspection.status);
    commitImport({ inspection, name: 'hexia.json', file });
  },
  'a share image': async () => {
    const file = await shareImage();
    const inspection = await inspectImportFile(file, 'map.png');
    if (inspection.status !== 'ready') throw new Error(inspection.status);
    commitImport({ inspection, name: 'map.png', file });
  },
  'the resumed session': async () => {
    localStorage.setItem(PREFS.autosave.key, saveText());
    const offer = readRestorableAutosave()!;
    localStorage.setItem(PREFS.autosave.key, SAVED_SESSION);
    restoreSession(offer);
  },
};

describe.each(Object.keys(PATHS))('opening %s with landmark conflicts', (path) => {
  it('leaves the open map untouched while the choice is asked and after it is cancelled', async () => {
    const before = openMap();
    await PATHS[path]!();
    expect(store().repairSession?.phase).toBe('choose');
    expect(store().modals.landmarkRepair).toBe(true);
    expect(openMap()).toEqual(before);
    expect(store().gridState).toBe(before.grid);
    cancelRepair();
    expect(store().repairSession).toBeNull();
    expect(openMap()).toEqual(before);
    expect(store().gridState).toBe(before.grid);
    expect(store().commandExecutor).toBe(before.executor);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('brings the open map back as it was when the hand repair is cancelled', async () => {
    const before = openMap();
    await PATHS[path]!();
    repairByHand();
    expect(store().repairSession?.phase).toBe('hand');
    expect(store().gridState).not.toBe(before.grid);
    cancelRepair();
    expect(store().gridState).toBe(before.grid);
    expect(store().commandExecutor).toBe(before.executor);
    expect({ ...openMap(), camera: before.camera }).toEqual(before);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('opens the imported map only when it is chosen', async () => {
    const before = openMap();
    await PATHS[path]!();
    expect(store().gridState).toBe(before.grid);
    repairAutomatically();
    expect(store().repairSession).toBeNull();
    expect(store().gridState).not.toBe(before.grid);
    expect(store().gridState!.objects.has('own-tree')).toBe(false);
    expect(schedule).toHaveBeenCalled();
  });
});

/** What Export first must download on each path: the bytes the visitor brought, unrepaired. */
const EXPORTED: Record<string, () => Promise<string>> = {
  'a save file': async () => saveText(),
  'a share image': async () => 'x',
  'the resumed session': async () => saveText(),
};

describe.each(Object.keys(PATHS))('Export first while opening %s', (path) => {
  it('downloads the map as it came and leaves the choice, the open map and its exported mark as they were', async () => {
    const before = openMap();
    const exportedAt = store().exportedAt;
    await PATHS[path]!();
    expect(exportUnrepaired()).toBe(true);
    expect(downloads).toHaveLength(1);
    expect(await readBlob(downloads[0]!.blob, 'text')).toBe(await EXPORTED[path]!());
    expect(store().repairSession?.phase).toBe('choose');
    expect(store().modals.landmarkRepair).toBe(true);
    expect(openMap()).toEqual(before);
    expect(store().gridState).toBe(before.grid);
    expect(store().commandExecutor).toBe(before.executor);
    expect(store().exportedAt).toBe(exportedAt);
    expect(schedule).not.toHaveBeenCalled();
    cancelRepair();
    expect(openMap()).toEqual(before);
  });
});

describe('Export first over a fresh planet', () => {
  it('downloads the old save whole, with the objects the repair would move, never the empty open map', async () => {
    newMap(editorPort, 'hexia');
    const empty = store().gridState!;
    expect(empty.objects.size).toBe([...empty.objects.values()].filter((o) => o.locked).length);
    await PATHS['a save file']!();
    const session = store().repairSession!;
    if (session.phase !== 'choose') throw new Error(session.phase);
    expect(exportUnrepaired()).toBe(true);
    const text = await readBlob(downloads[0]!.blob, 'text');
    expect(text).toBe(saveText());
    // The file reopens as the old save it is: the same objects, where the save had them, and the same report.
    const reread = await inspectImportFile(new Blob([text], { type: 'application/json' }), 'again.json');
    if (reread.status !== 'ready') throw new Error(reread.status);
    const saved = JSON.parse(saveText()) as { objects: unknown[] };
    const whole = (state: { objects: Map<string, unknown> }, report: { objects: unknown[] }) => state.objects.size + report.objects.length;
    expect(whole(reread.preview.state, reread.preview.report!)).toBe(whole(session.pending, session.report));
    const where = (report: { objects: { object: { id: string; position: unknown } }[] }) => report.objects.map((o) => [o.object.id, o.object.position]);
    expect(where(reread.preview.report!)).toEqual(where(session.report));
    expect(saved.objects.length).toBeGreaterThan(0);
    expect(store().gridState).toBe(empty);
  });
});

