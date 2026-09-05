/*
 * frame-overview.tsx — the interface at a glance IS the interface.
 *
 * The figure mounts the REAL `Shell` inside a pictured subtree (`ui-preview.tsx`: chrome renders,
 * nothing acts — no windows, no tour, no fuses, no global listeners), sized to the window the live
 * shell laid itself out for and zoomed to the figure. Whatever the interface looks like right now,
 * the figure looks like that: a redesign of the shell redraws its own documentation.
 *
 * Clusters are found by the shell's own anchors (`data-tour-target`, `data-help`), measured from
 * the mounted tree — so the spotlight ring bounds exactly what the shell drew, and a section CUT
 * crops the same mount to one cluster's measured box.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Shell } from '../../../../../shell/Shell';
import { tourTargetSelector } from '../../../../tour/steps';
import { drawCursorImg } from '../demo-cursor';
import { UiPreviewProvider, type UiPreviewPose } from '../../../../../primitives/ui-preview';
import { FIT_REF } from '../../../../../design/scale';
import { useEditorStore } from '../../../../../../state/store';
import { renderThumbnail } from '../../../../../../canvas/thumbnail';
import { createGrid } from '../../../../../../core/model/grid-model';
import { DEFAULT_MAP } from '../../../../../../config/maps';
import type { GridState } from '../../../../../../core/model/types';
import { isMotionReduced } from '../../../../../../canvas/map2d/motion-state';
import { useT } from '../../../../../../i18n/context';
import { withAlpha } from '../../../../../design/styles';
import { FOCUS_RING } from '../../../../../design/tokens';
import { radii, shadows, z } from '../../../../../design/styles';
import { spotlightRx } from '../../../../tour/TourOverlay';
import { figureCaption, PressPulse } from '../caption';

const INERT = { inert: '' } as unknown as HTMLAttributes<HTMLDivElement>;

export type FrameCorner = 'modes' | 'agent' | 'topright' | 'rail' | 'bar';

const CORNER_TITLE: Record<FrameCorner, string> = {
  modes: 'help.frame.modes_t',
  agent: 'help.frame.assistant_t',
  topright: 'help.frame.topright_t',
  rail: 'help.frame.rail_t',
  bar: 'help.frame.bar_t',
};

/** The shell's own anchors that make up each cluster; a cluster's box is their union.
 *  The bar's are `div`-scoped: the mode BLOCKS are buttons carrying the same help ids as the
 *  shelves they open, and a bare `[data-help]` would pull the top-left row into the bottom bar. */
const CORNER_ANCHORS: Record<FrameCorner, readonly string[]> = {
  // The union of the icon BUTTONS, not the row wrapper: the wrapper is wider than the group,
  // which would hang the ring off-centre.
  modes: [`${tourTargetSelector('modes')} button`],
  agent: [tourTargetSelector('assistant')],
  // The menu is found by its TOUR target: its help id ("frame") is also the rail's hide-interface
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
    const subject: GridState = grid ?? { template: DEFAULT_MAP, cells: createGrid(DEFAULT_MAP), objects: new Map(), lockedLayers: new Set() };
    void renderThumbnail(subject, 1024, aspect).then((p) => { if (!dropped && p) setPng(p); });
    return () => { dropped = true; };
  }, [grid, aspect]);
  return png;
}

/** Measure a cluster's box within the pictured shell, in the shell's own (pre-zoom) pixels.
 *  The screen-to-shell ratio is read off the root itself (its laid-out width IS the pictured
 *  window's), so the answer holds under any ancestor zoom: the figure's own scale, the chrome
 *  scale the Help window rides, and the user's UI zoom all cancel out. */
