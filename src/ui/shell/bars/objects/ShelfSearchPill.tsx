/**
 * The object shelf's round search button, which grows in place along the names' row into the search
 * field and shrinks back when closed (UI-28), on the upright panel and on a wide shelf short of room.
 * It stands at the right end of the positioned row it covers when open; what it covers fades under it
 * through `underOpenSearch`.
 */
import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { useT } from '../../../../i18n/context';
import { cssMotion } from '../../../design/motion';
import { btnReset, cursors, radii } from '../../../design/styles';
import { PLATE, PLATE_INK } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { SearchIcon } from '../../../primitives/line-glyphs';
import { TouchReach } from '../../../primitives/TouchReach';
import { useSwapClip } from '../../../primitives/use-swap-clip';
import { helpTargetAttr } from '../../../session/help-targets';
import { useFrameZoom } from '../../use-frame-zoom';
import { ShelfSearchField } from './ShelfSearchField';

/** The search drawing's side as a share of the button's. */
const ICON_SHARE = 20 / 44;

/** What a row part the open field covers wears: out of reach and faded while the field is open. */
export function underOpenSearch(open: boolean, reduced: boolean | null): {
  attrs: HTMLAttributes<HTMLElement> & { inert?: '' }; style: CSSProperties;
} {
  return {
    attrs: { 'aria-hidden': open || undefined, ...(open ? { inert: '' } : {}) },
    style: { opacity: open ? 0 : 1, transition: cssMotion('shelf.search.expand', ['opacity'], reduced) },
  };
}

/** `size` is the button's side in the row's px; `style` places the pill in its row (its top or foot, an
 *  edge on the map). Closing the field clears the query. */
export function ShelfSearchPill({ size, open, onOpenChange, query, setQuery, reduced, style }: {
  size: number; open: boolean; onOpenChange: (open: boolean) => void;
  query: string; setQuery: (query: string) => void; reduced: boolean | null; style?: CSSProperties;
}) {
  const t = useT();
  const zoom = useFrameZoom();
  const ref = useRef<HTMLDivElement>(null);
  // The field outgrows the pill only while the pill's width grows, so the pill clips only then and the
  // focus rings of its button and field, drawn outside them, show at rest.
  const clip = useSwapClip(open ? 'open' : 'shut', { fromRest: true });
  const wasOpen = useRef(open);
  // The field opened from the button takes the keyboard at once.
  useEffect(() => {
    if (open && !wasOpen.current) ref.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <div
      ref={ref}
      data-testid="shell-search-pill"
      style={{
        position: 'absolute', right: 0, width: open ? '100%' : size, height: size, borderRadius: radii.pill,
        background: PLATE, transition: cssMotion('shelf.search.expand', ['width'], reduced), ...clip.clip, ...style,
      }}
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === 'width') clip.settle(); }}
    >
      {open ? (
        <ShelfSearchField
          value={query}
          onChange={setQuery}
          ariaLabel={t('shelf.search')}
          placeholder={t('shelf.search_ph')}
          inPill={{ padX: size }}
          wrapStyle={{ position: 'absolute', inset: 0, width: 'auto', height: 'auto', borderRadius: radii.pill, pointerEvents: 'auto' }}
          wrapAttrs={helpTargetAttr('search')}
        />
      ) : null}
      <ActionButton
        interaction="action"
        aria-label={t('shelf.search')}
        aria-expanded={open}
        onClick={() => { if (open) setQuery(''); onOpenChange(!open); }}
        style={{
          ...btnReset, position: 'absolute', right: 0, top: 0, width: size, height: size, borderRadius: radii.pill,
          background: 'transparent', color: PLATE_INK, cursor: cursors.clickable, pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <SearchIcon size={Math.round(size * ICON_SHARE)} />
        <TouchReach w={size} h={size} zoom={zoom} />
      </ActionButton>
    </div>
  );
}
