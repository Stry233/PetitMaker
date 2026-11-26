// The browser's library of blueprints: records in IndexedDB, flat folders in `PREFS.blueprintFolders`
// so a folder holding nothing survives, and the one order All and every folder show in
// `PREFS.blueprintOrder`, kept beside the records so no file ever carries it. A record's `folder` names
// one of them or is null, which shows under All only. Removing a folder removes its blueprints. Memory
// changes only after the backend accepted the write, and every stored value is admitted by the file
// codec's record rules on read. A wipe ends every operation not yet landed, so nothing written after
// it starts outlives it.
// A record that came from a file holds its name, author and folder as unreviewed until
// `settleReview` records the background text check; an unreviewed folder is left out of `folders()`,
// and every write storing an unreviewed record tells `onUnreviewed`, so no way back into the library skips the check.
// The app's own folders are stored under `builtInFolderId`, kept as they are where a typed name is
// tidied, and an app's own name carries `appName`; the page shows both in the interface language, and
// a rename or an import gives a plain text instead.
import {
  admitBlueprintRecord, BLUEPRINT_NAME_MAX, builtInFolderOf, blueprintPartText, folderReviewText, type BlueprintRecord, type BlueprintTextPart,
} from '../blueprint';
import { deleteBlueprintDb, readBlueprintDb, removeBlueprintDb, writeBlueprintDb } from '../../platform/storage/blueprint-db';
import { readPref, writePref } from '../../platform/storage/prefs';
import { movedBeside, type ListPlace } from '../../core/base/list-move';
import { createSignal } from '../../core/base/signal';
import { clampText } from '../../core/base/text';
import { generateRecordId } from '../../core/model/object-id';

export interface BlueprintBackend {
  all(): Promise<BlueprintRecord[]>;
  put(r: BlueprintRecord): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  /** Deletes every record; resolves however that went. */
  clear(): Promise<void>;
}

/** Where a list the library keeps beside its records is kept: the folder names, or the record ids in order. */
interface BlueprintListStore {
  read(): string[];
  write(names: string[]): void;
}

/** Where the library keeps its folder list and its order. */
interface BlueprintLists { folders: BlueprintListStore; order: BlueprintListStore }

const PREF_LISTS: BlueprintLists = {
  folders: { read: () => [...readPref('blueprintFolders')], write: (names) => writePref('blueprintFolders', names) },
  order: { read: () => [...readPref('blueprintOrder')], write: (ids) => writePref('blueprintOrder', ids) },
};

/** A list held in memory only. */
function memoryList(): BlueprintListStore {
  let names: string[] = [];
  return { read: () => [...names], write: (next) => { names = [...next]; } };
}

/** The folder list and the order held in memory only. */
export function memoryBlueprintLists(): BlueprintLists {
  return { folders: memoryList(), order: memoryList() };
}

/** Where records are placed in the order relative to another: just before it, or just after it. */
export type BlueprintPlace = ListPlace<string>;

export interface BlueprintLibrary {
  /** In the library's own order: newest saved first until arranged, a new or imported record first. */
  records(): readonly BlueprintRecord[];
  /** The folders to show: those whose name no record still holds unreviewed. */
  folders(): readonly string[];
  /** Reads the backend and the folder list afresh and tells subscribers; writes issued after it are taken again after a wipe. */
  load(): Promise<void>;
  subscribe(tell: () => void): () => void;
  /** Changes whenever subscribers are told. */
  version(): number;
  /** Hears each write that stores a record holding unreviewed text; returns the stop. */
  onUnreviewed(tell: () => void): () => void;
  /** The local data reset's part: from the call on, every operation not yet landed lands nothing more
   *  and rejects with `BlueprintLibraryWiped`, and so does every write until the next `load`; in its turn, after the one in flight,
   *  the backend is cleared and memory emptied. The folder list and the order are left to the reset's own storage clear. */
  wipe(): Promise<void>;
  save(r: BlueprintRecord): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** Stores `thumbs` as record `id`'s pictures, keeping every other field as held when the write runs. */
  setThumbs(id: string, thumbs: BlueprintRecord['thumbs']): Promise<void>;
  move(ids: readonly string[], folder: string | null): Promise<void>;
  /** Moves the records `ids`, in the order they stand in, to `at`; nothing when `at` names one of
   *  them or a record the library lacks. */
  arrange(ids: readonly string[], at: BlueprintPlace): Promise<void>;
  /** A removed record keeps its place in the order until the next `load`, so storing it again puts it back there. */
  remove(ids: readonly string[]): Promise<void>;
  /** The folder name actually used: `name` trimmed, with a number appended when a folder holds it or
   *  `shown` names it; '' for a blank name, which adds nothing. */
  addFolder(name: string, shown?: readonly string[]): string;
  /** Adds the built-in folder stored as `id` unless the library holds it. */
  holdFolder(id: string): void;
  /** Re-files the folder's blueprints under `to`, a name or a built-in folder's id; false, with nothing
   *  changed, when `to` is in use or blank. A write issued while it waits files under `to` what names `from`, once the rename landed. */
  renameFolder(from: string, to: string): Promise<boolean>;
  removeFolder(name: string): Promise<void>;
  /** Every record lands in its own `folder`, a name or a built-in folder's id, made when missing; one
   *  naming none lands in `open` while the library holds it, else under none. The result's `folder` is
   *  where they all landed, or null when they landed in several. One whose id and body are held is
   *  skipped, one whose id is held with another body is stored under a fresh id. The added records hold
   *  their texts as unreviewed; `folder` too when it is new or still unreviewed and has text from outside. */
  importRecords(records: readonly BlueprintRecord[], open: string | null): Promise<{ added: number; skipped: number; folder: string | null }>;
  /** Records the text check of `part` of record `id`: approved when `replacement` is null, otherwise the
   *  part takes it for good (a refused author and its original author both become anonymous, a refused
   *  folder none). False, with nothing changed, when the part is no longer unreviewed or its text is not `checked`. */
  settleReview(id: string, part: BlueprintTextPart, checked: string, replacement: string | null): Promise<boolean>;
}

