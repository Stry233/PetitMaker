// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlueprintBackend } from '../../../io/storage/blueprint-library';
import type { BlueprintRecord } from '../../../io/blueprint';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} });

// The page-wide library reads through the platform store; an in-memory one stands in for IndexedDB.
const store = new Map<string, unknown>();
// While set, every write waits for it, so a write can be held in flight.
let writesWait: Promise<void> | null = null;
vi.mock('../../../platform/storage/blueprint-db', () => ({
  readBlueprintDb: async () => [...store.values()],
  writeBlueprintDb: async (id: string, v: unknown) => { if (writesWait) await writesWait; store.set(id, v); },
  removeBlueprintDb: async (ids: readonly string[]) => { for (const id of ids) store.delete(id); },
  deleteBlueprintDb: async () => { store.clear(); },
}));

// Exports are heard rather than downloaded.
const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));

const record = (id: string, over: Partial<BlueprintRecord> = {}): BlueprintRecord => ({
  id, name: `Plot ${id}`, folder: null, author: 'Ann', origin: null, savedAt: 1000, appVersion: '2.0.0',
  body: { w: 1, h: 1, cells: [null, null, null, null], objects: [] },
  thumbs: { flat: '', lifted: '' }, ...over,
});

function memoryBackend(): BlueprintBackend & { held: Map<string, BlueprintRecord> } {
  const held = new Map<string, BlueprintRecord>();
  return {
    held,
    all: async () => [...held.values()],
    put: async (r) => { held.set(r.id, r); },
    remove: async (ids) => { for (const id of ids) held.delete(id); },
    clear: async () => { held.clear(); },
  };
}

async function fresh() {
  const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
  const backend = memoryBackend();
  const library = createBlueprintLibrary(backend);
  await library.load();
  return { library, backend };
}

beforeEach(() => { mem.clear(); store.clear(); writesWait = null; });

