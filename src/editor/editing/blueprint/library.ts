/** The blueprint library the live editor reads and writes, what it hears of it, the moves among its
 *  cards it has yet to write, and how a write the browser refused is said. */
import { movedBeside } from '../../../core/base/list-move';
import { createSignal } from '../../../core/base/signal';
import { MY_FOLDER, type BlueprintRecord } from '../../../io/blueprint';
import { BlueprintLibraryWiped, blueprintLibrary, type BlueprintLibrary, type BlueprintPlace } from '../../../io/storage/blueprint-library';
import { translate } from '../../../i18n/context';
import { showToast } from '../../../platform/channels/toast-bus';
import { useEditorStore } from '../../../state/store';

let library: BlueprintLibrary = blueprintLibrary;

/** The library the editor reads and writes. */
export function editorBlueprintLibrary(): BlueprintLibrary {
  return library;
}

/** Puts `next` behind the editor's blueprint verbs; returns the restore. */
export function __setBlueprintLibrary(next: BlueprintLibrary): () => void {
  const was = library;
  library = next;
  moves = [];
  return () => { library = was; moves = []; };
}

/** The library's own record `id`, raw, or undefined. */
export const recordOf = (id: string): BlueprintRecord | undefined => library.records().find((r) => r.id === id);

/** Says a library write failed, as `key` words it; one a local data wipe cut short says nothing, since
 *  the page reloads and nothing was lost the visitor did not ask to lose. */
export function sayWriteFailed(err: unknown, key: 'blueprint.write_failed' | 'blueprint.import_storage_failed'): void {
  if (!(err instanceof BlueprintLibraryWiped)) showToast(translate(key), 'error');
}

/** Runs a library write, saying so when the browser refused it; whether it landed. */
export async function written(write: Promise<void>): Promise<boolean> {
  try {
    await write;
    return true;
  } catch (err) {
    sayWriteFailed(err, 'blueprint.write_failed');
    return false;
  }
}

/** Runs `review` whenever the library stores a record whose text waits for the background review,
 *  whatever stored it (an import, a delete's Undo); returns the stop. */
export function watchUnreviewedBlueprints(review: () => void): () => void {
  return library.onUnreviewed(review);
}

/** `open` when the page shows that folder, else null: a folder waiting for review is never written into or opened. */
export function shownOpenFolder(open: string | null): string | null {
  return open !== null && library.folders().includes(open) ? open : null;
}

/** The folder open in the strip or the explorer while the page shows it, else null: the one a save
 *  files under unless another is chosen. */
export function openBlueprintFolder(): string | null {
  return shownOpenFolder(useEditorStore.getState().blueprint.folder);
}

/** The folders the strip and explorer show: My Blueprints first, then the others in the order they were made. */
export function blueprintFolders(): readonly string[] {
  const all = library.folders();
  return all.includes(MY_FOLDER) ? [MY_FOLDER, ...all.filter((f) => f !== MY_FOLDER)] : all;
}

/** A move among the cards the library was asked to write and has not written yet. */
interface PendingMove { readonly ids: readonly string[]; readonly at: BlueprintPlace }

/** The moves the library has yet to write, oldest first. */
let moves: readonly PendingMove[] = [];
/** How many times `moves` changed, and how many times a move changed the order shown, on this page. */
let movesVersion = 0, shifts = 0;
const movesChanged = createSignal();

const setMoves = (next: readonly PendingMove[]): void => {
  moves = next;
  movesVersion += 1;
  movesChanged.emit();
};

/** Moves the records `ids` to `at` in the library's one order, shown as moved at once
 *  (`inShownOrder`) while the library writes it; whether the write landed. */
export function arrangeShown(ids: readonly string[], at: BlueprintPlace): Promise<boolean> {
  const move: PendingMove = { ids, at };
  shifts += 1;
  setMoves([...moves, move]);
  return written(library.arrange(ids, at)).then((landed) => {
    if (!landed) shifts += 1;
    setMoves(moves.filter((m) => m !== move));
    return landed;
  });
}

/** `records`, the library's own, in the order it will hold once every move it has yet to write
 *  lands; a move the library would refuse, beside a record it lacks or one of those moved, moves none. */
export function inShownOrder(records: readonly BlueprintRecord[]): readonly BlueprintRecord[] {
  if (moves.length === 0) return records;
  let order = records.map((r) => r.id);
  for (const { ids, at } of moves) {
    const beside = 'before' in at ? at.before : at.after;
    if (order.includes(beside) && !ids.includes(beside)) order = movedBeside(order, ids, at);
  }
  const held = new Map(records.map((r) => [r.id, r]));
  return order.map((id) => held.get(id)!);
}

/** How many times a move among the cards changed the order shown on this page, as it started and
 *  again when its write failed and the order went back: it moves on in the same change that shows
 *  the new order (`watchBlueprintLibrary`). */
export function blueprintOrderShifts(): number {
  return shifts;
}

/** Hears every change to the library's records or folders, and to the order shown while a move is
 *  written; returns the stop. */
export function watchBlueprintLibrary(tell: () => void): () => void {
  const stops = [library.subscribe(tell), movesChanged.subscribe(tell)];
  return () => { for (const stop of stops) stop(); };
}

/** A number that changes with every change `watchBlueprintLibrary` hears. */
export function blueprintLibraryVersion(): number {
  return library.version() + movesVersion;
}
