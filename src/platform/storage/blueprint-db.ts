/**
 * The blueprint library's records in IndexedDB, one value per id by structured clone. The store
 * holds values as it was handed them; the library admits what it reads. Every operation waits for the
 * database however slowly it answers; reads resolve empty when the store is unavailable, writes reject,
 * so a save never claims to have stuck when it did not.
 */
import { BROWSER_DATABASES } from './prefs';
import { idbStore } from './idb-store';

const STORE = 'v';
const db = idbStore(BROWSER_DATABASES.blueprints, STORE, 4000);

/** Every stored value, in no particular order. */
export function readBlueprintDb(): Promise<unknown[]> {
  return db.run<unknown[]>((idb, done, fail) => {
    const req = idb.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => done(req.result as unknown[]);
    req.onerror = fail;
  }).catch(() => []);
}

function commit(work: (store: IDBObjectStore) => void): Promise<void> {
  return db.run<void>((idb, done, fail) => {
    const tx = idb.transaction(STORE, 'readwrite');
    work(tx.objectStore(STORE));
    tx.oncomplete = () => done();
    tx.onerror = tx.onabort = fail;
  });
}

export function writeBlueprintDb(id: string, value: unknown): Promise<void> {
  return commit((store) => { store.put(value, id); });
}

export function removeBlueprintDb(ids: readonly string[]): Promise<void> {
  return commit((store) => { for (const id of ids) store.delete(id); });
}

/** Deletes the database, resolving on completion, failure or the deadline. */
export const deleteBlueprintDb = (): Promise<void> => db.remove();
