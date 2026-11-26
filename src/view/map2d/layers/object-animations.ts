import * as PIXI from 'pixi.js-legacy';
import type { PlacedObject } from '../../../core/model/types';
import { TILE_SIZE } from '../geometry/world';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { iconUrl } from '../../../assets/icon-urls';
import { animConfig } from '../../shared/motion/anim-config';
import { arcMotion, arcOffset, flipOffset, flipSquash, groupEase, spinOffset } from '../../shared/motion/group-arc';
import { plopScale, spinEase } from '../../shared/motion/object-beats';
import type { GroupRotation } from '../../../tools/objects';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { spawnPuff } from '../draw/particles';
import { iconColor } from '../draw/icon-texture';
import { itemTint } from '../../shared/icon/item-tint';
import { OBJECT_CHILD, taggedChild } from '../draw/object-children';
import { timedBeat, type PlayBeat } from '../../shared/viewport/frame-loop';

export function fadeLayer(
  lc: PIXI.Container, elev: number, show: boolean,
  /** Each elevation's fade in flight, by its cancel. */
  layerFadeAnim: Map<number, () => void>,
  /** Plays on the frame loop of the renderer the layer container lives on. */
  play: PlayBeat,
): void {
  layerFadeAnim.get(elev)?.();
  layerFadeAnim.delete(elev);
  if (isMotionReduced()) { lc.visible = show; lc.alpha = 1; return; }
  if (show) lc.visible = true;                 // reveal before fading in
  const target = show ? 1 : 0;
  const from = lc.alpha;
  if (from === target && lc.visible === show) return;
  let ended = false;
  const stop = play(timedBeat(animConfig.layerFade.durationMs, (t) => {
    lc.alpha = from + (target - from) * t;
    if (t < 1) return;
    lc.alpha = target;
    if (!show) lc.visible = false;             // hide only after fading out
    layerFadeAnim.delete(elev);
    ended = true;
  }));
  if (!ended) layerFadeAnim.set(elev, stop);
}

/**
 * How far the selection ring shrinks before popping back, as a scale fraction.
 *
 * Derived from the box's own size so the edges always travel the same number of pixels, whether
 * the ring surrounds a single tree or a whole landmark. `maxAmp` caps a sub-tile box at the
 * amplitude of a 1x1.
 */
export function selectionPopAmplitude(spanPx: number): number {
  const { travelPx, maxAmp } = animConfig.selectionPop;
  return Math.min(maxAmp, travelPx / Math.max(spanPx, 1));
}

/**
 * Placement plop: the shared `plopScale` curve on the wrapper, squashing on landing and settling
 * back to rest with an overshoot. No-op under reduced motion (the object is already at its final
 * scale).
 */
export function animateSquash(
  objectMap: Map<string, PIXI.Container>, objectId: string, sizeCells: number,
  /** Plays on the frame loop of the renderer the wrapper lives on. */
  play: PlayBeat,
): void {
  if (isMotionReduced()) return;
  const wrapper = objectMap.get(objectId);
  if (!wrapper) return;
  const { settleMs } = animConfig.plop;
  const cx = wrapper.width / 2;
  const cy = wrapper.height / 2;
  wrapper.pivot.set(cx, cy);
  wrapper.x += cx;
  wrapper.y += cy;

  play(timedBeat(settleMs, (t) => {
    // The wrapper dies mid-flight when the placement is undone or deleted within the settle window.
    if (wrapper.destroyed) return false;
    const { across, up } = plopScale(t, sizeCells);
    wrapper.scale.set(across, up);
    if (t < 1) return;
    wrapper.scale.set(1, 1);
    wrapper.pivot.set(0, 0);
    wrapper.x -= cx;
    wrapper.y -= cy;
  }));
}

/**
 * Rotation beat: the object *turns* — ease the icon sprite from its old angle
 * to the new one (mild overshoot) rather than squashing it (a turn reads as a
 * rotation; a squash would read as a re-place). The wrapper has already been
 * rebuilt at the new angle (rotate = Remove + Place),
 * so this sets the icon back to `fromDeg` and eases forward to `toDeg`. No-op
 * under reduced motion (the icon is already at the final angle). Only rotatable
 * items have a tagged icon (`OBJECT_CHILD.icon`).
 */
