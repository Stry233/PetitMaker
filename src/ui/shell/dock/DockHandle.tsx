/**
 * The bottom dock's handle on the seam between the map and the panel: dragged, it sets how deep the
 * dock reaches; let go under the close line (`panel-frame.ts:BOTTOM_DOCK`), it closes the panel. The
 * dock follows the finger on every frame through `use-dock.ts:dockDrag`, which the planes' writers read
 * past React (the map plane travels and clips meanwhile, so its canvas never resizes under a finger),
 * and the settled depth is set once on release. It stands on the column's rung, over the map, which
 * a seam line dragged up runs over; the upright frame's veil ranks above it but ends at the seam, so
 * the bare band and the tiles only meet the handle's edge, at rest and held alike.
 */
import { useRef } from 'react';
import { useT } from '../../../i18n/context';
import { viewportSizeSnapshot } from '../../../platform/device/viewport-space';
import { z } from '../../design/styles';
import { BOTTOM_DOCK, bottomDockHeight } from '../panel-frame';
import { SEAM_HANDLE, SeamHandle } from '../../primitives/SeamHandle';
import { dockDrag, setDockDepth, useDockAsked, useDockDepth, useDockDepthMost } from '../use-dock';

/** How far one arrow key moves the seam, as a share of the window's height. */
const KEY_STEP = 0.05;

export function DockHandle({ zoom, onClose }: { zoom: number; onClose: () => void }) {
  const t = useT();
  // `depth` is where the seam stands; `asked` where the user last put it, deeper while the frame
  // above has made the dock yield.
  const depth = useDockDepth();
  const asked = useDockAsked();
  const most = useDockDepthMost();

  /** The drag kept between the window's foot and the most the dock may take under the frame. */
  const clamp = (dy: number): number => {
    const vh = viewportSizeSnapshot().height;
    return Math.min(depth * vh, Math.max((depth - most) * vh, dy));
  };
  // A drag let go to close keeps its depth while the dock slides off, which clears it.
  const closing = useRef(false);
  const drag = (dy: number | null) => {
    if (dy !== null) { closing.current = false; dockDrag.set(depth - dy / viewportSizeSnapshot().height); }
    else if (!closing.current) dockDrag.set(null);
  };
  const release = (dy: number) => {
    const vh = viewportSizeSnapshot().height;
    // Let go near the foot of the seam the user sees, it closes; half that seam at most, so a short
    // drag on a dock the frame has made shallow never does.
    if (depth - dy / vh < Math.min(BOTTOM_DOCK.close, depth / 2)) { closing.current = true; onClose(); return; }
    // A dock an open panel has made yield under its least cannot stand shallower by a drag that does
    // not close it, so such a drag leaves the depth the user set, which returns when the panel closes.
    if (dy > 0 && depth < BOTTOM_DOCK.least) return;
    // Upward the drag adds to the asked depth; downward it starts from the seam the user sees.
    setDockDepth((dy < 0 ? asked : depth) - dy / vh);
  };

  return (
    <SeamHandle
      label={t('agent.dock_resize')}
      zoom={zoom}
      value={{
        min: Math.round(Math.min(BOTTOM_DOCK.least, depth) * 100),
        max: Math.round(Math.max(most, depth) * 100),
        now: Math.round(depth * 100),
      }}
      clamp={clamp}
      onDrag={drag}
      onRelease={release}
      follows
      onStep={(direction) => setDockDepth(asked - direction * KEY_STEP)}
      testId="dock-handle"
      morph="dock-handle"
      arrive="dock.handle.arrive"
      style={{
        position: 'fixed', left: 0, right: 0,
        bottom: `calc(${bottomDockHeight(depth)} - ${SEAM_HANDLE.h}px)`,
        zIndex: z.column,
      }}
    />
  );
}
