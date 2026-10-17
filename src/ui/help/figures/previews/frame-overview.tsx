/*
 * The interface at a glance: the real `Shell` in a pictured subtree, sized to the live window and zoomed
 * to the figure. Clusters are found by the shell's own anchors (`data-tour-target`, `data-help`), so the
 * spotlight and the section cuts bound exactly what the shell drew.
 */
import { useObservedSize } from '../../../primitives/use-observed-size';
import { INERT } from './PreviewFrame';
import { cssMotion } from '../../../design/motion';
import { viewportRect } from '../../../../platform/device/viewport-space';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Shell } from '../../../shell/Shell';
import { tourTargetSelector } from '../../../chrome/tour/steps';
import { useInView } from '../use-in-view';
import { useFigureReady } from '../figure-ready';
import { UiPreviewProvider, type UiPreviewPose } from '../../../design/preview';
import { FIT_REF } from '../../../design/scale';
import { useEditorStore } from '../../../../state/store';
import { renderThumbnail } from '../../../../view/map2d/capture/thumbnail';
import { DEFAULT_MAP } from '../../../../config/maps';
import type { GridState } from '../../../../core/model/types';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { useT } from '../../../../i18n/context';
import { radii, z } from '../../../design/styles';
import { FOCUS_RING, rgbaOf } from '../../../design/tokens';
import { spotlightRx } from '../../../chrome/tour/TourOverlay';
import { figureCaption } from '../caption';
import { bareGridState } from '../../../../core/model/template';
import type { TextKey } from '../../../../i18n/keys';
import { useSettledValue } from '../../../primitives/use-settled-value';
import { useEffectEvent } from '../../../primitives/use-effect-event';


type FrameCorner = 'modes' | 'agent' | 'topright' | 'rail' | 'bar';

const CORNER_TITLE: Record<FrameCorner, TextKey> = {
  modes: 'help.frame.modes_t',
  agent: 'help.frame.assistant_t',
  topright: 'help.frame.topright_t',
  rail: 'help.frame.rail_t',
  bar: 'help.frame.bar_t',
};

/** The shell's own anchors that make up each cluster; a cluster's box is their union.
 *  The bar's are `div`-scoped: the mode blocks are buttons carrying the same help ids as the
 *  shelves they open, and a bare `[data-help]` would pull the top-left row into the bottom bar. */
const CORNER_ANCHORS: Record<FrameCorner, readonly string[]> = {
  // The union of the icon buttons, not the row wrapper: the wrapper is wider than the group,
  // which would hang the ring off-centre.
  modes: [`${tourTargetSelector('modes')} button`],
  agent: [tourTargetSelector('assistant')],
  // The menu is found by its tour target: its help id ("frame") is also the rail's hide-interface
  // button's, which would pull the whole rail into this box.
  topright: [tourTargetSelector('share'), tourTargetSelector('menu'), '[data-help="load"]'],
  rail: [tourTargetSelector('view3d'), '[data-help="undo"]', '[data-help="camera"]', '[data-help="layers"]'],
  bar: [tourTargetSelector('bar'), 'div[data-help="objects"]', 'div[data-help="generate"]', 'div[data-help="notes"]'],
};

export interface Box { x: number; y: number; w: number; h: number }

const pad = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });

function useMapBackdrop(aspect: number): string | null {
  const grid = useEditorStore((s) => s.gridState);
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    let dropped = false;
    const subject: GridState = grid ?? bareGridState(DEFAULT_MAP);
    void renderThumbnail(subject, 1024, { aspect }).then((p) => { if (!dropped && p) setPng(p); });
    return () => { dropped = true; };
  }, [grid, aspect]);
  return png;
}

/** Measure a cluster's box within the pictured shell, in the shell's own (pre-zoom) pixels.
 *  The screen-to-shell ratio is read off the root itself (its laid-out width is the pictured
 *  window's), so the answer holds under any ancestor zoom: the figure's own scale, the chrome
 *  scale the Help window rides, and the user's UI zoom all cancel out. */
export function measureBox(root: HTMLElement, selectors: readonly string[], winW: number, padPx: number): Box | null {
  const rootRect = viewportRect(root);
  if (rootRect.width <= 0) return null;
  const zoom = rootRect.width / winW;
  const boxes: Box[] = [];
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      const r = viewportRect(el);
      if (r.width <= 0 || r.height <= 0) continue;
      boxes.push({ x: (r.left - rootRect.left) / zoom, y: (r.top - rootRect.top) / zoom, w: r.width / zoom, h: r.height / zoom });
    }
  }
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return pad({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, padPx);
}

/** A point in the same shell-pixel space `measureBox` answers in: the first present anchor's
 *  centre. */
