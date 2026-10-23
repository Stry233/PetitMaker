/** Layers: the ground under everything, the stack above it, and locked and hidden layers. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { brush, eraser, plateau, Pointer, setLayerLocked, terrainCell } from './_editing';
import { ToolType } from '../../../state/editing/vocabulary';
import { ELEVATION_MAX, layerNumber } from '../../../core/game/profile';
import type { MacroCoord } from '../../../core/model/types';

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });
/** The 3x3 block at `at` as drawn, corners included, as one comparable string. */
const shape = (w: SpecWorld, at: MacroCoord): string => JSON.stringify(rect(at, 3, 3).map((c) => terrainCell(w, c)));

describe('layers', () => {
  spec('EDIT-13', 'the ground stays under every eraser, outside the planet editor', () => {
    const w = world();
    const at = w.openGround(4, 4);
    const before = w.fingerprint();
    for (const contentType of ['mountain', 'water', 'road'] as const) {
      eraser(w, { contentType, eraserShape: 'rect' }).drag(at, shift(at, 3, 3));
    }
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-13', 'terrain stacks up to the game\'s highest layer and no further, named by the game\'s number', () => {
    const w = world();
    const at = w.openGround(5, 5);
    plateau(w, at, 5, 5, ELEVATION_MAX - 6);
    plateau(w, shift(at, 1, 1), 3, 3, ELEVATION_MAX - 3);
    const top = shift(at, 2, 2);
    const p = brush(w, { floor: ELEVATION_MAX });
    p.click(top);
    expect(w.terrainAt(top)?.elevation).toBe(ELEVATION_MAX);
    p.click(top);
    expect(w.terrainAt(top)?.elevation, 'a further dab stacks nothing').toBe(ELEVATION_MAX);

    expect(w.stroke([top], TerrainType.Mountain, ELEVATION_MAX + 1).refusedBy).toEqual(['V-MTN-01']);
    expect(w.sandbox.refusal?.params).toEqual({ max: layerNumber(ELEVATION_MAX) });
    expect(layerNumber(ELEVATION_MAX)).toBe(ELEVATION_MAX + 1);
  });

  spec('EDIT-14', 'a locked layer refuses the brush, the eraser, the shapes and the corner tool', () => {
    const w = world();
    const at = w.openGround(6, 6);
    plateau(w, shift(at, 1, 1), 3, 3, 1);
    setLayerLocked(w, 1, true);
    const before = w.fingerprint();

    brush(w).click(shift(at, 2, 2));
    brush(w, { contentType: 'water' }).click(shift(at, 2, 2));
    brush(w, { shape: 'rect' }).drag(at, shift(at, 5, 5));
    brush(w, { shape: 'line' }).drag(at, shift(at, 5, 0));
    eraser(w).click(shift(at, 2, 2));
    eraser(w, { eraserShape: 'circle' }).drag(shift(at, 2, 2), shift(at, 4, 2));
    new Pointer(w, { tool: ToolType.EdgeCut }).click(shift(at, 0, 0));
    expect(w.fingerprint()).toBe(before);

    setLayerLocked(w, 1, false);
    new Pointer(w, { tool: ToolType.EdgeCut }).click(shift(at, 0, 0));
    expect(w.fingerprint(), 'unlocked, the same corner click cuts').not.toBe(before);
  });

  spec('EDIT-14', 'automatic trimming leaves terrain standing on a locked layer as it is', () => {
    const trimmedBeside = (locked: boolean) => {
      const w = world();
      const at = w.openGround(6, 3);
      plateau(w, at, 3, 3, 2);
      if (locked) setLayerLocked(w, 2, true);
      const block = shape(w, at);
      brush(w, { autoEdgeCut: 'round', shape: 'rect' }).drag(shift(at, 3, 0), shift(at, 4, 2));
      expect(w.terrainAt(shift(at, 3, 1)), 'the new stroke stands').toEqual({ type: TerrainType.Mountain, elevation: 1 });
      return shape(w, at) !== block;
    };
    expect(trimmedBeside(false), 'unlocked, the trim reshapes the block beside the stroke').toBe(true);
    expect(trimmedBeside(true), 'locked, it stays as it was').toBe(false);
  });

  spec('EDIT-15', 'the eraser passes over terrain on a hidden layer without refusing the stroke', () => {
    const w = world();
    const at = w.openGround(6, 3);
    plateau(w, at, 3, 3, 2);
    plateau(w, shift(at, 3, 0), 3, 3, 1);
    const e = eraser(w, { eraserShape: 'rect', layerVisibility: { 2: false } });
    e.drag(at, shift(at, 5, 2));
    expect(e.toasts).toEqual([]);
    expect(w.terrainAt(shift(at, 1, 1)), 'the hidden block stays').toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(w.terrainAt(shift(at, 4, 1)), 'the visible one is lowered').toBeNull();
  });

  spec('EDIT-15', 'automatic trimming passes over terrain on a hidden layer', () => {
    const trimmedBeside = (hidden: boolean) => {
      const w = world();
      const at = w.openGround(6, 3);
      plateau(w, at, 3, 3, 2);
      const block = shape(w, at);
      brush(w, { autoEdgeCut: 'round', shape: 'rect', layerVisibility: hidden ? { 2: false } : {} }).drag(shift(at, 3, 0), shift(at, 4, 2));
      return shape(w, at) !== block;
    };
    expect(trimmedBeside(false)).toBe(true);
    expect(trimmedBeside(true)).toBe(false);
  });
});