describe('the blueprint library', () => {
  it('[BLUE-10] saves, renames, moves and removes', async () => {
    const { library, backend } = await fresh();
    const told = vi.fn();
    library.subscribe(told);
    await library.save(record('a', { savedAt: 1 }));
    await library.save(record('b', { savedAt: 2 }));
    expect(library.records().map((r) => r.id)).toEqual(['b', 'a']);
    await library.rename('a', '  Barn  ');
    expect(library.records().find((r) => r.id === 'a')!.name).toBe('Barn');
    expect(backend.held.get('a')!.name).toBe('Barn');
    await library.move(['a'], 'Farm');
    expect(library.records().find((r) => r.id === 'a')!.folder).toBe('Farm');
    expect(library.folders()).toEqual(['Farm']);
    await library.remove(['a']);
    expect(library.records().map((r) => r.id)).toEqual(['b']);
    expect(backend.held.has('a')).toBe(false);
    expect(told).toHaveBeenCalled();
  });

  it('[BLUE-10] keeps folders that hold nothing', async () => {
    const { library } = await fresh();
    expect(library.addFolder('Farm')).toBe('Farm');
    expect(library.addFolder('Farm')).toBe('Farm 2');
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const again = createBlueprintLibrary(memoryBackend());
    await again.load();
    expect(again.folders()).toEqual(['Farm', 'Farm 2']);
  });

  it('[BLUE-10] renames a folder with its blueprints and removes it with them', async () => {
    const { library } = await fresh();
    library.addFolder('Farm');
    await library.save(record('a', { folder: 'Farm' }));
    await library.save(record('b'));
    await library.renameFolder('Farm', 'Barns');
    expect(library.folders()).toEqual(['Barns']);
    expect(library.records().find((r) => r.id === 'a')!.folder).toBe('Barns');
    await library.removeFolder('Barns');
    expect(library.folders()).toEqual([]);
    expect(library.records().map((r) => r.id)).toEqual(['b']);
  });

  it('[BLUE-10] skips an import it already holds', async () => {
    const { library } = await fresh();
    await library.save(record('a'));
    const res = await library.importRecords([record('a'), record('a', { body: { w: 1, h: 1, cells: [null, null, null, { type: 'water' as never, rise: 0 }], objects: [] } })], null);
    expect(res).toEqual({ added: 1, skipped: 1, folder: null });
    const ids = library.records().map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('[BLUE-10] lands a folder file in a folder of that name, made if missing', async () => {
    const { library } = await fresh();
    const res = await library.importRecords([record('a', { folder: 'Farm' })], null);
    expect(res).toEqual({ added: 1, skipped: 0, folder: 'Farm' });
    expect(library.records()[0]!.folder).toBe('Farm');
    // The folder the file made shows once its name passes the review.
    expect(library.folders()).toEqual([]);
    expect(await library.settleReview('a', 'folder', 'Farm', null)).toBe(true);
    expect(library.folders()).toEqual(['Farm']);
  });

  it('[BLUE-10] drops stored values that fail admission on read', async () => {
    store.set('good', record('good'));
    store.set('bad', { id: 'bad', name: 5 });
    const { blueprintLibrary } = await import('../../../io/storage/blueprint-library');
    await blueprintLibrary.load();
    expect(blueprintLibrary.records().map((r) => r.id)).toEqual(['good']);
  });

  it('[BLUE-10] empties after a local data wipe', async () => {
    const { blueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { wipeLocalData } = await import('../../../io/storage/local-reset');
    const { autosave } = await import('../../../editor/session/autosave');
    await blueprintLibrary.load();
    await blueprintLibrary.save(record('a'));
    blueprintLibrary.addFolder('Farm');
    const told = vi.fn();
    blueprintLibrary.subscribe(told);
    await wipeLocalData(autosave);
    expect(blueprintLibrary.records()).toEqual([]);
    expect(blueprintLibrary.folders()).toEqual([]);
    expect(told).toHaveBeenCalled();
    autosave.setSuspended(false);
  });
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A backend whose every call waits for `release()`, so operations overlap in flight. */
function slowBackend() {
  const inner = memoryBackend();
  const waiting: (() => void)[] = [];
  const gate = () => new Promise<void>((r) => { waiting.push(r); });
  const backend: BlueprintBackend = {
    all: async () => { await gate(); return inner.all(); },
    put: async (r) => { await gate(); await inner.put(r); },
    remove: async (ids) => { await gate(); await inner.remove(ids); },
    clear: () => inner.clear(),
  };
  const release = async () => { for (let i = 0; i < 20; i++) { await tick(); waiting.splice(0).forEach((r) => r()); } };
  return { backend, inner, release };
}

describe('overlapping library operations', () => {
  it('[BLUE-10] keeps a save that lands while the library is loading', async () => {
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { backend, release } = slowBackend();
    const library = createBlueprintLibrary(backend);
    const loading = library.load();
    const saving = library.save(record('a'));
    await release();
    await Promise.all([loading, saving]);
    expect(library.records().map((r) => r.id)).toEqual(['a']);
  });

  it('[BLUE-10] keeps both a rename and a move of one record issued together', async () => {
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { backend, inner, release } = slowBackend();
    inner.held.set('a', record('a'));
    const library = createBlueprintLibrary(backend);
    const loading = library.load();
    await release();
    await loading;
    const ops = [library.rename('a', 'Barn'), library.move(['a'], 'Farm')];
    await release();
    await Promise.all(ops);
    expect(library.records()[0]).toMatchObject({ name: 'Barn', folder: 'Farm' });
    expect(inner.held.get('a')).toMatchObject({ name: 'Barn', folder: 'Farm' });
  });

  it('[BLUE-10] files a save into a folder being renamed under the new name', async () => {
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { backend, inner, release } = slowBackend();
    inner.held.set('a', record('a', { folder: 'X' }));
    const library = createBlueprintLibrary(backend);
    const loading = library.load();
    await release();
    await loading;
    const ops = [library.renameFolder('X', 'Y'), library.save(record('b', { folder: 'X' }))];
    await release();
    await Promise.all(ops);
    expect(library.records().map((r) => r.folder)).toEqual(['Y', 'Y']);
    expect(library.folders()).toEqual(['Y']);
  });
});

describe('library edge cases', () => {
  it('[BLUE-10] gives the second of two records sharing an id in one file a fresh id, or skips it when identical', async () => {
    const { library } = await fresh();
    const other = { w: 1, h: 1, cells: [null, null, null, { type: 'water' as never, rise: 0 }], objects: [] };
    const res = await library.importRecords([record('a'), record('a'), record('a', { body: other })], null);
    expect(res).toEqual({ added: 2, skipped: 1, folder: null });
    expect(new Set(library.records().map((r) => r.id)).size).toBe(2);
  });

  it('[BLUE-10] refuses to rename a folder onto a name in use', async () => {
    const { library } = await fresh();
    library.addFolder('Farm');
    library.addFolder('Town');
    await library.save(record('a', { folder: 'Farm' }));
    expect(await library.renameFolder('Farm', 'Town')).toBe(false);
    expect(library.folders()).toEqual(['Farm', 'Town']);
    expect(library.records()[0]!.folder).toBe('Farm');
    expect(await library.renameFolder('Farm', 'Barns')).toBe(true);
  });

  it('[BLUE-10] files a save under the folder it names when a rename issued before it is refused', async () => {
    const { library } = await fresh();
    library.addFolder('Farm');
    library.addFolder('Town');
    const renamed = library.renameFolder('Farm', 'Town');
    await library.save(record('a', { folder: 'Farm' }));
    expect(await renamed).toBe(false);
    expect(library.records()[0]!.folder).toBe('Farm');
    expect(library.folders()).toEqual(['Farm', 'Town']);
  });

  it('[BLUE-10] holds each record the backend accepted when a later write fails', async () => {
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const inner = memoryBackend();
    const library = createBlueprintLibrary({
      ...inner,
      put: async (r) => { if (r.id === 'b') throw new Error('full'); await inner.put(r); },
    });
    await library.load();
    await library.save(record('x'));
    await library.save(record('c', { folder: 'F' }));
    await expect(library.move(['x', 'b', 'c'].filter((id) => id !== 'b'), 'G')).resolves.toBeUndefined();
    await library.save(record('b')).catch(() => {});
    expect(library.records().map((r) => r.id).sort()).toEqual(['c', 'x']);
    await expect(library.importRecords([record('p'), record('b'), record('q')], null)).rejects.toThrow();
    expect(library.records().map((r) => r.id).sort()).toEqual(['c', 'p', 'x']);
  });
});

describe('the library\'s own order', () => {
  /** A library of `ids` saved one after another, each newer than the one before. */
  async function saved(ids: string[], backend = memoryBackend()) {
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const library = createBlueprintLibrary(backend);
    await library.load();
    for (const [i, id] of ids.entries()) await library.save(record(id, { savedAt: 10 + i }));
    return { library, backend };
  }
  const order = (library: { records(): readonly BlueprintRecord[] }) => library.records().map((r) => r.id);

  it('[BLUE-10] lists newest first until arranged, and keeps an arrangement across reloads', async () => {
    const { library, backend } = await saved(['a', 'b', 'c', 'd']);
    expect(order(library)).toEqual(['d', 'c', 'b', 'a']);
    await library.arrange(['a'], { before: 'c' });
    expect(order(library)).toEqual(['d', 'a', 'c', 'b']);
    await library.arrange(['d', 'b'], { after: 'c' });
    expect(order(library)).toEqual(['a', 'c', 'd', 'b']);
    const { createBlueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const again = createBlueprintLibrary(backend);
    await again.load();
    expect(order(again)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('[BLUE-10] places a card moved inside a folder beside its neighbours there, the others staying put', async () => {
    const { library } = await saved(['a', 'b', 'c', 'd', 'e']);
    await library.move(['a', 'c', 'e'], 'Farm');
    expect(order(library)).toEqual(['e', 'd', 'c', 'b', 'a']);
    // The folder shows e, c, a; a dropped between e and c lands right before c in the one order.
    await library.arrange(['a'], { before: 'c' });
    expect(order(library)).toEqual(['e', 'd', 'a', 'c', 'b']);
    expect(order(library).filter((id) => library.records().find((r) => r.id === id)!.folder === 'Farm')).toEqual(['e', 'a', 'c']);
    // Dropped after the folder's last card, e lands right after it, before what follows outside the folder.
    await library.arrange(['e'], { after: 'c' });
    expect(order(library)).toEqual(['d', 'a', 'c', 'e', 'b']);
  });

  it('[BLUE-10] puts new and imported blueprints first, the arrangement kept behind them', async () => {
    const { library } = await saved(['a', 'b', 'c']);
    await library.arrange(['c'], { after: 'a' });
    expect(order(library)).toEqual(['b', 'a', 'c']);
    await library.save(record('n', { savedAt: 99 }));
    expect(order(library)).toEqual(['n', 'b', 'a', 'c']);
    // Imported ones go first in the file's order, however old they are.
    await library.importRecords([record('x', { savedAt: 1 }), record('y', { savedAt: 2 })], null);
    expect(order(library)).toEqual(['x', 'y', 'n', 'b', 'a', 'c']);
  });

  it('[BLUE-10] puts deleted blueprints back where they stood on Undo', async () => {
    const { library } = await saved(['a', 'b', 'c', 'd']);
    await library.arrange(['a'], { before: 'd' });
    const { __setBlueprintLibrary, deleteBlueprints } = await import('../../../editor/editing/blueprint');
    const { setToastPresenter } = await import('../../../platform/channels/toast-bus');
    let undo: (() => void) | undefined;
    const stops = [__setBlueprintLibrary(library), setToastPresenter((_text, _type, action) => { undo = action?.run; })];
    try {
      await deleteBlueprints(['a', 'c']);
      expect(order(library)).toEqual(['d', 'b']);
      undo!();
      await vi.waitFor(() => expect(order(library)).toEqual(['a', 'd', 'c', 'b']));
    } finally { for (const stop of stops.reverse()) stop(); }
  });

  it('[BLUE-10] forgets the arrangement with the rest after a local data wipe', async () => {
    const { blueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { wipeLocalData } = await import('../../../io/storage/local-reset');
    const { autosave } = await import('../../../editor/session/autosave');
    await blueprintLibrary.load();
    await blueprintLibrary.save(record('a', { savedAt: 1 }));
    await blueprintLibrary.save(record('b', { savedAt: 2 }));
    await blueprintLibrary.arrange(['a'], { before: 'b' });
    expect(order(blueprintLibrary)).toEqual(['a', 'b']);
    await wipeLocalData(autosave);
    autosave.setSuspended(false);
    // The same records stored again come back newest first, as a library never arranged lists them.
    store.set('a', record('a', { savedAt: 1 }));
    store.set('b', record('b', { savedAt: 2 }));
    await blueprintLibrary.load();
    expect(order(blueprintLibrary)).toEqual(['b', 'a']);
  });

  it('[BLUE-11] never writes the arrangement into an exported file', async () => {
    const { library } = await saved(['a', 'b', 'c']);
    library.addFolder('Farm');
    await library.move(['a', 'b', 'c'], 'Farm');
    await library.arrange(['a'], { before: 'c' });
    expect(order(library)).toEqual(['a', 'c', 'b']);
    const { __setBlueprintLibrary, exportBlueprints } = await import('../../../editor/editing/blueprint');
    const stop = __setBlueprintLibrary(library);
    try {
      const files = async (which: readonly string[] | { folder: string }) => {
        download.downloadJSON.mockReset();
        await exportBlueprints(which, { confirmNotice: async () => true });
        return JSON.parse(download.downloadJSON.mock.calls[0]![0] as string) as { records: Record<string, unknown>[] };
      };
      for (const file of [await files({ folder: 'Farm' }), await files(['a', 'c', 'b'])]) {
        // Newest saved first, as a library never arranged lists them, and no record says where it stood.
        expect(file.records.map((r) => r.id)).toEqual(['c', 'b', 'a']);
        for (const r of file.records) expect(Object.keys(r).some((k) => /order|rank|place|index/i.test(k))).toBe(false);
      }
    } finally { stop(); }
  });
});

describe('a local data wipe while the library writes', () => {
  /** Holds every write until the returned release. */
  const holdWrites = (): (() => void) => {
    let open!: () => void;
    writesWait = new Promise<void>((r) => { open = r; });
    return () => { writesWait = null; open(); };
  };
  const settled = (p: Promise<unknown>): Promise<unknown> => p.catch(() => 'refused');

  it('[BLUE-10] keeps nothing a write in flight or waiting stores once the wipe starts', async () => {
    const { blueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { wipeLocalData } = await import('../../../io/storage/local-reset');
    const { autosave } = await import('../../../editor/session/autosave');
    const { readPref } = await import('../../../platform/storage/prefs');
    await blueprintLibrary.load();
    const release = holdWrites();
    const writes = [blueprintLibrary.save(record('a', { folder: 'Farm' })), blueprintLibrary.save(record('b', { folder: 'Town' }))].map(settled);
    const wiping = wipeLocalData(autosave);
    for (let i = 0; i < 5; i++) await tick();
    release();
    await wiping;
    await Promise.all(writes);
    autosave.setSuspended(false);
    expect([...store.keys()]).toEqual([]);
    expect(readPref('blueprintFolders')).toEqual([]);
    expect(readPref('blueprintOrder')).toEqual([]);
    await blueprintLibrary.load();
    expect(blueprintLibrary.records()).toEqual([]);
    expect(blueprintLibrary.folders()).toEqual([]);
  });

  it('[BLUE-13] a wipe while the examples are being given leaves them to be given on the next load', async () => {
    const { blueprintLibrary } = await import('../../../io/storage/blueprint-library');
    const { wipeLocalData } = await import('../../../io/storage/local-reset');
    const { autosave } = await import('../../../editor/session/autosave');
    const { readPref } = await import('../../../platform/storage/prefs');
    const { giveBlueprintExamples } = await import('../../../editor/editing/blueprint/examples');
    await import('../../../config/blueprints');
    await blueprintLibrary.load();
    const release = holdWrites();
    const giving = settled(giveBlueprintExamples(blueprintLibrary));
    await vi.waitFor(() => expect(readPref('blueprintFolders')).not.toEqual([]));
    const wiping = wipeLocalData(autosave);
    for (let i = 0; i < 5; i++) await tick();
    release();
    await wiping;
    await giving;
    autosave.setSuspended(false);
    expect(readPref('blueprintExamplesGiven')).toBe(false);
    expect([...store.keys()]).toEqual([]);
  });

  it('[BLUE-10] a change the wipe cuts short says nothing, while one the browser refuses still says so', async () => {
    const { createBlueprintLibrary, memoryBlueprintLists } = await import('../../../io/storage/blueprint-library');
    const { __setBlueprintLibrary, importBlueprintFile, moveBlueprints, renameBlueprint } = await import('../../../editor/editing/blueprint');
    const { setToastPresenter } = await import('../../../platform/channels/toast-bus');
    const { encodeBlueprints } = await import('../../../io/blueprint');
    const inner = memoryBackend();
    let refuse = false;
    const library = createBlueprintLibrary({ ...inner, put: async (r) => { if (refuse) throw new Error('quota'); await inner.put(r); } }, memoryBlueprintLists());
    const heard: string[] = [];
    const stops = [__setBlueprintLibrary(library), setToastPresenter((text) => { heard.push(text); })];
    try {
      await library.save(record('a'));
      // Settings, Local data wipes the library; the page reloads before anything else is written.
      await library.wipe();
      expect(await renameBlueprint('a', 'Barn')).toBe(false);
      expect(await moveBlueprints(['a'], 'Farm')).toBe(false);
      expect(await importBlueprintFile(encodeBlueprints([record('b')]))).toBe(false);
      expect(heard).toEqual([]);
      await library.load();
      await library.save(record('a'));
      refuse = true;
      expect(await renameBlueprint('a', 'Barn')).toBe(false);
      expect(await importBlueprintFile(encodeBlueprints([record('b')]))).toBe(false);
      expect(heard).toHaveLength(2);
    } finally { for (const stop of stops.reverse()) stop(); }
  });
});

