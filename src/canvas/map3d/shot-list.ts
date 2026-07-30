// Pure shot-list reducer for the export "3D shots" menu. A shot is a CameraAngle; the menu holds
// 1..5 of them. Kept free of React/three so the add/delete/seed/replace rules are unit-testable.
import { buildSmartAngles, type CameraAngle } from './capture';
import type { GridState } from '../../core/model/types';

export const MIN_SHOTS = 1;
export const MAX_SHOTS = 5;

/** The default block set when the 3D toggle is first enabled: the four best smart angles. */
export function seedShots(state: GridState): CameraAngle[] {
  return buildSmartAngles(state).slice(0, 4);
}

const key = (a: CameraAngle): string => `${Math.round(a.az)},${Math.round(a.el)},${a.dist.toFixed(2)}`;

/** Append one more shot (a smart angle not already present, else a rotated variant of the last),
 *  capped at MAX_SHOTS. No-op at the cap. */
export function addShot(shots: CameraAngle[], state: GridState): CameraAngle[] {
  if (shots.length >= MAX_SHOTS) return shots;
  const seen = new Set(shots.map(key));
  const next = buildSmartAngles(state).find((a) => !seen.has(key(a)));
  const last = shots[shots.length - 1] ?? { az: 45, el: 45, dist: 0.9 };
  const fresh: CameraAngle = next ?? { ...last, az: last.az + 72 };
  return [...shots, fresh];
}

/** Remove the shot at index i, floored at MIN_SHOTS. No-op at the floor. */
export function deleteShot(shots: CameraAngle[], i: number): CameraAngle[] {
  if (shots.length <= MIN_SHOTS) return shots;
  return shots.filter((_, idx) => idx !== i);
}

/** Set the shot at index i (used by the angle editor's "Use this view"). */
export function replaceShot(shots: CameraAngle[], i: number, angle: CameraAngle): CameraAngle[] {
  return shots.map((s, idx) => (idx === i ? angle : s));
}
