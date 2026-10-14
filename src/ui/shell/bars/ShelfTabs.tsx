/**
 * The bottom shelves' one-line scrolling tab row: the active, focused or externally chosen tab is revealed,
 * the wheel behaves as the item row's, and `active` may be null during a search.
 */
import { ActionButton } from '../../primitives/ActionButton';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { CONTROL_CLEARANCE, useScrollRow } from '../../primitives/use-scroll-row';
import { btnReset, cursors } from '../../design/styles';
import { ACTIVE } from '../../design/tokens';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../help/page-schema';
import { SHELF_TABS, TEXT } from '../units';
import { BarText } from './bar-atoms';
import { reveal } from './row-scroll';
import { useFrameZoom } from '../use-frame-zoom';

/** The row's own box, which the shelf places a sibling (a search field, a row of actions) into. */
export const TAB_ROW: CSSProperties = {
  display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: SHELF_TABS.gap,
};

/** How far a cut name is softened at an end the row can still travel toward, in css px. A name
 *  sliced at a hard vertical edge — which on the object shelf is exactly where the search field
 *  begins — reads as a drawing error rather than as a row that continues. */
const FADE = 24;

/** How far the fade reaches into the last whole name instead, in css px: about one glyph of a shelf
 *  label, which is enough to see dissolve. */
const BITE = 26;

/**
 * How wide the fade at one end must be to land on a name: a fade in the gutter between names shows
 * nothing, so it stretches back to bite part of the last whole name.
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

interface ShelfTabEntry<T extends string> {
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
    <ActionButton
      interaction="tile"
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
    </ActionButton>
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
  // The hook's own binding effect carries no dependency list, so it re-measures on every render of
  // this component — a locale change (new `tabs` labels, same row box) reaches it the same way a
  // resize does, with no extra wiring needed here.
  const fade = useScrollRow(rowRef, { zoom, bleed: CONTROL_CLEARANCE, pointerEvents: 'auto', fade: { fadeAt } });

  // The chosen tab is read from the row, not a ref: a persistent motion button's forwarded ref is never re-invoked.
  useLayoutEffect(() => {
    reveal(rowRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'));
  }, [active]);

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label={label}
      className="pw-noscroll"
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