export function measurePoint(root: HTMLElement, selectors: readonly string[], winW: number): { x: number; y: number } | null {
  const rootRect = viewportRect(root);
  if (rootRect.width <= 0) return null;
  const zoom = rootRect.width / winW;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const r = viewportRect(el);
    if (r.width <= 0 || r.height <= 0) continue;
    return { x: (r.left + r.width / 2 - rootRect.left) / zoom, y: (r.top + r.height / 2 - rootRect.top) / zoom };
  }
  return null;
}

function measure(root: HTMLElement, corner: FrameCorner, winW: number): Box | null {
  // The bar's box is its cells and the mode row's is its icons; the active tool's and the selected
  // icon's names hang below those boxes, so both pad deeper.
  return measureBox(root, CORNER_ANCHORS[corner], winW, corner === 'bar' ? 30 : corner === 'modes' ? 34 : 12);
}

const noop = () => {};

/** The real shell, pictured: window-sized inside its own containing block, zoomed to fit. The pose
 *  holds a mode armed so the selected icon's name and its bottom toolbar are in the picture. */
export function PicturedShell({ win, zoom, layerPanel, notesRow, mode = 'mountain', children }: {
  win: { w: number; h: number };
  zoom: number;
  layerPanel?: UiPreviewPose['layerPanel'];
  mode?: UiPreviewPose['mode'];
  notesRow?: UiPreviewPose['notesRow'];
  children?: ReactNode;
}) {
  const backdrop = useMapBackdrop(win.w / win.h);
  // One pose object per distinct state, so the pictured subtree re-renders only when a posed
  // fact changes.
  const row = useSettledValue(notesRow, (r) => (r ? `${r.visible}|${r.locked}` : ''));
  const pose = useMemo<UiPreviewPose>(
    () => ({ viewport: win, mode, layerPanel, ...(row ? { notesRow: row } : {}) }),
    [win, mode, layerPanel, row],
  );
  return (
    <div style={{ position: 'relative', width: win.w, height: win.h, overflow: 'hidden', contain: 'paint', zoom }}>
      {backdrop && (
        <img src={backdrop} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      <UiPreviewProvider pose={pose}>
        <Shell onRestoreSession={noop} splashActive={false}>{null}</Shell>
      </UiPreviewProvider>
      {children}
    </div>
  );
}

/** The pictured window: 0.8 of `FIT_REF` exactly, so the interface fits it by construction (the
 *  fit scales everything by the same 0.8) while the figure stays small. The pose hands this to
 *  `useViewportSize`, so the shell truly lays itself out for this window. */
export function useWindowSnapshot(): { w: number; h: number } {
  return PICTURE_WIN;
}

const PICTURE_WIN = { w: FIT_REF.w * 0.8, h: FIT_REF.h * 0.96 };

const CYCLE: readonly FrameCorner[] = ['modes', 'agent', 'topright', 'rail', 'bar'];

/** The whole window at a glance, the spotlight walking cluster to cluster. */
export function FrameOverview() {
  const ready = useFigureReady();
  const t = useT();
  const win = useWindowSnapshot();
  const width = 560;
  const scale = width / win.w;
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const still = useRef(isMotionReduced());

  useEffect(() => {
    if (!ready || still.current) return undefined;
    const timer = setInterval(() => setStep((n) => (n + 1) % CYCLE.length), 2200);
    return () => clearInterval(timer);
  }, [ready]);

  const corner = CYCLE[step]!;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!ready || !root || still.current) return undefined;
    const read = () => {
      const b = measure(root, corner, win.w);
      if (b) setBox(b);
      return b !== null;
    };
    // Read with the step so the ring and its name move together, and again a beat later once the
    // shell's own entrances settle. A cluster the live state is not showing (the bottom bar with
    // no mode armed) gives up its beat instead of holding a dead one.
    read();
    const timer = setTimeout(() => { if (!read()) setStep((n) => (n + 1) % CYCLE.length); }, 80);
    return () => clearTimeout(timer);
  }, [corner, win.w, ready]);

  return (
    <div ref={rootRef} aria-hidden {...INERT} style={{ position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden', borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none' }}>
      {ready && <PicturedShell win={win} zoom={scale}>
        {!still.current && box && (
          <>
            {/* Figure annotations stand at the ladder's top: the pictured chrome carries the
                app's own rungs, and the name plate must read over all of it. */}
            <span
              style={{
                position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
                border: `5px solid ${FOCUS_RING}`, borderRadius: spotlightRx(box.w, box.h, 1), zIndex: z.unmissable,
                boxShadow: `0 0 0 8px ${rgbaOf(FOCUS_RING, 0.18)}`, transition: cssMotion('help.figure.spotlight', ['left', 'top', 'width', 'height', 'opacity']), pointerEvents: 'none',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: Math.max(12, Math.min(box.x, win.w - 420)),
                top: box.y + box.h + 18 > win.h - 70 ? box.y - 64 : box.y + box.h + 18,
                zIndex: z.unmissable, pointerEvents: 'none', transition: cssMotion('help.figure.spotlight', ['left', 'top', 'width', 'height', 'opacity']),
                ...figureCaption({ role: 'lead', padding: '8px 20px', shadow: true, nowrap: true }),
              }}
            >
              {t(CORNER_TITLE[corner])}
            </span>
          </>
        )}
      </PicturedShell>}
    </div>
  );
}

