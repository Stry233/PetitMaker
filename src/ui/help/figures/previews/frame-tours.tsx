/** The layer control and the Notes row walked through on the pictured shell, each press landing on the control's own target. */
import { measureBox, measurePoint, PicturedShell, useWindowSnapshot, type Box } from './frame-overview';
import { INERT } from './PreviewFrame';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useScriptedWalk } from '../scripted-walk';
import { cssMotion } from '../../../design/motion';
import { useRef, useState } from 'react';
import { drawCursorImg } from '../demo-cursor';
import { useInView } from '../use-in-view';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { FOCUS_RING } from '../../../design/tokens';
import { radii, shadows, z } from '../../../design/styles';
import { PressPulse } from '../caption';

/** The Notes row's two toggles, walked on the pictured panel standing open: the mark lands on the
 *  eye, the eye closes; then on the lock, the lock shuts; then each opens again. The row is posed
 *  through the preview context rather than pressed, because the pictured panel is the live one and
 *  a real press would hide or lock the reader's own notes. */
export type NotesPress = 'eye' | 'lock';
export const NOTES_TAP: Record<NotesPress, readonly string[]> = {
  eye: ['[data-testid="shell-layer-annotation-eye"]'],
  lock: ['[data-testid="shell-layer-annotation-lock"]'],
};
export const NOTES_WALK: readonly NotesPress[] = ['eye', 'eye', 'lock', 'lock'];
export const NOTES_VIEW = { w: 560, h: 300, pad: 14 } as const;

