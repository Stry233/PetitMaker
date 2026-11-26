// @vitest-environment jsdom
/**
 * A flip plays like a card turning over, on a group turn's clock and curve: the body travels from
 * where it stood, mirrored back, through the flip's axis while it squashes along that axis only, and
 * opens out a little past rest before it settles; an item's art never shows mirrored, and under
 * reduced motion it steps straight to rest.
 */
import '../../../_support/pixi-env'; // object-animations reaches PIXI, which needs jsdom's missing 2D context
import { afterEach, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { spec } from '../../../_support/spec';
import { flipOffset, flipScale, flipSquash } from '../../../../view/shared/motion/group-arc';
import type { GroupRotation } from '../../../../tools/objects';
import { animateGroupRotation } from '../../../../view/map2d/layers/object-animations';
import { animConfig } from '../../../../view/shared/motion/anim-config';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import type { PlayBeat } from '../../../../view/shared/viewport/frame-loop';
import { beatClock } from '../../../_support/beat-clock';
import { setReducedMotion, __resetMotionState } from '../../../../platform/channels/motion-state';

/** An object wrapper standing with its top-left at cell (x, y). */
function wrapper(x: number, y: number): PIXI.Container {
  const c = new PIXI.Container();
  c.position.set(x * TILE_SIZE, y * TILE_SIZE);
  return c;
}

/** The frame loop's clock: `step(ts)` steps every live beat at `ts`. */
function onFrameLoop(): { play: PlayBeat; step: (ts: number) => void; readonly played: number } {
  const clock = beatClock();
  return { play: clock.play, step: (ts: number) => { clock.frame(ts); }, get played() { return clock.played; } };
}

/** A one-cell member at rest at cell (6, 2), flipped left to right about x = 5: it stood at (3, 2). */
const FLIP: GroupRotation = { pivot: { x: 5, y: 3 }, sweepDeg: 0, flip: { x: true, y: false }, members: [{ id: 'a', from: { x: 3.5, y: 2.5 }, spun: false }] };

afterEach(() => { __resetMotionState(); });

spec('BLUE-14', 'a flip opens out from the mirror through the axis, the art squashed along that axis only and never mirrored', () => {
  expect(flipOffset(FLIP.pivot, FLIP.members[0]!.from, FLIP.flip!, 0)).toEqual({ dx: -3, dy: 0 });
  const landed = flipOffset(FLIP.pivot, FLIP.members[0]!.from, FLIP.flip!, 1);
  expect([landed.dx, landed.dy].map(Math.abs)).toEqual([0, 0]);
  expect([flipScale(0), flipScale(0.5), flipScale(1)]).toEqual([-1, 0, 1]);
  expect(flipSquash(0.5)).toBe(animConfig.groupFlip.minScale);

  const w = wrapper(6, 2);
  const loop = onFrameLoop();
  animateGroupRotation(new Map([['a', w]]), FLIP, loop.play);
  loop.step(0);
  // The first frame stands where the member stood before the flip, its centre (the wrapper's pivot
  // while it plays) at (3.5, 2.5), at full width.
  expect(w.x / TILE_SIZE).toBeCloseTo(3.5);
  expect(w.y / TILE_SIZE).toBe(2.5);
  expect(w.scale.x).toBeCloseTo(1);
  expect(w.scale.y).toBe(1);
  // Partway it is squashed across x, never flipped over, and not at all across y.
  const { durationMs } = animConfig.groupRotation;
  loop.step(durationMs * 0.25);
  expect(w.scale.x).toBeGreaterThan(0);
  expect(w.scale.x).toBeLessThan(1);
  expect(w.scale.y).toBe(1);
  // Near the end it opens a little past full width and settles, as a group turn swings past its quarter.
  loop.step(durationMs * 0.8);
  expect(w.scale.x).toBeGreaterThan(1);
  expect(w.scale.x).toBeLessThan(1.2);
  loop.step(durationMs);
  expect({ x: w.x, y: w.y, sx: w.scale.x, sy: w.scale.y, px: w.pivot.x, py: w.pivot.y })
    .toEqual({ x: 6 * TILE_SIZE, y: 2 * TILE_SIZE, sx: 1, sy: 1, px: 0, py: 0 });
});

spec('BLUE-14', 'under reduced motion a flip steps straight to rest', () => {
  setReducedMotion(true);
  const w = wrapper(6, 2);
  const loop = onFrameLoop();
  animateGroupRotation(new Map([['a', w]]), FLIP, loop.play);
  loop.step(0);
  expect({ x: w.x, y: w.y, sx: w.scale.x, px: w.pivot.x }).toEqual({ x: 6 * TILE_SIZE, y: 2 * TILE_SIZE, sx: 1, px: 0 });
});
