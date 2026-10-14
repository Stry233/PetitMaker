// The per-view camera poses a save may carry, read field by field so a bad pose never rejects the map.
import { isFiniteNumber } from '../../core/base/guards';
import type { PersistedCamera } from './format';

/** The camera a save carries: the views given, or none when neither is. */
export function persistedCamera(view2d?: PersistedCamera['view2d'], view3d?: PersistedCamera['view3d']): PersistedCamera | undefined {
  if (!view2d && !view3d) return undefined;
  return { ...(view2d ? { view2d } : {}), ...(view3d ? { view3d } : {}) };
}

/** A 2D pose read field by field, or undefined when a field is missing or not finite. */
export function readView2d(raw: unknown): PersistedCamera['view2d'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const { x, y, zoom } = raw as { x?: unknown; y?: unknown; zoom?: unknown };
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(zoom) ? { x, y, zoom } : undefined;
}

/** Reads valid 2D and 3D camera fields of a parsed save independently without rejecting the map. */
export function readParsedSaveCamera(raw: unknown): PersistedCamera | undefined {
  if (!raw || typeof raw !== 'object' || !('camera' in raw)) return undefined;
  const cam = (raw as { camera?: unknown }).camera;
  if (!cam || typeof cam !== 'object') return undefined;
  const { view2d, view3d } = cam as { view2d?: unknown; view3d?: unknown };
  const result: PersistedCamera = {};
  const pose2d = readView2d(view2d);
  if (pose2d) result.view2d = pose2d;
  if (view3d && typeof view3d === 'object') {
    const { az, el, dist, tx, tz } = view3d as { az?: unknown; el?: unknown; dist?: unknown; tx?: unknown; tz?: unknown };
    if (isFiniteNumber(az) && isFiniteNumber(el) && isFiniteNumber(dist)) {
      result.view3d = {
        az, el, dist,
        ...(isFiniteNumber(tx) ? { tx } : {}),
        ...(isFiniteNumber(tz) ? { tz } : {}),
      };
    }
  }
  return persistedCamera(result.view2d, result.view3d);
}
