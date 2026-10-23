/**
 * The browser storage a saved key lands in, held in memory so a spec can read what was written: a
 * localStorage of plain strings and an IndexedDB whose object stores keep the values they are given
 * (a CryptoKey among them), each request answered on a microtask as a browser answers it.
 */

/** A localStorage over a Map; `written()` is every stored value at once. */
export function memoryLocalStorage(): { storage: Storage; written: () => string } {
  const backing = new Map<string, string>();
  const storage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, String(v)); },
    removeItem: (k: string) => { backing.delete(k); },
    clear: () => { backing.clear(); },
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() { return backing.size; },
  } as Storage;
  return { storage, written: () => [...backing.values()].join('\n') };
}

/** An IndexedDB of one database; `values()` is everything its object stores hold. */
export function memoryIndexedDB(): { factory: IDBFactory; values: () => unknown[] } {
  const stores = new Map<string, Map<string, unknown>>();
  type Req = { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void; onblocked?: () => void };
  const answer = (req: Req, result?: unknown) => queueMicrotask(() => { req.result = result; req.onsuccess?.(); });
  const db = {
    createObjectStore: (name: string) => { stores.set(name, new Map()); },
    transaction: (name: string) => {
      const tx: { oncomplete?: () => void; objectStore?: unknown } = {};
      tx.objectStore = () => ({
        get: (id: string) => { const req: Req = {}; answer(req, stores.get(name)!.get(id)); return req; },
        put: (value: unknown, id: string) => { stores.get(name)!.set(id, value); queueMicrotask(() => tx.oncomplete?.()); },
      });
      return tx;
    },
    close: () => {},
  };
  const factory = {
    open: () => {
      const req: Req = { result: db };
      queueMicrotask(() => { if (stores.size === 0) req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
    deleteDatabase: () => { const req: Req = {}; stores.clear(); answer(req); return req; },
  } as unknown as IDBFactory;
  return { factory, values: () => [...stores.values()].flatMap((s) => [...s.values()]) };
}
