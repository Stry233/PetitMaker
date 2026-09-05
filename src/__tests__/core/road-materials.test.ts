/**
 * Different road materials never connect: in the game, two surfaces meet with a
 * hairline of ground between them, so for every connectivity question — which side a road's
 * drawing faces, whether a cell is an endpoint of its run, whether a cut is legal — a neighbour
 * of another material is no neighbour at all. A trimmed endpoint keeps its cut when a different
 * surface is laid beside it, and a cell walled in by foreign material is still cuttable, because
 * it is isolated within its OWN material's run.
 */
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ROAD_STATES, canonicalToActual, countRoadNeighbors, detectRoadConn,
} from '../../core/edge-cut/road-cut-states';
import { validateCut } from '../../core/edge-cut/cut-validator';
import { reconcileCuts } from '../../core/edge-cut/cut-reconcile';
import { ROAD_FEATHER, roadBodyPoints, roadBoundarySides, roadCutFeeds } from '../../core/edge-cut/road-shape';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { catalogLoadValue } from '../../state/catalog';
import { roadLookup } from '../../state/object-index';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import type { Corners, EditorEvents, GridState, PlacedObject } from '../../core/model/types';
import { CellZone } from '../../core/model/types';
import { makeState, makeExecutor, placeCmd } from '../rules/_helpers';

function addRoad(state: GridState, catalogId: string, x: number, y: number, corners?: Corners): PlacedObject {
  const road: PlacedObject = {
    id: `r-${catalogId}-${x}-${y}`, catalogId, position: { x, y }, rotation: 0, elevation: 0,
    ...(corners ? { corners: [...corners] as Corners } : {}),
  };
  state.objects.set(road.id, road);
  bumpObjectsVersion(state, { added: [road] });
  return road;
}

