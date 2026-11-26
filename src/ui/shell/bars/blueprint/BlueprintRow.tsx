/**
 * The Blueprint strip on a wide window, at rest: the Generate shelf's arrangement with the object
 * shelf's search. The folder names, then New folder and the field, over one scrolling row of cards
 * led by New blueprint, Expand as the square at its end, and under it the row's scrollbar. While a
 * card is carried the square stands as the delete target. It
 * stands on the band its shelf draws (`BlueprintShelf.tsx`).
 */
import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { usePx } from '../../../design/scale';
import { PLATE_INK } from '../../../design/tokens';
import { FitIcon } from '../../../primitives/line-glyphs';
import { scrollBleed, useScrollRow } from '../../../primitives/use-scroll-row';
import { useSwapReel } from '../../../primitives/use-swap-clip';
import { useFrameLayout, usePlanGlide, useRailClearance } from '../../frame-layout';
import { useFrameZoom } from '../../use-frame-zoom';
import { roleSize } from '../../../design/text-weight';
import { RAIL, SHELF_TABS } from '../../units';
import type { BarSurface } from '../bar-panel';
import { TAB_ROW, namesIndent } from '../ShelfTabs';
import { ShelfAction } from '../generate/generate-controls';
import { BATCH, CHOSEN, GAP, PAD, PAIR_GAP, STRIP, bodyHeight } from '../generate/generate-shelf';
import { BinSquare, SwapFace } from './BinSquare';
import { SCROLL, SEARCH } from '../objects/object-shelf';
import { ShelfScrollbar, useShelfScrollbar } from '../ShelfScrollbar';
import { ShelfSearchField } from '../objects/ShelfSearchField';
import { CarryCancel } from '../objects/CarryCancel';
import { useTouchMode } from '../../../design/input-mode';
import { cardBleed, stripCard } from './BlueprintCard';
import { NewFolderButton } from './blueprint-asks';
import { StripCards } from './StripCards';
import { FolderTabs } from './FolderTabs';
import { SQUARE_RIDE, usePieces, type BlueprintShelfModel } from './use-blueprint-shelf';
import { BLUEPRINT_ORDER_ATTR, useReorderGlide } from './use-blueprint-carry';
import { tourTargetAttr } from '../../../chrome/tour/steps';

/** The squares' glyph side, in css px. */
const SQUARE_GLYPH = 30;

/** The row's id, which its scrollbar names as what it scrolls. */
const ROW_ID = 'shell-blueprint-row';

