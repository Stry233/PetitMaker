/** Corner cuts: the corner tool's cycle, fillets in notches, Auto Trim and the repairs an edit owes. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { brush, placeItem, plateau, Pointer, terrainCell } from './_editing';
import { ToolType } from '../../../state/editing/vocabulary';
import type { MacroCoord } from '../../../core/model/types';

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });
const SE = 3, SW = 2, NW = 0;

/** The corner tool, clicked at the corner where terrain cell `c`'s south-east corner lies. */
const cornerTool = (w: SpecWorld) => {
  const p = new Pointer(w, { tool: ToolType.EdgeCut });
  return { clickSE: (c: MacroCoord) => p.click(c) };
};

const cornerOf = (w: SpecWorld, c: MacroCoord, i: number): string => terrainCell(w, c)?.corners?.[i] ?? 'square';
const look = (trim: string): string => (trim.startsWith('tri') ? 'bevel' : trim === 'fan' ? 'round' : trim);

describe('corner cuts', () => {
  spec('EDIT-16', 'the corner tool cycles a free corner through square, bevel and round and back', () => {
    const w = world();
    const block = w.openGround(3, 3);
    plateau(w, block, 1, 1, 1);
    const tool = cornerTool(w);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { tool.clickSE(block); seen.push(look(cornerOf(w, block, SE))); }
    expect(new Set(seen)).toEqual(new Set(['bevel', 'round', 'square']));
    expect(seen[2]).toBe('square');
    expect(terrainCell(w, block)?.elevation, 'the block itself stays').toBe(1);
  });

  spec('EDIT-16', 'the corners meeting at one junction cycle independently of each other', () => {
    const w = world();
    const a = w.openGround(4, 4);
    const b = shift(a, 1, 1);
    plateau(w, a, 1, 1, 1);
    plateau(w, b, 1, 1, 1);
    const tool = cornerTool(w);
    const pairs = new Set<string>();
    for (let i = 0; i < 9; i++) {
      tool.clickSE(a);
      pairs.add(`${look(cornerOf(w, a, SE))}/${look(cornerOf(w, b, NW))}`);
    }
    expect(pairs.size).toBe(9);
    expect(pairs.has('square/square')).toBe(true);
  });

  spec('EDIT-16', 'a mountain capping a waterfall cuts its corner away from the water and keeps the corner at the lip', () => {
    const w = world();
    const at = w.openGround(3, 2);
    const cap = shift(at, 0, 1);
    const fall = shift(at, 1, 1);
    expect(w.stroke([...rect(at, 3, 1), cap, shift(at, 2, 1)], TerrainType.Mountain, 1).ok).toBe(true);
    expect(w.stroke([fall], TerrainType.Water, 1).ok).toBe(true);
    const tool = cornerTool(w);
    tool.clickSE(shift(cap, -1, 0));
    expect(look(cornerOf(w, cap, SW))).toBe('round');
    const before = w.fingerprint();
    tool.clickSE(cap);
    expect(w.fingerprint(), 'the corner beside the falling water stays square').toBe(before);
  });

  spec('EDIT-16', 'a corner joined along an edge to the same terrain at the same height cannot be cut', () => {
    const w = world();
    const at = w.openGround(4, 3);
    plateau(w, at, 2, 1, 1);
    const before = w.fingerprint();
    cornerTool(w).clickSE(shift(at, 0, -1));
    expect(w.fingerprint()).toBe(before);
    expect(w.undo(), 'and leaves no undo step').toBe(true);
    expect(w.terrainAt(at), 'the step undone was the block itself').toBeNull();
  });

  spec('EDIT-17', 'a click in an L-shaped notch rounds it with a fillet as high as the walls, and cycling it away restores the cell', () => {
    const w = world();
    const at = w.openGround(4, 4);
    plateau(w, at, 2, 1, 2);
    plateau(w, shift(at, 0, 1), 1, 1, 2);
    const notch = shift(at, 1, 1);
    const before = w.fingerprint();
    const tool = cornerTool(w);
    tool.clickSE(at);
    expect(look(cornerOf(w, notch, NW))).toBe('round');
    expect(terrainCell(w, notch)?.elevation, 'the fillet rises to the walls').toBe(2);
    tool.clickSE(at);
    tool.clickSE(at);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-18', 'cut corners take no support away: a block they surround rises exactly as high', () => {
    const peak = (cut: boolean) => {
      const w = world();
      const at = w.openGround(3, 3);
      plateau(w, at, 3, 3, 1);
      if (cut) {
        const tool = cornerTool(w);
        for (const c of [shift(at, -1, -1), shift(at, 2, -1), shift(at, -1, 2), shift(at, 2, 2)]) tool.clickSE(c);
        expect(look(cornerOf(w, at, NW))).toBe('round');
      }
      brush(w, { floor: 4 }).click(shift(at, 1, 1));
      return w.terrainAt(shift(at, 1, 1))?.elevation;
    };
    const cut = peak(true);
    expect(cut).toBe(4);
    expect(cut).toBe(peak(false));
  });

  spec('EDIT-18', 'a fillet adds no support: a notch it rounds still holds nothing up', () => {
    const peak = (notch: 'empty' | 'fillet' | 'block') => {
      const w = world();
      const at = w.openGround(3, 3);
      const centre = shift(at, 1, 1);
      plateau(w, at, 3, 2, 1);
      plateau(w, shift(at, 0, 2), 2, 1, 1);
      if (notch === 'fillet') {
        cornerTool(w).clickSE(centre);
        expect(terrainCell(w, shift(at, 2, 2))?.patchOnly).toBe(true);
      }
      if (notch === 'block') plateau(w, shift(at, 2, 2), 1, 1, 1);
      brush(w, { floor: 4 }).click(centre);
      return w.terrainAt(centre)?.elevation;
    };
    expect(peak('block')).toBe(4);
    expect(peak('empty')).toBe(3);
    expect(peak('fillet')).toBe(peak('empty'));
  });

  spec('EDIT-18', 'an object stands on a cut block at the height it stands on the square one', () => {
    const footing = (cut: boolean) => {
      const w = world();
      const at = w.openGround(3, 3);
      plateau(w, at, 3, 3, 1);
      if (cut) cornerTool(w).clickSE(shift(at, -1, -1));
      return placeItem(w, 'tree-apple', at)?.elevation;
    };
    expect(footing(false)).toBe(1);
    expect(footing(true)).toBe(footing(false));
  });

  spec('EDIT-19', 'with Auto Trim on, a stroke cuts the corners it left exposed inside its own undo step', () => {
    for (const mode of ['round', 'rect'] as const) {
      const w = world();
      const at = w.openGround(3, 3);
      const before = w.fingerprint();
      brush(w, { autoEdgeCut: mode, shape: 'rect' }).drag(at, shift(at, 2, 2));
      const corners = [cornerOf(w, at, 0), cornerOf(w, shift(at, 2, 0), 1), cornerOf(w, shift(at, 0, 2), 2), cornerOf(w, shift(at, 2, 2), 3)];
      expect(corners.map(look), mode).toEqual(Array(4).fill(mode === 'round' ? 'round' : 'bevel'));
      expect(cornerOf(w, shift(at, 1, 0), 0), 'an edge joined to its neighbour stays square').toBe('square');
      w.undo();
      expect(w.fingerprint(), `${mode}: one undo takes the stroke and its cuts`).toBe(before);
    }
  });

  spec('EDIT-19', 'Auto Trim fills a notch the stroke formed', () => {
    const w = world();
    const at = w.openGround(3, 3);
    plateau(w, at, 2, 1, 1);
    brush(w, { autoEdgeCut: 'round' }).click(shift(at, 0, 1));
    expect(terrainCell(w, shift(at, 1, 1))?.patchOnly, 'the notch holds a fillet').toBe(true);
  });

  spec('EDIT-19', 'Auto Trim leaves a corner the stroke did not touch, and every cut it made can be changed by hand', () => {
    const w = world();
    const at = w.openGround(10, 3);
    plateau(w, at, 1, 1, 1);
    const away = shift(at, 6, 0);
    brush(w, { autoEdgeCut: 'round' }).click(away);
    expect(cornerOf(w, at, SE), 'the far block keeps its square corner').toBe('square');
    expect(look(cornerOf(w, away, SE))).toBe('round');
    cornerTool(w).clickSE(away);
    expect(look(cornerOf(w, away, SE)), 'the corner tool moves it on').toBe('bevel');
  });

  spec('EDIT-20', 'an edit that leaves a cut corner unable to stand squares it in the same step, and undo brings the cut back', () => {
    const w = world();
    const at = w.openGround(4, 3);
    plateau(w, at, 1, 1, 1);
    cornerTool(w).clickSE(at);
    expect(look(cornerOf(w, at, SE))).toBe('round');
    const cut = w.fingerprint();
    brush(w).click(shift(at, 1, 0));
    expect(cornerOf(w, at, SE), 'joined along its edge, the cut is squared').toBe('square');
    expect(w.terrainAt(shift(at, 1, 0))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    w.undo();
    expect(w.fingerprint()).toBe(cut);
  });

  spec('EDIT-20', 'a fillet whose walls an edit takes away is removed with the edit', () => {
    const w = world();
    const at = w.openGround(4, 4);
    plateau(w, at, 2, 1, 1);
    plateau(w, shift(at, 0, 1), 1, 1, 1);
    cornerTool(w).clickSE(at);
    const notch = shift(at, 1, 1);
    expect(terrainCell(w, notch)?.patchOnly).toBe(true);
    const filleted = w.fingerprint();
    new Pointer(w, { tool: ToolType.Eraser }).click(shift(at, 0, 1));
    expect(terrainCell(w, notch), 'no wall left to wrap, no fillet').toBeNull();
    w.undo();
    expect(w.fingerprint()).toBe(filleted);
  });
});
