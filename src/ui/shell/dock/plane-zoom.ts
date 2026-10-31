/**
 * The zoom a plane beside the docked assistant carries (the frame plane and the desk under it): its
 * style on a render, the same values written past React from the live dock and scale, and the clocks
 * those writes follow.
 */
import { useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { viewportSizeSnapshot } from '../../../platform/device/viewport-space';
import { liveScaleNow, onLiveScale, type ScaleInputs } from '../../design/scale';
import { font } from '../../design/styles';
import { weightVars } from '../../design/text-weight';
import { useEffectEvent } from '../../primitives/use-effect-event';
import { frameZoomAt } from '../panel-frame';
import { dockAside, dockDepthNow, dockDrag, onDockDrag } from '../use-dock';
import { TEXT } from '../units';

/** A plane's zoom, type and weights as its render's style. */
export function planeZoomStyle(zoom: number, windowH: number, dpr: number, dense: boolean): CSSProperties {
  return {
    zoom, '--shell-zoom': String(zoom), '--viewport-h': `${windowH}px`, fontSize: TEXT.label, fontFamily: font.family,
    ...weightVars(zoom, dpr, dense),
  } as CSSProperties;
}

/** A plane's zoom and weights, written past React as `planeZoomStyle` writes them on a render. */
export function writeFrameZoom(el: HTMLElement, zoom: number, dpr: number, dense: boolean, windowH: number): void {
  el.style.zoom = String(zoom);
  el.style.setProperty('--shell-zoom', String(zoom));
  el.style.setProperty('--viewport-h', `${windowH}px`);
  for (const [k, v] of Object.entries(weightVars(zoom, dpr, dense))) el.style.setProperty(k, String(v));
}

/** The bottom dock's depth on this frame, a held seam's first; undefined for a side dock. */
export function liveDockDepth(bottom: boolean): number | undefined {
  return bottom ? dockDrag.get() ?? dockDepthNow() : undefined;
}

/** The frame's zoom on this frame: the dock's live fraction at `depth` and the window's live size,
 *  in the upright arrangement when `upright`, under `scale` (the live UI zoom unless a picture holds its own). */
export function liveFrameZoom(depth: number | undefined, upright: boolean, scale: ScaleInputs = liveScaleNow()): { zoom: number; windowH: number } {
  const { width, height } = viewportSizeSnapshot();
  return { zoom: frameZoomAt(dockAside.get(), width, height, scale.uiZoom, { touch: scale.touch, upright, depth }), windowH: height };
}

/** Runs `write` on the dock slide's frames, a held seam's and, unless `pictured`, the UI zoom's, and
 *  after every render before the paint, since a render mid-glide or mid-slide wrote the settled form. */
export function useLivePlaneWriter(write: () => void, pictured = false): void {
  const run = useEffectEvent(write);
  useEffect(() => dockAside.on('change', run), []);
  useEffect(() => onDockDrag(run), []);
  useEffect(() => (pictured ? undefined : onLiveScale(run)), [pictured]);
  useLayoutEffect(() => { run(); });
}