export function measureBox(root: HTMLElement, selectors: readonly string[], winW: number, padPx: number): Box | null {
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0) return null;
  const zoom = rootRect.width / winW;
  const boxes: Box[] = [];
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
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
function measurePoint(root: HTMLElement, selectors: readonly string[], winW: number): { x: number; y: number } | null {
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0) return null;
  const zoom = rootRect.width / winW;
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
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
export function PicturedShell({ win, zoom, layerPanel, children }: {
  win: { w: number; h: number };
  zoom: number;
  layerPanel?: UiPreviewPose['layerPanel'];
  children?: ReactNode;
}) {
  const backdrop = useMapBackdrop(win.w / win.h);
  const [pose] = useState<UiPreviewPose>(() => ({ viewport: win, mode: 'mountain', layerPanel }));
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
  const t = useT();
  const win = useWindowSnapshot();
  const width = 560;
  const scale = width / win.w;
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const still = useRef(isMotionReduced());

  useEffect(() => {
    if (still.current) return undefined;
    const timer = setInterval(() => setStep((n) => (n + 1) % CYCLE.length), 2200);
    return () => clearInterval(timer);
  }, []);

  const corner = CYCLE[step]!;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || still.current) return undefined;
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
  }, [corner, scale]);

  return (
    <div ref={rootRef} aria-hidden {...INERT} style={{ position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden', borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none' }}>
      <PicturedShell win={win} zoom={scale}>
        {!still.current && box && (
          <>
            {/* Figure annotations stand at the ladder's top: the pictured chrome carries the
                app's own rungs, and the name plate must read over all of it. */}
            <span
              style={{
                position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
                border: `5px solid ${FOCUS_RING}`, borderRadius: spotlightRx(box.w, box.h, 1), zIndex: z.unmissable,
                boxShadow: `0 0 0 8px ${withAlpha(FOCUS_RING, 0.18)}`, transition: 'all 0.4s ease', pointerEvents: 'none',
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: Math.max(12, Math.min(box.x, win.w - 420)),
                top: box.y + box.h + 18 > win.h - 70 ? box.y - 64 : box.y + box.h + 18,
                zIndex: z.unmissable, pointerEvents: 'none', transition: 'all 0.4s ease',
                ...figureCaption({ role: 'lead', padding: '8px 20px', shadow: true, nowrap: true }),
              }}
            >
              {t(CORNER_TITLE[corner])}
            </span>
          </>
        )}
      </PicturedShell>
    </div>
  );
}

/** One cluster, cut from the same pictured shell and filled to the figure. A cluster the live
 *  state is not showing (the bottom bar with no mode armed) falls back to the given stand-in.
 *  The shell mounts only once the figure nears the viewport: a page holds several of these, and
 *  mounting them all with the page is seconds of work the reader has not scrolled to yet. */
