/*
 * The press that carries an item card onto the map: the list carry (`bars/use-list-carry.ts`) whose
 * lift arms the card for the carry (`editor/editing/object-shelf.ts:carryItem`), which owns what it
 * arms and puts back. A finger's carry that ends back over the shelf picks the card instead.
 */
import type { RefObject } from 'react';
import { carryItem } from '../../../../editor/editing/object-shelf';
import { modalityOf } from '../../../../platform/input/gesture-timing';
import { useListCarry, type ListCarry } from '../use-list-carry';

/** `enabled` false leaves the card a plain button; `onLift` runs as the card leaves the row and
 *  `onLand` once the carry is over, however it ends. */
export function useCardCarry(
  itemId: string, ref: RefObject<HTMLElement | null>,
  { enabled, onLift, onLand }: { enabled: boolean; onLift: () => void; onLand?: () => void },
): ListCarry {
  return useListCarry(ref, {
    enabled, onLift, onLand,
    lift: (hold) => carryItem(itemId, { ...hold, picksOnReturn: modalityOf(hold) === 'touch' }),
  });
}
