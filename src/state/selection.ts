/**
 * Selection helpers. The selection is an ordered array, in the order the user built it;
 * `[]` means nothing is selected.
 */
import type { BlockRef } from './store';

/** Equality by value: a `BlockRef` is rebuilt on every hover, so `===` never matches. */
export function sameRef(a: BlockRef, b: BlockRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'object' && b.kind === 'object'
    ? a.id === b.id
    : a.kind === 'terrain' && b.kind === 'terrain' && a.x === b.x && a.y === b.y;
}

/** The one member, or null. A plural selection returns null, never an arbitrary member. */
export function singleSelection(sel: readonly BlockRef[]): BlockRef | null {
  return sel.length === 1 ? sel[0]! : null;
}

/** Object ids in the selection, in order. */
export function selectedObjectIds(sel: readonly BlockRef[]): string[] {
  return sel.flatMap((r) => (r.kind === 'object' ? [r.id] : []));
}
