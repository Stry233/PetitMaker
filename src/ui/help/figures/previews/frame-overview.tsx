/*
 * The interface at a glance: the real `Shell` in a pictured subtree, sized to the live window and zoomed
 * to the figure. Clusters are found by the shell's own anchors (`data-tour-target`, `data-help`), so the
 * spotlight and the section cuts bound exactly what the shell drew.
 */
import { useReducedMotionConfig } from 'framer-motion';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { INERT } from './PreviewFrame';
import { cssMotion } from '../../../design/motion';
import { visualRect } from '../../../design/visual-rect';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Shell } from '../../../shell/Shell';
import { tourTargetSelector } from '../../../chrome/tour/steps';
import { useInView } from '../use-in-view';
import { useFigureReady } from '../figure-ready';
import { UiPreviewProvider, type UiPreviewPose } from '../../../design/preview';
import { FIT_REF, NO_DOCK, uiScaleOf } from '../../../design/scale-model';
import { useScaleView, useSurfaceZoom, useViewportSize } from '../../../design/scale';
import { PICTURED_UI_ZOOM } from '../../../design/ui-zoom-anim';
import { MINIATURE_SIGHT, useFigureRoom, useFigureSight } from '../figure-scale';
import { useLayoutShape } from '../../../design/input-mode';
import { useEditorStore } from '../../../../state/store';
import { useT } from '../../../../i18n/context';
import { useMapBackdrop } from './map-backdrop';
import { fadeMask, SCROLL_FADE } from '../../../primitives/scroll-fade';
import { radii, z } from '../../../design/styles';
import { FOCUS_RING, rgbaOf } from '../../../design/tokens';
import { spotlightRx } from '../../../chrome/tour/ShowMe';
import { figureCaption } from '../caption';
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
  modes: [`${tourTargetSelector('modes')} button`, `${tourTargetSelector('modes')} [data-map-caption]`],
  // The character she is drawn as, which stands over her block rather than on its box.
  agent: ['[data-testid="pw-character"]'],
  // The menu is found by its tour target: its help id ("frame") is also the rail's hide-interface
  // button's, which would pull the whole rail into this box.
  topright: [tourTargetSelector('share'), tourTargetSelector('menu'), '[data-help="load"]'],
  rail: [tourTargetSelector('view3d'), '[data-help="undo"]', '[data-help="camera"]', '[data-help="layers"]'],
  // Upright the bar is the panel standing on it (`[data-bar-panel]`), its rows over the tool row.
  bar: [tourTargetSelector('bar'), 'div[data-help="terrain"]', 'div[data-help="objects"]', 'div[data-help="generate"]', 'div[data-help="notes"]', '[data-testid="shell-object-brush"]', '[data-bar-panel]'],
};

export interface Box { x: number; y: number; w: number; h: number }

const pad = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });

/** Measure a cluster's box within the pictured shell, in the shell's own (pre-zoom) pixels.
 *  The screen-to-shell ratio is read off the root itself (its laid-out width is the pictured
 *  window's), so the answer holds under any ancestor zoom: the figure's own scale, the chrome
 *  scale the Help window rides, and the user's UI zoom all cancel out. Rects come through
 *  `visualRect`, so the root and a target under the pictured shell's own zoom answer in one unit. */
export function measureBox(root: HTMLElement, selectors: readonly string[], winW: number, padPx: number): Box | null {
  const rootRect = visualRect(root);
  if (rootRect.width <= 0) return null;
  const zoom = rootRect.width / winW;
  const boxes: Box[] = [];
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      const r = visualRect(el);
      if (r.width <= 0 || r.height <= 0) continue;
      // Clipped to the window: a row that scrolls sideways lays out wider than the screen shows it.
      const x1 = Math.max(0, (r.left - rootRect.left) / zoom);
      const y1 = Math.max(0, (r.top - rootRect.top) / zoom);
      const x2 = Math.min(winW, (r.right - rootRect.left) / zoom);
      const y2 = Math.min(rootRect.height / zoom, (r.bottom - rootRect.top) / zoom);
      if (x2 <= x1 || y2 <= y1) continue;
      boxes.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
  }
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return pad({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, padPx);
}