export function BlueprintRow({ model, surface }: { model: BlueprintShelfModel; surface: BarSurface }) {
  const t = useT();
  const { px, scale } = usePx();
  const zoom = useFrameZoom();
  const layout = useFrameLayout();
  const { bar, content } = surface;
  const piece = usePieces();
  const clearance = useRailClearance(PAD.bottom + STRIP.h + STRIP.gap, bar.tabsTop + roleSize('title'));
  const right = layout ? layout.edgeRight + clearance : PAD.right;
  const adapt = usePlanGlide('frame.layout.adapt');
  const reelKey = model.searching ? 'search' : model.folder ?? '';
  // The row the strip opens or folds back to stands at once, its cards travelling in as pieces of the
  // unfolding; only another folder or search brings a fresh reel in.
  const swap = useSwapReel(reelKey, { fromRest: true });
  /** A finger carries one card off the row to the map: a release over the shelf puts it back. */
  const carried = useTouchMode() && model.carry.carrying === 'one';

  const { w: cardW, h: cardH } = stripCard(layout, scale);
  const bodyH = bodyHeight(bar.tabsTop);
  const chosenOut = Math.ceil(cardH * CHOSEN.insetY);
  // The square narrows where the row would leave room for fewer than three cards, as Generate's squares do.
  const narrow = layout ? layout.width - right - PAD.side < cardW * 3 : false;
  const squareW = narrow ? RAIL.button : cardH * BATCH.wide;
  const squareH = narrow ? (cardH - PAIR_GAP) / 2 : cardH;
  const rowGap = bar.tabsTop - PAD.bottom - bodyH;

  const rowRef = useRef<HTMLDivElement>(null);
  const cardsFade = useScrollRow(rowRef, { zoom, pointerEvents: 'auto', });
  // Another folder or query starts the row at its first card.
  const scroll = useShelfScrollbar(rowRef, { id: ROW_ID, content: [model.records.length], reset: `${reelKey}|${model.query}` });
  const glide = useReorderGlide(model.carry, 'row', null, rowRef);
  const binning = model.carry.carrying !== null;
  const unfoldPiece = piece('unfold', undefined, SQUARE_RIDE);

  return (
    <div
      data-testid="shell-blueprint-shelf"
      style={{
        position: 'relative', width: '100%', boxSizing: 'border-box',
        padding: `${PAD.top}px ${layout?.edgeRight ?? PAD.right}px ${PAD.bottom}px ${PAD.side}px`,
        transition: adapt(['padding-right']),
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: rowGap,
      }}
    >
      {/* The folder names, and New folder with the field at the row's far end, over the square. */}
      <div {...content.tabs} style={{
        ...TAB_ROW, flexWrap: 'nowrap', position: 'relative', marginLeft: namesIndent(bar),
        marginRight: layout ? clearance : 0, transition: adapt(['margin-right']),
      }}>
        <FolderTabs model={model} />
        <span style={{ flex: '1 1 0', minWidth: SHELF_TABS.gap }} />
        {/* New folder and the field are one group, as the object shelf's brush button and field are. */}
        <div style={{
          flex: '0 1 auto', display: 'flex', alignItems: 'center', gap: SEARCH.group.gap, width: SEARCH.group.w,
          minWidth: SEARCH.h * 4 + SEARCH.group.gap, marginBottom: SEARCH.bottom,
        }}>
          <NewFolderButton model={model} size={SEARCH.h} piece={piece('new-folder')} />
          <ShelfSearchField
            value={model.query}
            onChange={model.setQuery}
            ariaLabel={t('shelf.search')}
            placeholder={t('shelf.search_ph')}
            wrapAttrs={piece('search')}
            wrapStyle={{ flex: '1 1 0', minWidth: SEARCH.h * 3, width: 'auto', pointerEvents: 'auto' }}
          />
        </div>
      </div>

      <div {...content.start} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', height: bodyH, gap: STRIP.gap }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', height: cardH, minWidth: 0, marginRight: layout ? clearance : 0, transition: adapt(['margin-right']) }}>
          {carried ? <CarryCancel style={{ position: 'absolute', inset: 0 }} /> : null}
          <div
            {...scroll.row}
            ref={rowRef}
            className="pw-noscroll"
            data-testid="blueprint-cards"
            {...{ [BLUEPRINT_ORDER_ATTR]: 'row' }}
            style={{
              position: 'relative', display: 'flex', alignItems: 'stretch', flex: '0 1 auto', minWidth: 0,
              height: cardH + 2 * chosenOut, ...scrollBleed(cardBleed(cardW, cardH)), ...cardsFade, ...swap.clip,
              // The carried card stays mounted, out of sight, under the cancel line.
              ...(carried ? { visibility: 'hidden' } : null),
            }}
          >
            {/* Another folder or search brings its cards in as one reel, as a category does on the object shelf. */}
            <motion.div
              key={reelKey}
              {...swap.reel}
              style={{ display: 'flex', alignItems: 'center', gap: GAP.card, flex: 'none' }}
            >
              <StripCards model={model} glide={glide} cardW={cardW} />
            </motion.div>
          </div>
          {/* Expand acts on the library, so it stands outside the scroll, past the last card. A pointer
              reaching it, or the focus, mounts the explorer out of sight, ready to unfold. */}
          <div onPointerEnter={() => model.setWarm(true)} onPointerDown={() => model.setWarm(true)} onFocus={() => model.setWarm(true)}
            onPointerLeave={() => model.setWarm(false)} onBlur={() => model.setWarm(false)} style={{ position: 'relative', flex: '0 0 auto', marginLeft: GAP.card, height: cardH, width: squareW, transition: adapt(['width']) }}>
            {/* While anything is carried the square gives way to the delete target, the two crossfading where they stand. */}
            <SwapFace shown={binning} style={{ position: 'absolute', inset: 0 }}>
              <BinSquare over={model.carry.overBin} width={squareW} height={squareH} radius={px(BATCH.radius)} glyph={SQUARE_GLYPH}
                {...(binning ? { piece: unfoldPiece } : {})} />
            </SwapFace>
            <SwapFace shown={!binning} style={{ position: 'absolute', inset: 0 }}>
              <ShelfAction label={t('blueprint.unfold')} testId="shell-blueprint-unfold" busy={false} pressed={false}
                piece={{ ...(binning ? {} : unfoldPiece), ...tourTargetAttr('blueprint-unfold') }}
                width={squareW} height={squareH} radius={px(BATCH.radius)} reach={{}} onPress={() => model.unfold(true)} at={{ left: 0, top: 0 }}>
                <span aria-hidden style={{ display: 'flex', color: PLATE_INK }}><FitIcon size={SQUARE_GLYPH} /></span>
              </ShelfAction>
            </SwapFace>
          </div>
        </div>

        {/* The strip's own row: where the row is scrolled; the explorer has none, so it fades where it stands. */}
        <div {...piece('scrollbar')} style={{ position: 'relative', height: STRIP.h, minWidth: 0, marginRight: layout ? clearance : 0 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: (STRIP.h - px(SCROLL.thumb.h)) / 2, height: px(SCROLL.thumb.h), pointerEvents: 'none' }}>
            <ShelfScrollbar label={t('blueprint.scrollbar')} {...scroll.bar} />
          </div>
        </div>
      </div>
    </div>
  );
}
