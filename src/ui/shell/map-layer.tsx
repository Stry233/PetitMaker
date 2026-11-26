/**
 * The frame's layer on the map: a step's drawing over the map in frame px (Blueprint's viewfinder and
 * the dim around it), under every piece of the frame's chrome, so the veiled clusters and the rail
 * stand over it undimmed. It fills the frame's box and clips to it, so nothing drawn in it reaches a
 * docked assistant beside the frame, and hides with the interface.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useUiPreview } from '../design/preview';
import { z } from '../design/styles';
import { veilTransition } from './controls/RailButton';

const MapLayerContext = createContext<HTMLElement | null>(null);

/** The element a surface portals its map drawing into, or null outside a live frame. */
export function useMapLayer(): HTMLElement | null {
  return useContext(MapLayerContext);
}

/** Stands the layer ahead of `children` (the veil and the rail draw over it) and hands it to them. */
export function MapLayer({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const pictured = useUiPreview();
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  return (
    <MapLayerContext.Provider value={layer}>
      {pictured ? null : (
        <div ref={setLayer} data-testid="shell-map-layer" aria-hidden style={{
          position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: z.canvasControls,
          opacity: hidden ? 0 : 1, visibility: hidden ? 'hidden' : undefined, transition: veilTransition(hidden, 'opacity', 'visibility'),
        }} />
      )}
      {children}
    </MapLayerContext.Provider>
  );
}