describe('road connectivity is per material', () => {
  it('a different material is not a connection side', () => {
    const state = makeState(20, 20);
    const dirt = addRoad(state, 'path-overgrown-dirt', 5, 5);
    addRoad(state, 'path-cobblestone', 4, 5);   // foreign on the left
    addRoad(state, 'path-overgrown-dirt', 6, 5);    // own material on the right
    expect(detectRoadConn(roadLookup(state), dirt)).toBe('right');
  });

  it('a different material does not count as a neighbour', () => {
    const state = makeState(20, 20);
    const dirt = addRoad(state, 'path-overgrown-dirt', 5, 5);
    addRoad(state, 'path-cobblestone', 4, 5);
    addRoad(state, 'path-cobblestone', 6, 5);
    addRoad(state, 'path-cobblestone', 5, 4);
    expect(countRoadNeighbors(roadLookup(state), dirt)).toBe(0);
  });

  it('a cell walled in by foreign material is cuttable as an isolated cell', () => {
    const state = makeState(20, 20);
    const dirt = addRoad(state, 'path-overgrown-dirt', 5, 5);
    addRoad(state, 'path-cobblestone', 4, 5);
    addRoad(state, 'path-cobblestone', 6, 5);
    const conn = detectRoadConn(roadLookup(state), dirt);
    for (let s = 1; s < CANONICAL_ROAD_STATES.length; s++) {
      const actual = canonicalToActual([...CANONICAL_ROAD_STATES[s]!], conn);
      expect(validateCut(state, roadLookup(state), 5, 5, 'road', actual), `state ${s}`).toBe(true);
    }
  });

  it('a trimmed endpoint keeps its cut when another material lands beside it — the reported repro', () => {
    const state = makeState(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) state.cells[y]![x]!.zone = CellZone.Grass;
    const exec = makeExecutor(state);
    // A two-cell dirt run; the right cell is an endpoint wearing the BR-fan cut.
    exec.execute(placeCmd({ id: 'a', catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 }, 10));
    exec.execute(placeCmd({
      id: 'b', catalogId: 'path-overgrown-dirt', position: { x: 6, y: 5 }, rotation: 0, elevation: 0,
      corners: [...CANONICAL_ROAD_STATES[1]!] as Corners,
    }, 10));
    // Another surface right beside the trimmed endpoint, then the stroke's reconcile pass.
    const start = exec.getUndoStackSize();
    exec.execute(placeCmd({ id: 'c', catalogId: 'path-cobblestone', position: { x: 7, y: 5 }, rotation: 0, elevation: 0 }, 10));
    expect(exec.commitStroke(start)).toEqual([]);
    expect(state.objects.get('b')?.corners, 'the cut survives the foreign neighbour')
      .toEqual(CANONICAL_ROAD_STATES[1]);
  });

  it('a coating arriving re-announces the road beside it, so both views redraw the boundary', () => {
    const state = makeState(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) state.cells[y]![x]!.zone = CellZone.Grass;
    const bus = new EventBus<EditorEvents>();
    const exec = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state), catalogLoadValue);
    exec.execute(placeCmd({ id: 'dirt', catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 }, 10));
    const announced: string[] = [];
    bus.on('objects-changed', (d) => { for (const o of d.added ?? []) announced.push(o.id); });
    exec.execute(placeCmd({ id: 'stone', catalogId: 'path-cobblestone', position: { x: 6, y: 5 }, rotation: 0, elevation: 0 }, 10));
    expect(announced).toContain('dirt');
  });

  it('the feather is the surface\'s own boundary, and lifts only where the surface continues', () => {
    // A road surface draws connected inside and FADES over ROAD_FEATHER at every edge where its
    // run ends — against grass and against another material alike. The seam between materials is
    // two fades meeting, not a special case.
    const state = makeState(20, 20);
    const a = addRoad(state, 'path-overgrown-dirt', 5, 5);
    const b = addRoad(state, 'path-overgrown-dirt', 6, 5);
    const c = addRoad(state, 'path-cobblestone', 7, 5);
    const roads = roadLookup(state);
    expect(roadBoundarySides(roads, a).e, 'inside the run: one unbroken surface').toBe(false);
    expect(roadBoundarySides(roads, a).w, 'against grass: the boundary fades').toBe(true);
    expect(roadBoundarySides(roads, b).e, 'against another material: the same fade').toBe(true);
    expect(roadBoundarySides(roads, c).w, 'and the other side fades too — the seam is their meeting').toBe(true);
    // The body outline insets by t along fading sides only, keeping its point count.
    const at0 = roadBodyPoints(roads, b, 0, 0, 1, 1, 0);
    const atF = roadBodyPoints(roads, b, 0, 0, 1, 1, ROAD_FEATHER);
    expect(atF).toHaveLength(at0.length);
    expect(Math.max(...atF.map((p) => p[0]))).toBeCloseTo(1 - ROAD_FEATHER, 6); // E fades
    expect(Math.min(...atF.map((p) => p[0]))).toBeCloseTo(0, 6);               // W continues, flush
  });

  it('a feeder\'s surface continues into the gap it feeds, unbroken', () => {
    // The fill in the cut tile's cell is the feeder's own material, so the shared cell line is
    // interior to that surface — no fade there.
    const state = makeState(20, 20);
    addRoad(state, 'path-overgrown-dirt', 5, 5, [...CANONICAL_ROAD_STATES[1]!] as Corners);
    addRoad(state, 'path-overgrown-dirt', 4, 5);
    const stone = addRoad(state, 'path-cobblestone', 6, 5);
    const roads = roadLookup(state);
    expect(roadBoundarySides(roads, stone).w, 'the feeder reaches the line flush').toBe(false);
  });

  it('the wrapping material FEEDS a cut tile\'s vacated area — the gamma half of the pair', () => {
    // A dirt endpoint wearing the BR fan (canonical, connected west): its vacated area touches
    // the E and S sides, and each half is fed by whatever foreign tile stands on ITS side.
    const state = makeState(20, 20);
    const cut = addRoad(state, 'path-overgrown-dirt', 5, 5, [...CANONICAL_ROAD_STATES[1]!] as Corners);
    addRoad(state, 'path-overgrown-dirt', 4, 5);
    addRoad(state, 'path-cobblestone', 6, 5);
    const one = roadCutFeeds(roadLookup(state), cut);
    expect(one, 'the E half alone is fed').toHaveLength(1);
    expect(one[0]!.feeders.map((w) => w.catalogId)).toEqual(['path-cobblestone']);
    const south = addRoad(state, 'path-cobblestone', 5, 6);
    const both = roadCutFeeds(roadLookup(state), cut);
    expect(both, 'one wrap of one material is one fill').toHaveLength(1);
    expect(both[0]!.feeders, 'both wraps are named — each side reads the fill as its own surface').toHaveLength(2);
    expect(roadBoundarySides(roadLookup(state), south).n, 'the south wrap reaches its fill flush').toBe(false);
  });

  it('two different materials each feed their own half of a fan', () => {
    const state = makeState(20, 20);
    const cut = addRoad(state, 'path-overgrown-dirt', 5, 5, [...CANONICAL_ROAD_STATES[1]!] as Corners);
    addRoad(state, 'path-overgrown-dirt', 4, 5);
    addRoad(state, 'path-cobblestone', 6, 5);
    addRoad(state, 'path-park-stone', 5, 6);
    const feeds = roadCutFeeds(roadLookup(state), cut);
    expect(feeds).toHaveLength(2);
    expect(new Set(feeds.flatMap((f) => f.feeders.map((w) => w.catalogId)))).toEqual(new Set(['path-cobblestone', 'path-park-stone']));
  });

  it('a triangle\'s feed stays all-or-nothing — its complement has no natural halves', () => {
    const state = makeState(20, 20);
    const cut = addRoad(state, 'path-overgrown-dirt', 5, 5, [...CANONICAL_ROAD_STATES[3]!] as Corners);
    addRoad(state, 'path-overgrown-dirt', 4, 5);
    addRoad(state, 'path-cobblestone', 6, 5);
    expect(roadCutFeeds(roadLookup(state), cut)).toHaveLength(0);
    addRoad(state, 'path-cobblestone', 5, 4);
    expect(roadCutFeeds(roadLookup(state), cut)).toHaveLength(1);
  });

  it('a feed needs level ground and a flush feeder edge', () => {
    const base = () => {
      const state = makeState(20, 20);
      const cut = addRoad(state, 'path-overgrown-dirt', 5, 5, [...CANONICAL_ROAD_STATES[1]!] as Corners);
      addRoad(state, 'path-overgrown-dirt', 4, 5);
      return { state, cut };
    };
    // A feeder standing a level away does not reach across the cliff.
    const b = base();
    const high = addRoad(b.state, 'path-cobblestone', 5, 6);
    high.elevation = 1;
    expect(roadCutFeeds(roadLookup(b.state), b.cut)).toHaveLength(0);
    // A feeder whose own cut vacates the facing edge presents no surface to continue: the stone
    // endpoint at (6,5) connects EAST to its own run, so its wedge keeps only that edge and its
    // W side — the one facing the gap — is vacated.
    const c = base();
    addRoad(c.state, 'path-cobblestone', 6, 5, [...CANONICAL_ROAD_STATES[5]!] as Corners);
    addRoad(c.state, 'path-cobblestone', 7, 5);
    expect(roadCutFeeds(roadLookup(c.state), c.cut)).toHaveLength(0);
  });

  it('the feed is the exact complement at its outline, retreating inward as it fades', () => {
    // Canonical BR fan in a unit cell at (0,0), connected west, both halves fed by one material.
    // At t = 0 the feed's arc IS the cut's arc — the two surfaces abut, and the seam is the two
    // fades glowing through. At t = ROAD_FEATHER the arc retreats inward, clamped to the cell.
    const state = makeState(20, 20);
    const cut = addRoad(state, 'path-overgrown-dirt', 5, 5, [...CANONICAL_ROAD_STATES[1]!] as Corners);
    addRoad(state, 'path-overgrown-dirt', 4, 5);
    addRoad(state, 'path-cobblestone', 6, 5);
    addRoad(state, 'path-cobblestone', 5, 6);
    const feeds = roadCutFeeds(roadLookup(state), cut);
    expect(feeds).toHaveLength(1);
    const r = (p: [number, number]) => Math.hypot(p[0], p[1]);
    const at0 = feeds[0]!.points(0, 0, 1, 1, 0);
    for (const p of at0) {
      expect(p[0]).toBeLessThanOrEqual(1 + 1e-9); // never outside the cell
      expect(p[1]).toBeLessThanOrEqual(1 + 1e-9);
      expect(r(p)).toBeGreaterThanOrEqual(1 - 1e-9); // never inside the cut's own arc
    }
    expect(at0.some((p) => p[0] === 1 && p[1] === 1), 'the far corner is fed').toBe(true);
    expect(at0.some((p) => Math.abs(r(p) - 1) < 1e-6), 'the outline touches the cut\'s arc').toBe(true);
    const atF = feeds[0]!.points(0, 0, 1, 1, ROAD_FEATHER);
    expect(atF).toHaveLength(at0.length);
    expect(atF.some((p) => Math.abs(r(p) - (1 + ROAD_FEATHER)) < 1e-6), 'the core sits one feather in').toBe(true);
  });

  it('the same material landing beside a trimmed endpoint still squares it — a middle cell holds no cut', () => {
    const state = makeState(20, 20);
    addRoad(state, 'path-overgrown-dirt', 5, 5);
    const trimmed = addRoad(state, 'path-overgrown-dirt', 6, 5, [...CANONICAL_ROAD_STATES[1]!] as Corners);
    addRoad(state, 'path-overgrown-dirt', 7, 5);
    const exec = makeExecutor(state);
    reconcileCuts([{ x: 7, y: 5 }], state, exec);
    expect(trimmed.corners?.every((c) => c === 'square') ?? true).toBe(true);
  });
});