export function FrameCut({ corner, fallback }: { corner: FrameCorner; fallback?: ReactNode }) {
  const win = useWindowSnapshot();
  const holdRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const hold = holdRef.current;
    if (!hold || near) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: '600px' });
    io.observe(hold);
    return () => io.disconnect();
  }, [near]);

  const scale = box ? Math.min(620 / box.w, 340 / box.h, 1.25) : 0.4;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !near) return undefined;
    const read = () => setBox(measure(root, corner, win.w));
    const timer = setTimeout(read, 120);
    const settle = setTimeout(() => { read(); setSettled(true); }, 900);
    return () => { clearTimeout(timer); clearTimeout(settle); };
  }, [corner, near]);
  if (settled && !box && fallback) return <>{fallback}</>;

  const view = box
    ? { w: Math.round(box.w * scale), h: Math.round(box.h * scale), dx: box.x, dy: box.y }
    : { w: 620, h: 200, dx: 0, dy: 0 };
  const style: CSSProperties = {
    position: 'relative', width: view.w, height: view.h, overflow: 'hidden',
    borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
    // The mount measures itself before the box lands; until then it holds a quiet frame.
    opacity: box ? 1 : 0,
    transition: 'opacity 0.2s ease',
  };
  return (
    <div ref={holdRef} aria-hidden {...INERT} style={style}>
      {near && (
        <div style={{ zoom: scale }}>
          <div style={{ marginLeft: -view.dx, marginTop: -view.dy }}>
            {/* The measure root's width must BE the pictured window's, whatever the wrappers lay
                out at: the screen-to-shell ratio is read off this box. */}
            <div ref={rootRef} style={{ width: win.w }}>
              <PicturedShell win={win} zoom={1} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The presses the walk is made of, each on the control's own target: the readout's words open
 *  the panel, the head's left arrow grows it, the right arrow steps the ladder back down. */
type LayerPress = 'open' | 'bigger' | 'smaller';
const LAYER_TAP: Record<LayerPress, readonly string[]> = {
  // The press lane draws only once its own measurement lands; the readout word is the anchor
  // that is always there.
  open: ['[data-testid="shell-layer-readout-press"]', '[data-testid="shell-layer-readout"]'],
  bigger: ['[data-testid="shell-layer-bigger"]'],
  smaller: ['[data-testid="shell-layer-smaller"]'],
};

/** Up the ladder and back down: pill to column to grid, then grid to column to pill, and round
 *  again. Each entry is the press its beat lands while the control stands at the size the
 *  previous beat left it at. */
const LAYER_WALK: readonly LayerPress[] = ['open', 'bigger', 'smaller', 'smaller'];

/** The reduced-motion figure's mark: a floor's row on the posed column, the press that pins it. */
const LAYER_TAP_STILL: readonly string[] = ['[data-testid="shell-layer-row-2"]'];

const LAYER_BEAT_MS = 2800;

/** The first present press target under `root`, in the given order of preference. */
function pressTarget(root: HTMLElement, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/** One pointer event of the walk's scripted press. The pictured wrappers' `inert` and
 *  `pointer-events: none` block USER input only; a dispatched event still runs the listeners.
 *  jsdom has no PointerEvent, and a MouseEvent under the pointer type name reaches the same
 *  listeners (Framer's press gesture reads `isPrimary !== false`, which a MouseEvent passes). */
function pressEvent(type: 'pointerdown' | 'pointerup', buttons: number): Event {
  const init = { bubbles: true, cancelable: true, button: 0, buttons };
  return typeof PointerEvent === 'function'
    ? new PointerEvent(type, { ...init, isPrimary: true, pointerId: 1, pointerType: 'mouse' })
    : new MouseEvent(type, init);
}

/** A pulsing mark on the spot the pictured state answers a press at, and the exact point beside
 *  it: the ring is the house's own press pulse, standing rather than blooming once. */
function TapMark({ x, y }: { x: number; y: number }) {
  return (
    <>
      <PressPulse x={x} y={y} repeat />
      <span
        style={{
          position: 'absolute', left: x - 6, top: y - 6, width: 12, height: 12, borderRadius: 999,
          pointerEvents: 'none', zIndex: z.unmissable, background: FOCUS_RING, boxShadow: shadows.s1,
        }}
      />
    </>
  );
}

/** The layer control walked through its three sizes by pressing its own targets, on ONE pictured
 *  shell booted collapsed like the live app. Rail reads its pose only in the mode initializer
 *  (`Rail.tsx`), so a mounted shell cannot be re-posed; driving the real handlers instead is also
 *  what plays the control's own motion untouched — the open's presence spring, the column/grid
 *  shared-layout resize. Each beat marks the next press target, lands the press a cue later, and
 *  re-reads the crop box on a stagger while the control springs to its new size. */
/** The recording window's size in shell px: wide and tall enough for the walk's largest state
 *  (the grid), read right-anchored off the readout control. */
const LAYERS_VIEW = { w: 560, h: 430, pad: 14 } as const;

export function LayersTour() {
  const win = useWindowSnapshot();
  const holdRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const still = useRef(isMotionReduced());
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  /** Where the pictured pointer stands (shell px): the last press target it glided to. */
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  // The pointer wears the app's own cursor art; the host's position is the acting point.
  const cursorHost = (el: HTMLDivElement | null) => { if (el) drawCursorImg(el, 'clickable'); };

  useEffect(() => {
    const hold = holdRef.current;
    if (!hold || near) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: '600px' });
    io.observe(hold);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (still.current || !near) return undefined;
    const timer = setInterval(() => setStep((n) => (n + 1) % LAYER_WALK.length), LAYER_BEAT_MS);
    return () => clearInterval(timer);
  }, [near]);

  useEffect(() => {
    if (!near) return undefined;
    // ONE fixed recording window, anchored to the STATIC readout pill: the walk's states (pill,
    // column, grid) all play inside it, and the camera never moves once the anchor has landed.
    const readBox = () => {
      const root = rootRef.current;
      if (!root) return;
      setBox((was) => {
        if (was) return was;
        const anchor = measureBox(root, ['[data-testid="shell-layer-readout"]', '[data-help="layers"]'], win.w, 0);
        if (!anchor) return was;
        return {
          x: anchor.x + anchor.w + LAYERS_VIEW.pad - LAYERS_VIEW.w,
          y: anchor.y - LAYERS_VIEW.pad,
          w: LAYERS_VIEW.w,
          h: LAYERS_VIEW.h,
        };
      });
    };
    const readTap = (selectors: readonly string[]) => () => {
      const root = rootRef.current;
      const p = root ? measurePoint(root, selectors, win.w) : null;
      // The same spot keeps the same mark, so a re-read does not restart its pulse.
      setTap((was) => (was && p && Math.abs(was.x - p.x) < 1 && Math.abs(was.y - p.y) < 1 ? was : p));
      if (p) setCur(p);
    };
    if (still.current) {
      const read = () => { readBox(); readTap(LAYER_TAP_STILL)(); };
      const timers = [setTimeout(read, 120), setTimeout(read, 900)];
      return () => timers.forEach(clearTimeout);
    }
    const press = LAYER_WALK[step]!;
    const firePress = (phase: 'down' | 'up') => () => {
      const root = rootRef.current;
      const el = root && pressTarget(root, LAYER_TAP[press]);
      if (!el) return;
      if (phase === 'down') { el.dispatchEvent(pressEvent('pointerdown', 1)); return; }
      el.dispatchEvent(pressEvent('pointerup', 0));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    };
    // The mark stands on the target a full cue before the press lands; the held pointer gives
    // Framer's whileTap a beat of its own. The late box reads follow the control's spring: the
    // early ones land on a box still travelling.
    const timers = [
      setTimeout(() => { readBox(); readTap(LAYER_TAP[press])(); }, 150),
      setTimeout(readTap(LAYER_TAP[press]), 650),
      setTimeout(firePress('down'), 1150),
      setTimeout(firePress('up'), 1300),
      setTimeout(() => { setTap(null); readBox(); }, 1500),
      setTimeout(readBox, 2050),
      setTimeout(readBox, 2600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [step, near, win.w]);

  const scale = 620 / LAYERS_VIEW.w;
  const view = box
    ? { w: 620, h: Math.round(LAYERS_VIEW.h * scale), dx: box.x, dy: box.y }
    : { w: 620, h: Math.round(LAYERS_VIEW.h * scale), dx: 0, dy: 0 };
  return (
    <div
      ref={holdRef}
      aria-hidden
      {...INERT}
      style={{
        position: 'relative', width: 620, height: Math.round(LAYERS_VIEW.h * scale), overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
        opacity: box ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
    >
      {near && (
        <div style={{ position: 'relative', width: view.w, height: view.h, overflow: 'hidden' }}>
        <div style={{ zoom: scale }}>
          <div style={{ marginLeft: -view.dx, marginTop: -view.dy }}>
            <div ref={rootRef} style={{ position: 'relative', width: win.w }}>
              <PicturedShell win={win} zoom={1} layerPanel={still.current ? 'column' : undefined} />
              {tap && <TapMark x={tap.x} y={tap.y} />}
              {cur && (
                <div
                  ref={cursorHost}
                  style={{
                    position: 'absolute', left: cur.x, top: cur.y, zIndex: z.unmissable,
                    pointerEvents: 'none',
                    transition: still.current ? undefined : 'left 0.6s cubic-bezier(0.4, 0, 0.2, 1), top 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              )}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
