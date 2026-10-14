import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OverlayFlashes3D } from '../../../../../view/map3d/layers/overlay/flash';
import type { OverlayHost3D } from '../../../../../view/map3d/layers/overlay/host';
import { setReducedMotion } from '../../../../../platform/channels/motion-state';
import { cellSet, evidenceOn } from '../../../../../core/grid/grids';
import { TERRAIN_GRID } from '../../../../../core/game/profile';
import type { ValidationError } from '../../../../../core/model/types';
import { makeState } from '../../../../_support/map-state';

function fixture() {
  const state = makeState(16, 16);
  const group = new THREE.Group();
  let now = 0;
  const host = {
    group, state: () => state, requestRender: () => {}, nowMs: () => now,
  } as unknown as OverlayHost3D;
  return { flashes: new OverlayFlashes3D(host), group, advance: (ms: number) => { now += ms; } };
}

const refusal = (x: number, y: number): ValidationError =>
  ({ ruleId: 'TEST', message: 'refused', ...evidenceOn(TERRAIN_GRID, [{ x, y }]) });

afterEach(() => setReducedMotion(false));

describe('3D flashes follow the 2D policy', () => {
  it('lets the latest commit flash replace the one still fading', () => {
    const { flashes, group, advance } = fixture();
    flashes.flashCommit([cellSet(TERRAIN_GRID, [{ x: 2, y: 2 }])]);
    advance(10);
    flashes.flashCommit([cellSet(TERRAIN_GRID, [{ x: 6, y: 6 }])]);
    expect(group.children).toHaveLength(1);
  });

  it('lets the latest error flash replace the one still fading', () => {
    const { flashes, group, advance } = fixture();
    flashes.flashErrors([refusal(2, 2)]);
    advance(10);
    flashes.flashErrors([refusal(6, 6)]);
    expect(group.children).toHaveLength(1);
  });

  it('keeps an error flash and a commit flash apart', () => {
    const { flashes, group } = fixture();
    flashes.flashErrors([refusal(2, 2)]);
    flashes.flashCommit([cellSet(TERRAIN_GRID, [{ x: 6, y: 6 }])]);
    expect(group.children).toHaveLength(2);
  });

  it('keeps quiet for the same evidence within the cooldown', () => {
    const { flashes, group, advance } = fixture();
    flashes.flashErrors([refusal(2, 2)]);
    const first = group.children[0];
    advance(10);
    flashes.flashErrors([refusal(2, 2)]);
    expect(group.children).toEqual([first]);
  });
});
