/**
 * Shared single-line, horizontally scrollable tab row for bottom shelves. The active underline,
 * focused tab, and externally selected tab are revealed automatically. Wheel behavior matches the
 * item row. `active` may be null while search results span categories.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useScrollFade } from '../../primitives/scroll-fade';
import { btnReset, cursors, pressable } from '../../design/styles';
import { ACTIVE } from '../../design/tokens';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import type { HelpPageId } from '../../chrome/modals/help/page-schema';
import { SHELF_TABS, TEXT } from '../units';
import { BarText } from './bar-atoms';
import { reveal, useFrameZoom, wheelGlider, wheelPush } from './row-scroll';

/** The row's own box, which the shelf places a sibling (a search field, a row of actions) into. */
export const TAB_ROW: CSSProperties = {
  display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: SHELF_TABS.gap,
};

/**
 * Room around the names inside the scroller, in css px, taken straight back off as margin so that
 * none of the row's own edges move: a scroll container clips at its padding box, and a focus ring
 * stands 5 px outside the name it rings while the hover growth stands about 2 px outside it.
 * Without the slack the first and the last name are ringed on three sides.
 */
const SLACK = 6;

/** How far a cut name is softened at an end the row can still travel toward, in css px. A name
 *  sliced at a hard vertical edge — which on the object shelf is exactly where the search field
 *  begins — reads as a drawing error rather than as a row that continues. */
const FADE = 24;

/** How far the fade reaches INTO the last whole name instead, in css px: about one glyph of a 28 px
 *  word, which is enough to see dissolve. */
const BITE = 26;

/**
 * How wide the fade has to be at one end of the row for it to land on a NAME.
 *
 * The fade is the whole of what says the row continues, and it can only say it over something that
 * is drawn: the names stand on the map, so a fade that stops in the gutter between two of them
 * covers bare ground and shows nothing at all. That is not a rare case — at 1440 in English the row
 * ends a couple of pixels past "Ramps" with "Facilities" wholly hidden and no sign of it — and a
 * fixed width cannot cover it, since the gutter between two names is wider than any fade that would
 * not also wash out a short one.
 *
 * So: where a name is already cut by this edge the fixed width softens the cut, and where the edge
 * falls in a gutter the fade stretches back until it bites the last whole name. It never takes more
 * than a part of that name, so the word still reads.
 */
function fadeAt(row: HTMLElement, edge: number, atEnd: boolean): number {
  const tabs = [...row.children] as HTMLElement[];
  if (tabs.some((el) => el.offsetLeft < edge && el.offsetLeft + el.offsetWidth > edge)) return FADE;
  const near = atEnd
    ? tabs.filter((el) => el.offsetLeft + el.offsetWidth <= edge).pop()
    : tabs.find((el) => el.offsetLeft >= edge);
  if (!near) return FADE;
  // A tab's box carries `padX` either side of its word, so the ink stops short of both its edges.
  const ink = Math.max(0, near.offsetWidth - 2 * SHELF_TABS.padX);
  const bare = atEnd
    ? edge - (near.offsetLeft + near.offsetWidth - SHELF_TABS.padX)
    : near.offsetLeft + SHELF_TABS.padX - edge;
  return Math.max(FADE, bare + Math.min(BITE, ink * 0.4));
}

export interface ShelfTabEntry<T extends string> {
  id: T;
  label: string;
  /** Which Help Center page this tab's own kind answers with, where it differs from the shelf's
   *  own page (the generator's kinds each open a different tool). */
  helpTarget?: HelpPageId;
}

function ShelfTabButton({ label, active, onSelect, helpTarget }: {
  label: string;
  active: boolean;
  onSelect: () => void;
  helpTarget?: HelpPageId;
}) {
  return (
    <motion.button
      type="button"
      {...pressable}
      {...(helpTarget ? helpTargetAttr(helpTarget) : {})}
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onFocus={(e) => reveal(e.currentTarget)}
      style={{
        ...btnReset, position: 'relative', flex: 'none', pointerEvents: 'auto',
        cursor: cursors.clickable, padding: `0 ${SHELF_TABS.padX}px`,
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        gap: SHELF_TABS.underlineGap,
      }}
    >
      {/* On the map, not on the plate: the band starts below this row. */}
      <BarText size={TEXT.shelfTab} onMap>
        {label}
      </BarText>
      {/* Drawn on the unchosen tabs too, transparent: a mark that appeared on selection would nudge
          the whole row down as the visitor moved between names. */}
      <span
        data-testid="shell-shelf-tab-mark"
        style={{
          height: SHELF_TABS.underline, borderRadius: SHELF_TABS.underline,
          background: active ? ACTIVE : 'transparent',
        }}
      />
    </motion.button>
  );
}

export function ShelfTabs<T extends string>({ label, tabs, active, onSelect }: {
  label: string;
  tabs: readonly ShelfTabEntry<T>[];
  active: T | null;
  onSelect: (id: T) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const zoom = useFrameZoom();
  const reducedMotion = useReducedMotionConfig() ?? false;
  const glide = useRef(wheelGlider()).current;
  // The hook's own binding effect carries no dependency list, so it re-measures on every render of
  // this component — a locale change (new `tabs` labels, same row box) reaches it the same way a
  // resize does, with no extra wiring needed here.
  const fade = useScrollFade(rowRef, 'x', { fadeAt });

  // The chosen tab is read out of the row rather than carried by a ref: a motion element's
  // forwarded ref callback is identity-stable, so a ref prop that CHANGES on a persistent button
  // is never re-invoked — a conditional ref here stays on whichever tab was active at first mount,
  // and every later choice brings THAT one back, scrolling the row home under the click.
  useLayoutEffect(() => {
    reveal(rowRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'));
  }, [active]);

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label={label}
      className="pw-noscroll"
      onWheel={(e) => {
        const row = e.currentTarget;
        // A row that fits its content has room <= 0, so the wheel writes nothing there. A notch
        // GLIDES through the glider's own approach (row-scroll.ts); reduced motion lands it at once.
        const room = row.scrollWidth - row.clientWidth;
        const push = room > 0 ? wheelPush(e, row.clientWidth, zoom) : null;
        if (push) glide.wheel(row, push.by, reducedMotion);
      }}
      style={{
        // Positioned, so a name's `offsetLeft` is measured from the row's own box and the fade can
        // be told where the words are; static, it would report against the shelf's row instead.
        position: 'relative',
        // Solid, gaps between names included: the shelf's root is pointer-transparent, so without
        // this a wheel between two names falls through to the map instead of gliding the row.
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'flex-end', flexWrap: 'nowrap', gap: SHELF_TABS.gap,
        // Shrinkable to nothing, so the row gives way to whatever stands beside it rather than
        // pushing it: the search field keeps its place and the names take the shortfall.
        flex: '0 1 auto', minWidth: 0,
        overflowX: 'auto', overflowY: 'hidden',
        padding: SLACK, margin: -SLACK,
        ...fade,
      }}
    >
      {tabs.map((tab) => (
        <ShelfTabButton
          key={tab.id}
          label={tab.label}
          active={tab.id === active}
          onSelect={() => onSelect(tab.id)}
          {...(tab.helpTarget ? { helpTarget: tab.helpTarget } : {})}
        />
      ))}
    </div>
  );
}
