/** The library over the browser's own database on a slow device, whose IndexedDB answers the open and
 *  every read and write later than the store's deadline: the library still loads, saves still land and
 *  the examples are still given, once the browser answers, with nothing said; only a browser refusing
 *  the database has its saves refused. */
import { beforeEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { BlueprintLibraryWiped, blueprintLibrary, wipeBlueprintLibrary } from '../../../io/storage/blueprint-library';
import { giveBlueprintExamples } from '../../../editor/editing/blueprint/examples';
import { decodeBlueprints, type BlueprintRecord } from '../../../io/blueprint';
import { EXAMPLE_BLUEPRINTS_FILE } from '../../../config/blueprints';
import { readPref, writePref } from '../../../platform/storage/prefs';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  get length() { return mem.size; },
});

/** Later than the blueprint store's own deadline of 4 s. */
const LAG_MS = 5000;

type Opening = 'answers' | 'errors' | 'stays blocked';

/** The browser's IndexedDB on a slow device: the open answers `LAG_MS` late as `opening` says, and
 *  every read and every write answers `LAG_MS` late too. Records persist across opens. */
function slowIndexedDb(opening: Opening = 'answers') {
  const held = new Map<string, unknown>();
  const later = (answer: () => void): void => { setTimeout(answer, LAG_MS); };
  const db = {
    onversionchange: null,
    close: () => {},
    createObjectStore: () => ({}),
    transaction: () => {
      const changes: (() => void)[] = [];
      const tx = { oncomplete: null as null | (() => void), onerror: null, onabort: null, objectStore: () => store };
      const change = (apply: () => void): void => {
        if (changes.push(apply) === 1) later(() => { for (const c of changes) c(); tx.oncomplete?.(); });
      };
      const store = {
        getAll: () => {
          const req = { result: undefined as unknown, onsuccess: null as null | (() => void), onerror: null };
          later(() => { req.result = [...held.values()].map((v) => structuredClone(v)); req.onsuccess?.(); });
          return req;
        },
        put: (value: unknown, key: string) => change(() => held.set(key, structuredClone(value))),
        delete: (key: string) => change(() => held.delete(key)),
      };
      return tx;
    },
  };
  const factory = {
    open: () => {
      const req = {
        result: db, onupgradeneeded: null as null | (() => void), onsuccess: null as null | (() => void),
        onerror: null as null | (() => void), onblocked: null as null | (() => void),
      };
      later(() => {
        if (opening === 'errors') req.onerror?.();
        else if (opening === 'stays blocked') req.onblocked?.();
        else { req.onupgradeneeded?.(); req.onsuccess?.(); }
      });
      return req;
    },
    deleteDatabase: () => {
      const req = { onsuccess: null as null | (() => void), onerror: null, onblocked: null };
      queueMicrotask(() => { held.clear(); req.onsuccess?.(); });
      return req;
    },
  };
  return { factory, held };
}

/** `work`'s outcome, the page's clock running meanwhile a slice at a time so each late answer lands in turn. */
async function settled<T>(work: Promise<T>): Promise<T> {
  let done = false;
  void work.then(() => { done = true; }, () => { done = true; });
  for (let ms = 0; !done && ms < 120_000; ms += 250) {
    await vi.advanceTimersByTimeAsync(250);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return work;
}

const examples = (): BlueprintRecord[] => {
  const read = decodeBlueprints(EXAMPLE_BLUEPRINTS_FILE);
  if ('error' in read) throw new Error(read.error);
  return read.records;
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mem.clear();
  errors = vi.spyOn(console, 'error');
  return async () => {
    errors.mockRestore();
    vi.useRealTimers();
    // A local data reset ends the page's connection, so the next test opens its own browser's database.
    await wipeBlueprintLibrary();
  };
});

spec('BLUE-13', 'a first visit on a browser slow to open the library gets the examples once it opens, with nothing said', async () => {
  const { factory, held } = slowIndexedDb();
  vi.stubGlobal('indexedDB', factory);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await settled(blueprintLibrary.load().then(() => giveBlueprintExamples(blueprintLibrary)));
  expect(blueprintLibrary.records().map((r) => r.id).sort()).toEqual(examples().map((r) => r.id).sort());
  expect(held.size).toBe(examples().length);
  expect(readPref('blueprintExamplesGiven')).toBe(true);
  expect(errors).not.toHaveBeenCalled();
});

spec('BLUE-10', 'a library a slow browser opens shows its blueprints in their own order once it opens, and a save made meanwhile lands first', async () => {
  const [first, second, third] = examples().map((r) => ({ ...r, folder: null }));
  const { factory, held } = slowIndexedDb();
  held.set(first!.id, first);
  held.set(second!.id, second);
  writePref('blueprintOrder', [first!.id, second!.id]);
  writePref('blueprintExamplesGiven', true);
  vi.stubGlobal('indexedDB', factory);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const newest = { ...third!, savedAt: Math.max(first!.savedAt, second!.savedAt) + 1 };
  await settled(Promise.all([blueprintLibrary.load(), blueprintLibrary.save(newest)]));
  expect(blueprintLibrary.records().map((r) => r.id)).toEqual([newest.id, first!.id, second!.id]);
  expect(readPref('blueprintOrder')).toEqual([newest.id, first!.id, second!.id]);
  expect(held.has(newest.id)).toBe(true);
  expect(errors).not.toHaveBeenCalled();
});

for (const opening of ['errors', 'stays blocked'] as const) {
  spec('BLUE-10', `a browser whose library open ${opening} refuses every save and gives no examples`, async () => {
    vi.stubGlobal('indexedDB', slowIndexedDb(opening).factory);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await settled(blueprintLibrary.load());
    expect(blueprintLibrary.records()).toEqual([]);
    const save = await settled(blueprintLibrary.save({ ...examples()[0]!, folder: null }).then(() => null, (err: unknown) => err));
    expect(save).toBeInstanceOf(Error);
    expect(save).not.toBeInstanceOf(BlueprintLibraryWiped);
    await expect(settled(giveBlueprintExamples(blueprintLibrary))).rejects.toThrow();
    expect(readPref('blueprintExamplesGiven')).toBe(false);
  });
}
