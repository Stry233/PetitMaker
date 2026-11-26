/** Every database the page keeps open steps aside when another tab deletes or upgrades it, as a
 *  Local data reset there does, so that reset is never blocked here; the next use opens it afresh. */
import { afterEach, expect, it, vi } from 'vitest';
import { readBlueprintDb } from '../../../platform/storage/blueprint-db';
import { readFigureCache } from '../../../platform/storage/figure-cache';
import { deleteVault, sealSecret } from '../../../platform/storage/vault';

interface FakeDb { close: () => void; closed: boolean; onversionchange: (() => void) | null; transaction: () => unknown }

/** A request answering `result` on the next microtask. */
function answer(result: unknown) {
  const r = { result, onsuccess: null as null | (() => void), onerror: null };
  queueMicrotask(() => r.onsuccess?.());
  return r;
}

/** An IndexedDB whose every open succeeds with a fresh connection holding nothing, whose writes
 *  complete on the next microtask, and whose first `stalls` reads never answer. */
function fakeIndexedDb(stalls = 0) {
  const opened: FakeDb[] = [];
  const puts = vi.fn();
  const transaction = () => {
    const tx = { oncomplete: null as null | (() => void), onerror: null, onabort: null, objectStore: () => store };
    const store = {
      get: () => (stalls-- > 0 ? { onsuccess: null, onerror: null } : answer(undefined)), getAll: () => answer([]), getAllKeys: () => answer([]),
      put: () => { puts(); queueMicrotask(() => tx.oncomplete?.()); }, delete: () => {},
    };
    return tx;
  };
  const factory = {
    open: vi.fn(() => {
      const db: FakeDb = { closed: false, close: () => { db.closed = true; }, onversionchange: null, transaction };
      opened.push(db);
      const req = { result: db, onsuccess: null as null | (() => void), onupgradeneeded: null, onerror: null, onblocked: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }),
    deleteDatabase: vi.fn(() => {
      const req = { onsuccess: null as null | (() => void), onerror: null, onblocked: null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    }),
  };
  return { factory, opened, puts };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  { database: 'the blueprint library', use: () => readBlueprintDb() },
  { database: 'the figure cache', use: () => readFigureCache('figure') },
  { database: 'the key vault', use: async () => { await deleteVault(); return sealSecret('key'); } },
])('$database closes its connection when another tab changes the database, and reopens on the next use', async ({ use }) => {
  const { factory, opened } = fakeIndexedDb();
  vi.stubGlobal('indexedDB', factory);
  await use();
  expect(opened.length).toBeGreaterThan(0);
  for (const db of opened) db.onversionchange?.();
  expect(opened.filter((db) => !db.closed)).toEqual([]);
  const opens = factory.open.mock.calls.length;
  await use();
  expect(factory.open.mock.calls.length).toBe(opens + 1);
});

it('the key vault asks again after a read that ran past its deadline, and makes its key only once it has answered', async () => {
  const { factory, puts } = fakeIndexedDb(1);
  vi.stubGlobal('indexedDB', factory);
  await deleteVault();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const stalled = sealSecret('key');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await stalled).toBeNull();
  expect(puts).not.toHaveBeenCalled();
  vi.useRealTimers();
  expect(await sealSecret('key')).not.toBeNull();
  expect(puts).toHaveBeenCalledTimes(1);
});
