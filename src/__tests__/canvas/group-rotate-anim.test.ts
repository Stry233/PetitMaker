/**
 * The group-rotation ANIMATION must depict the operation that actually ran: ONE rigid body turning
 * about ONE point. The first implementation spun every member in place while their positions jumped
 * to the new arrangement, which is the operation the spec says this explicitly is NOT.
 *
 * Two facts decide whether it reads as one body, and both are asserted on the tween's inputs rather
 * than on pixels: every member travels an ARC about the centre (interpolating positions linearly
 * cuts the chord, so the arrangement contracts and re-expands mid-turn), and every member runs on
 * ONE clock (any per-member offset dissolves the illusion — this is the one animation in the app
 * where a stagger would be actively wrong).
 */
import './_pixi-env'; // object-animations reaches PIXI, which needs jsdom's missing 2D context
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { arcMotion, arcOffset, spinOffset, type GroupRotation } from '../../canvas/group-arc';
import { animateGroupRotation, animateRotation } from '../../canvas/map2d/layers/object-animations';
import { animConfig, easeOutBack } from '../../core/runtime/anim-config';
import { TILE_SIZE } from '../../core/model/constants';
import { setReducedMotion, __resetMotionState } from '../../canvas/map2d/motion-state';

/** A stand-in for an object wrapper: '_icon' is the child animateRotation/the arc spin tween. */
function wrapper(x: number, y: number, withIcon: boolean): PIXI.Container {
  const c = new PIXI.Container();
  c.x = x * TILE_SIZE;
  c.y = y * TILE_SIZE;
  if (withIcon) {
    const icon = new PIXI.Container();
    icon.name = '_icon';
    c.addChild(icon);
  }
  return c;
}

const iconOf = (c: PIXI.Container) => c.children.find((k) => k.name === '_icon')!;

/**
 * Run a tween with a controllable clock: returns a `step(ts)` that runs exactly the callbacks the
 * previous frame scheduled, plus the count of callbacks scheduled per frame (the one-rAF check).
 */
function withFakeRaf(): { step: (ts: number) => void; scheduledPerFrame: number[]; restore: () => void } {
  let queue: FrameRequestCallback[] = [];
  let scheduled = 0;
  const scheduledPerFrame: number[] = [];
  const spy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    queue.push(cb);
    scheduled++;
    return queue.length;
  });
  return {
    step: (ts: number) => {
      const due = queue;
      queue = [];
      scheduled = 0;
      for (const cb of due) cb(ts);
      scheduledPerFrame.push(scheduled);
    },
    scheduledPerFrame,
    restore: () => spy.mockRestore(),
  };
}

const turnOf = (members: GroupRotation['members']): GroupRotation =>
  ({ pivot: { x: 5.5, y: 4.5 }, sweepDeg: 90, members });

afterEach(() => {
  __resetMotionState();
  vi.restoreAllMocks();
});

