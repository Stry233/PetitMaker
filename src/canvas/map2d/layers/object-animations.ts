import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE } from '../../../core/model/constants';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { hexStringToNumber } from '../../../core/model/colors';
import { useEditorStore } from '../../../state/store';
import { iconUrl } from '../../../assets/icon-urls';
import { animConfig, easeOutBack } from '../../../core/runtime/anim-config';
import { arcMotion, arcOffset, spinOffset, type GroupRotation } from '../../group-arc';
import { isMotionReduced } from '../motion-state';
import { requestRender } from '../render-scheduler';
import { spawnPuff } from '../draw/particles';
import { iconColor } from '../draw/icon-color';

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function fadeLayer(
  lc: PIXI.Container, elev: number, show: boolean,
  layerFadeAnim: Map<number, number>,
): void {
  const prev = layerFadeAnim.get(elev);
  if (prev !== undefined) { cancelAnimationFrame(prev); layerFadeAnim.delete(elev); }
  if (isMotionReduced()) { lc.visible = show; lc.alpha = 1; return; }
  if (show) lc.visible = true;                 // reveal before fading in
  const target = show ? 1 : 0;
  const from = lc.alpha;
  if (from === target && lc.visible === show) return;
  const { durationMs } = animConfig.layerFade;
  let start: number | null = null;
  const tick = (ts: number) => {
    requestRender();
    if (start === null) start = ts;
    const t = Math.min((ts - start) / durationMs, 1);
    lc.alpha = from + (target - from) * t;
    if (t < 1) {
      layerFadeAnim.set(elev, requestAnimationFrame(tick));
    } else {
      lc.alpha = target;
      if (!show) lc.visible = false;           // hide only after fading out
      layerFadeAnim.delete(elev);
    }
  };
  layerFadeAnim.set(elev, requestAnimationFrame(tick));
}

/**
 * How far the selection ring shrinks before popping back, as a scale fraction.
 *
 * Derived from the box's own size so the EDGES always travel the same number of pixels, whether
 * the ring surrounds a single tree or the whole plaza. `maxAmp` caps a sub-tile box at the
 * amplitude of a 1x1.
 */
export function selectionPopAmplitude(spanPx: number): number {
  const { travelPx, maxAmp } = animConfig.selectionPop;
  return Math.min(maxAmp, travelPx / Math.max(spanPx, 1));
}

/**
 * Placement plop: squash the wrapper on landing, then settle back to rest with
 * an overshoot. Peaks/timing come from animConfig.plop. No-op under reduced
 * motion (the object is already at its final scale).
 */
export function animateSquash(
  objectMap: Map<string, PIXI.Container>, objectId: string, sizeCells = 1,
): void {
  if (isMotionReduced()) return;
  const wrapper = objectMap.get(objectId);
  if (!wrapper) return;
  const { squashX, squashY, settleMs, bounce } = animConfig.plop;
  // Smaller squash for larger footprints — a big object squashing the full 12%
  // reads heavy/slow, so scale the amplitude by ~1/size.
  const f = Math.max(0.4, Math.min(1, 1 / sizeCells));
  const peakX = 1 + (squashX - 1) * f;
  const peakY = 1 - (1 - squashY) * f;
  const cx = wrapper.width / 2;
  const cy = wrapper.height / 2;
  wrapper.pivot.set(cx, cy);
  wrapper.x += cx;
  wrapper.y += cy;

  const landFrac = 0.28;
  let start: number | null = null;
  const tick = (ts: number) => {
    // The wrapper dies mid-flight when the placement is undone or deleted within the
    // settle window; a tick on a destroyed display object throws inside rAF.
    if (wrapper.destroyed) return;
    requestRender();
    if (start === null) start = ts;
    const t = Math.min((ts - start) / settleMs, 1);
    let sx: number, sy: number;
    if (t < landFrac) {
      const u = t / landFrac;                                          // quick squash to peak
      sx = 1 + (peakX - 1) * u;
      sy = 1 + (peakY - 1) * u;
    } else {
      const e = easeOutBack((t - landFrac) / (1 - landFrac), bounce);  // peak → 1, overshoot = bounce
      sx = peakX + (1 - peakX) * e;
      sy = peakY + (1 - peakY) * e;
    }
    wrapper.scale.set(sx, sy);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      wrapper.scale.set(1, 1);
      wrapper.pivot.set(0, 0);
      wrapper.x -= cx;
      wrapper.y -= cy;
    }
  };
  requestAnimationFrame(tick);
}

