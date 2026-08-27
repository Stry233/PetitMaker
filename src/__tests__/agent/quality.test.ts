import { describe, it, expect } from 'vitest';
import { TerrainType, type Corners } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { evaluateMap, renderScorecard } from '../../agent/quality';

describe('evaluateMap: connectivity', () => {
  it('scores a fully open map 10', () => {
    const state = makeState(20, 20);
    expect(evaluateMap(state).connectivity.score).toBe(10);
  });

  it('flags a region walled off by an uncrossed cliff', () => {
    const state = makeState(20, 20);
    // vertical elevation-2 wall splits the map; no ramp/bridge joins the halves
    for (let y = 0; y < 20; y++) setTerrain(state, 10, y, TerrainType.Mountain, 2);
    const r = evaluateMap(state).connectivity;
    expect(r.score).toBeLessThanOrEqual(6);
    expect(r.hints.join(' ')).toMatch(/cut off/i);
  });
});

describe('evaluateMap: connectivity is start-point independent', () => {
  it('scores high when a small unramped plateau sits at the map centre', () => {
    const state = makeState(20, 20);
    // an isolated elev-2 plateau covering the centre — the main landmass is
    // everything around it and must dominate the score
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    const r = evaluateMap(state).connectivity;
    expect(r.score).toBeGreaterThanOrEqual(9);
    expect(r.hints.join(' ')).toMatch(/cut off/i);
  });
});

describe('evaluateMap: terrainInterest + water', () => {
  it('an all-flat, dry map scores low on both', () => {
    const state = makeState(20, 20);
    const r = evaluateMap(state);
    expect(r.terrainInterest.score).toBeLessThanOrEqual(3);
    expect(r.terrainInterest.hints.join(' ')).toMatch(/flat/i);
    expect(r.water.score).toBe(0);
    expect(r.water.hints.join(' ')).toMatch(/no water/i);
  });

  it('tiers and water raise the scores', () => {
    const state = makeState(20, 20);
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let y = 14; y < 18; y++) for (let x = 3; x < 12; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const r = evaluateMap(state);
    expect(r.terrainInterest.score).toBeGreaterThanOrEqual(5);
    expect(r.water.score).toBeGreaterThanOrEqual(4);
  });
});

