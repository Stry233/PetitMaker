/**
 * The Blueprint strip on an upright window: the dark panel the bar raises, in the upright object
 * panel's grammar. The seam handle in its top padding, the folder names with New folder and search
 * as round buttons at the row's end, and under them one scrolling row of cards led by New blueprint. The handle alone
 * unfolds it, exactly as it draws the object panel taller: the panel's top follows the finger, stays
 * where it is let go and keeps that height for the session (`slices/blueprint.ts:uprightHeight`), and
 * let go below the turn it rests as the strip; unfolded, the cards travel into the explorer's grid.
 * While a card or stack is carried, the delete target stands at the head's end in place of New folder
 * and search, crossfading with them as the wide strip's unfold square does.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { helpTargetAttr } from '../../../session/help-targets';
import { tourTargetAttr } from '../../../chrome/tour/steps';
import { useEditorStore } from '../../../../state/store';
import { useUiPreview } from '../../../design/preview';
import { TOUCH_TARGET, usePx } from '../../../design/scale';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { MORPHING_ATTR, morphScope, type MorphFirst } from '../../../primitives/morph';
import { MorphOnChange } from '../../../primitives/MorphOnChange';
import { SEAM_HANDLE, SeamHandle } from '../../../primitives/SeamHandle';
import { scrollBleed, useScrollRow } from '../../../primitives/use-scroll-row';
import { useFrameLayout } from '../../frame-layout';
import { useFrameZoom } from '../../use-frame-zoom';
import { SHELF_TABS, UPRIGHT_SPACE } from '../../units';
import { PanelTone, useBarSurface } from '../bar-panel';
import { useHandleFollow } from '../use-handle-follow';
import { TAB_MARK_DEPTH } from '../ShelfTabs';
import { CHOSEN } from '../generate/generate-shelf';
import { UPRIGHT_GRID } from '../objects/object-shelf';
import { ShelfSearchPill, underOpenSearch } from '../objects/ShelfSearchPill';
import { GRID_SURROUND, uprightGridHeight } from '../objects/UprightObjectPanel';
import { CarryCancel } from '../objects/CarryCancel';
import { useTouchMode } from '../../../design/input-mode';
import { cardBleed, stripCard } from './BlueprintCard';
import { NewFolderButton } from './blueprint-asks';
import { StripCards } from './StripCards';
import { BinSquare, SwapFace } from './BinSquare';
import { radii } from '../../../design/styles';
import { FolderTabs } from './FolderTabs';
import { UprightBlueprintExplorer, uprightExplorerLeast } from './UprightBlueprintExplorer';
import { ExplorerKept, explorerViewIn } from './BlueprintExplorer';
import { usePieces, useShelfChange, type BlueprintShelfModel, type ShelfChange } from './use-blueprint-shelf';
import { BLUEPRINT_ORDER_ATTR, BLUEPRINT_SHELF_ATTR, CARRY_EDGE_ATTR, useReorderGlide } from './use-blueprint-carry';

export function UprightBlueprintPanel({ model }: { model: BlueprintShelfModel }) {
  const t = useT();
  const zoom = useFrameZoom();
  const layout = useFrameLayout()!;
  const { scale } = usePx();
  const reduced = useReducedMotionConfig();
  const preview = useUiPreview();
  const still = reduced === true || preview;
  const piece = usePieces();
  const [searchOpen, setSearchOpen] = useState(false);
  const under = underOpenSearch(searchOpen, reduced);
  const setUi = useEditorStore((s) => s.setBlueprintUi);
  const asked = useEditorStore((s) => s.blueprint.uprightHeight);
  const rowRef = useRef<HTMLDivElement>(null);
  const fade = useScrollRow(rowRef, { zoom, pointerEvents: 'auto' });
  /** A finger carries one card off the row to the map: a release over the panel puts it back. */
  const touch = useTouchMode();
  const carried = touch && model.carry.carrying === 'one';
  const glide = useReorderGlide(model.carry, 'row', null, rowRef);
  const binning = model.carry.carrying !== null;

  // Cards keep the object grid's column measure, so the two panels' cards stand to one scale.
  const room = layout.width - layout.edgeLeft - layout.edgeRight;
  const { w: cardW, h: cardH } = stripCard(layout, scale);
  const chosenOut = Math.ceil(cardH * CHOSEN.insetY);
  // A button's top, level with the names rather than with the names and their marks.
  const level = { top: '50%', marginTop: -(TOUCH_TARGET + TAB_MARK_DEPTH) / 2 };

  // What stands under the head: the strip's one row at rest, the explorer unfolded, which turns where
  // a let-go height passes halfway from the row to the explorer's least.
  const rowH = cardH + 2 * chosenOut;
  const explorerLeast = uprightExplorerLeast(room, touch);
  const turn = (rowH + explorerLeast) / 2;
  const { most, kept, step, height } = uprightGridHeight({
    asked: model.unfolded ? asked : null, least: rowH, turn, resting: model.unfolded ? Infinity : rowH,
    room: layout.bar.room, reach: layout.bar.reach,
  });
  const settled = model.unfolded ? Math.max(explorerLeast, height) : rowH;

  const stageRef = useRef<HTMLDivElement>(null);
  /** A held handle drives the stage's height, which it writes past React on each move. */
  const { following, follow } = useHandleFollow({ settled, kept, zoom, boxes: () => [stageRef.current] });
  const { root, reveal } = useBarSurface('dark', { top: 0, scroll: false, following, least: GRID_SURROUND + rowH });

  const [morph] = useState(() => morphScope({ lift: true }));
  useEffect(() => () => morph.stop(), [morph]);
  /** A turn measured as the handle let go, while the stage still stood at the height the finger held. */
  const released = useRef<MorphFirst | null>(null);
  const shelfChange = useShelfChange(model);
  const changing = useRef<ShelfChange>('unfold');
  const measureTurn = (): MorphFirst | null => {
    const was = released.current;
    released.current = null;
    changing.current = shelfChange.changing();
    if (was || still || !stageRef.current) return was;
    const view = changing.current === 'arrange' ? explorerViewIn(stageRef.current) : stageRef.current;
    return view ? morph.measure(view) : null;
  };
  // A release measured for a turn its commit did not make is dropped with the hold it set on the stage.
  useLayoutEffect(() => {
    if (!released.current) return;
    released.current = null;
    stageRef.current?.removeAttribute(MORPHING_ATTR);
  });

  /** Settles the stage at `next` frame px: unfolded at that height past the turn, else the strip. */
  const settle = (next: number, measure: boolean) => {
    const unfolded = next >= turn;
    if (measure && unfolded !== model.unfolded && !still && stageRef.current) released.current = morph.measure(stageRef.current);
    if (!unfolded) { if (model.unfolded) model.unfold(false); return; }
    const choice = { uprightHeight: Math.max(explorerLeast, next) };
    if (model.unfolded) setUi(choice); else model.unfold(true, choice);
  };
  /** A drag of `dy` visual px kept to what leaves the stage between the strip's row and its most. */
  const clampDrag = (dy: number) => Math.min((settled - rowH) * zoom, Math.max((settled - most) * zoom, dy));

  return (
    <motion.div
      {...helpTargetAttr('blueprint')}
      {...mapEdgeAttr('bottom')}
      {...reveal}
      {...root}
      {...{ [CARRY_EDGE_ATTR]: '', [BLUEPRINT_SHELF_ATTR]: '' }}
      data-testid="shell-blueprint-shelf"
      style={{ ...root.style, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: UPRIGHT_SPACE.row }}
    >
      <PanelTone tone="dark">
        <SeamHandle
          label={t('blueprint.resize')}
          zoom={zoom}
          value={{ now: Math.round(settled), min: Math.round(rowH), max: Math.round(most) }}
          clamp={clampDrag}
          onDrag={follow}
          onRelease={(dy) => settle(kept(settled - dy / zoom), true)}
          onStep={(direction) => settle(step(-direction * explorerLeast / 2), false)}
          follows
          plate="dark"
          testId="shell-blueprint-handle"
          marks={tourTargetAttr('blueprint-unfold')}
          reach={null}
          gripReach={{ bottom: false, top: most - settled >= TOUCH_TARGET }}
          // The panel's column gap stands under it; the handle's own strip is the air over the head.
          style={{ position: 'relative', flex: 'none', height: SEAM_HANDLE.h, marginBottom: -UPRIGHT_SPACE.row, zIndex: 1 }}
        />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', minHeight: TOUCH_TARGET }}>
          {/* The names give way to the open field as the object panel's do. */}
          <div {...under.attrs} {...tourTargetAttr('blueprint-folders')} style={{
            flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'flex-end', gap: SHELF_TABS.gap,
            marginRight: 2 * (TOUCH_TARGET + UPRIGHT_GRID.gap), ...under.style,
          }}>
            <FolderTabs model={model} />
          </div>
          {/* While anything is carried New folder and search give way to the delete target, crossfading where they stand. */}
          <SwapFace shown={!binning}>
            <div {...under.attrs} style={under.style}>
              <NewFolderButton model={model} size={TOUCH_TARGET} piece={piece('new-folder')}
                style={{ position: 'absolute', right: TOUCH_TARGET + UPRIGHT_GRID.gap, ...level }} />
            </div>
            <ShelfSearchPill size={TOUCH_TARGET} open={searchOpen} onOpenChange={setSearchOpen} query={model.query}
              setQuery={model.setQuery} reduced={reduced} style={level} />
          </SwapFace>
          <SwapFace shown={binning}>
            <BinSquare over={model.carry.overBin} width={2 * TOUCH_TARGET + UPRIGHT_GRID.gap} height={TOUCH_TARGET} radius={radii.pill}
              glyph={TOUCH_TARGET / 2} style={{ left: 'auto', right: 0, ...level }} />
          </SwapFace>
        </div>
        <MorphOnChange<MorphFirst> change={shelfChange.change} measure={measureTurn}
          play={(first) => { morph.play(first, changing.current === 'arrange' ? 'blueprint.library.arrange' : 'blueprint.library.unfold'); }}>
            <div ref={stageRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: settled, minHeight: 0 }}>
              {!model.unfolded && carried ? <CarryCancel style={{ position: 'absolute', left: 0, right: 0, top: 0, height: rowH }} /> : null}
              {model.unfolded || model.carry.keepsExplorer || following ? (
                <ExplorerKept hidden={!model.unfolded}><UprightBlueprintExplorer model={model} /></ExplorerKept>
              ) : null}
              {model.unfolded ? null : (
                <div
                  ref={rowRef}
                  className="pw-noscroll"
                  data-testid="blueprint-cards"
                  {...{ [BLUEPRINT_ORDER_ATTR]: 'row' }}
                  style={{
                    position: 'relative', display: 'flex', alignItems: 'center', gap: UPRIGHT_GRID.gap, minWidth: 0, flex: 'none',
                    height: rowH, ...scrollBleed(cardBleed(cardW, cardH)), ...fade,
                    // The carried card stays mounted, out of sight, under the cancel line.
                    ...(carried ? { visibility: 'hidden' } : null),
                  }}
                >
                  <StripCards model={model} glide={glide} cardW={cardW} />
                </div>
              )}
            </div>
        </MorphOnChange>
      </PanelTone>
    </motion.div>
  );
}
