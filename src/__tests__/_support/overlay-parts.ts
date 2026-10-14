import type { OverlayLayer } from '../../view/map2d/layers/overlay-layer';

const PARTS = ['flashes', 'ghosts', 'marks', 'regions', 'planet', 'band'] as const;

/** A display object or field of the 2D overlay, found on the layer or on whichever part holds it. */
export function overlayPart<T>(overlay: OverlayLayer, field: string): T {
  const layer = overlay as unknown as Record<string, Record<string, unknown> | undefined>;
  if (field in layer) return layer[field] as T;
  for (const part of PARTS) {
    const holder = layer[part];
    if (holder && field in holder) return holder[field] as T;
  }
  throw new Error(`no overlay field ${field}`);
}
