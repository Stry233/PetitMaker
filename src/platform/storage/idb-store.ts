/**
 * One IndexedDB database holding one object store, opened once and shared by every operation on it.
 * Values go in by structured clone. A database slow on a slow device or a busy page is still working:
 * an operation past the deadline has not answered yet. Only IndexedDB missing, an open that errors or
 * stays blocked past the deadline, or the work's own error or abort (a full disk among them) fails one.
 */

/** An operation's part on the open database: it passes its result to `done`, or calls `fail`. */
type IdbWork<T> = (db: IDBDatabase, done: (value: T) => void, fail: () => void) => void;

interface IdbStore {
  /** Runs `work` on the open database and resolves what it passes `done`, however long the open and
   *  the work take; rejects when the store is unavailable or `work` throws or fails. */
  run<T>(work: IdbWork<T>): Promise<T>;
  /** `run` for a caller with an answer of its own: `fallback` where `run` rejects, and also when the
   *  work, once the database is open, has not answered by the deadline, which leaves it running. */
  settle<T>(work: IdbWork<T>, fallback: T): Promise<T>;
  /** Closes this page's connection and deletes the database, resolving on completion, failure or the deadline. */
  remove(): Promise<void>;
}

const idb = (): IDBFactory | null => (typeof indexedDB !== 'undefined' ? indexedDB : null);

/** The database `name` with its one object store `store`; `deadlineMs` bounds a blocked open and `settle`'s wait. */
export function idbStore(name: string, store: string, deadlineMs: number): IdbStore {
  let opening: Promise<IDBDatabase | null> | null = null;

  const open = (): Promise<IDBDatabase | null> => {
    if (opening) return opening;
    const mine = new Promise<IDBDatabase | null>((resolve) => {
      const f = idb();
      if (!f) { resolve(null); return; }
      let blocked: ReturnType<typeof setTimeout> | undefined;
      let gaveUp = false;
      try {
        const req = f.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onsuccess = () => {
          clearTimeout(blocked);
          const db = req.result;
          // An open answering after the store gave up on it holds a connection nothing will use.
          if (gaveUp) { db.close(); return; }
          // Another tab deleting or upgrading the database (its Local data reset) waits on every open
          // connection, so this one closes and the next operation opens afresh.
          db.onversionchange = () => { db.close(); if (opening === mine) opening = null; };
          resolve(db);
        };
        req.onerror = () => { clearTimeout(blocked); resolve(null); };
        // A blocked open still succeeds once the other tab lets go, unless that tab never does.
        req.onblocked = () => { blocked ??= setTimeout(() => { gaveUp = true; resolve(null); }, deadlineMs); };
      } catch { resolve(null); }
    });
    opening = mine;
    return mine;
  };

  const exec = <T,>(db: IDBDatabase | null, work: IdbWork<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const fail = (): void => reject(new Error(`IndexedDB database ${name} unavailable`));
    if (!db) { fail(); return; }
    try { work(db, resolve, fail); } catch { fail(); }
  });

  return {
    run: (work) => open().then((db) => exec(db, work)),
    settle: (work, fallback) => open().then((db) => new Promise((resolve) => {
      const timer = db ? setTimeout(() => resolve(fallback), deadlineMs) : undefined;
      const give = (value: typeof fallback): void => { clearTimeout(timer); resolve(value); };
      exec(db, work).then(give, () => give(fallback));
    })),
    remove() {
      const f = idb();
      const was = opening;
      opening = null;
      if (!f) return Promise.resolve();
      return (was ?? Promise.resolve(null)).then((db) => {
        db?.close();
        return new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, deadlineMs);
          const req = f.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => { clearTimeout(timer); resolve(); };
        });
      });
    },
  };
}
