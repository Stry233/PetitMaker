import { useState } from 'react';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useWindowRoom, useWindowSettledWidth } from '../../primitives/ModalShell';
import { useWindowCard } from '../../primitives/Window';

/** The narrowest body, in css px, that keeps two columns by default. A landscape window's cap leaves
 *  a padded card at least 94 % of 700 px less its 50 px frame (the fit never exceeds window / 700),
 *  so no landscape window switches at this value. */
export const TWO_COLUMNS_FROM = 600;

/** The height, in css px, of a picture standing above its form in a one-column window body. */
export const STACKED_PREVIEW_HEIGHT = 150;

/** The body's measured width and how much narrower it stands than the card's content, in css px. */
interface BodyFit { width: number; inset: number }

/** The card's content width, its padding taken off, in its own css px. */
function contentWidth(card: HTMLElement): number {
  const cs = getComputedStyle(card);
  return card.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}

/** How many columns a window body lays out in: two while the body is at least `threshold` css px
 *  wide (its own px, under the card's zoom), one below. Attach `ref` to the body, whose width must
 *  not follow its column count; the observer follows the element as it mounts and unmounts. An
 *  unmeasured body (no layout yet) keeps two. In a card morphing between sizes the body is judged at
 *  the width it will have once the card lands, so a section turned to mid-morph never passes through
 *  the other layout. */
export function useWindowColumns(threshold = TWO_COLUMNS_FROM): readonly [1 | 2, (body: HTMLElement | null) => void] {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [fit, setFit] = useState<BodyFit>({ width: 0, inset: 0 });
  const card = useWindowCard();
  const settled = useWindowSettledWidth();
  useObservedSize(() => body, ([el]) => {
    // A hidden body (a section not shown) has no width to judge and keeps its last reading.
    if (!el || el.clientWidth === 0) return;
    const width = el.clientWidth;
    // A card with no layout of its own yet counts as the body's own width.
    const content = card?.current ? contentWidth(card.current) : 0;
    const inset = content > 0 ? content - width : 0;
    setFit((was) => (was.width === width && was.inset === inset ? was : { width, inset }));
  }, [body, card]);
  const width = fit.width > 0 && settled !== null ? settled - fit.inset : fit.width;
  return [width > 0 && width < threshold ? 1 : 2, setBody];
}

/** The same switch for a window that sizes its card to its own layout, read from the room the card
 *  may take (`ModalShell.tsx:useWindowRoom`) rather than from a body that would follow the choice. */
export function useRoomColumns(threshold: number): 1 | 2 {
  const room = useWindowRoom() ?? 0;
  return room > 0 && room < threshold ? 1 : 2;
}
