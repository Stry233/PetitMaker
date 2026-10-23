/** Undo and redo as a person sees them: one gesture, one step, back and forth exactly. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { brush, eraser, plateau, Pointer } from './_editing';
import { ToolType } from '../../../state/editing/vocabulary';

describe('undo and redo', () => {
  spec('EDIT-21', 'takes back a whole stroke in one step', () => {
    const w = world();
    const at = w.openGround(4, 4);
    const before = w.fingerprint();
    expect(w.stroke(rect(at, 4, 4), TerrainType.Mountain, 1).ok).toBe(true);
    expect(w.terrainAt(at)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.undo()).toBe(true);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-22', 'redo brings back exactly what undo took, and a new edit clears it', () => {
    const w = world();
    const at = w.openGround(6, 3);
    w.stroke(rect(at, 3, 3), TerrainType.Mountain, 1);
    const painted = w.fingerprint();
    w.undo();
    w.redo();
    expect(w.fingerprint()).toBe(painted);
    w.undo();
    w.stroke(rect({ x: at.x + 3, y: at.y }, 3, 3), TerrainType.Mountain, 1);
    const fresh = w.fingerprint();
    w.redo();
    expect(w.fingerprint()).toBe(fresh);
  });

  spec('EDIT-23', 'a cancelled press takes back what it laid, leaves nothing to redo and keeps the strokes before it', () => {
    const w = world();
    const at = w.openGround(8, 4);
    plateau(w, at, 2, 2, 1);
    const kept = w.fingerprint();
    const press = (p: Pointer, cells: { x: number; y: number }[], laysOnPress = true) => {
      p.press(cells[0]!);
      for (const c of cells.slice(1)) p.move(c);
      if (laysOnPress) expect(w.fingerprint(), `${p.manager.getActiveTool().id} lays as it goes`).not.toBe(kept);
      p.cancel();
      expect(w.fingerprint(), `${p.manager.getActiveTool().id} cancelled`).toBe(kept);
      w.redo();
      expect(w.fingerprint(), 'nothing to redo').toBe(kept);
    };
    const row = [{ x: at.x + 3, y: at.y }, { x: at.x + 6, y: at.y }, { x: at.x + 6, y: at.y + 3 }];
    press(brush(w), row);
    press(brush(w, { shape: 'rect' }), row, false);
    press(eraser(w), [at, { x: at.x + 1, y: at.y + 1 }]);
    press(new Pointer(w, { tool: ToolType.EdgeCut }), [{ x: at.x - 1, y: at.y - 1 }]);
    press(new Pointer(w, { tool: ToolType.ObjectPlacer, armedItem: 'tree-apple' }), [{ x: at.x + 4, y: at.y + 2 }]);
    expect(w.terrainAt(at), 'the earlier stroke stays').toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
});