/** One cluster, cut from the same pictured shell and filled to the figure. A cluster the live
 *  state is not showing (the bottom bar with no mode armed) falls back to the given stand-in.
 *  The shell mounts only once the figure nears the viewport: a page holds several of these, and
 *  mounting them all with the page is seconds of work the reader has not scrolled to yet. */
export function FrameCut({ corner, fallback, layerPanel, mode, targets, highlight }: { corner: FrameCorner; fallback?: ReactNode; layerPanel?: UiPreviewPose['layerPanel']; mode?: UiPreviewPose['mode']; targets?: readonly string[]; highlight?: readonly string[] }) {
  const win = useWindowSnapshot();
  const holdRef = useRef<HTMLDivElement>(null);
  const near = useInView(holdRef);
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [focus, setFocus] = useState<Box | null>(null);
  const [settled, setSettled] = useState(false);

  const scale = box ? Math.min(620 / box.w, 340 / box.h, 1.25) : 0.4;

  const read = () => {
    const root = rootRef.current;
    if (!root) return;
    setBox(targets ? measureBox(root, targets, win.w, 20) : measure(root, corner, win.w));
    if (highlight) setFocus(measureBox(root, highlight, win.w, 4));
  };
  // Read as the pictured shell lays out and whenever its box changes, and once more when its
  // entrances have settled; a cluster the live state is not showing then gives way to its stand-in.
  useObservedSize(() => (near ? rootRef.current : null), read, [corner, near, layerPanel, mode, targets, highlight, win.w]);
  const readSettled = useEffectEvent(() => { read(); setSettled(true); });
  useEffect(() => {
    if (!near) return undefined;
    const timer = setTimeout(readSettled, FIGURE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [corner, near, layerPanel, mode, targets, highlight]);
  if (settled && !box && fallback) return <>{fallback}</>;

  const view = box
    ? { w: Math.round(box.w * scale), h: Math.round(box.h * scale), dx: box.x, dy: box.y }
    : { w: 620, h: 200, dx: 0, dy: 0 };
  const style: CSSProperties = {
    position: 'relative', width: view.w, height: view.h, overflow: 'hidden',
    borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
    // The mount measures itself before the box lands; until then it holds a quiet frame.
    opacity: box ? 1 : 0,
    transition: cssMotion('help.figure.fade', ['opacity']),
  };
  return (
    <div ref={holdRef} aria-hidden {...INERT} style={style}>
      {box && focus && <span aria-hidden style={{ position: 'absolute', left: (focus.x - box.x) * scale, top: (focus.y - box.y) * scale, width: focus.w * scale, height: focus.h * scale, border: `3px solid ${FOCUS_RING}`, borderRadius: radii.md, zIndex: z.unmissable, pointerEvents: 'none', boxSizing: 'border-box' }}/> }
      {near && (
        <div style={{ zoom: scale }}>
          <div style={{ marginLeft: -view.dx, marginTop: -view.dy }}>
            {/* The measure root's width must be the pictured window's, whatever the wrappers lay
                out at: the screen-to-shell ratio is read off this box. */}
            <div ref={rootRef} style={{ width: win.w }}>
              <PicturedShell win={win} zoom={1} layerPanel={layerPanel} mode={mode} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** How long a cut waits for its cluster before it shows the stand-in. */
const FIGURE_SETTLE_MS = 900;


const NOTES_ENTRY_HIGHLIGHT = ['[data-testid="shell-layer-annotation"]'];
const NOTES_ENTRY_TARGETS = NOTES_ENTRY_HIGHLIGHT;

/** The entry row and resulting toolbar are cropped from the editor's own shell. */
export function NotesEntryPreview() {
  const t = useT();
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', width: '100%' }}>
    <div style={{ textAlign: 'center' }}>
      <FrameCut corner="rail" layerPanel="column" targets={NOTES_ENTRY_TARGETS} highlight={NOTES_ENTRY_HIGHLIGHT}/>
      <p style={figureCaption({ role: 'note', padding: '3px 8px' })}>{t('help.notes.entry_layer')}</p>
    </div>
    <div style={{ textAlign: 'center' }}>
      <FrameCut corner="bar" mode="annotate"/>
    </div>
  </div>;
}
