/** The one carry of a shelf card or a blueprint onto the map, which both card carries take. */
import { useEditorStore } from '../../state/store';
import { startCarry, type Carry } from '../../view/interaction/pointer/carry';

const store = () => useEditorStore.getState();

/** The pointer carrying a card: its id, the element holding its capture, and what to tell the card
 *  when the carry ends, however it ends. */
export interface CardHold {
  pointerId: number;
  surface: HTMLElement | null;
  onEnd: () => void;
}

/** What a carry arms and gives back, which each kind of card answers for itself. */
interface CardArming {
  /** Arms the card for the carry; false where it cannot be armed here. */
  arm(): boolean;
  /** Puts back what was armed before the carry, as an ending off the map does. */
  giveBack(): void;
  /** What a drop the map took leaves armed; absent, the card stays armed. */
  dropped?(): void;
  /** The carry was let go without the pointer ever reaching the map. */
  stayed?(): void;
}

/**
 * Carries `card` onto the map (`view/interaction/pointer/carry.ts`): armed for the carry, so the drop
 * is the armed tool's own press and release. The carry is a purpose of its own (`setCarrying`), which
 * puts the selection down even for the card already armed. Any ending but a drop gives back what was
 * armed and that selection; leaving the mode it began in ends the carry at once, so a later release
 * runs no other mode's tool, and gives back nothing, since the mode moved on. Null when the card
 * cannot be armed.
 */
export function carryCard(card: string, hold: CardHold, arming: CardArming): Carry | null {
  const selection = store().selection;
  if (!arming.arm()) return null;
  store().setCarrying(card);
  const mode = store().editMode.mode;
  let unwatch = (): void => {};
  const carry = startCarry({
    pointerId: hold.pointerId,
    surface: hold.surface,
    end: (dropped, stayed) => {
      unwatch();
      store().setCarrying(null);
      if (dropped) arming.dropped?.();
      else if (store().editMode.mode === mode) {
        arming.giveBack();
        if (selection.length > 0) store().restoreSelection(selection);
      }
      if (stayed) arming.stayed?.();
      hold.onEnd();
    },
  });
  unwatch = useEditorStore.subscribe((s) => { if (s.editMode.mode !== mode) carry.cancel(); });
  return carry;
}
