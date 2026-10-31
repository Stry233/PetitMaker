/**
 * The assistant panel's host, outside the frame's plane: docked, the panel is the desk the sliding
 * interface lies on, so it must not travel with it. The wrapper carries only the frame's zoom, type
 * and weights; the column claims its own rung and wears the frame's veil itself (`hidden`). A dock at
 * the window's foot adds the handle on its seam.
 */
import { Suspense, useRef } from 'react';
import { useEditorStore } from '../../../state/store';
import { ScaleProvider, SurfaceZoomProvider, useDenseScript, useDevicePixelRatio, useViewportSize } from '../../design/scale';
import { useSettledUiZoom } from '../../design/ui-zoom-anim';
import { useLayoutShape, useTouchMode } from '../../design/input-mode';
import { RenderBoundary } from '../../primitives/RenderBoundary';
import { ChunkNotice } from '../../chrome/guards/FailureNotice';
import { useLatch } from '../../primitives/use-latch';
import { PanelColumn } from '../edition-surfaces';
import { frameZoomAt } from '../panel-frame';
import { axisOf, useDockDepth, useDockStage } from '../use-dock';
import { SCALE } from '../units';
import { DockHandle } from './DockHandle';
import { liveDockDepth, liveFrameZoom, planeZoomStyle, useLivePlaneWriter, writeFrameZoom } from './plane-zoom';

export function DockedAssistant({ hidden, onClose }: { hidden: boolean; onClose: () => void }) {
  const open = useEditorStore((s) => s.assistantOpen);
  const everOpened = useLatch(open);
  // The zoom comes from the live fraction, so a render mid-slide writes what the frame writer writes;
  // a scale glide's frames are written past React from the live scale, as the frame plane's are.
  const { aside, edge, place } = useDockStage();
  const axis = axisOf(edge);
  const depthShare = useDockDepth();
  const depth = axis === 'y' ? depthShare : undefined;
  const { w: vw, h: vh } = useViewportSize();
  const uiZoom = useSettledUiZoom();
  const touch = useTouchMode();
  const upright = useLayoutShape() === 'portrait';
  const zoom = frameZoomAt(aside, vw, vh, uiZoom, { touch, upright, depth });
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const wrapRef = useRef<HTMLDivElement>(null);
  // The desk rides the slide's, the scale's and a held seam's frames, or it meets the sheet's edge off
  // the seam.
  useLivePlaneWriter(() => {
    const el = wrapRef.current;
    if (!el) return;
    const { zoom: live, windowH } = liveFrameZoom(liveDockDepth(depth !== undefined), upright);
    writeFrameZoom(el, live, dpr, dense, windowH);
  });
  if (!everOpened) return null;
  return (
    <div ref={wrapRef} style={planeZoomStyle(zoom, vh, dpr, dense)}>
      <ScaleProvider value={SCALE}>
        <SurfaceZoomProvider value={zoom}>
          <RenderBoundary resetKey={open} fallback={<ChunkNotice />}>
            <Suspense fallback={null}>
              <PanelColumn open={open} hosted veiled={hidden} />
            </Suspense>
          </RenderBoundary>
        </SurfaceZoomProvider>
      </ScaleProvider>
      {/* The seam's handle shows once the sheet has cleared the panel at the window's foot. */}
      {axis === 'y' && place === 'ground' && aside >= 1 && !hidden ? <DockHandle zoom={zoom} onClose={onClose} /> : null}
    </div>
  );
}
