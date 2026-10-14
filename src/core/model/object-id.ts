/**
 * New object, note and planet ids. Uniqueness is an invariant: `state.objects` is keyed by id, so
 * a repeat would replace the object holding it, which the placement rules refuse rather than let
 * happen (`rules/placement-overlap.ts`). Every id comes from the one installed `IdSource`.
 */
import { wallClock } from '../base/clock';

/** Where new ids come from. `next(prefix)` answers an id starting with `prefix`, never one it gave
 *  before. */
interface IdSource {
  next(prefix: string): string;
}

let seq = 0;

/** The editor's source: the timestamp keeps a session's ids clear of the ones in a map it loads,
 *  the counter keeps them apart within the session, and a random tail keeps two tabs apart. */
const sessionIds: IdSource = {
  next: (prefix) => prefix + wallClock().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6),
};

/** Ids `prefix` + `seq` + a counter: the same ids in the same order on every run. */
function sequentialIds(): IdSource {
  let n = 0;
  return { next: (prefix) => `${prefix}seq${(n++).toString(36)}` };
}

let source: IdSource = sessionIds;

/** Installs sequential ids, keeping the counter of a sequential source already installed so a
 *  module graph shared by several test files never repeats an id. */
export function __setSequentialIds(): void {
  if (source === sessionIds) source = sequentialIds();
}

/** A new id after `prefix`. */
export function generateId(prefix: string): string {
  return source.next(prefix);
}

export function generateObjectId(): string {
  return generateId('');
}
