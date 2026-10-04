/**
 * The planet session's chunk frame: the frame its ground and plaza cover, drawn live on the map. The
 * frame flashes once when a ground stroke reaches past the canvas edge, where the planet can grow no
 * further. It draws through the view and renders nothing of its own.
 */
import { useEffect } from 'react';
import type { GridState } from '../../../core/model/types';
import type { PlanetFrame } from '../../../core/model/planet';
import { onActiveViewChange } from '../../../canvas/active-view';
import { host } from '../../../kit/host';
import { sessionFrame } from '../../../kit/operations/planet-session';
import { useEditorStore } from '../../../state/store';
import { seconds } from '../../design/motion';
import { useCanvasFact } from './use-canvas-fact';

const frameOf = (state: GridState | null) => (state ? sessionFrame(state) : null);
const sameFrame = (a: PlanetFrame | null, b: PlanetFrame | null): boolean =>
  a === b || (!!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.cols === b.cols && a.rows === b.rows);

export function PlanetFrameOverlay(): null {
  const bus = useEditorStore((s) => s.eventBus);
  // Held by value: the canvas is re-read every frame of a stroke, and the frame moves far less often.
  const frame = useCanvasFact(frameOf, sameFrame);

  useEffect(() => {
    const show = () => host.planetFrame.show(frame);
    show();
    // A remounted renderer starts with an empty overlay.
    const off = onActiveViewChange(show);
    return () => { off(); host.planetFrame.show(null); };
  }, [frame]);

  useEffect(() => {
    const flash = () => host.planetFrame.flash(seconds('planet.frame.flash') * 1000);
    bus.on('ground-clipped', flash);
    return () => bus.off('ground-clipped', flash);
  }, [bus]);

  return null;
}