/** Why an operation a wipe cut short rejects: no storage failure, so nothing says so. */
export class BlueprintLibraryWiped extends Error {
  constructor() { super('the blueprint library was wiped'); }
}

/** `name` as the library keeps it, empty when nothing is left. */
const tidy = (name: string): string => clampText(name, BLUEPRINT_NAME_MAX) ?? '';
/** Folder `folder` as the library keeps it: a built-in folder's id as it is, a name tidied. */
const folderKept = (folder: string): string => (builtInFolderOf(folder) ? folder : tidy(folder));

/** A new record id, stable across exports and imports. */
export const newBlueprintId = (): string => generateRecordId('b');

const withoutPart = (r: BlueprintRecord, part: BlueprintTextPart): BlueprintRecord => {
  const left = r.unreviewed?.filter((p) => p !== part) ?? [];
  const { unreviewed: _held, ...rest } = r;
  return left.length > 0 ? { ...rest, unreviewed: left } : rest;
};

const newestFirst = (a: BlueprintRecord, b: BlueprintRecord): number => b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1);

/** How records that landed join the order: a saved one keeps a place it holds, else stands before
 *  every record saved before it; an imported one goes first. */
type Joining = 'saved' | 'first';
const sameBody = (a: BlueprintRecord, b: BlueprintRecord): boolean => JSON.stringify(a.body) === JSON.stringify(b.body);

