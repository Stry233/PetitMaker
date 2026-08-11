/*
 * ShelfTabs.tsx — the row of names that heads a bottom shelf, and one name in it.
 *
 * Both bottom shelves are headed the same way, and it is ONE element used twice rather than two
 * that resemble each other: the names stand on the map above the backing band, at the shelf's own
 * left edge, each as wide as its own word at one constant size, over a mark drawn to that width.
 *
 * The row is ANCHORED. It is the first thing in a shelf that is laid out from the left and from the
 * top of its own block, so nothing that stands beside it or under it — a control that only one
 * algorithm has, a sentence that runs to two lines, a candidate card that is shorter on a laptop —
 * can move a name. A row of tabs that shifted as the visitor moved through it would make the next
 * tab a moving target.
 *
 * `active` is nullable because a row can have nothing in force: the object shelf shows a search
 * result under names that then describe none of what is on screen.
 *
 * THE MARK IS WHAT IS CHOSEN, NOT THE WORD. Every name is the same warm off-white on the same
 * outline, and the yellow bar under one of them is the whole difference — which is how the game
 * marks its own category row. Colouring the chosen word instead put the one name the eye is meant
 * to find in the interface's lightest colour, over an island whose sand border is nearly that
 * colour already.
 *
 * IT TRAVELS SIDEWAYS RATHER THAN WRAPPING. Six category names at one fixed size are wider than the
 * room left beside the search field in every language but Chinese and Japanese — English included —
 * and wrapping them ran the row onto two lines: the shelf grew upward into the map, the names
 * stopped being one line to read along, and the mark under the chosen one could sit under a line
 * the eye had already left. So the row is one line that scrolls. It is a scroller only where there
 * is something to scroll: the generator's two names never fill their row, and every part of this —
 * the fade, the wheel, the reveal — resolves to nothing there.
 *
 * IT TAKES THE WHEEL BY THE SAME RULE THE ITEM ROW DOES (`row-scroll.ts:wheelPush`). The two rows
 * stand one above the other with a band of bare map between them, and the pointer is over one or
 * the other; what would confuse is two rows answering one gesture differently, not each answering
 * it. Withholding the wheel here also takes away the only pointer reach a name pushed off the end
 * has: a scroll container offers a mouse no grip, and the keyboard is not reach.
 *
 * THE CHOSEN NAME IS BROUGHT BACK, and the routes that need it are the ones that are not a click on
 * the name: the shelf opens on the armed item's own category, which can be the last of the six, and
 * clearing a search puts a category back in force. A focused name is brought back too, which is
 * what makes every tab reachable from the keyboard.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useLayoutEffect, useRef, type CSSProperties, type Ref } from 'react';
import { useScrollFade } from '../../primitives/scroll-fade';
import { btnReset, cursors, pressable } from '../../design/styles';
import { ACTIVE } from '../../design/tokens';
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
 * covers bare island and shows nothing at all. That is not a rare case — at 1440 in English the row
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
}

function ShelfTabButton({ label, active, buttonRef, onSelect }: {
  label: string;
  active: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}) {
  return (
    <motion.button
      ref={buttonRef}
      type="button"
      {...pressable}
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
  const activeRef = useRef<HTMLButtonElement>(null);
  const zoom = useFrameZoom();
  const reducedMotion = useReducedMotionConfig() ?? false;
  const glide = useRef(wheelGlider()).current;
  // The hook's own binding effect carries no dependency list, so it re-measures on every render of
  // this component — a locale change (new `tabs` labels, same row box) reaches it the same way a
  // resize does, with no extra wiring needed here.
  const fade = useScrollFade(rowRef, 'x', { fadeAt });

  useLayoutEffect(() => { reveal(activeRef.current); }, [active]);

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
          buttonRef={tab.id === active ? activeRef : undefined}
          onSelect={() => onSelect(tab.id)}
        />
      ))}
    </div>
  );
}
