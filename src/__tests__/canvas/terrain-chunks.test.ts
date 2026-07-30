/**
 * Terrain consolidates into ONE Graphics per chunk. Per-cell Graphics made a
 * dense generated map carry ~10k+ display nodes, and a pan re-traverses every
 * visible node each frame — measured at ~9 ms/frame (41 fps) at fit-to-map.
 * Chunk-level Graphics cut the traversal to ~1 node per 256 cells; edits mark
 * their chunks dirty and repaint ONCE per frame (flushDirty), not per command.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { TerrainLayer } from '../../canvas/map2d/layers/terrain-layer';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

function graphicsLeaves(c: PIXI.Container): PIXI.Graphics[] {
  const out: PIXI.Graphics[] = [];
  const walk = (n: PIXI.Container) => {
    for (const ch of n.children) {
      if (ch instanceof PIXI.Graphics) out.push(ch);
      else if (ch instanceof PIXI.Container) walk(ch);
    }
  };
  walk(c);
  return out;
}

describe('TerrainLayer chunk consolidation', () => {
  it('drawFull builds one Graphics per touched chunk, not one per cell', () => {
    const state = makeState(20, 20) as GridState; // spans chunks (0,0) and (1,0)/(0,1)/(1,1)
    setTerrain(state, 2, 2, TerrainType.Mountain, 2);
    setTerrain(state, 3, 2, TerrainType.Mountain, 2);
    setTerrain(state, 4, 7, TerrainType.Water, 0);
    setTerrain(state, 18, 3, TerrainType.Mountain, 1); // chunk (1,0)
    const layer = new TerrainLayer();
    layer.drawFull(state);
    // 5 terrain cells in 2 chunks → exactly 2 Graphics (waterfall arrows would
    // add more, but this state has none).
    expect(graphicsLeaves(layer.container)).toHaveLength(2);
  });

  it('redrawCells defers the repaint to flushDirty, which repaints each dirty chunk once', () => {
    const state = makeState(20, 20) as GridState;
    setTerrain(state, 2, 2, TerrainType.Mountain, 2);
    const layer = new TerrainLayer();
    layer.drawFull(state);
    const g = graphicsLeaves(layer.container)[0]!;
    const before = g.geometry.graphicsData.length;

    setTerrain(state, 5, 5, TerrainType.Mountain, 1); // same chunk
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    layer.redrawCells([{ x: 5, y: 5 }, { x: 6, y: 5 }], state);
    expect(g.geometry.graphicsData.length, 'no repaint before the flush').toBe(before);

    expect(layer.flushDirty(state), 'both cells share one chunk → one repaint').toBe(1);
    expect(g.geometry.graphicsData.length).toBeGreaterThan(before);
    expect(layer.flushDirty(state), 'clean after the flush').toBe(0);
  });

  it('cells across chunks dirty each chunk exactly once', () => {
    const state = makeState(40, 40) as GridState;
    const layer = new TerrainLayer();
    layer.drawFull(state);
    setTerrain(state, 2, 2, TerrainType.Mountain, 1);   // chunk (0,0)
    setTerrain(state, 20, 2, TerrainType.Mountain, 1);  // chunk (1,0)
    setTerrain(state, 2, 20, TerrainType.Mountain, 1);  // chunk (0,1)
    layer.redrawCells([{ x: 2, y: 2 }, { x: 20, y: 2 }, { x: 2, y: 20 }], state);
    expect(layer.flushDirty(state)).toBe(3);
  });

  it('an erase disappears after the flush', () => {
    const state = makeState(20, 20) as GridState;
    setTerrain(state, 2, 2, TerrainType.Mountain, 2);
    const layer = new TerrainLayer();
    layer.drawFull(state);
    const g = graphicsLeaves(layer.container)[0]!;
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);

    state.cells[2]![2]!.terrain = null;
    layer.redrawCells([{ x: 2, y: 2 }], state);
    layer.flushDirty(state);
    expect(g.geometry.graphicsData.length, 'chunk repainted empty').toBe(0);
  });
});
