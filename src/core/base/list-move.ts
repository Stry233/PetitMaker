/** Several items of a list moved together to one place in it, by a slot index or beside an item that stays. */

/** Where items set down in a list stand: just before an item that stays, or just after one. */
export type ListPlace<T> = { readonly before: T } | { readonly after: T };

/** `list` with the members of `moving` it holds taken out and set down together, in the order they
 *  stood, at slot `at`: before item `at` of `list`, at the end for its length. */
export function movedTo<T>(list: readonly T[], moving: readonly T[], at: number): T[] {
  const stays = (x: T): boolean => !moving.includes(x);
  return [...list.slice(0, at).filter(stays), ...list.filter((x) => !stays(x)), ...list.slice(at).filter(stays)];
}

/** Where `movedTo` sets them down, by an item that stays: before the first from slot `at` on, else
 *  after the last before it; null when none stays. */
export function placeOf<T>(list: readonly T[], moving: readonly T[], at: number): ListPlace<T> | null {
  const next = list.slice(at).find((x) => !moving.includes(x));
  if (next !== undefined) return { before: next };
  const before = list.slice(0, at).filter((x) => !moving.includes(x));
  return before.length === 0 ? null : { after: before[before.length - 1]! };
}

/** The move of `moving` to slot `at` of `list`: the order it makes and where that is by an item that
 *  stays; null where it changes nothing. */
export function listMove<T>(list: readonly T[], moving: readonly T[], at: number): { order: T[]; place: ListPlace<T> } | null {
  const order = movedTo(list, moving, at);
  if (order.every((x, i) => x === list[i])) return null;
  const place = placeOf(list, moving, at);
  return place ? { order, place } : null;
}

/** `list` with the members of `moving` it holds set down together, in the order they stood, at
 *  `place`, whose item must be in `list` and not moving. */
export function movedBeside<T>(list: readonly T[], moving: readonly T[], place: ListPlace<T>): T[] {
  const anchor = 'before' in place ? place.before : place.after;
  const carried = list.filter((x) => moving.includes(x));
  const rest = list.filter((x) => !moving.includes(x));
  const i = rest.indexOf(anchor) + ('after' in place ? 1 : 0);
  return [...rest.slice(0, i), ...carried, ...rest.slice(i)];
}