export function animateRotation(
  objectMap: Map<string, PIXI.Container>, id: string, turn: { fromDeg: number; toDeg: number },
  /** Plays on the frame loop of the renderer the wrapper lives on. */
  play: PlayBeat,
  onFrame?: (eased: number) => void,
): void {
  if (isMotionReduced()) return;
  const { fromDeg, toDeg } = turn;
  const wrapper = objectMap.get(id);
  if (!wrapper) return;
  const icon = taggedChild(wrapper.children, OBJECT_CHILD.icon);
  if (!icon) return;
  const fromRad = (fromDeg * Math.PI) / 180;
  const toRad = (toDeg * Math.PI) / 180;
  const { durationMs } = animConfig.rotation;
  icon.rotation = fromRad;
  play(timedBeat(durationMs, (t) => {
    if (icon.destroyed) return false;
    const e = spinEase(t);
    icon.rotation = fromRad + (toRad - fromRad) * e;
    // A caller (the selection ring) rides this same progress rather than computing its own — see
    // group-arc.ts's file header for why a second interpolation of the same motion is the bug class
    // this whole feature exists to avoid. Exactly 1 on the settling frame, matching icon.rotation
    // below landing exactly on toRad.
    onFrame?.(t < 1 ? e : 1);
    if (t >= 1) icon.rotation = toRad;
  }));
}

/**
 * Group-rotation beat: the selection turns as one rigid body. Every member travels an arc about the
 * shared centre (a straight line would squash the arrangement mid-turn); a spun member's icon turns
 * by the same quarter on its own axis, and a carried member arcs without spinning. One beat drives
 * every member, so they share start, duration and easing.
 * The commands have already applied, so the tween is an offset back from the rest pose that
 * reaches zero at the end; under reduced motion it does nothing, which is that end state.
 */
export function animateGroupRotation(
  objectMap: Map<string, PIXI.Container>, turn: GroupRotation,
  /** Plays on the frame loop of the renderer the members live on. */
  play: PlayBeat,
  onFrame?: (eased: number) => void,
): void {
  if (isMotionReduced()) return;
  if (turn.flip) { animateGroupFlip(objectMap, turn, turn.flip, play, onFrame); return; }
  const sweepRad = (turn.sweepDeg * Math.PI) / 180;
  const parts = turn.members.flatMap((m) => {
    const wrapper = objectMap.get(m.id);
    if (!wrapper) return [];
    // Only a rotatable item tags an icon; a carried member has none to spin anyway.
    const icon = m.spun ? taggedChild(wrapper.children, OBJECT_CHILD.icon) ?? null : null;
    return [{
      wrapper, icon,
      restX: wrapper.x, restY: wrapper.y, restRot: icon?.rotation ?? 0,
      motion: arcMotion(turn.pivot, m.from),
    }];
  });
  if (parts.length === 0) return;

  play(timedBeat(animConfig.groupRotation.durationMs, (t) => {
    // Exactly 1 on the settling frame (never the raw formula there), so every member's offset and
    // spin land on precisely zero — see arcOffset/spinOffset's file header. The selection ring rides
    // this same value via onFrame instead of computing its own interpolation of the same turn.
    const eased = groupEase(t);
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
  }));
}

/**
 * Group-flip beat, the group rotation's twin for a flip: every member's wrapper squashes along the
 * flipped screen axes about its own centre while it travels through the flip's axis, then opens out
 * at rest (`shared/motion/group-arc.ts`). Its art is never mirrored, as the game never mirrors it.
 * One beat drives every member; the wrappers' pivots and scales are given back on the settling frame.
 */
