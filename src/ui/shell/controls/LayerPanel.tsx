/**
 * The expanded layer control: every buildable floor, ground at the bottom, in a one-column file
 * that scrolls inside the square's depth or a three-column square that shows the whole stack. The
 * head stays outside the scrolling floors; `frame.ts` places the plate, and only its own controls
 * close it.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Refusal } from '../../../core/model/types';
import { layerLockRule } from '../../../rules/layer-lock';
import { viewportRect } from '../../../platform/device/viewport-space';
import { useT } from '../../../i18n/context';
import { layerRows } from '../../../state/layer-utils';
import { useEditorStore } from '../../../state/store';
import { useMapDerived } from '../../session/use-map-derived';
import { helpTargetAttr } from '../../session/help-targets';
import { cssMotion } from '../../design/motion';
import { useTransition } from '../../design/motion/use-motion';
import { frameZoomAttr } from '../../design/motion/zoom-corrected-radius';
import { z } from '../../design/styles';
import { PANEL_EDGE, PLATE } from '../../design/tokens';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useScrollFade } from '../../primitives/scroll-fade';
import { LAYER_PANEL_TOP, type LayerMode } from '../frame';
import { layerName } from '../../session/layer-name';
import { useFrameZoom, useZoomedLayoutTransform } from '../use-frame-zoom';
import { PANEL, colsOf, fullDepth, plateDepth, tileOf, type Row } from './layer-plate';
import { LayerHead } from './LayerHead';
import { NotesRow } from './LayerNotesRow';
import { LayerTile } from './LayerTile';

/** How long a refusal holds the locked tiles' tint: each refusal of a drag extends it, so the drag shows one steady tint. */
const LOCK_HOLD_MS = 550;

/** Scrolls a tinted tile into view where the floors hide every one; safe because the refusing pointer is on the map. */
function revealRefusal(scroller: HTMLDivElement | null): void {
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return;
  const tinted = [...scroller.querySelectorAll('[data-testid^="shell-layer-refused-"]')];
  const view = viewportRect(scroller);
  const shown = tinted.some((el) => {
    const box = viewportRect(el);
    return box.bottom > view.top && box.top < view.bottom;
  });
  if (!shown) tinted[0]?.scrollIntoView({ block: 'nearest' });
}

/** Every floor with how much of the map's ground it covers, read live while the panel is open. */
function useFloorRows(open: boolean, cols: number) {
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  // The map is mutated in place, so its revision reports a change; opening is a dependency because nothing is heard while closed.
  const rows = useMapDerived<Row[]>(() => {
    if (!gridState) return [];
    return layerRows(gridState).map((row) => ({ ...row, name: layerName(t, row.elevation) }));
  }, [open, gridState, t], { listening: open, timing: 'frame' });
  // Rows of `cols` filled from the ground up, drawn in reverse so the ground row is at the bottom.
  return useMemo(() => {
    const out: Row[][] = [];
    for (let i = 0; i < rows.length; i += cols) out.push(rows.slice(i, i + cols));
    return out.reverse();
  }, [rows, cols]);
}

