/*
 * Who a blueprint names. Each placement stays a group of the map (`core/model/placed-group.ts`), which
 * records the original author it names, so a frame saved over a placement of another author's
 * blueprint names them as adapted from for as long as anything of that placement stands. The original
 * is a record's `origin` when it adapts another's, else its author, so an adaptation of an adaptation
 * keeps the first original; an anonymous original names no one. Where the edition forbids names a
 * player makes up, the only author a save names is the one the platform gives.
 */
import type { Rect } from '../../../core/grid/rect';
import type { GridState } from '../../../core/model/types';
import { groupStands, mapGroups, type GroupSeed } from '../../../core/model/placed-group';
import { BLUEPRINT_NAME_MAX, type BlueprintRecord } from '../../../io/blueprint';
import { SUPPORTS_TYPED_AUTHOR } from '../../../platform/build/edition';
import { readHostProfileName } from '../../../platform/host/host-bridge';
import { readPref } from '../../../platform/storage/prefs';
import { useEditorStore } from '../../../state/store';
import { recordTextVerdict, textApproved } from '../../../state/text-verdicts';

/** The original author a save by `author` names as adapted from: `origin`, or null when that is `author` themselves. */
export function adaptedFrom(origin: string | null, author: string | null): string | null {
  return origin !== author ? origin : null;
}

/** The original author a placement of `record` names to `author`: the record's origin, else its
 *  author; null when that is anonymous or `author` themselves. */
function originalFor(record: BlueprintRecord, author: string | null): string | null {
  return adaptedFrom(record.origin ?? record.author, author);
}

/** The seed a placement of `record` (as the page shows it) by `author` records its group under. Its
 *  texts are ones the page already shows, so they count as approved (`reviewGroupText` checks those a
 *  map file brings). */
export function seedOf(record: BlueprintRecord, author: string | null): GroupSeed {
  const origin = originalFor(record, author);
  recordTextVerdict(record.name, true);
  if (origin !== null) recordTextVerdict(origin, true);
  return { blueprint: record.id, name: record.name, origin };
}

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The original author of the standing group naming an approved one on `state` whose frame `frame`
 *  overlaps most, or null when it overlaps none. */
export function originAmong(state: GridState, frame: Rect): string | null {
  let best: string | null = null, most = 0;
  for (const g of mapGroups(state)) {
    if (g.origin === null || !textApproved(g.origin)) continue;
    const area = overlapArea(g.frame, frame);
    if (area > most && groupStands(state, g)) { most = area; best = g.origin; }
  }
  return best;
}

/** The original author a save of `frame` names as adapted from, or null. */
export function originFor(frame: Rect): string | null {
  const state = useEditorStore.getState().gridState;
  return state ? originAmong(state, frame) : null;
}

/** The author the save step offers: the last one saved under, null for anonymous. */
export function lastBlueprintAuthor(): string | null {
  return readPref('blueprintAuthor');
}

/** The platform's answer on its way, which every call meanwhile shares. */
let asking: Promise<string | null> | null = null;
/** The name the platform last gave on this page. */
let given: string | null = null;

/**
 * The player's name on the platform as a blueprint's author, clipped to the name limit; null where
 * the platform gives none or the edition has no platform to ask. One request runs at a time, and a
 * call while it runs gets its answer. The platform may first ask the player's consent, so this is
 * called only from a press.
 */
export function platformAuthor(): Promise<string | null> {
  const read = readHostProfileName;
  if (!read) return Promise.resolve(null);
  asking ??= read().then((name) => {
    if (name !== null) given = name.slice(0, BLUEPRINT_NAME_MAX);
    return name === null ? null : given;
  }).finally(() => { asking = null; });
  return asking;
}

/** Whether a save may name `author` in this edition: no one always, and any author where players
 *  type theirs; elsewhere only the name the platform gave on this page or the one last saved under,
 *  which it gave before. */
export function authorAllowed(author: string | null): boolean {
  return author === null || SUPPORTS_TYPED_AUTHOR || author === given || author === lastBlueprintAuthor();
}

/** The text an author field showing `author` already carries, which needs no check: the author last
 *  saved under, or, where the platform names the author, that name, which the player never typed. */
export function knownAuthor(author: string): string {
  return SUPPORTS_TYPED_AUTHOR ? lastBlueprintAuthor() ?? '' : author;
}