describe('evaluateMap: stamped pools + plaza apron', () => {
  it('two congruent pools are named as stamps; distinct pools pass', () => {
    const state = makeState(40, 40);
    for (let y = 4; y < 10; y++) for (let x = 4; x < 12; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    for (let y = 4; y < 10; y++) for (let x = 20; x < 28; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const twin = evaluateMap(state);
    expect(twin.water.hints.join(' ')).toMatch(/congruent 8x6 stamps/);
    for (let y = 8; y < 10; y++) for (let x = 20; x < 28; x++) { state.cells[y]![x]!.terrain = null; }
    const varied = evaluateMap(state);
    expect(varied.water.hints.join(' ')).not.toMatch(/congruent/);
  });

  it('a lone flower dot is named; a lone tree is a specimen; noise costs the decoration grade', () => {
    const state = makeState(40, 40);
    for (let x = 5; x < 15; x++) for (let y = 5; y < 8; y++) {
      state.objects.set(`f${x}-${y}`, { id: `f${x}-${y}`, catalogId: 'flower-lily', position: { x, y }, rotation: 0, elevation: 0, locked: false });
    }
    state.objects.set('lonetree', { id: 'lonetree', catalogId: 'tree-peach', position: { x: 30, y: 30 }, rotation: 0, elevation: 0, locked: false });
    const clean = evaluateMap(state);
    expect(clean.decoration.hints.join(' ')).not.toMatch(/lone flower/);
    state.objects.set('stray', { id: 'stray', catalogId: 'flower-lily', position: { x: 30, y: 10 }, rotation: 0, elevation: 0, locked: false });
    const noisy = evaluateMap(state);
    expect(noisy.decoration.hints.join(' ')).toMatch(/lone flower dot/);
    expect(noisy.decoration.score).toBeLessThanOrEqual(clean.decoration.score);
    // A detached flower PAIR is a stray too; a tree pair stays a specimen moment.
    state.objects.delete('stray');
    state.objects.set('p1', { id: 'p1', catalogId: 'flower-lily', position: { x: 30, y: 10 }, rotation: 0, elevation: 0, locked: false });
    state.objects.set('p2', { id: 'p2', catalogId: 'flower-lily', position: { x: 31, y: 10 }, rotation: 0, elevation: 0, locked: false });
    state.objects.set('t1', { id: 't1', catalogId: 'tree-peach', position: { x: 10, y: 30 }, rotation: 0, elevation: 0, locked: false });
    state.objects.set('t2', { id: 't2', catalogId: 'tree-peach', position: { x: 11, y: 30 }, rotation: 0, elevation: 0, locked: false });
    const pairs = evaluateMap(state);
    expect(pairs.decoration.hints.join(' ')).toMatch(/stray dot/);
    expect(pairs.decoration.hints.join(' ')).not.toMatch(/\(10,30\)/);
  });

  it('objects pressed against a locked structure trip the apron hint; roads do not', () => {
    const state = makeState(40, 40);
    state.objects.set('plaza', { id: 'plaza', catalogId: '__plaza__', position: { x: 15, y: 15 }, rotation: 0, elevation: 0, width: 6, height: 6, locked: true });
    const clean = evaluateMap(state);
    expect(clean.decoration.hints.join(' ')).not.toMatch(/flush/);
    for (let i = 0; i < 6; i++) {
      state.objects.set(`t${i}`, { id: `t${i}`, catalogId: 'tree-peach', position: { x: 15 + i, y: 14 }, rotation: 0, elevation: 0, locked: false });
    }
    const flush = evaluateMap(state);
    expect(flush.decoration.hints.join(' ')).toMatch(/flush against the locked structure/);
  });
});

describe('evaluateMap: degenerate maps', () => {
  it('never emits NaN scores, even on a zero-size map', () => {
    const r = evaluateMap(makeState(0, 0));
    for (const d of Object.values(r)) expect(Number.isNaN(d.score)).toBe(false);
  });
});

describe('evaluateMap: buildings/decoration/roads + scorecard', () => {
  it('an empty map lists missing catalog buildings', () => {
    const r = evaluateMap(makeState(20, 20));
    expect(r.buildings.score).toBe(0);
    expect(r.buildings.hints.join(' ')).toMatch(/missing/i);
    expect(r.decoration.score).toBe(0);
    expect(r.roads.score).toBe(0);
  });

  it('renderScorecard emits one line per dimension with scores', () => {
    const text = renderScorecard(evaluateMap(makeState(20, 20)));
    for (const k of ['connectivity', 'terrainInterest', 'water', 'buildings', 'decoration', 'roads', 'silhouette']) {
      expect(text).toContain(k);
    }
    expect(text).toMatch(/10\/10/); // connectivity is perfect on an empty map
    expect(text).toMatch(/OVERALL: \d+(\.\d+)?\/10/);
  });
});

describe('evaluateMap: silhouette (edge treatment)', () => {
  it('is neutral with no hints on a cliff-less map', () => {
    const r = evaluateMap(makeState(20, 20)).silhouette;
    expect(r.score).toBe(5);
    expect(r.hints).toEqual([]);
  });

  it('scores raw square blocks low and names the untrimmed corners', () => {
    const state = makeState(24, 24);
    // two 8x8 raw mountain blocks -> 8 convex corners, all square
    for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = 13; y <= 20; y++) for (let x = 13; x <= 20; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const r = evaluateMap(state).silhouette;
    expect(r.score).toBeLessThanOrEqual(4);
    expect(r.hints.join(' ')).toMatch(/raw squares/i);
  });

  it('rewards trimmed convex corners', () => {
    const state = makeState(24, 24);
    for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    // trim the four convex corners: Corners order [NW, NE, SW, SE]
    state.cells[2]![2]!.terrain!.corners = ['fan', 'square', 'square', 'square'] as Corners;
    state.cells[2]![9]!.terrain!.corners = ['square', 'fan', 'square', 'square'] as Corners;
    state.cells[9]![2]!.terrain!.corners = ['square', 'square', 'fan', 'square'] as Corners;
    state.cells[9]![9]!.terrain!.corners = ['square', 'square', 'square', 'fan'] as Corners;
    const r = evaluateMap(state).silhouette;
    expect(r.score).toBeGreaterThanOrEqual(8);
  });

  it('flags a dead-straight long cliff wall', () => {
    const state = makeState(24, 24);
    for (let x = 2; x <= 19; x++) setTerrain(state, x, 10, TerrainType.Mountain, 1);
    const r = evaluateMap(state).silhouette;
    expect(r.hints.join(' ')).toMatch(/dead-straight/i);
  });
});

describe('scorecard trends (the feedback signal)', () => {
  it('renderScorecard shows per-dimension trend vs a previous report', () => {
    const state = makeState(20, 20);
    const before = evaluateMap(state);
    for (let y = 5; y <= 8; y++) for (let x = 5; x <= 12; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const after = evaluateMap(state);
    const text = renderScorecard(after, before);
    expect(text).toMatch(/water: \d+\/10 \(was 0, improved\)/);
  });
});