describe('arc geometry', () => {
  it('holds the radius while the angle advances, so the body stays rigid', () => {
    const pivot = { x: 5.5, y: 4.5 };
    const m = arcMotion(pivot, { x: 4.5, y: 4.5 });
    for (const e of [0, 0.25, 0.5, 0.75, 1]) {
      const { dx, dy } = arcOffset(m, Math.PI / 2, e);
      // Rest is the END of the sweep, so the live point is rest + offset.
      const rest = { x: pivot.x, y: pivot.y - m.radius };
      expect(Math.hypot(rest.x + dx - pivot.x, rest.y + dy - pivot.y)).toBeCloseTo(m.radius, 10);
    }
  });

  it('is an ARC, not the chord: mid-turn it sits further from the centre than a straight line would', () => {
    const pivot = { x: 0, y: 0 };
    const from = { x: 2, y: 0 };
    const m = arcMotion(pivot, from);
    const rest = { x: 0, y: 2 };                                  // where a +90 turn puts it
    const { dx, dy } = arcOffset(m, Math.PI / 2, 0.5);
    const arcMid = Math.hypot(rest.x + dx, rest.y + dy);
    const chordMid = Math.hypot((from.x + rest.x) / 2, (from.y + rest.y) / 2);
    expect(arcMid).toBeCloseTo(2, 10);
    expect(chordMid).toBeLessThan(arcMid);                        // the squash a linear tween shows
  });

  it('lands exactly on the rest pose, and leaves a member on the pivot alone', () => {
    const m = arcMotion({ x: 3, y: 3 }, { x: 7, y: 1 });
    const end = arcOffset(m, -Math.PI / 2, 1);
    expect(end.dx).toBeCloseTo(0, 12);
    expect(end.dy).toBeCloseTo(0, 12);
    const centre = arcOffset(arcMotion({ x: 3, y: 3 }, { x: 3, y: 3 }), Math.PI / 2, 0);
    expect(centre.dx).toBe(0);
    expect(Math.abs(centre.dy)).toBe(0);
  });

  it('advances a spun member exactly as far as the body, and to zero at the end', () => {
    expect(spinOffset(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(spinOffset(Math.PI / 2, 1)).toBeCloseTo(0, 12);
  });
});

describe('animateGroupRotation (2D)', () => {
  it('arcs every member about the pivot on ONE clock', () => {
    const map = new Map<string, PIXI.Container>([
      ['a', wrapper(5, 3, true)], ['b', wrapper(5, 4, true)], ['c', wrapper(5, 5, true)],
    ]);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'b', from: { x: 5.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: true },
    ]);
    const rest = new Map([...map].map(([id, w]) => [id, { x: w.x, y: w.y }]));
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);

    const { durationMs, overshoot } = animConfig.groupRotation;
    for (const frac of [0, 0.3, 0.6]) {
      raf.step(frac * durationMs);
      const e = easeOutBack(frac, overshoot);
      for (const m of turn.members) {
        const expected = arcOffset(arcMotion(turn.pivot, m.from), Math.PI / 2, e);
        const w = map.get(m.id)!;
        expect(w.x - rest.get(m.id)!.x).toBeCloseTo(expected.dx * TILE_SIZE, 6);
        expect(w.y - rest.get(m.id)!.y).toBeCloseTo(expected.dy * TILE_SIZE, 6);
      }
    }
    raf.restore();
  });

  it('drives all members from a SINGLE rAF, never one per member', () => {
    const map = new Map<string, PIXI.Container>(
      [...Array(8)].map((_, i) => [`m${i}`, wrapper(i, 0, true)] as const),
    );
    const turn = turnOf([...map.keys()].map((id, i) => ({ id, from: { x: i, y: 0 }, spun: true })));
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);
    raf.step(0);
    raf.step(animConfig.groupRotation.durationMs * 0.5);
    // One callback scheduled per frame regardless of the member count — 40 members cost one tick.
    expect(raf.scheduledPerFrame).toEqual([1, 1]);
    raf.restore();
  });

  it('starts every member at the same phase: at t=0 they sit at their PRE-turn positions', () => {
    const map = new Map<string, PIXI.Container>([['a', wrapper(5, 3, true)], ['c', wrapper(5, 5, true)]]);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: true },
    ]);
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);
    raf.step(0);
    // Both were on the row y=4.5 before the turn (a at x=4.5, c at x=6.5) — centres, so anchors
    // sit half a tile up-left of them.
    expect(map.get('a')!.x + TILE_SIZE / 2).toBeCloseTo(4.5 * TILE_SIZE, 6);
    expect(map.get('a')!.y + TILE_SIZE / 2).toBeCloseTo(4.5 * TILE_SIZE, 6);
    expect(map.get('c')!.x + TILE_SIZE / 2).toBeCloseTo(6.5 * TILE_SIZE, 6);
    expect(map.get('c')!.y + TILE_SIZE / 2).toBeCloseTo(4.5 * TILE_SIZE, 6);
    raf.restore();
  });

  it('spins a rotatable member on its own axis, on the same clock', () => {
    const map = new Map<string, PIXI.Container>([['house', wrapper(5, 3, true)]]);
    const turn = turnOf([{ id: 'house', from: { x: 4.5, y: 4.5 }, spun: true }]);
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);
    const { durationMs, overshoot } = animConfig.groupRotation;
    raf.step(0);
    // Back-dated by the full sweep at t=0 (the command already left the icon at its final angle).
    expect(iconOf(map.get('house')!).rotation).toBeCloseTo(-Math.PI / 2, 6);
    raf.step(0.5 * durationMs);
    expect(iconOf(map.get('house')!).rotation)
      .toBeCloseTo(spinOffset(Math.PI / 2, easeOutBack(0.5, overshoot)), 6);
    raf.step(durationMs);
    expect(iconOf(map.get('house')!).rotation).toBe(0);
    raf.restore();
  });

  it('gives a CARRIED member no self-spin: it travels the arc without turning', () => {
    // A non-rotatable 1x1 (a tree, a flower, a road tile) never turned, so animating a turn would
    // show something that did not happen.
    const carried = wrapper(5, 5, true);            // an icon exists; it must not be touched
    const map = new Map<string, PIXI.Container>([['flower', carried]]);
    const turn = turnOf([{ id: 'flower', from: { x: 6.5, y: 4.5 }, spun: false }]);
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);
    const { durationMs } = animConfig.groupRotation;
    raf.step(0);
    expect(iconOf(carried).rotation).toBe(0);
    expect(carried.x).not.toBe(5 * TILE_SIZE);      // but it DID travel
    raf.step(0.5 * durationMs);
    expect(iconOf(carried).rotation).toBe(0);
    raf.restore();
  });

  it('lands every member exactly on its rest pose and stops scheduling', () => {
    const map = new Map<string, PIXI.Container>([['a', wrapper(5, 3, true)], ['c', wrapper(5, 5, true)]]);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: false },
    ]);
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);
    raf.step(0);
    raf.step(animConfig.groupRotation.durationMs);
    expect(map.get('a')!.x).toBe(5 * TILE_SIZE);
    expect(map.get('a')!.y).toBe(3 * TILE_SIZE);
    expect(map.get('c')!.x).toBe(5 * TILE_SIZE);
    expect(map.get('c')!.y).toBe(5 * TILE_SIZE);
    expect(iconOf(map.get('a')!).rotation).toBe(0);
    expect(raf.scheduledPerFrame).toEqual([1, 0]);   // the settling frame schedules nothing
    raf.restore();
  });

  it('keeps turning the rest of the body when one member dies mid-flight', () => {
    const map = new Map<string, PIXI.Container>([['a', wrapper(5, 3, true)], ['c', wrapper(5, 5, true)]]);
    const turn = turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: true },
    ]);
    const raf = withFakeRaf();
    animateGroupRotation(map, turn);
    raf.step(0);
    map.get('a')!.destroy();
    expect(() => raf.step(animConfig.groupRotation.durationMs * 0.5)).not.toThrow();
    expect(map.get('c')!.x).not.toBe(5 * TILE_SIZE);
    raf.restore();
  });

  it('under reduced motion applies NO transform and schedules nothing: everything is already home', () => {
    setReducedMotion(true);
    const a = wrapper(5, 3, true), c = wrapper(5, 5, true);
    const map = new Map<string, PIXI.Container>([['a', a], ['c', c]]);
    const raf = withFakeRaf();
    animateGroupRotation(map, turnOf([
      { id: 'a', from: { x: 4.5, y: 4.5 }, spun: true },
      { id: 'c', from: { x: 6.5, y: 4.5 }, spun: false },
    ]));
    expect(raf.scheduledPerFrame).toEqual([]);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    expect([a.x, a.y, c.x, c.y]).toEqual([5 * TILE_SIZE, 3 * TILE_SIZE, 5 * TILE_SIZE, 5 * TILE_SIZE]);
    expect(iconOf(a).rotation).toBe(0);
    raf.restore();
  });
});