export function createBlueprintLibrary(backend: BlueprintBackend, lists: BlueprintLists = PREF_LISTS): BlueprintLibrary {
  const { folders } = lists;
  let held = new Map<string, BlueprintRecord>();
  let list: BlueprintRecord[] = [];
  let names: string[] = folders.read();
  // Record ids in the order shown; it may name records removed since the last load.
  let order: string[] = [];
  const changed = createSignal<void>(undefined, (err) => console.error('[blueprint-library] listener failed:', err));
  let version = 0;
  const tell = (): void => { version++; changed.emit(); };
  const unreviewed = createSignal<void>(undefined, (err) => console.error('[blueprint-library] listener failed:', err));
  // Folder renames issued and not yet past their turn, by the old name; `landed` once the turn renamed it.
  const renaming = new Map<string, { to: string; landed: boolean }>();
  // Bumped by every wipe: an operation issued before it lands nothing more. `wiped` holds from a wipe
  // until the next load, refusing every write meanwhile.
  let epoch = 0;
  let wiped = false;
  // The epoch of the operation in its turn, which `live` checks after every wait.
  let turn = 0;
  const live = (): boolean => turn === epoch;
  const ended = (): Error => new BlueprintLibraryWiped();
  // Every operation runs after the previous one finished, so each reads `held` only once earlier writes have landed.
  let tail: Promise<unknown> = Promise.resolve();
  // A write is refused while wiped, a read only once a wipe was issued after it; a wipe never is.
  const run = <T,>(task: () => Promise<T>, kind: 'write' | 'read' | 'wipe' = 'write'): Promise<T> => {
    const issued = epoch;
    const result = tail.then(() => {
      if (kind !== 'wipe' && (issued !== epoch || (kind === 'write' && wiped))) throw ended();
      turn = epoch;
      return task();
    });
    tail = result.catch(() => {});
    return result;
  };
  /** The folder a write issued now files under once its turn comes: `folder` tidied, or the name a
   *  rename issued before it gave that folder, once that rename landed. */
  const folderFor = (folder: string | null): (() => string | null) => {
    if (folder === null) return () => null;
    const to = folderKept(folder);
    const rename = to ? renaming.get(to) : undefined;
    return () => (rename?.landed ? rename.to : to || null);
  };

  const settle = (): void => {
    list = order.flatMap((id) => { const r = held.get(id); return r ? [r] : []; });
    tell();
  };
  const saveFolders = (next: string[]): void => { names = next; folders.write(next); };
  const saveOrder = (next: string[]): void => { order = next; lists.order.write(next); };
  const join = (ids: readonly string[], how: Joining): void => {
    let next = how === 'first' ? order.filter((id) => !ids.includes(id)) : [...order];
    if (how === 'first') next = [...ids, ...next];
    else for (const id of ids) {
      const r = held.get(id);
      if (!r || next.includes(id)) continue;
      const older = next.findIndex((o) => { const x = held.get(o); return x !== undefined && newestFirst(r, x) < 0; });
      next.splice(older < 0 ? next.length : older, 0, id);
    }
    saveOrder(next);
  };
  const ensureFolder = (name: string | null): void => { if (name !== null && !names.includes(name)) saveFolders([...names, name]); };

  // Each record the backend accepted is held at once, so a failure part-way keeps what stuck; records
  // new to the order join it as `joining` says. A wipe issued meanwhile ends it with nothing more held.
  const store = async (records: readonly BlueprintRecord[], joining?: Joining): Promise<void> => {
    const landed: string[] = [];
    try {
      for (const r of records) {
        await backend.put(r);
        if (!live()) throw ended();
        held.set(r.id, r);
        landed.push(r.id);
      }
    } finally {
      if (live()) {
        if (joining && landed.length > 0) join(landed, joining);
        settle();
        if (landed.some((id) => held.get(id)?.unreviewed?.length)) unreviewed.emit();
      }
    }
  };
  const drop = async (ids: readonly string[]): Promise<void> => {
    const present = ids.filter((id) => held.has(id));
    if (present.length === 0) return;
    await backend.remove(present);
    if (!live()) throw ended();
    for (const id of present) held.delete(id);
    settle();
  };

  return {
    records: () => list,
    folders: () => names.filter((n) => !list.some((r) => r.folder === n && r.unreviewed?.includes('folder'))),
    load: () => run(async () => {
      const all = await backend.all();
      if (!live()) throw ended();
      wiped = false;
      held = new Map(all.map((r) => [r.id, r]));
      names = folders.read();
      const missing = [...new Set(all.map((r) => r.folder))].filter((f): f is string => f !== null && !names.includes(f));
      if (missing.length > 0) saveFolders([...names, ...missing]);
      // Records the stored order lacks (a library from before it was kept) lead it, newest first.
      const kept = lists.order.read().filter((id) => held.has(id));
      const loose = all.filter((r) => !kept.includes(r.id)).sort(newestFirst).map((r) => r.id);
      const next = [...loose, ...new Set(kept)];
      if (next.join('\n') !== lists.order.read().join('\n')) saveOrder(next); else order = next;
      settle();
    }, 'read'),
    wipe() {
      epoch++;
      wiped = true;
      return run(async () => {
        await backend.clear();
        held = new Map();
        names = [];
        order = [];
        settle();
      }, 'wipe');
    },
    subscribe: (listener) => changed.subscribe(listener),
    version: () => version,
    onUnreviewed: (listener) => unreviewed.subscribe(listener),
    save(r) {
      const folder = folderFor(r.folder);
      return run(async () => {
        const into = folder();
        ensureFolder(into);
        await store([{ ...r, folder: into }], 'saved');
      });
    },
    rename: (id, name) => run(async () => {
      const r = held.get(id);
      const next = tidy(name);
      if (!r || !next) return;
      const { appName: _own, ...rest } = withoutPart({ ...r, name: next }, 'name');
      await store([rest]);
    }),
    setThumbs: (id, thumbs) => run(async () => {
      const r = held.get(id);
      if (r) await store([{ ...r, thumbs }]);
    }),
    move(ids, folder) {
      const into = folderFor(folder);
      return run(async () => {
        const to = into();
        ensureFolder(to);
        await store(ids.flatMap((id) => { const r = held.get(id); return r ? [withoutPart({ ...r, folder: to }, 'folder')] : []; }));
      });
    },
    arrange: (ids, at) => run(async () => {
      const anchor = 'before' in at ? at.before : at.after;
      const moving = order.filter((id) => ids.includes(id) && held.has(id));
      if (moving.length === 0 || ids.includes(anchor) || !held.has(anchor)) return;
      saveOrder(movedBeside(order, moving, at));
      settle();
    }),
    remove: (ids) => run(() => drop(ids)),
    addFolder(name, shown = []) {
      const base = tidy(name);
      if (!base || wiped) return '';
      let used = base;
      for (let n = 2; names.includes(used) || shown.includes(used); n++) {
        const suffix = ` ${n}`;
        used = `${clampText(base, BLUEPRINT_NAME_MAX - suffix.length) ?? ''}${suffix}`;
      }
      saveFolders([...names, used]);
      tell();
      return used;
    },
    holdFolder(id) {
      if (wiped || !builtInFolderOf(id) || names.includes(id)) return;
      saveFolders([...names, id]);
      tell();
    },
    renameFolder(from, to) {
      const next = folderKept(to);
      const rename = { to: next, landed: false };
      if (next && next !== from) renaming.set(from, rename);
      const done = run(async () => {
        if (!next || next === from || !names.includes(from) || names.includes(next)) return false;
        await store(list.filter((r) => r.folder === from).map((r) => ({ ...r, folder: next })));
        saveFolders(names.map((n) => (n === from ? next : n)));
        settle();
        rename.landed = true;
        return true;
      });
      // Writes issued while it waited have read the rename by then; one issued after names the new folder.
      const forget = (): void => { if (renaming.get(from) === rename) renaming.delete(from); };
      void done.then(forget, forget);
      return done;
    },
    removeFolder: (name) => run(async () => {
      await drop(list.filter((r) => r.folder === name).map((r) => r.id));
      saveFolders(names.filter((n) => n !== name));
      settle();
    }),
    importRecords(records, open) {
      const opened = folderFor(open);
      const named = records.map((r) => folderFor(r.folder));
      return run(async () => {
        const fallback = opened();
        const intoOpen = fallback !== null && names.includes(fallback) ? fallback : null;
        const into = records.map((r, i) => (r.folder === null ? intoOpen : named[i]!()));
        // Whether a record landing in `folder` holds its name for review: a folder from outside the library not yet shown.
        const waits = (folder: string | null): boolean => folder !== null && folderReviewText(folder) !== ''
          && (!names.includes(folder) || list.some((r) => r.folder === folder && r.unreviewed?.includes('folder')));
        let skipped = 0;
        const add = new Map<string, BlueprintRecord>();
        records.forEach((r, i) => {
          const same = held.get(r.id) ?? add.get(r.id);
          if (same && sameBody(same, r)) { skipped++; return; }
          const id = same ? newBlueprintId() : r.id;
          const folder = into[i] ?? null;
          const unreviewed: BlueprintTextPart[] = ['name'];
          if (r.author !== null || r.origin !== null) unreviewed.push('author');
          if (waits(folder)) unreviewed.push('folder');
          const { appName: _own, ...plain } = r;
          add.set(id, { ...plain, id, folder, unreviewed });
        });
        for (const r of add.values()) ensureFolder(r.folder);
        await store([...add.values()], 'first');
        const landed = new Set(into);
        return { added: add.size, skipped, folder: landed.size === 0 ? intoOpen : landed.size === 1 ? [...landed][0] ?? null : null };
      });
    },
    settleReview: (id, part, checked, replacement) => run(async () => {
      const r = held.get(id);
      if (!r || !r.unreviewed?.includes(part) || blueprintPartText(r, part) !== checked) return false;
      let next = withoutPart(r, part);
      if (replacement !== null) {
        next = part === 'name' ? { ...next, name: tidy(replacement) || next.name }
          : part === 'author' ? { ...next, author: null, origin: null } : { ...next, folder: null };
      }
      await store([next]);
      if (part === 'folder' && replacement !== null && r.folder !== null && !list.some((x) => x.folder === r.folder)) {
        saveFolders(names.filter((n) => n !== r.folder));
        settle();
      }
      return true;
    }),
  };
}

/** A backend holding records in memory only, for a library that never outlives its page. */
export function memoryBlueprintBackend(): BlueprintBackend {
  const held = new Map<string, BlueprintRecord>();
  return {
    all: async () => [...held.values()],
    put: async (r) => { held.set(r.id, r); },
    remove: async (ids) => { for (const id of ids) held.delete(id); },
    clear: async () => { held.clear(); },
  };
}

const idbBackend: BlueprintBackend = {
  all: async () => (await readBlueprintDb()).flatMap((v) => { const r = admitBlueprintRecord(v); return r ? [r] : []; }),
  put: (r) => writeBlueprintDb(r.id, r),
  remove: (ids) => removeBlueprintDb(ids),
  clear: () => deleteBlueprintDb().catch(() => {}),
};

/** The page-wide library on IndexedDB; call `load` once at start and after a local data wipe. */
export const blueprintLibrary: BlueprintLibrary = createBlueprintLibrary(idbBackend);

/** Wipes the page-wide library and deletes its database without reopening it (`BlueprintLibrary.wipe`). */
export function wipeBlueprintLibrary(): Promise<void> {
  return blueprintLibrary.wipe();
}