/** Each element `selectors` match within the pictured shell, as its own box in `measureBox`'s space,
 *  unclipped, so a crop can tell which ones its edges would cut. */
function measureEach(root: HTMLElement, selectors: string, winW: number, keep: (el: Element) => boolean = () => true): Box[] {
  const rootRect = visualRect(root);
  if (rootRect.width <= 0) return [];
  const zoom = rootRect.width / winW;
  const boxes: Box[] = [];
  for (const el of root.querySelectorAll(selectors)) {
    if (!keep(el)) continue;
    const r = visualRect(el);
    if (r.width <= 0 || r.height <= 0) continue;
    boxes.push({ x: (r.left - rootRect.left) / zoom, y: (r.top - rootRect.top) / zoom, w: r.width / zoom, h: r.height / zoom });
  }
  return boxes;
}

/** A point in the same shell-pixel space `measureBox` answers in: the first present anchor's
 *  centre. */
export function measurePoint(root: HTMLElement, selectors: readonly string[], winW: number): { x: number; y: number } | null {
  const rootRect = visualRect(root);
  if (rootRect.width <= 0) return null;
  const zoom = rootRect.width / winW;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const r = visualRect(el);
    if (r.width <= 0 || r.height <= 0) continue;
    return { x: (r.left + r.width / 2 - rootRect.left) / zoom, y: (r.top + r.height / 2 - rootRect.top) / zoom };
  }
  return null;
}

function measure(root: HTMLElement, corner: FrameCorner, winW: number): Box | null {
  // Upright the bar's panel stands on the mode row, so the bar is pictured with it, whole.
  const upright = root.getBoundingClientRect().height > root.getBoundingClientRect().width;
  if (corner === 'bar' && upright) return measureBox(root, [...CORNER_ANCHORS.bar, ...CORNER_ANCHORS.modes], winW, 12);
  // The bar's box is its cells and the mode row's is its icons; the active tool's and the selected
  // icon's names hang below those boxes, so both pad deeper.
  if (corner === 'agent') return measureBox(root, CORNER_ANCHORS.agent, winW, 12) ?? measureBox(root, [tourTargetSelector('assistant')], winW, 12);
  return measureBox(root, CORNER_ANCHORS[corner], winW, corner === 'bar' ? 30 : 12);
}

const noop = () => {};

/** The real shell, pictured: window-sized inside its own containing block, zoomed to fit. The pose
 *  holds a mode armed so the selected icon's name and its bottom toolbar are in the picture. */
