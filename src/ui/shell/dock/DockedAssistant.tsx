/**
 * The assistant panel's host, outside the frame's plane: docked, the panel is the desk the sliding
 * interface lies on, so it must not travel with it. The wrapper carries only the frame's zoom, type
 * and weights; the column claims its own rung and wears the frame's veil itself (`hidden`).
 */
import { Suspense, useEffect, useRef, type CSSProperties } from 'react';
import { viewportSize } from '../../../platform/device/viewport-space';
import { useEditorStore } from '../../../state/store';
import { ScaleProvider, useDenseScript, useDevicePixelRatio, useFitFloor, useViewportSize } from '../../design/scale';
import { font } from '../../design/styles';
import { weightVars } from '../../design/text-weight';
import { useAnimatedUiZoom } from '../../design/ui-zoom-anim';
import { RenderBoundary } from '../../primitives/RenderBoundary';
import { ChunkNotice } from '../../chrome/guards/FailureNotice';
import { useLatch } from '../../primitives/use-latch';
import { PanelColumn } from '../edition-surfaces';
import { frameZoomAt } from '../panel-frame';
import { dockAside, useDockStage } from '../use-dock';
import { SCALE, TEXT } from '../units';

/** A plane's zoom and weights, written past React on the slide's frames as its `style` writes them on a render. */
export function writeFrameZoom(el: HTMLElement, zoom: number, dpr: number, dense: boolean, windowH: number): void {
  el.style.zoom = String(zoom);
  el.style.setProperty('--shell-zoom', String(zoom));
  el.style.setProperty('--viewport-h', `${windowH}px`);
  for (const [k, v] of Object.entries(weightVars(zoom, dpr, dense))) el.style.setProperty(k, String(v));
}

export function DockedAssistant({ hidden }: { hidden: boolean }) {
  const open = useEditorStore((s) => s.assistantOpen);
  const everOpened = useLatch(open);
  // The zoom comes from the live fraction, so a render mid-slide writes what the frame writer writes.
  const { aside } = useDockStage();
  const { w: vw, h: vh } = useViewportSize();
  const uiZoom = useAnimatedUiZoom();
  const floor = useFitFloor();
  const zoom = frameZoomAt(aside, vw, vh, uiZoom, floor);
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const wrapRef = useRef<HTMLDivElement>(null);
  // The desk rides the slide's frames, or it meets the sheet's edge off the seam.
  useEffect(() => dockAside.on('change', (v) => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = viewportSize();
    writeFrameZoom(el, frameZoomAt(v, width, height, uiZoom, floor), dpr, dense, height);
  }), [uiZoom, floor, dpr, dense]);
  if (!everOpened) return null;
  return (
    <div
      ref={wrapRef}
      style={{
        zoom, '--shell-zoom': String(zoom), '--viewport-h': `${vh}px`, fontSize: TEXT.label, fontFamily: font.family,
        ...weightVars(zoom, dpr, dense),
      } as CSSProperties}
    >
      <ScaleProvider value={SCALE}>
        <RenderBoundary resetKey={open} fallback={<ChunkNotice />}>
          <Suspense fallback={null}>
            <PanelColumn open={open} hosted veiled={hidden} />
          </Suspense>
        </RenderBoundary>
      </ScaleProvider>
    </div>
  );
}