/**
 * Rotation beat: the object *turns* — ease the icon sprite from its old angle
 * to the new one (mild overshoot) rather than squashing it (a turn reads as a
 * rotation; a squash would read as a re-place). The wrapper has already been
 * rebuilt at the new angle (rotate = Remove + Place),
 * so this sets the icon back to `fromDeg` and eases forward to `toDeg`. No-op
 * under reduced motion (the icon is already at the final angle). Only rotatable
 * items have a tagged '_icon'.
 */
export function animateRotation(
  objectMap: Map<string, PIXI.Container>, id: string, fromDeg: number, toDeg: number,
  onFrame?: (eased: number) => void,
): void {
  if (isMotionReduced()) return;
  const wrapper = objectMap.get(id);
  if (!wrapper) return;
  const icon = wrapper.children.find((c) => c.name === '_icon');
  if (!icon) return;
  const fromRad = (fromDeg * Math.PI) / 180;
  const toRad = (toDeg * Math.PI) / 180;
  const { durationMs, overshoot } = animConfig.rotation;
  icon.rotation = fromRad;
  let start: number | null = null;
  const tick = (ts: number) => {
    requestRender();
    if (icon.destroyed) return;
    if (start === null) start = ts;
    const t = Math.min((ts - start) / durationMs, 1);
    const e = easeOutBack(t, overshoot);
    icon.rotation = fromRad + (toRad - fromRad) * e;
    // A caller (the selection ring) rides this SAME progress rather than computing its own — see
    // group-arc.ts's file header for why a second interpolation of the same motion is the bug class
    // this whole feature exists to avoid. Exactly 1 on the settling frame, matching icon.rotation
    // below landing exactly on toRad.
    onFrame?.(t < 1 ? e : 1);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      icon.rotation = toRad;
    }
  };
  requestAnimationFrame(tick);
}

/**
 * Group-rotation beat: the selection turns as ONE rigid body. Every member travels an ARC about the
 * shared centre (never a straight line from old to new — that pulls the arrangement inward through
 * the middle of the turn, reading as a squash), and a SPUN member's icon advances by the same
 * quarter turn on its own axis. A CARRIED member arcs without spinning; it never turned.
 *
 * ONE rAF drives every member: they must share a start, a duration and an easing or the body comes
 * apart, and one loop also means one `requestRender` per frame instead of one per member (a
 * 40-member group costs a single tick, not forty).
 *
 * The commands have already applied, so each wrapper stands at its final position with its icon at
 * its final angle; the tween works as an OFFSET back from that rest pose and reaches zero at the end
 * of the sweep, so it can only land where the map put things. No-op under reduced motion, which is
 * exactly that end state.
 */