export function PicturedShell({ win, zoom, layerPanel, notesRow, mode = 'mountain', objectBrush, regionScreen, children }: {
  win: { w: number; h: number };
  zoom: number;
  layerPanel?: UiPreviewPose['layerPanel'];
  /** The mode held armed; `null` poses the editor at rest, no mode armed, as it first opens. */
  mode?: UiPreviewPose['mode'] | null;
  notesRow?: UiPreviewPose['notesRow'];
  objectBrush?: UiPreviewPose['objectBrush'];
  regionScreen?: UiPreviewPose['regionScreen'];
  children?: ReactNode;
}) {
  const backdrop = useMapBackdrop(win.w / win.h);
  const uiZoom = usePicturedUiZoom(win);
  // One pose object per distinct state, so the pictured subtree re-renders only when a posed
  // fact changes.
  const row = useSettledValue(notesRow, (r) => (r ? `${r.visible}|${r.locked}` : ''));
  const pose = useMemo<UiPreviewPose>(
    () => ({
      viewport: win, uiZoom, layerPanel, ...(mode ? { mode } : {}),
      ...(row ? { notesRow: row } : {}), ...(objectBrush ? { objectBrush } : {}), ...(regionScreen ? { regionScreen } : {}),
    }),
    [win, uiZoom, mode, layerPanel, row, objectBrush, regionScreen],
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

/** The pictured window: the reader's own, so the shell lays itself out exactly as their screen
 *  shows it; where a figure poses the other shape (`HelpFigure.form`), a window of that shape (a
 *  phone held upright, or the reference window). The pose hands it to `useViewportSize`. */
export function useWindowSnapshot(): { w: number; h: number } {
  const shape = useLayoutShape();
  const own = useEditorStore((s) => s.layoutShape);
  const live = useViewportSize();
  if (shape === own) return live;
  return shape === 'portrait' ? PICTURE_WIN_UPRIGHT : FIT_REF;
}

const PICTURE_WIN_UPRIGHT = { w: 390, h: 844 };

/** The zoom, inside the figure, at which a pictured shell draws its controls the size the reader's
 *  screen draws them: the live frame over the pictured one, under the zoom Help itself stands at. */
export function useLiveShellZoom(win: { w: number; h: number }): number {
  const view = useScaleView();
  const surface = useSurfaceZoom();
  // A posed window (a phone pictured for a desktop reader) draws at that device's own size: its css
  // px on the reader's.
  const own = win.w === view.vw && win.h === view.vh;
  // The pictured shell lays out at the reader's UI zoom in their own window (`PicturedShell`).
  const pictured = uiScaleOf({ ...view, vw: win.w, vh: win.h, dock: NO_DOCK, uiZoom: own ? view.uiZoom : PICTURED_UI_ZOOM });
  return own ? uiScaleOf(view) / (pictured * surface) : 1 / surface;
}

/** The widest an upright window's overview stands, so a phone's picture leaves its words in view. */
const OVERVIEW_UPRIGHT_MAX = 300;

/** How wide a whole pictured window stands: a miniature by intent, as wide as the column allows and
 *  short enough to stand in the reading area whole (`MINIATURE_SIGHT`), a phone's at most
 *  `OVERVIEW_UPRIGHT_MAX`, its clusters named in the figure's own type. */
export function useOverviewWidth(win: { w: number; h: number }): number {
  const room = useFigureRoom();
  const sight = useFigureSight();
  const upright = win.h > win.w;
  const tall = sight > 0 ? Math.floor((sight * MINIATURE_SIGHT * win.w) / win.h) : Infinity;
  return Math.min(room || 560, tall, upright ? Math.min(win.w, OVERVIEW_UPRIGHT_MAX) : win.w);
}

/** The UI zoom a pictured window lays out at: the reader's own in their own window, so its panels
 *  stand as their screen draws them, and the pictured zoom in a posed device's. */
export function usePicturedUiZoom(win: { w: number; h: number }): number {
  const live = useViewportSize();
  const readerZoom = useEditorStore((s) => s.uiZoom);
  return win.w === live.w && win.h === live.h ? readerZoom : PICTURED_UI_ZOOM;
}

/** A whole pictured window, shell and all, as a miniature: posed in `mode` with nothing walked. */
export function FrameMiniature({ mode }: { mode?: UiPreviewPose['mode'] }) {
  const ready = useFigureReady();
  const win = useWindowSnapshot();
  const width = useOverviewWidth(win);
  const scale = width / win.w;
  return (
    <div data-figure-miniature data-figure-sized aria-hidden {...INERT} style={{ position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden', borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none' }}>
      {ready && <PicturedShell win={win} zoom={scale} {...(mode ? { mode } : {})} />}
    </div>
  );
}

const CYCLE: readonly FrameCorner[] = ['modes', 'agent', 'topright', 'rail', 'bar'];

/** The whole window at a glance, the spotlight walking cluster to cluster. */
export function FrameOverview() {
  const ready = useFigureReady();
  const t = useT();
  const win = useWindowSnapshot();
  const width = useOverviewWidth(win);
  const scale = width / win.w;
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const still = useReducedMotionConfig() === true;

  useEffect(() => {
    if (!ready || still) return undefined;
    const timer = setInterval(() => setStep((n) => (n + 1) % CYCLE.length), 2200);
    return () => clearInterval(timer);
  }, [ready, still]);

  const corner = CYCLE[step]!;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!ready || !root || still) return undefined;
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
  }, [corner, win.w, ready, still]);

  return (
    <div data-figure-miniature data-figure-sized style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
    {/* Every cluster's name in one cell, so the longest holds the room and a step moves nothing. */}
    <div style={{ display: 'grid', maxWidth: width }}>
      {CYCLE.map((c) => (
        <span key={c} style={{ gridArea: '1 / 1', justifySelf: 'center', visibility: !still && box && c === corner ? 'visible' : 'hidden', ...figureCaption({ role: 'small', padding: '4px 14px' }) }}>
          {t(CORNER_TITLE[c])}
        </span>
      ))}
    </div>
    <div ref={rootRef} aria-hidden {...INERT} style={{ position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden', borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none' }}>
      {ready && <PicturedShell win={win} zoom={scale}>
        {!still && box && (
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
          </>
        )}
      </PicturedShell>}
    </div>
    </div>
  );
}

