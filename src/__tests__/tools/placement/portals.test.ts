import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeCtx } from '../../../tools/placement/object';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import { scanPortals, routeRegions, type Portal } from '../../../tools/placement/portals';
import { TerrainType, type EditorEvents, type MacroCoord } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

const W = 40;
// A 40x40 grass map split by a 4-wide vertical water ford (x 18..21), with a tier-1 plateau (x 28..33,
// y 10..15) embedded in the right ground region. → a bridge portal (left↔right) + a ramp portal (right↔plateau).
function setup() {
  const state = makeState(W, 40);
  for (let y = 0; y < 40; y++) for (let x = 18; x <= 21; x++) setTerrain(state, x, y, TerrainType.Water, 0);
  for (let y = 10; y <= 15; y++) for (let x = 28; x <= 33; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  const a = analyzeTerrain(state);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ctx = makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), 1);
  return { a, ...scanPortals(ctx, a) };
}

describe('scanPortals', () => {
  it('finds a bridge portal across the ford and a ramp portal up to the plateau', () => {
    const { a, portals, regionAdj } = setup();
    const bridges = portals.filter((p) => p.kind === 'bridge');
    const ramps = portals.filter((p) => p.kind === 'ramp');
    expect(bridges.length, 'bridge portals').toBeGreaterThan(0);
    expect(ramps.length, 'ramp portals').toBeGreaterThan(0);

    const b = bridges[0]!;
    expect(b.regionA).not.toBe(b.regionB);
    expect(a.open[b.approachA.y * W + b.approachA.x]).toBe(1); // approaches are buildable open cells
    expect(a.open[b.approachB.y * W + b.approachB.x]).toBe(1);
    expect(a.regionElev[b.regionA]).toBe(0);                   // both banks are ground level
    expect(a.regionElev[b.regionB]).toBe(0);

    const r = ramps[0]!;
    expect(Math.abs(a.regionElev[r.regionA]! - a.regionElev[r.regionB]!)).toBe(1); // a one-tier step
    expect(a.open[r.approachA.y * W + r.approachA.x]).toBe(1);
    expect(a.open[r.approachB.y * W + r.approachB.x]).toBe(1);

    // regionAdj lists each portal under both of its regions.
    expect(regionAdj.get(b.regionA)).toContain(b);
    expect(regionAdj.get(r.regionB)).toContain(r);
  });

  it('routeRegions returns the cheapest portal sequence (Dijkstra over the region graph)', () => {
    const c: MacroCoord = { x: 0, y: 0 };
    const p01: Portal = { kind: 'ramp', regionA: 0, regionB: 1, anchor: c, approachA: c, approachB: c, cost: 4 };
    const p12: Portal = { kind: 'bridge', regionA: 1, regionB: 2, anchor: c, approachA: c, approachB: c, cost: 6 };
    const adj = new Map<number, Portal[]>([[0, [p01]], [1, [p01, p12]], [2, [p12]]]);
    expect(routeRegions(0, 2, adj)).toEqual([p01, p12]);
    expect(routeRegions(2, 0, adj)).toEqual([p12, p01]);
    expect(routeRegions(0, 0, adj)).toEqual([]);
    expect(routeRegions(0, 5, adj)).toBeNull(); // region 5 not in the graph → unreachable
  });
});