/** A paint a locked floor refused, off-screen at its cell, tints that floor here. */
function useLockRefusal(scroller: RefObject<HTMLDivElement | null>): boolean {
  const eventBus = useEditorStore((s) => s.eventBus);
  const [refused, setRefused] = useState(false);
  const holdTimer = useRef<number | null>(null);
  useEffect(() => {
    const onFail = (data: Refusal) => {
      if (!data.errors.some((e) => e.ruleId === layerLockRule.id)) return;
      setRefused(true);
      revealRefusal(scroller.current);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => { holdTimer.current = null; setRefused(false); }, LOCK_HOLD_MS);
    };
    eventBus.on('validation-failed', onFail);
    return () => {
      eventBus.off('validation-failed', onFail);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, [eventBus, scroller]);
  return refused;
}

/**
 * The floors' scrollbar lane, which the pinned notes row stops short by. Only a scrollbar arriving or
 * leaving changes it: a one-pixel flicker under a fractional zoom would jerk the row every frame.
 */
function useScrollbarLane(scroller: RefObject<HTMLDivElement | null>, deps: readonly unknown[]): number {
  const [lane, setLane] = useState(0);
  useObservedSize(() => scroller.current, ([el]) => setLane((was) => {
    const next = Math.max(0, el!.offsetWidth - el!.clientWidth);
    if (was !== 0 && next !== 0 && Math.abs(was - next) <= 1) return was;
    return was === next ? was : next;
  }), deps);
  return lane;
}

interface LayerPanelProps {
  /** The control's size; `pill` is the collapsed stepper `Rail.tsx` draws. */
  mode: LayerMode;
  onMode: (mode: LayerMode) => void;
  /** The plate's right edge from the window's and how deep it may draw, from the rail's plan (`frame.ts:planRail`). */
  right: number;
  maxHeight: number;
  top?: number;
  maxWidth?: number;
  /** The interface is put away: hidden rather than unmounted, so the stack returns at its size. */
  veiled?: boolean;
}

export function LayerPanel({ mode, onMode, right, maxHeight, top = LAYER_PANEL_TOP, maxWidth, veiled }: LayerPanelProps) {
  const t = useT();
  const open = mode !== 'pill';
  const cols = colsOf(mode);
  const resize = useTransition('layer.mode.resize');
  const veilFade = useTransition(veiled ? 'frame.veil' : 'frame.unveil');
  const arrive = useTransition('surface.arrive');
  const zoomed = useZoomedLayoutTransform();
  const zoom = useFrameZoom();
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const displayLayer = useEditorStore((s) => s.displayLayer);
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  const lockedLayers = useEditorStore((s) => s.gridState?.lockedLayers);
  const annotateSelected = useEditorStore((s) => s.editMode.mode === 'annotate');
  const highlight = displayLayer ?? activeLayer;
  // The plate draws at its natural depth or the room the rail gives it; whether the floors scroll is arithmetic, right on the first frame.
  const drawn = Math.min(plateDepth(mode), maxHeight);
  const scrolls = open && fullDepth(mode) > drawn;
  const bands = useFloorRows(open, cols);
  const scroller = useRef<HTMLDivElement | null>(null);
  const refused = useLockRefusal(scroller);
  const lane = useScrollbarLane(scroller, [scrolls, mode, open]);
  const floorsFade = useScrollFade(scroller, 'y');

  const tile = (row: Row) => (
    <LayerTile
      key={row.elevation}
      row={row}
      mode={mode}
      active={!annotateSelected && row.elevation === highlight}
      visible={layerVisibility[row.elevation] !== false}
      locked={lockedLayers?.has(row.elevation) === true}
      refused={refused}
    />
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="shell-layer-panel"
          data-testid="shell-layer-panel"
          {...helpTargetAttr('layers')}
          role="group"
          aria-label={t('layer.title')}
          initial={{ opacity: 0, scale: 0.9, y: -6 }}
          // Framer owns this element's opacity, so the frame's veil rides it here.
          animate={{ opacity: veiled ? 0 : 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -6 }}
          transition={{ ...arrive, layout: resize, opacity: veilFade }}
          // The plate resizes with its tiles under one motion; the zoom attribute keeps its corner in frame px mid-resize.
          layout
          layoutDependency={mode}
          transformTemplate={zoomed}
          {...frameZoomAttr(zoom)}
          style={{
            position: 'fixed', top, right, padding: PANEL.pad, boxSizing: 'border-box',
            // A surface on a deaf carrier: every press, wheel and scroll in its box is its own.
            pointerEvents: 'auto',
            // A hairline, not a shadow, against the map.
            background: PLATE, border: PANEL_EDGE, borderRadius: PANEL.radius,
            transformOrigin: 'top right', maxHeight: drawn, maxWidth,
            // Only `visibility` here; the opacity is Framer's.
            visibility: veiled ? 'hidden' : 'visible',
            transition: [cssMotion(veiled ? 'frame.veil' : 'frame.unveil', ['visibility']), cssMotion('frame.layout.adapt', ['top', 'right', 'max-width'])].join(', '),
            display: 'flex', flexDirection: 'column', overflowX: 'auto', overflowY: 'hidden',
            // Over the rail, whose count it was opened from.
            zIndex: z.opened,
          }}
        >
          <LayerHead mode={mode} onMode={onMode} />
          <NotesRow lane={lane} />
          {/*
            The floors are the one part that scrolls, with a scrollbar only where the declared depths
            overflow, keeping its lane so the tiles never shift. Equal tracks draw every floor in the
            same box; one flat list keyed by floor keeps each tile's identity across a size change.
          */}
          <motion.div
            ref={scroller}
            data-testid="shell-layer-floors"
            className={scrolls ? undefined : 'pw-noscroll'}
            layout
            layoutDependency={mode}
            transition={resize}
            transformTemplate={zoomed}
            layoutScroll
            style={{
              minHeight: 0, overflowY: 'auto', scrollbarGutter: scrolls ? 'stable' : 'auto',
              display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: tileOf(mode).gap, alignContent: 'start',
              ...floorsFade,
            }}
          >
            {bands.flatMap((band, i) => [
              ...band.map(tile),
              ...Array.from({ length: cols - band.length }, (_, j) => <span key={`gap-${i}-${j}`} aria-hidden />),
            ])}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
