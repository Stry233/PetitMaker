/**
 * Where the frame plane, the map plane and the vignette stand while the docked assistant slides the
 * interface aside, and the dock widths published for the chrome outside the frame.
 *
 * Renders write the settled form; the slide's frames are written past React from the live fraction
 * (`use-dock.ts:dockAside`) with the same arithmetic. The map plane travels half the dock, since the
 * map is centred in its box, and a clip carries its visible edge the rest of the way, so the canvas
 * keeps its size until the slide settles. Each edge's width is published twice: in the chrome's own
 * units (`--pin-dock-left`/`-right`) and in css px (the `-px` pair), at most one of each pair nonzero.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { viewportSize } from '../../../platform/device/viewport-space';
import { useDenseScript, useDevicePixelRatio, useFitFloor, useViewportSize } from '../../design/scale';
import { font, z } from '../../design/styles';
import { weightVars } from '../../design/text-weight';
import { useAnimatedUiZoom } from '../../design/ui-zoom-anim';
import { useRootCssVars } from '../../primitives/use-root-css-vars';
import { PINNED_COLUMN_W, PINNED_DOCK_REF_W, frameZoomAt } from '../panel-frame';
import { dockAside, useDockStage } from '../use-dock';
import { TEXT, ZOOM } from '../units';
import { writeFrameZoom } from './DockedAssistant';

const dockVars = (atLeft: boolean, refW: number, px: number) => ({
  '--pin-dock-left': `${atLeft ? refW : 0}px`,
  '--pin-dock-right': `${atLeft ? 0 : refW}px`,
  '--pin-dock-left-px': `${atLeft ? px : 0}px`,
  '--pin-dock-right-px': `${atLeft ? 0 : px}px`,
});

export function useDockPlanes() {
  const { aside, side } = useDockStage();
  const { w: vw, h: vh } = useViewportSize();
  const uiZoom = useAnimatedUiZoom();
  const floor = useFitFloor();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const zoom = frameZoomAt(aside, vw, vh, uiZoom, floor);
  const atLeft = side === 'left';
  const dockRef = aside * PINNED_DOCK_REF_W;
  const dockPx = dockRef * (zoom / ZOOM);
  const dockLeft = atLeft ? dockPx : 0;
  const dockRight = atLeft ? 0 : dockPx;
  const sliding = aside > 0 && aside < 1;
  const mapTravel = dockPx / 2;
  useRootCssVars(dockVars(atLeft, dockRef, dockPx));

  const frameRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  useEffect(() => dockAside.on('change', (v) => {
    const frame = frameRef.current, map = mapRef.current, vig = vignetteRef.current;
    if (!frame || !map || !vig) return;
    const { width, height } = viewportSize();
    const zoomNow = frameZoomAt(v, width, height, uiZoom, floor);
    const refW = v * PINNED_DOCK_REF_W;
    const px = refW * (zoomNow / ZOOM);
    const inset = `${v * PINNED_COLUMN_W}px`;
    frame.style.left = atLeft ? inset : '0px';
    frame.style.right = atLeft ? '0px' : inset;
    writeFrameZoom(frame, zoomNow, dpr, dense, height);
    const travel = px / 2;
    const between = v > 0 && v < 1;
    map.style.left = !between && atLeft ? `${px}px` : '0px';
    map.style.right = !between && !atLeft ? `${px}px` : '0px';
    map.style.transform = between ? `translateX(${atLeft ? travel : -travel}px)` : '';
    map.style.clipPath = between ? `inset(0 ${travel}px 0 ${travel}px)` : '';
    map.style.pointerEvents = between ? 'none' : '';
    vig.style.left = atLeft ? `${px}px` : '0px';
    vig.style.right = atLeft ? '0px' : `${px}px`;
    const root = document.documentElement.style;
    for (const [k, value] of Object.entries(dockVars(atLeft, refW, px))) root.setProperty(k, value);
  }), [atLeft, uiZoom, dpr, dense, floor]);

  const inset = aside * PINNED_COLUMN_W;
  /** `contain: layout` makes the plane the fixed chrome's containing block without a transform; the plane is deaf. */
  const frameStyle = {
    zoom, '--shell-zoom': String(zoom), '--viewport-h': `${vh}px`, fontSize: TEXT.label, fontFamily: font.family,
    ...weightVars(zoom, dpr, dense),
    position: 'fixed', top: 0, bottom: 0, left: atLeft ? inset : 0, right: atLeft ? 0 : inset,
    contain: 'layout', pointerEvents: 'none', zIndex: z.panel,
  } as CSSProperties;
  /** The map plane translates and clips in transit, deaf while the view projections lag the box, then settles to an inset. */
  const mapStyle: CSSProperties = {
    position: 'fixed', top: 0, bottom: 0,
    left: sliding ? 0 : dockLeft, right: sliding ? 0 : dockRight,
    ...(sliding ? {
      transform: `translateX(${atLeft ? mapTravel : -mapTravel}px)`,
      clipPath: `inset(0 ${mapTravel}px 0 ${mapTravel}px)`,
      pointerEvents: 'none',
    } : null),
    contain: 'layout', zIndex: z.paper,
  };
  return { frameRef, mapRef, vignetteRef, frameStyle, mapStyle, dockLeft, dockRight };
}
