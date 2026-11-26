/**
 * Computed results kept across sessions in IndexedDB, each under a key its owner derives from every
 * input that decides it. Values go in by structured clone (Maps, Sets and plain records survive;
 * class prototypes and functions do not). Every operation resolves undefined or nothing when
 * IndexedDB is missing or fails, so a caller always has its own computation to fall back on.
 */
import { BROWSER_DATABASES } from './prefs';
import { idbStore } from './idb-store';

const STORE = 'v';
/** A figure waits on the cache only briefly before computing its own. */
const db = idbStore(BROWSER_DATABASES.figureCache, STORE, 2000);

/** The value stored under `key`, or undefined. */
export function readFigureCache<T>(key: string): Promise<T | undefined> {
  return db.settle<T | undefined>((idb, done) => {
    const req = idb.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => done(req.result as T | undefined);
    req.onerror = () => done(undefined);
  }, undefined);
}

/** Stores `value` under `key` and drops every key that does not start with `keep`, so results of
 *  an older build go once a newer one writes. */
export function writeFigureCache(key: string, value: unknown, keep: string): Promise<void> {
  return db.settle<void>((idb, done) => {
    const tx = idb.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      for (const k of keys.result) if (typeof k !== 'string' || !k.startsWith(keep)) store.delete(k);
    };
    store.put(value, key);
    tx.oncomplete = () => done();
    tx.onerror = tx.onabort = () => done();
  }, undefined);
}

/** Deletes the database, resolving on completion, failure or the deadline. */
export const deleteFigureCache = (): Promise<void> => db.remove();
