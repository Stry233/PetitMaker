/** The cell grid's offset glides between grids on the canvas registry's motion, and passes the
 *  reduced-motion gate: under it the lines stand on the new grid at once, a glide in flight included. */
import { afterEach, describe, expect, it } from 'vitest';
import { GridShift } from '../../../../view/shared/grid/grid-shift';
import { GRIDS } from '../../../../core/game/profile';
import { __resetMotionState, setReducedMotion } from '../../../../platform/channels/motion-state';
import { animConfig, easeOutCubic } from '../../../../view/shared/motion/anim-config';

afterEach(__resetMotionState);

const MS = animConfig.gridShift.durationMs;

describe('the grid shift', () => {
  it('starts on the object grid', () => {
    expect(new GridShift().offset).toEqual(GRIDS.object.offset);
  });

  it('glides to the terrain grid on the registry duration and ease, then rests', () => {
    const shift = new GridShift();
    shift.aim('terrain', true, 0);
    expect(shift.offset).toEqual(GRIDS.object.offset);
    expect(shift.gliding).toBe(true);
    expect(shift.step(MS / 2)).toBe(true);
    expect(shift.offset.x).toBeCloseTo(GRIDS.terrain.offset.x * easeOutCubic(0.5));
    expect(shift.offset.y).toBeCloseTo(GRIDS.terrain.offset.y * easeOutCubic(0.5));
    expect(shift.step(MS)).toBe(true);
    expect(shift.offset).toEqual(GRIDS.terrain.offset);
    expect(shift.step(MS + 16)).toBe(false);
  });

  it('turns back from where it stands when aimed home mid-glide', () => {
    const shift = new GridShift();
    shift.aim('terrain', true, 0);
    shift.step(MS / 2);
    const turned = shift.offset;
    shift.aim('object', true, MS / 2);
    expect(shift.offset).toEqual(turned);
    shift.step(MS / 2 + 1);
    expect(shift.offset.x).toBeGreaterThan(turned.x);
    shift.step(MS * 2);
    expect(shift.offset).toEqual(GRIDS.object.offset);
  });

  it('stands on the new grid at once without a glide', () => {
    const shift = new GridShift();
    shift.aim('terrain', false, 0);
    expect(shift.offset).toEqual(GRIDS.terrain.offset);
    expect(shift.step(1)).toBe(false);
  });

  it('stands on the new grid at once under reduced motion', () => {
    setReducedMotion(true);
    const shift = new GridShift();
    shift.aim('terrain', true, 0);
    expect(shift.offset).toEqual(GRIDS.terrain.offset);
    expect(shift.gliding).toBe(false);
  });

  it('lands a glide in flight when motion is reduced mid-way', () => {
    const shift = new GridShift();
    shift.aim('terrain', true, 0);
    shift.step(MS / 4);
    setReducedMotion(true);
    expect(shift.step(MS / 4 + 1)).toBe(true);
    expect(shift.offset).toEqual(GRIDS.terrain.offset);
    expect(shift.gliding).toBe(false);
  });
});
