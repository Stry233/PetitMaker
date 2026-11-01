/**
 * Where the frame plane, the map plane and the vignette stand while the docked assistant slides the
 * interface aside, and the dock widths published for the chrome outside the frame.
 *
 * Renders write the settled form; the slide's frames, the frames of the UI zoom's follow and each
 * render's paint are written past React from the live values (`use-dock.ts:dockAside`,
 * `design/scale.tsx:onLiveScale`) with the same arithmetic (`plane-zoom.ts:useLivePlaneWriter`). The map plane travels half the dock, since the
 * map is centred in its box, and a clip carries its visible edge the rest of the way, so the canvas
 * keeps its size until the slide settles. Each side edge's width is published twice: in the chrome's own
 * units (`--pin-dock-left`/`-right`) and in css px (the `-px` pair), at most one of each pair nonzero.
 * A bottom dock (`use-dock.ts:useDockAxis`) does the same along the height: the planes' feet rise, the
 * map travels up half the dock and is clipped at its foot, and the side widths stay 0; the plate under
 * a bottom dock (`plateRef`) stands as tall as its strip.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { useDenseScript, useDevicePixelRatio, useViewportSize } from '../../design/scale';
import { z } from '../../design/styles';
import { useSettledUiZoom } from '../../design/ui-zoom-anim';
import { useLayoutShape, useTouchMode } from '../../design/input-mode';
import { useUiPreview } from '../../design/preview';
import { DOCK_DEPTH_VAR, dockStrip, frameZoomAt } from '../panel-frame';
import { axisOf, dockAside, dockDrag, useDockDepth, useDockStage } from '../use-dock';
import { ZOOM } from '../units';
import { liveDockDepth, liveFrameZoom, planeZoomStyle, useLivePlaneWriter, writeFrameZoom } from './plane-zoom';

const dockVars = (atLeft: boolean, refW: number, px: number) => ({
  '--pin-dock-left': `${atLeft ? refW : 0}px`,
  '--pin-dock-right': `${atLeft ? 0 : refW}px`,
  '--pin-dock-left-px': `${atLeft ? px : 0}px`,
  '--pin-dock-right-px': `${atLeft ? 0 : px}px`,
});

/** Where the planes' edges stand with the sheet `v` of the way off a dock, in css px of the window and
 *  the frame's own px (`frameInset`, `frameFoot`); `between` while it travels. */
function planeGeometry(v: number, atLeft: boolean, depth: number | null, height: number, zoom: number) {
  const strip = dockStrip(v, height, depth ?? undefined);
  const refW = strip.axis === 'x' ? strip.size : 0;
  const side = refW * (zoom / ZOOM);
  const foot = strip.axis === 'y' ? strip.size : 0;
  return {
    refW, side, foot,
    frameInset: refW / ZOOM,
    frameFoot: foot / zoom,
    left: atLeft ? side : 0,
    right: atLeft ? 0 : side,
    between: v > 0 && v < 1,
  };
}

type PlaneGeometry = ReturnType<typeof planeGeometry>;

/** The frame plane's box, in its own px. */
function framePlaneBox(g: PlaneGeometry, atLeft: boolean) {
  return { left: atLeft ? g.frameInset : 0, right: atLeft ? 0 : g.frameInset, bottom: g.frameFoot };
}

/** The map plane's box: in transit it keeps the window's box, travels half the strip (the map is
 *  centred in its box) and is clipped the other half, deaf while the view projections lag the box;
 *  settled, it is inset by the strip. */
function mapPlaneBox(g: PlaneGeometry, bottom: boolean, atLeft: boolean) {
  if (!g.between) return { left: `${g.left}px`, right: `${g.right}px`, bottom: `${g.foot}px`, transform: '', clipPath: '', pointerEvents: '' };
  const travel = (bottom ? g.foot : g.side) / 2;
  return {
    left: '0px', right: '0px', bottom: '0px',
    transform: bottom ? `translateY(${-travel}px)` : `translateX(${atLeft ? travel : -travel}px)`,
    clipPath: bottom ? `inset(${travel}px 0 ${travel}px 0)` : `inset(0 ${travel}px 0 ${travel}px)`,
    pointerEvents: 'none',
  };
}

export function useDockPlanes() {
  const { aside, edge } = useDockStage();
  const axis = axisOf(edge);
  const share = useDockDepth();
  const depth = axis === 'y' ? share : null;
  const { w: vw, h: vh } = useViewportSize();
  const uiZoom = useSettledUiZoom();
  const touch = useTouchMode();
  const pictured = useUiPreview();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const upright = useLayoutShape() === 'portrait';
  const zoom = frameZoomAt(aside, vw, vh, uiZoom, { touch, upright, depth: depth ?? undefined });
  const atLeft = edge === 'left';
  const at = planeGeometry(aside, atLeft, depth, vh, zoom);

  const frameRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  // The one writer of the dock's root variables. A pictured shell holds its settled scale; the live
  // one belongs to the window's own interface. A held seam handle's depth stands in for the settled
  // one; while it is held the map plane keeps its box and travels and clips as on a slide, so its
  // canvas never resizes under the finger.
  const write = () => {
    const live = liveDockDepth(depth !== null) ?? null;
    const root = document.documentElement.style;
    if (live !== null) root.setProperty(DOCK_DEPTH_VAR, String(live));
    const frame = frameRef.current, map = mapRef.current, vig = vignetteRef.current;
    // A pictured shell reads its posed window, not the browser's.
    const { zoom: zoomNow, windowH } = pictured
      ? liveFrameZoom(live ?? undefined, upright, { touch, uiZoom }, { width: vw, height: vh })
      : liveFrameZoom(live ?? undefined, upright);
    const g0 = planeGeometry(dockAside.get(), atLeft, live, windowH, zoomNow);
    const g = dockDrag.get() === null || depth === null ? g0 : { ...g0, between: true };
    for (const [k, value] of Object.entries(dockVars(atLeft, g.refW, g.side))) root.setProperty(k, value);
    if (plateRef.current) plateRef.current.style.height = `${g.foot}px`;
    if (!frame || !map || !vig) return;
    const box = framePlaneBox(g, atLeft);
    frame.style.left = `${box.left}px`;
    frame.style.right = `${box.right}px`;
    frame.style.bottom = `${box.bottom}px`;
    writeFrameZoom(frame, zoomNow, dpr, dense, windowH);
    Object.assign(map.style, mapPlaneBox(g, depth !== null, atLeft));
    vig.style.left = `${g.left}px`;
    vig.style.right = `${g.right}px`;
    vig.style.bottom = `${g.foot}px`;
  };
  useLivePlaneWriter(write, pictured);
  useEffect(() => () => {
    const root = document.documentElement.style;
    for (const k of Object.keys(dockVars(true, 0, 0))) root.removeProperty(k);
  }, []);

  /** `contain: layout` makes the plane the fixed chrome's containing block without a transform; the plane is deaf. */
  const frameStyle = {
    ...planeZoomStyle(zoom, vh, dpr, dense),
    position: 'fixed', top: 0, ...framePlaneBox(at, atLeft),
    contain: 'layout', pointerEvents: 'none', zIndex: z.panel,
  } as CSSProperties;
  const mapStyle = {
    position: 'fixed', top: 0, ...mapPlaneBox(at, depth !== null, atLeft),
    contain: 'layout', zIndex: z.paper,
  } as CSSProperties;
  return { frameRef, mapRef, vignetteRef, plateRef, frameStyle, mapStyle, dockLeft: at.left, dockRight: at.right, dockBottom: at.foot };
}