export function animateGroupRotation(
  objectMap: Map<string, PIXI.Container>, turn: GroupRotation,
  onFrame?: (eased: number) => void,
): void {
  if (isMotionReduced()) return;
  const sweepRad = (turn.sweepDeg * Math.PI) / 180;
  const parts = turn.members.flatMap((m) => {
    const wrapper = objectMap.get(m.id);
    if (!wrapper) return [];
    // Only a rotatable item tags an '_icon'; a carried member has none to spin anyway.
    const icon = m.spun ? wrapper.children.find((c) => c.name === '_icon') ?? null : null;
    return [{
      wrapper, icon,
      restX: wrapper.x, restY: wrapper.y, restRot: icon?.rotation ?? 0,
      motion: arcMotion(turn.pivot, m.from),
    }];
  });
  if (parts.length === 0) return;

  const { durationMs, overshoot } = animConfig.groupRotation;
  let start: number | null = null;
  const tick = (ts: number) => {
    requestRender();
    if (start === null) start = ts;
    const t = Math.min((ts - start) / durationMs, 1);
    // Exactly 1 on the settling frame (never the raw formula there), so every member's offset and
    // spin land on precisely zero — see arcOffset/spinOffset's file header. The selection ring rides
    // this SAME value via onFrame instead of computing its own interpolation of the same turn.
    const eased = t < 1 ? easeOutBack(t, overshoot) : 1;
    for (const p of parts) {
      // A member can die mid-flight (undo, a delete, a layer rebuild) — its wrapper is destroyed
      // while the others keep turning, so skip it rather than abandoning the whole tween.
      if (p.wrapper.destroyed) continue;
      const { dx, dy } = arcOffset(p.motion, sweepRad, eased);
      p.wrapper.x = p.restX + dx * TILE_SIZE;
      p.wrapper.y = p.restY + dy * TILE_SIZE;
      if (p.icon && !p.icon.destroyed) {
        p.icon.rotation = p.restRot + spinOffset(sweepRad, eased);
      }
    }
    onFrame?.(eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Deletion beat: collapse the object inward + fade (the "where did it
 * go" carrier), and fire an energetic same-hue poof partway through. The
 * wrapper is detached from objectMap up front so the deferred sync /
 * removeObjects won't double-destroy it — this method owns its teardown. Must
 * be called BEFORE the RemoveObject command executes, while the wrapper still
 * exists. No-op under reduced motion (the normal removal path makes the object
 * disappear instantly).
 */
export function animateRemove(
  objectMap: Map<string, PIXI.Container>, container: PIXI.Container, id: string,
): void {
  if (isMotionReduced()) return;
  const wrapper = objectMap.get(id);
  if (!wrapper) return;
  objectMap.delete(id);

  const obj = useEditorStore.getState().gridState?.objects.get(id);
  const item = obj ? getCatalogItem(obj.catalogId) : undefined;
  // Same-hue tint: prefer the icon's own color; roads (no icon) carry item.color;
  // else the catalog category hue, else the fallback.
  const delUrl = item?.icon ? iconUrl(item.icon) : undefined;
  const color = (delUrl ? iconColor(delUrl) : null)
    ?? (item?.color
      ? hexStringToNumber(item.color)
      : (item ? (animConfig.categoryColor[item.category] ?? animConfig.fallbackColor) : animConfig.fallbackColor));
  const size = obj ? getPlacedObjectSize(obj) : { w: 1, h: 1 };
  const lcx = (size.w * TILE_SIZE) / 2, lcy = (size.h * TILE_SIZE) / 2;
  const worldCx = wrapper.x + lcx, worldCy = wrapper.y + lcy;
  wrapper.pivot.set(lcx, lcy);
  wrapper.x += lcx;
  wrapper.y += lcy;

  const { collapseMs, poofOffsetFrac } = animConfig.deletion;
  const del = animConfig.puff.delete;
  const poofCount = Math.min(del.countCap, del.countBase + Math.round(size.w * size.h * del.countPerArea));

  let start: number | null = null;
  let poofed = false;
  const tick = (ts: number) => {
    requestRender();
    if (wrapper.destroyed) return;
    if (start === null) start = ts;
    const t = Math.min((ts - start) / collapseMs, 1);
    wrapper.scale.set(1 - t, 1 - t);
    wrapper.alpha = 1 - t * t;
    if (!poofed && t >= poofOffsetFrac) {
      poofed = true;
      spawnPuff(container, worldCx, worldCy, {
        // Footprint-INDEPENDENT spread (~one tile) so large items don't get a
        // long, slow trajectory — a tight central burst at any size.
        count: poofCount, color, spreadPx: del.spreadMul * TILE_SIZE * 0.5,
        lifetimeMs: del.lifetimeMs, risePx: del.risePx, gravity: del.gravity,
        arcSpread: del.arcSpread, maxRadiusPx: del.maxRadiusPx,
      });
    }
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      try { wrapper.parent?.removeChild(wrapper); wrapper.destroy({ children: true }); } catch { /* already gone */ }
    }
  };
  requestAnimationFrame(tick);
}
