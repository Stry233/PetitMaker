import { describe, it, expect } from 'vitest';
import { layerLockRule } from '../../rules/layer-lock';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain, paintCmd, eraseCmd } from './_helpers';

describe('V-LOCK-01: Layer Lock', () => {
  it('allows painting when no layers are locked', () => {
    const state = makeState();
    expect(layerLockRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state)).toHaveLength(0);
  });
  it('rejects painting at a locked elevation', () => {
    const state = makeState();
    state.lockedLayers.add(3);
    expect(layerLockRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 3), state)).toHaveLength(1);
  });
  it('rejects erasing a cell that occupies a locked layer', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    state.lockedLayers.add(2);
    expect(layerLockRule.validate(eraseCmd([{ x: 5, y: 5 }]), state)).toHaveLength(1);
  });
  it('rejects overwriting a cell that spans a locked layer', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    state.lockedLayers.add(2);
    expect(layerLockRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 5), state)).toHaveLength(1);
  });
  it('allows painting at non-locked elevation with no existing terrain', () => {
    const state = makeState();
    state.lockedLayers.add(5);
    expect(layerLockRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state)).toHaveLength(0);
  });
});
