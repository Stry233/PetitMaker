/**
 * Computed results kept across sessions in IndexedDB, each under a key its owner derives from every
 * input that decides it. Values go in by structured clone (Maps, Sets and plain records survive;
 * class prototypes and functions do not). Every operation resolves undefined or nothing when
 * IndexedDB is missing or fails, so a caller always has its own computation to fall back on.
 */
import { BROWSER_DATABASES } from './prefs';

const DB_NAME = BROWSER_DATABASES.figureCache;
const STORE = 'v';
/** A deadline on any one operation, so a stuck database never holds a figure back. */
const DEADLINE_MS = 2000;

const idb = (): IDBFactory | null => (typeof indexedDB !== 'undefined' ? indexedDB : null);

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    const f = idb();
    if (!f) { resolve(null); return; }
    try {
      const req = f.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function settle<T>(work: (db: IDBDatabase, done: (value: T) => void) => void, fallback: T): Promise<T> {
  return open().then((db) => new Promise<T>((resolve) => {
    if (!db) { resolve(fallback); return; }
    const timer = setTimeout(() => resolve(fallback), DEADLINE_MS);
    const done = (value: T) => { clearTimeout(timer); resolve(value); };
    try { work(db, done); } catch { done(fallback); }
  }));
}

/** The value stored under `key`, or undefined. */
export function readFigureCache<T>(key: string): Promise<T | undefined> {
  return settle<T | undefined>((db, done) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => done(req.result as T | undefined);
    req.onerror = () => done(undefined);
  }, undefined);
}

/** Stores `value` under `key` and drops every key that does not start with `keep`, so results of
 *  an older build go once a newer one writes. */
export function writeFigureCache(key: string, value: unknown, keep: string): Promise<void> {
  return settle<void>((db, done) => {
    const tx = db.transaction(STORE, 'readwrite');
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
export function deleteFigureCache(): Promise<void> {
  const f = idb();
  const was = dbPromise;
  dbPromise = null;
  if (!f) return Promise.resolve();
  return (was ?? Promise.resolve(null)).then((db) => {
    db?.close();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DEADLINE_MS);
      const req = f.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => { clearTimeout(timer); resolve(); };
    });
  });
}