describe('the SINGLE-object spin is unchanged', () => {
  it('eases the icon alone: the wrapper never moves', () => {
    // Rotating ONE object about its own centre genuinely IS a spin in place, so that path keeps its
    // own tuning (animConfig.rotation) and touches nothing but the icon.
    const w = wrapper(5, 3, true);
    const map = new Map<string, PIXI.Container>([['a', w]]);
    const raf = withFakeRaf();
    animateRotation(map, 'a', 0, 90);
    const { durationMs, overshoot } = animConfig.rotation;
    raf.step(0);
    expect(iconOf(w).rotation).toBe(0);
    expect([w.x, w.y]).toEqual([5 * TILE_SIZE, 3 * TILE_SIZE]);
    raf.step(0.5 * durationMs);
    expect(iconOf(w).rotation).toBeCloseTo((Math.PI / 2) * easeOutBack(0.5, overshoot), 6);
    expect([w.x, w.y]).toEqual([5 * TILE_SIZE, 3 * TILE_SIZE]);
    raf.step(durationMs);
    expect(iconOf(w).rotation).toBeCloseTo(Math.PI / 2, 10);
    raf.restore();
  });

  it('is a no-op under reduced motion', () => {
    setReducedMotion(true);
    const w = wrapper(5, 3, true);
    const raf = withFakeRaf();
    animateRotation(new Map([['a', w]]), 'a', 0, 90);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    expect(iconOf(w).rotation).toBe(0);
    raf.restore();
  });
});
