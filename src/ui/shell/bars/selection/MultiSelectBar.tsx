/**
 * Touch multi-select's bar, standing while the latch is on (`state/slices/edit.ts`) in the bar's
 * place: how many objects are selected, Done, and a row of what the group can do (turn, flip, move,
 * select all, copy, delete), offered as the selection card offers them, with nothing over the map.
 * Upright it is the cream panel the bar raises, the count and Done on a line above the row, which
 * scrolls sideways where it does not fit; on a wide window it stands on the cream band where a shelf
 * would, the count leading the row and Done ending it. A Help figure pictures it over its own map
 * (`PicturedMultiSelect`).
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { quantityParams, useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { selectedObjectIds } from '../../../../state/selection';
import { selectedGroup } from '../../../../state/placed-groups';
import { copyAllowed } from '../../../../state/clipboard';
import { selectionTarget, type SelectionTarget } from '../../../../editor/editing/object-menu';
import { btnReset, cursors, radii, SPACE } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { ACTIVE, DANGER_INK, INSET, PLATE, PLATE_INK } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { CheckIcon, DuplicateIcon, FlipIcon, MoveIcon, RotateIcon, SelectAllIcon, TrashIcon } from '../../../primitives/line-glyphs';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { fadeMask, SCROLL_FADE } from '../../../primitives/scroll-fade';
import { helpTargetAttr } from '../../../session/help-targets';
import { useMapRevision } from '../../../session/use-map-revision';
import { TouchReach } from '../../../primitives/TouchReach';
import { plateButton, plateLabel, plateRule } from '../../planet/MapPlate';
import { useScrollRow } from '../../../primitives/use-scroll-row';
import { useRunCommand } from '../../use-shell-commands';
import { useFrameZoom } from '../../use-frame-zoom';
import { EDGE, PLATE_BAND, SHELF_TABS } from '../../units';
import { useFrameLayout } from '../../frame-layout';
import { PanelTone, useBarSurface } from '../bar-panel';
import { ShelfBand } from '../ShelfBand';

/** An action tile: its mark over its name (C3), never narrower than `minW` nor wider than `maxW`. */
const TILE = { minW: 64, maxW: 120, h: 68 } as const;
const TICK = 18;

/** The room a pressed tile's growth and its focus ring take past the scrolling row's box. */
const TILE_BLEED = 6;

/** An action tile's box, its fill and ink aside. */
const tileBox = (): CSSProperties => ({
  ...btnReset, position: 'relative', flex: '1 1 0', minWidth: TILE.minW, maxWidth: TILE.maxW, minHeight: TILE.h,
  padding: `${SPACE[4]}px ${SPACE[3]}px`, borderRadius: radii.field,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
  cursor: cursors.clickable, pointerEvents: 'auto',
});

const noop = () => {};

/** Done on the upright bar's line above the row, a fingertip to reach in touch mode. */
function DoneButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  const zoom = useFrameZoom();
  return (
    <ActionButton appearance="primary" interaction="pill" data-testid="multi-select-done" onClick={onPress} style={{ ...plateButton, position: 'relative' }}>
      <CheckIcon size={TICK} />
      {t('selection.done')}
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}

/** How many objects the group holds, as a line. */
function useCountTitle(count: number): string {
  const t = useT();
  const locale = useLocale();
  return t('selection.multi_count', quantityParams(locale, { n: count }));
}

/** The count and Done on the upright bar's line above the row. */
function CountLine({ count, onDone }: { count: number; onDone: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE[3], padding: `0 ${SPACE[2]}px 0 ${SPACE[3]}px` }}>
      <span data-testid="multi-select-count" style={plateLabel}>{useCountTitle(count)}</span>
      <DoneButton onPress={onDone} />
    </div>
  );
}