/** One cluster, cut from the same pictured shell and filled to the figure. A cluster the live
 *  state is not showing (the bottom bar with no mode armed) falls back to the given stand-in.
 *  The shell mounts only once the figure nears the viewport: a page holds several of these, and
 *  mounting them all with the page is seconds of work the reader has not scrolled to yet. */
export function FrameCut({ corner, fallback, layerPanel, mode, objectBrush, regionScreen, targets, highlight }: { corner: FrameCorner; fallback?: ReactNode; layerPanel?: UiPreviewPose['layerPanel']; mode?: UiPreviewPose['mode']; objectBrush?: UiPreviewPose['objectBrush']; regionScreen?: UiPreviewPose['regionScreen']; targets?: readonly string[]; highlight?: readonly string[] }) {
  const win = useWindowSnapshot();
  const holdRef = useRef<HTMLDivElement>(null);
  const near = useInView(holdRef);
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [focus, setFocus] = useState<Box | null>(null);
  const [parts, setParts] = useState<CutParts>(NO_PARTS);
  const [settled, setSettled] = useState(false);

  const live = useLiveShellZoom(win);
  const room = useFigureRoom();
  // A cut is already a part of the shell, so it draws at live size and crops rather than shrinks.
  const scale = live;

  const read = () => {
    const root = rootRef.current;
    if (!root) return;
    const next = targets ? measureBox(root, targets, win.w, 20) : measure(root, corner, win.w);
    setBox(next);
    if (next) setParts(measureParts(root, next, win.w));
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

  // Wider than the room at the least share, the cut keeps the room and centres on its cluster.
  const cropW = box ? Math.min(Math.round(box.w * scale), room || Infinity) : 0;
  const span = box ? cutSpan(box, cropW / scale, CROP_AT[corner], parts) : null;
  const view = box && span
    ? { w: Math.round((span.end - span.start) * scale), h: Math.round(box.h * scale), dx: span.start, dy: box.y }
    : { w: room || 620, h: 200, dx: 0, dy: 0 };
  // A side the crop cuts into fades out, as a row that scrolls does, so no control ends in a hard cut.
  const cutStart = !!box && view.dx > box.x + 0.5;
  const cutEnd = !!box && view.dx + view.w / scale < box.x + box.w - 0.5;
  const mask = fadeMask('x', { start: cutStart ? SCROLL_FADE : 0, end: cutEnd ? SCROLL_FADE : 0 });
  const style: CSSProperties = {
    ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : null),
    position: 'relative', width: view.w, maxWidth: '100%', height: view.h, overflow: 'hidden',
    borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
    // The mount measures itself before the box lands; until then it holds a quiet frame.
    opacity: box ? 1 : 0,
    transition: cssMotion('help.figure.fade', ['opacity']),
  };
  return (
    <div ref={holdRef} aria-hidden data-figure-sized {...INERT} style={style}>
      {box && focus && <span aria-hidden style={{ position: 'absolute', left: (focus.x - box.x) * scale, top: (focus.y - box.y) * scale, width: focus.w * scale, height: focus.h * scale, border: `3px solid ${FOCUS_RING}`, borderRadius: radii.md, zIndex: z.unmissable, pointerEvents: 'none', boxSizing: 'border-box' }}/> }
      {near && (
        <div style={{ zoom: scale }}>
          <div style={{ marginLeft: -view.dx, marginTop: -view.dy }}>
            {/* The measure root's width must be the pictured window's, whatever the wrappers lay
                out at: the screen-to-shell ratio is read off this box. */}
            <div ref={rootRef} style={{ width: win.w }}>
              <PicturedShell win={win} zoom={1} layerPanel={layerPanel} mode={mode} objectBrush={objectBrush} regionScreen={regionScreen} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What a cut's edges must respect: the chosen controls and their names (kept in view) and every
 *  word and control (never cut through), in shell px. */
interface CutParts { keep: readonly Box[]; whole: readonly Box[] }
const NO_PARTS: CutParts = { keep: [], whole: [] };
const CHOSEN = '[data-map-caption],[aria-pressed="true"],[aria-checked="true"],[aria-selected="true"]';
const WHOLE = 'button,[role=button],[role=tab]';
const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && !!n.textContent?.trim());

function measureParts(root: HTMLElement, box: Box, winW: number): CutParts {
  const within = (b: Box) => b.y < box.y + box.h && b.y + b.h > box.y && b.x < box.x + box.w && b.x + b.w > box.x;
  return {
    keep: measureEach(root, CHOSEN, winW).filter(within),
    whole: [...measureEach(root, '*', winW, hasText), ...measureEach(root, WHOLE, winW)].filter(within),
  };
}

/** The span, in shell px, a cut `width` wide shows of `box`: placed at `at` (0 its start, 1 its end),
 *  moved to keep the chosen controls and their names in view, then narrowed so neither edge cuts
 *  through a word or a control. */
function cutSpan(box: Box, width: number, at: number, parts: CutParts): { start: number; end: number } {
  if (width >= box.w - 0.5) return { start: box.x, end: box.x + box.w };
  let start = box.x + (box.w - width) * at;
  const chosen = [...parts.keep].sort((a, b) => a.x - b.x);
  if (chosen.length) {
    let left = chosen[0]!.x, right = chosen[0]!.x + chosen[0]!.w;
    for (const c of chosen.slice(1)) if (Math.max(right, c.x + c.w) - left <= width) right = Math.max(right, c.x + c.w);
    start = Math.min(Math.max(start, right - width), left);
  }
  start = Math.min(Math.max(start, box.x), box.x + box.w - width);
  let end = start + width;
  const boxEnd = box.x + box.w;
  // Moving an edge off one part can land it in a neighbour; a few passes settle it.
  for (let pass = 0; pass < 4; pass++) {
    for (const p of parts.whole) {
      if (p.w > width / 2) continue;
      if (start > box.x + 0.5 && p.x < start && p.x + p.w > start) start = p.x + p.w;
      if (end < boxEnd - 0.5 && p.x < end && p.x + p.w > end) end = p.x;
    }
  }
  return end - start > width / 2 ? { start, end } : { start: box.x + (box.w - width) * at, end: box.x + (box.w - width) * at + width };
}

/** Where a cut wider than its room keeps its cluster: a row read from its start (the bar's tools
 *  lead it, the modes their first), the right-hand clusters from their right edge. */
const CROP_AT: Record<FrameCorner, number> = { modes: 0, agent: 0, bar: 0, topright: 1, rail: 1 };

/** How long a cut waits for its cluster before it shows the stand-in. */
const FIGURE_SETTLE_MS = 900;


const NOTES_ENTRY_HIGHLIGHT = ['[data-testid="shell-layer-annotation"]'];
const NOTES_ENTRY_TARGETS = NOTES_ENTRY_HIGHLIGHT;

/** The entry row and resulting toolbar are cropped from the editor's own shell. */
export function NotesEntryPreview() {
  const t = useT();
  return <div data-figure-sized style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', width: '100%' }}>
    <div style={{ textAlign: 'center' }}>
      <FrameCut corner="rail" layerPanel="column" targets={NOTES_ENTRY_TARGETS} highlight={NOTES_ENTRY_HIGHLIGHT}/>
      <p style={figureCaption({ role: 'note', padding: '3px 8px' })}>{t('help.notes.entry_layer')}</p>
    </div>
    <div style={{ textAlign: 'center' }}>
      <FrameCut corner="bar" mode="annotate"/>
    </div>
  </div>;
}
