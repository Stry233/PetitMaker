import { describe, it, expect } from 'vitest';
import { layerLockRule } from '../../rules/layer-lock';
import { CommandType, TerrainType, type TrimCornersCommand } from '../../core/model/types';
import { makeState, setTerrain, paintCmd, eraseCmd, makeObject } from '../_support/map-state';

const trim = (fields: { x: number; y: number; layer: 'terrain' | 'road' } & Record<string, unknown>): TrimCornersCommand =>
  ({ type: CommandType.TrimCorners, afterCorners: ['fan', 'square', 'square', 'square'], ...fields }) as TrimCornersCommand;

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
  it('rejects trimming the corners of terrain standing on a locked layer', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    state.lockedLayers.add(2);
    expect(layerLockRule.validate(trim({ x: 5, y: 5, layer: 'terrain' }), state)).toHaveLength(1);
    state.lockedLayers.clear();
    state.lockedLayers.add(4);
    expect(layerLockRule.validate(trim({ x: 5, y: 5, layer: 'terrain' }), state)).toHaveLength(0);
  });
  it('rejects a fillet whose column crosses a locked layer', () => {
    const state = makeState();
    state.lockedLayers.add(2);
    const fillet = { x: 5, y: 5, layer: 'terrain' as const, patchOnly: true, terrainType: TerrainType.Mountain, patchBase: 0 };
    expect(layerLockRule.validate(trim({ ...fillet, elevation: 3 }), state)).toHaveLength(1);
    expect(layerLockRule.validate(trim({ ...fillet, elevation: 1 }), state)).toHaveLength(0);
  });
  it('rejects trimming a road standing on a locked layer', () => {
    const state = makeState();
    state.objects.set('r', { ...makeObject('r', 4, 4), catalogId: 'path-overgrown-dirt', elevation: 1 });
    state.lockedLayers.add(1);
    expect(layerLockRule.validate(trim({ x: 4, y: 4, layer: 'road', objectId: 'r' }), state)).toHaveLength(1);
  });
  it('allows painting at non-locked elevation with no existing terrain', () => {
    const state = makeState();
    state.lockedLayers.add(5);
    expect(layerLockRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state)).toHaveLength(0);
  });
});
