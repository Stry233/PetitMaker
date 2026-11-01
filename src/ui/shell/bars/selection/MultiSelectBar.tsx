/**
 * Touch multi-select's surfaces, standing while the latch is on (`state/slices/edit.ts`): a plate
 * over the map with the count and Done, and in the bar's place a row of what the group can do
 * (turn, move, select all, copy, delete). Upright the row is the cream panel the bar raises; on a wide
 * window it stands on the cream band where a shelf would. A Help figure pictures both over its own
 * map (`PicturedMultiSelect`).
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { quantityParams, useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { selectedObjectIds } from '../../../../state/selection';
import { copyAllowed } from '../../../../state/clipboard';
import { btnReset, cursors, radii, SPACE } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { ACTIVE, DANGER_INK, INSET, PLATE_INK } from '../../../design/tokens';
import { ActionButton } from '../../../primitives/ActionButton';
import { CheckIcon, DuplicateIcon, MoveIcon, RotateIcon, SelectAllIcon, TrashIcon } from '../../../primitives/line-glyphs';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { fadeMask, SCROLL_FADE } from '../../../primitives/scroll-fade';
import { helpTargetAttr } from '../../../session/help-targets';
import { TouchReach } from '../../../primitives/TouchReach';
import { MapPlate, PlateTitled, plateButton } from '../../planet/MapPlate';
import { useRunCommand } from '../../use-shell-commands';
import { useFrameZoom } from '../../use-frame-zoom';
import { PLATE_BAND, SHELF_TABS } from '../../units';
import { PanelTone, useBarSurface } from '../bar-panel';
import { ShelfBand } from '../ShelfBand';

/** An action tile: its mark over its name (C3), never narrower than `minW` nor wider than `maxW`. */
const TILE = { minW: 64, maxW: 120, h: 68 } as const;
const TICK = 18;

const noop = () => {};

/** The plate's Done. */
function DoneButton({ onPress }: { onPress: () => void }) {
  const t = useT();
  return (
    <ActionButton appearance="primary" interaction="pill" data-testid="multi-select-done" onClick={onPress} style={plateButton}>
      <CheckIcon size={TICK} />
      {t('selection.done')}
    </ActionButton>
  );
}

/** The plate's title: how many objects the group holds. */
function useCountTitle(count: number): string {
  const t = useT();
  const locale = useLocale();
  return t('selection.multi_count', quantityParams(locale, { n: count }));
}

/** The count and Done, on the plate a task over the map wears. */
function MultiSelectPlate() {
  const count = useEditorStore((s) => selectedObjectIds(s.selection).length);
  const end = useEditorStore((s) => s.clearSelection);
  return (
    <MapPlate title={useCountTitle(count)} testId="multi-select-plate">
      <DoneButton onPress={() => end()} />
    </MapPlate>
  );
}

type ActionId = 'rotate' | 'move' | 'select-all' | 'copy' | 'delete';

/** What the row offers: how many blocks are selected, whether Move is latched, whether copying is
 *  allowed here. */
interface RowReads { selected: number; moving: boolean; canCopy: boolean }