/** The count leading the wide band's row: the number over what it counts, a tile's height. */
function CountTile({ count }: { count: number }) {
  const t = useT();
  const locale = useLocale();
  const params = quantityParams(locale, { n: count });
  return (
    <span data-testid="multi-select-count" aria-label={t('selection.multi_count', params)}
      style={{ flex: 'none', minWidth: TILE.minW, height: TILE.h, padding: `0 ${SPACE[2]}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: PLATE_INK }}>
      <span aria-hidden style={{ ...roleFont('title'), lineHeight: 1.05 }}>{params?.n ?? count}</span>
      <span aria-hidden style={{ ...roleFont('action'), whiteSpace: 'nowrap' }}>{t('selection.count_label', params)}</span>
    </span>
  );
}

/** Done ending the wide band's row, a tile like the actions it closes. */
function DoneTile({ onPress }: { onPress: () => void }) {
  const t = useT();
  const zoom = useFrameZoom();
  return (
    <ActionButton appearance="primary" interaction="tile" data-testid="multi-select-done" onClick={onPress} style={{ ...tileBox(), background: PLATE_INK, color: PLATE }}>
      <CheckIcon />
      <span style={{ ...roleFont('action'), textAlign: 'center' }}>{t('selection.done')}</span>
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}

/** A rule between the wide row's count, its actions and Done. */
const rowRule: CSSProperties = { ...plateRule, margin: `${SPACE[4]}px 0` };

type ActionId = 'rotate' | 'flip' | 'move' | 'select-all' | 'copy' | 'delete';

/** What a selection can do, as the row greys by it (`editor/editing/object-menu.ts:selectionTarget`). */
type Abilities = Pick<SelectionTarget, 'rotatable' | 'flippable' | 'copyable' | 'deletable'>;

/** What the row offers: the selection's abilities, null where it can take none; whether anything is
 *  selected, for Move, which the drop's rules judge; whether Move is latched; whether copying is
 *  allowed here. */
interface RowReads { can: Abilities | null; held: boolean; moving: boolean; canCopy: boolean }

/** A figure's row over `count` selected objects of its own world, which stands in no planet session
 *  and locks nothing: one object only turns, as Pick arms it again and Flip needs a second (EDIT-53). */
const picturedReads = (count: number): RowReads => ({
  can: count > 0 ? { rotatable: true, flippable: count > 1, copyable: count > 1, deletable: true } : null,
  held: count > 0, moving: false, canCopy: true,
});

/** The row's tiles, each running `press` with its id. */
function ActionTiles({ reads, press }: { reads: RowReads; press: (id: ActionId) => void }) {
  const t = useT();
  const zoom = useFrameZoom();
  const { can, held, moving, canCopy } = reads;
  const tile = (on = false): CSSProperties => ({ ...tileBox(), background: on ? ACTIVE : INSET, color: PLATE_INK });
  const actions: Array<{ id: ActionId; label: string; icon: ReactNode; off: boolean; on?: boolean; danger?: boolean }> = [
    { id: 'rotate', label: t('a11y.rotate'), icon: <RotateIcon />, off: !can?.rotatable },
    { id: 'flip', label: t('shortcut.flip'), icon: <FlipIcon />, off: !can?.flippable },
    { id: 'move', label: t('menu.move'), icon: <MoveIcon />, off: !held, on: moving },
    { id: 'select-all', label: t('shortcut.select_all'), icon: <SelectAllIcon />, off: false },
    { id: 'copy', label: t('context.copy'), icon: <DuplicateIcon />, off: !can?.copyable || !canCopy },
    { id: 'delete', label: t('a11y.delete'), icon: <TrashIcon />, off: !can?.deletable, danger: true },
  ];
  return actions.map((a) => (
    <ActionButton
      key={a.id}
      interaction="tile"
      data-testid={`multi-select-${a.id}`}
      {...(a.on === undefined ? {} : { 'aria-pressed': a.on })}
      disabled={a.off}
      onClick={() => press(a.id)}
      style={{ ...tile(a.on), ...(a.danger ? { color: DANGER_INK } : {}) }}
    >
      {a.icon}
      <span style={{ ...roleFont('action'), textAlign: 'center', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{a.label}</span>
      <TouchReach zoom={zoom} />
    </ActionButton>
  ));
}

/** The tiles side by side; on the wide band, `height` tall inside the shelf's side padding. */
const rowStyle = (height?: number): CSSProperties => ({
  position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SHELF_TABS.gap,
  ...(height === undefined ? {} : { height, padding: `0 ${SHELF_TABS.left}px` }),
});

export function MultiSelectBar() {
  const run = useRunCommand();
  const { upright, bar, root, reveal, tone, band, content } = useBarSurface('cream');
  const selection = useEditorStore((s) => s.selection);
  const gridState = useEditorStore((s) => s.gridState);
  // An edit changes what the selection offers (a lock, an object gone) without a selection write.
  useMapRevision(selection.length > 0, 'frame');
  const planet = useEditorStore((s) => s.planetSession);
  const repairing = useEditorStore((s) => s.repairSession?.phase === 'hand');
  const group = useEditorStore(selectedGroup);
  const can = selectionTarget(selection, gridState, !!planet, { planet, repairing, group });
  const moving = useEditorStore((s) => s.moveLatched);
  const setMoveLatched = useEditorStore((s) => s.setMoveLatched);
  const canCopy = useEditorStore(copyAllowed);
  const press = (id: ActionId) => {
    // Move latches the next one-finger drag, a touch gesture's own state that no other caller means.
    if (id === 'move') setMoveLatched(!moving);
    else run(id === 'rotate' ? 'selection.rotate_cw' : id === 'flip' ? 'selection.flip' : id === 'select-all' ? 'selection.all' : id === 'copy' ? 'selection.copy' : 'selection.delete');
  };

  const count = selectedObjectIds(selection).length;
  const done = () => run('selection.clear');
  const reads = { can, held: selection.length > 0, moving, canCopy };

  return (
    <div data-testid="multi-select-bar" {...helpTargetAttr('touch', 'touch-menu')} {...mapEdgeAttr('bottom')} {...root}>
      <PanelTone tone={tone}>
        {band}
        {upright ? (
          <motion.div {...content.centre} {...reveal} style={{ display: 'flex', flexDirection: 'column', gap: SPACE[3], minWidth: 0 }}>
            <CountLine count={count} onDone={done} />
            <TileScroller><ActionTiles reads={reads} press={press} /></TileScroller>
          </motion.div>
        ) : (
          <motion.div {...content.centre} {...reveal} style={rowStyle(bar.height)}>
            <WideRow count={count} reads={reads} press={press} onDone={done} />
          </motion.div>
        )}
      </PanelTone>
    </div>
  );
}

/** The wide band's row: the count, the actions, then Done. */
function WideRow({ count, reads, press, onDone }: { count: number; reads: RowReads; press: (id: ActionId) => void; onDone: () => void }) {
  return (
    <>
      <CountTile count={count} />
      <span aria-hidden style={rowRule} />
      <ActionTiles reads={reads} press={press} />
      <span aria-hidden style={rowRule} />
      <DoneTile onPress={onDone} />
    </>
  );
}

/** The upright row: its tiles at their own size, scrolled sideways where the panel is narrower. The
 *  scroller runs out over the panel's side padding to the screen's edges, so a tile past the room
 *  shows its start there under the fade and reads as more to scroll to. */
function TileScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useFrameZoom();
  const layout = useFrameLayout();
  const bleed = { top: TILE_BLEED, bottom: TILE_BLEED, left: layout?.edgeLeft ?? EDGE, right: layout?.edgeRight ?? EDGE };
  const fade = useScrollRow(ref, { zoom, bleed, pointerEvents: 'auto' });
  return (
    <div ref={ref} data-testid="multi-select-row" className="pw-noscroll"
      style={{ ...fade, display: 'flex', gap: SHELF_TABS.gap, justifyContent: 'safe center' }}>
      {children}
    </div>
  );
}

/**
 * The bar over a Help figure's map while its world's multi-select is latched, as a wide window stands
 * it: the row on its cream band at the map's foot, absolute in the figure's box. The row keeps `zoom`,
 * the live size, and where wider than the box stands at its start, in a box `rowAttrs` marks for the
 * figure to pan. It takes no input and its actions do nothing.
 */
export function PicturedMultiSelect({ count, zoom, rowAttrs }: {
  count: number;
  zoom: number;
  rowAttrs?: Record<string, string>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [overruns, setOverruns] = useState(false);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const clip = row?.parentElement;
    if (row && clip) setOverruns(row.offsetWidth > clip.clientWidth + 0.5);
  }, [zoom, count]);
  const rowEnd = overruns ? fadeMask('x', { start: 0, end: SCROLL_FADE }) : undefined;
  return (
    <div {...{ inert: '' }} data-testid="pictured-multi-select" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: PLATE_BAND.top * zoom, overflow: 'hidden' }}>
        <div style={{ zoom, position: 'absolute', inset: 0 }}>
          <ShelfBand tone="cream" height={PLATE_BAND.top} testId="pictured-multi-select-band" />
        </div>
      </div>
      {/* The row's still box: unpanned, it fades the end a wider row runs past, as a scrolling row does;
          the figure's pan then sets both sides. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, ...(rowEnd ? { maskImage: rowEnd, WebkitMaskImage: rowEnd } : null) }}>
        <div ref={rowRef} {...rowAttrs} style={{ position: 'relative', width: 'max-content', minWidth: '100%', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 'max-content' }}>
            <div style={{ ...rowStyle(PLATE_BAND.top), zoom }}>
              <WideRow count={count} reads={picturedReads(count)} press={noop} onDone={noop} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
