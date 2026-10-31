/**
 * The magnifier over a touch press (`view/shared/overlay/loupe.ts`): the map under the finger,
 * enlarged in a cream-ringed circle above it, centred on the point the finger is on. No part of it
 * takes pointer input, so the map under it still answers a release there.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { LOUPE, LOUPE_OUTER, loupeCentre, loupeVersion, onLoupeChange, paintLoupe } from '../../../view/shared/overlay/loupe';
import { PLATE, plateShapeEdge } from '../../design/tokens';
import { presence } from '../../design/motion';
import { z } from '../../design/styles';
import { useDevicePixelRatio } from '../../design/scale';

const LENS = 2 * LOUPE.radius;

export function MapLoupe() {
  useSyncExternalStore(onLoupeChange, loupeVersion);
  const lens = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotionConfig();
  const dpr = useDevicePixelRatio();
  const centre = loupeCentre();
  useLayoutEffect(() => { if (lens.current) paintLoupe(lens.current, dpr); });
  if (!centre) return null;
  return (
    <motion.div
      aria-hidden
      data-testid="map-loupe"
      {...presence('map.loupe.arrive', { opacity: 0, scale: 0.6 }, { reduced })}
      style={{
        position: 'fixed', left: centre.x - LOUPE_OUTER, top: centre.y - LOUPE_OUTER, width: 2 * LOUPE_OUTER, height: 2 * LOUPE_OUTER,
        boxSizing: 'border-box', borderRadius: '50%', border: `${LOUPE.ring}px solid ${PLATE}`, boxShadow: plateShapeEdge(),
        background: PLATE, overflow: 'hidden', pointerEvents: 'none', zIndex: z.canvasControls,
      }}
    >
      <canvas ref={lens} style={{ display: 'block', width: LENS, height: LENS, pointerEvents: 'none' }} />
    </motion.div>
  );
}