/** The row's tiles, each running `press` with its id. */
function ActionTiles({ reads, press }: { reads: RowReads; press: (id: ActionId) => void }) {
  const t = useT();
  const zoom = useFrameZoom();
  const { selected, moving, canCopy } = reads;
  const empty = selected === 0;
  // One object is armed again by Pick, so Copy waits for a second (EDIT-53).
  const single = selected < 2;
  const tile = (on = false): CSSProperties => ({
    ...btnReset, position: 'relative', flex: '1 1 0', minWidth: TILE.minW, maxWidth: TILE.maxW, minHeight: TILE.h,
    padding: `${SPACE[4]}px ${SPACE[3]}px`, borderRadius: radii.field,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE[2],
    cursor: cursors.clickable, pointerEvents: 'auto', background: on ? ACTIVE : INSET, color: PLATE_INK,
  });
  const actions: Array<{ id: ActionId; label: string; icon: ReactNode; off: boolean; on?: boolean; danger?: boolean }> = [
    { id: 'rotate', label: t('a11y.rotate'), icon: <RotateIcon />, off: empty },
    { id: 'move', label: t('menu.move'), icon: <MoveIcon />, off: empty, on: moving },
    { id: 'select-all', label: t('shortcut.select_all'), icon: <SelectAllIcon />, off: false },
    { id: 'copy', label: t('context.copy'), icon: <DuplicateIcon />, off: single || !canCopy },
    { id: 'delete', label: t('a11y.delete'), icon: <TrashIcon />, off: empty, danger: true },
  ];
  return actions.map((a) => (
    <ActionButton
      key={a.id}
      interaction="tile"
      data-testid={`multi-select-${a.id}`}
      {...(a.id === 'delete' ? { 'data-selection-delete': '' } : {})}
      {...(a.on === undefined ? {} : { 'aria-pressed': a.on })}
      disabled={a.off}
      onClick={() => press(a.id)}
      style={{ ...tile(a.on), ...(a.danger ? { color: DANGER_INK } : {}) }}
    >
      {a.icon}
      <span style={{ ...roleFont('label'), textAlign: 'center', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{a.label}</span>
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
  const selected = useEditorStore((s) => s.selection.length);
  const moving = useEditorStore((s) => s.moveLatched);
  const setMoveLatched = useEditorStore((s) => s.setMoveLatched);
  const canCopy = useEditorStore(copyAllowed);
  const press = (id: ActionId) => {
    if (id === 'move') setMoveLatched(!moving);
    else run(id === 'rotate' ? 'selection.rotate_cw' : id === 'select-all' ? 'selection.all' : id === 'copy' ? 'selection.copy' : 'selection.delete');
  };

  return (
    <>
      <MultiSelectPlate />
      <div data-testid="multi-select-bar" {...helpTargetAttr('touch', 'touch-menu')} {...mapEdgeAttr('bottom')} {...root}>
        <PanelTone tone={tone}>
          {band}
          <motion.div {...content.centre} {...reveal} style={rowStyle(upright ? undefined : bar.height)}>
            <ActionTiles reads={{ selected, moving, canCopy }} press={press} />
          </motion.div>
        </PanelTone>
      </div>
    </>
  );
}

/**
 * Both surfaces over a Help figure's map while its world's multi-select is latched, as a wide window
 * stands them: the plate at the map's top and the row on its cream band at the map's foot, absolute
 * in the figure's box. The plate draws at `zoom` times what `share` asks for a plate that wide; the
 * row keeps `zoom`, the live size, and where wider than the box stands at its start, in a box
 * `rowAttrs` marks for the figure to pan. They take no input and their actions do nothing.
 */
export function PicturedMultiSelect({ count, zoom, share = () => 1, rowAttrs }: {
  count: number;
  zoom: number;
  /** The share of `zoom` to draw the plate at for a plate `least` px wide at `zoom`, in the box's px. */
  share?: (least: number) => number;
  rowAttrs?: Record<string, string>;
}) {
  const title = useCountTitle(count);
  const plateRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  // The plate's box stands outside its zoom, so its width is in the figure box's own px. The row
  // keeps the live size: the figure pans it toward the tile a press heads for, as a finger scrolls it.
  useLayoutEffect(() => {
    const plate = plateRef.current;
    if (plate) setK(share(plate.offsetWidth / k));
  }, [zoom, share, k]);
  const at = zoom * k;
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
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <div ref={plateRef} style={{ width: 'max-content' }}>
          <div style={{ zoom: at, padding: SPACE[3] }}>
            <PlateTitled title={title} pictured><DoneButton onPress={noop} /></PlateTitled>
          </div>
        </div>
      </div>
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
              <ActionTiles reads={{ selected: count, moving: false, canCopy: true }} press={noop} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