export function NotesRowTour() {
  const win = useWindowSnapshot();
  const holdRef = useRef<HTMLDivElement>(null);
  const near = useInView(holdRef);
  const still = useRef(isMotionReduced());
  const rootRef = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState({ visible: true, locked: false });
  const [box, setBox] = useState<Box | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const cursorHost = (el: HTMLDivElement | null) => { if (el) drawCursorImg(el, 'clickable'); };
  const readBox = () => {
    const root = rootRef.current;
    if (!root) return;
    setBox((was) => {
      if (was) return was;
      const anchor = measureBox(root, ['[data-testid="shell-layer-annotation-help"]', '[data-help="layers"]'], win.w, 0);
      if (!anchor) return was;
      return { x: anchor.x + anchor.w + NOTES_VIEW.pad + 200 - NOTES_VIEW.w, y: anchor.y - NOTES_VIEW.pad - 60, w: NOTES_VIEW.w, h: NOTES_VIEW.h };
    });
  };
  const readTap = (selectors: readonly string[]) => () => {
    const root = rootRef.current;
    const p = root ? measurePoint(root, selectors, win.w) : null;
    setTap((was) => (was && p && Math.abs(was.x - p.x) < 1 && Math.abs(was.y - p.y) < 1 ? was : p));
    if (p) setCur(p);
  };
  // The settled pose reads its window and mark as the pictured shell lays out.
  useObservedSize(() => (near && still.current ? rootRef.current : null), () => { readBox(); readTap(NOTES_TAP.eye)(); }, [near, win.w]);
  useScriptedWalk(NOTES_WALK.length, LAYER_BEAT_MS, near && !still.current, (step) => {
    const press = NOTES_WALK[step]!;
    return [
      [150, () => { readBox(); readTap(NOTES_TAP[press])(); }],
      [650, readTap(NOTES_TAP[press])],
      [1200, () => setRow((r) => (press === 'eye' ? { ...r, visible: !r.visible } : { ...r, locked: !r.locked }))],
      [1500, () => { setTap(null); readBox(); }],
    ];
  }, win.w);

  const scale = 620 / NOTES_VIEW.w;
  const view = box
    ? { w: 620, h: Math.round(NOTES_VIEW.h * scale), dx: box.x, dy: box.y }
    : { w: 620, h: Math.round(NOTES_VIEW.h * scale), dx: 0, dy: 0 };
  return (
    <div
      ref={holdRef}
      aria-hidden
      {...INERT}
      style={{
        position: 'relative', width: 620, height: Math.round(NOTES_VIEW.h * scale), overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
        opacity: box ? 1 : 0,
        transition: cssMotion('help.figure.fade', ['opacity']),
      }}
    >
      {near && (
        <div style={{ position: 'relative', width: view.w, height: view.h, overflow: 'hidden' }}>
        <div style={{ zoom: scale }}>
          <div style={{ marginLeft: -view.dx, marginTop: -view.dy }}>
            <div ref={rootRef} style={{ position: 'relative', width: win.w }}>
              <PicturedShell win={win} zoom={1} layerPanel="column" notesRow={row} />
              {tap && <TapMark x={tap.x} y={tap.y} />}
              {cur && (
                <div
                  ref={cursorHost}
                  style={{
                    position: 'absolute', left: cur.x, top: cur.y, zIndex: z.unmissable,
                    pointerEvents: 'none',
                    transition: still.current ? undefined : cssMotion('help.figure.pointer', ['left', 'top']),
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

/** The presses the walk is made of, each on the control's own target: the readout's words open
 *  the panel, the head's left arrow grows it, the right arrow steps the ladder back down. */
export type LayerPress = 'open' | 'bigger' | 'smaller';
export const LAYER_TAP: Record<LayerPress, readonly string[]> = {
  // The press lane draws only once its own measurement lands; the readout word is the anchor
  // that is always there.
  open: ['[data-testid="shell-layer-readout-press"]', '[data-testid="shell-layer-readout"]'],
  bigger: ['[data-testid="shell-layer-bigger"]'],
  smaller: ['[data-testid="shell-layer-smaller"]'],
};

/** Up the ladder and back down: pill to column to grid, then grid to column to pill, and round
 *  again. Each entry is the press its beat lands while the control stands at the size the
 *  previous beat left it at. */
export const LAYER_WALK: readonly LayerPress[] = ['open', 'bigger', 'smaller', 'smaller'];

/** The reduced-motion figure's mark: a floor's row on the posed column, the press that pins it. */
export const LAYER_TAP_STILL: readonly string[] = ['[data-testid="shell-layer-row-2"]'];

export const LAYER_BEAT_MS = 2800;


/** The first present press target under `root`, in the given order of preference. */
export function pressTarget(root: HTMLElement, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/** One pointer event of the walk's scripted press. The pictured wrappers' `inert` and
 *  `pointer-events: none` block user input only; a dispatched event still runs the listeners.
 *  jsdom has no PointerEvent, and a MouseEvent under the pointer type name reaches the same
 *  listeners (Framer's press gesture reads `isPrimary !== false`, which a MouseEvent passes). */
export function pressEvent(type: 'pointerdown' | 'pointerup', buttons: number): Event {
  const init = { bubbles: true, cancelable: true, button: 0, buttons };
  return typeof PointerEvent === 'function'
    ? new PointerEvent(type, { ...init, isPrimary: true, pointerId: 1, pointerType: 'mouse' })
    : new MouseEvent(type, init);
}

/** A pulsing mark on the spot the pictured state answers a press at, and the exact point beside
 *  it: the ring is the house's own press pulse, standing rather than blooming once. */
export function TapMark({ x, y }: { x: number; y: number }) {
  return (
    <>
      <PressPulse x={x} y={y} repeat />
      <span
        style={{
          position: 'absolute', left: x - 6, top: y - 6, width: 12, height: 12, borderRadius: radii.pill,
          pointerEvents: 'none', zIndex: z.unmissable, background: FOCUS_RING, boxShadow: shadows.s1,
        }}
      />
    </>
  );
}

/** The recording window's size in shell px: wide and tall enough for the walk's largest state
 *  (the grid), read right-anchored off the readout control. */
export const LAYERS_VIEW = { w: 560, h: 430, pad: 14 } as const;

/** The layer control walked through its three sizes by pressing its own targets, on one pictured
 *  shell booted collapsed like the live app. Rail reads its pose only in the mode initializer
 *  (`Rail.tsx`), so a mounted shell cannot be re-posed; driving the real handlers instead is also
 *  what plays the control's own motion untouched — the open's presence spring, the column/grid
 *  shared-layout resize. Each beat marks the next press target, lands the press a cue later, and
 *  re-reads the crop box on a stagger while the control springs to its new size. */
export function LayersTour() {
  const win = useWindowSnapshot();
  const holdRef = useRef<HTMLDivElement>(null);
  const near = useInView(holdRef);
  const still = useRef(isMotionReduced());
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  /** Where the pictured pointer stands (shell px): the last press target it glided to. */
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  // The pointer wears the app's own cursor art; the host's position is the acting point.
  const cursorHost = (el: HTMLDivElement | null) => { if (el) drawCursorImg(el, 'clickable'); };
  // One fixed recording window, anchored to the static readout pill: every state of the walk plays inside it.
  const readBox = () => {
    const root = rootRef.current;
    if (!root) return;
    setBox((was) => {
      if (was) return was;
      const anchor = measureBox(root, ['[data-testid="shell-layer-readout"]', '[data-help="layers"]'], win.w, 0);
      if (!anchor) return was;
      return { x: anchor.x + anchor.w + LAYERS_VIEW.pad - LAYERS_VIEW.w, y: anchor.y - LAYERS_VIEW.pad, w: LAYERS_VIEW.w, h: LAYERS_VIEW.h };
    });
  };
  const readTap = (selectors: readonly string[]) => () => {
    const root = rootRef.current;
    const p = root ? measurePoint(root, selectors, win.w) : null;
    // The same spot keeps the same mark, so a re-read does not restart its pulse.
    setTap((was) => (was && p && Math.abs(was.x - p.x) < 1 && Math.abs(was.y - p.y) < 1 ? was : p));
    if (p) setCur(p);
  };
  useObservedSize(() => (near && still.current ? rootRef.current : null), () => { readBox(); readTap(LAYER_TAP_STILL)(); }, [near, win.w]);
  useScriptedWalk(LAYER_WALK.length, LAYER_BEAT_MS, near && !still.current, (step) => {
    const press = LAYER_WALK[step]!;
    const firePress = (phase: 'down' | 'up') => () => {
      const root = rootRef.current;
      const el = root && pressTarget(root, LAYER_TAP[press]);
      if (!el) return;
      if (phase === 'down') { el.dispatchEvent(pressEvent('pointerdown', 1)); return; }
      el.dispatchEvent(pressEvent('pointerup', 0));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    };
    // The mark stands on the target a full cue before the press lands, and the held pointer gives
    // the control's press feedback a beat of its own; the late reads follow the control's spring.
    return [
      [150, () => { readBox(); readTap(LAYER_TAP[press])(); }],
      [650, readTap(LAYER_TAP[press])],
      [1150, firePress('down')],
      [1300, firePress('up')],
      [1500, () => { setTap(null); readBox(); }],
      [2050, readBox],
      [2600, readBox],
    ];
  }, win.w);

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
        transition: cssMotion('help.figure.fade', ['opacity']),
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
                    transition: still.current ? undefined : cssMotion('help.figure.pointer', ['left', 'top']),
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