function animateGroupFlip(
  objectMap: Map<string, PIXI.Container>, turn: GroupRotation, axes: { x: boolean; y: boolean },
  play: PlayBeat, onFrame?: (eased: number) => void,
): void {
  const parts = turn.members.flatMap((m) => {
    const wrapper = objectMap.get(m.id);
    if (!wrapper) return [];
    // Its centre at rest is its centre before the flip, mirrored across the pivot.
    const rest = { x: axes.x ? 2 * turn.pivot.x - m.from.x : m.from.x, y: axes.y ? 2 * turn.pivot.y - m.from.y : m.from.y };
    const centre = { x: rest.x * TILE_SIZE - wrapper.x, y: rest.y * TILE_SIZE - wrapper.y };
    const was = { x: wrapper.x, y: wrapper.y, pivotX: wrapper.pivot.x, pivotY: wrapper.pivot.y, scaleX: wrapper.scale.x, scaleY: wrapper.scale.y };
    return [{ wrapper, from: m.from, centre, was }];
  });
  if (parts.length === 0) return;
  for (const p of parts) p.wrapper.pivot.set(p.was.pivotX + p.centre.x, p.was.pivotY + p.centre.y);
  play(timedBeat(animConfig.groupRotation.durationMs, (t) => {
    const eased = groupEase(t);
    const squash = flipSquash(eased);
    for (const p of parts) {
      if (p.wrapper.destroyed) continue;
      if (t >= 1) {
        p.wrapper.pivot.set(p.was.pivotX, p.was.pivotY);
        p.wrapper.position.set(p.was.x, p.was.y);
        p.wrapper.scale.set(p.was.scaleX, p.was.scaleY);
        continue;
      }
      const { dx, dy } = flipOffset(turn.pivot, p.from, axes, eased);
      p.wrapper.position.set(p.was.x + p.centre.x + dx * TILE_SIZE, p.was.y + p.centre.y + dy * TILE_SIZE);
      p.wrapper.scale.set(p.was.scaleX * (axes.x ? squash : 1), p.was.scaleY * (axes.y ? squash : 1));
    }
    onFrame?.(eased);
  }));
}

/**
 * Deletion beat: collapse the object inward + fade (the "where did it
 * go" carrier), and fire an energetic same-hue poof partway through. The
 * wrapper is detached from objectMap up front so the deferred sync /
 * removeObjects won't double-destroy it — this method owns its teardown. Must
 * be called before the RemoveObject command executes, while the wrapper still
 * exists. No-op under reduced motion (the normal removal path makes the object
 * disappear instantly).
 */
export function animateRemove(
  objectMap: Map<string, PIXI.Container>, container: PIXI.Container, id: string,
  /** The object as the layer's own map holds it, for its footprint and tint. */
  obj: PlacedObject | undefined,
  /** Plays on the frame loop of the renderer the wrapper lives on. */
  play: PlayBeat,
): void {
  if (isMotionReduced()) return;
  const wrapper = objectMap.get(id);
  if (!wrapper) return;
  objectMap.delete(id);

  const item = obj ? getCatalogItem(obj.catalogId) : undefined;
  // Same-hue tint: the icon's own colour, else the item's tint.
  const delUrl = item?.icon ? iconUrl(item.icon) : undefined;
  const color = (delUrl ? iconColor(delUrl) : null) ?? itemTint(item);
  const size = obj ? getPlacedObjectSize(obj) : { w: 1, h: 1 };
  const lcx = (size.w * TILE_SIZE) / 2, lcy = (size.h * TILE_SIZE) / 2;
  const worldCx = wrapper.x + lcx, worldCy = wrapper.y + lcy;
  wrapper.pivot.set(lcx, lcy);
  wrapper.x += lcx;
  wrapper.y += lcy;

  const { collapseMs, poofOffsetFrac } = animConfig.deletion;
  const del = animConfig.puff.delete;
  const poofCount = Math.min(del.countCap, del.countBase + Math.round(size.w * size.h * del.countPerArea));

  let poofed = false;
  play(timedBeat(collapseMs, (t) => {
    if (wrapper.destroyed) return false;
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
      }, play);
    }
    if (t < 1) return;
    try { wrapper.parent?.removeChild(wrapper); wrapper.destroy({ children: true }); } catch { /* already gone */ }
  }));
}
