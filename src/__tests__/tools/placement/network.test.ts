import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeCtx, tryPlace } from '../../../tools/placement/object';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import { scanPortals } from '../../../tools/placement/portals';
import { buildNetwork, type Node } from '../../../tools/placement/network';
import { getCatalogByCategory } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { ItemCategory, TerrainType, type EditorEvents, type MacroCoord } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

const W = 80, H = 80;
const idOf = (cat: ItemCategory) => new Set(getCatalogByCategory(cat).map((i) => i.id));
const roadIds = idOf(ItemCategory.Road), bridgeIds = idOf(ItemCategory.Bridge), rampIds = idOf(ItemCategory.Ramp);

// A left ground region + a right ground region split by a 4-wide vertical wall (a bridgeable water ford
// in the interior, capped top & bottom by elev-1 mountain so the water has no uncapped faces and the two
// grounds stay separate), plus a tier-1 plateau inside the left region → three regions joined by
// one bridge + one ramp.
function build() {
  const state = makeState(W, H);
  for (let y = 0; y < H; y++) for (let x = 38; x <= 41; x++) {
    if (y < 2 || y > H - 3) setTerrain(state, x, y, TerrainType.Mountain, 1); // caps (higher → no water face, non-walkable barrier)
    else setTerrain(state, x, y, TerrainType.Water, 0);
  }
  for (let y = 20; y <= 27; y++) for (let x = 10; x <= 17; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  return state;
}

describe('buildNetwork (region-portal router)', () => {
  it('connects hub + plateau hamlet + across-ford hamlet with a ramp + a bridge; rule-clean', () => {
    const state = build();
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), 7);
    const a = analyzeTerrain(state);
    const hub: MacroCoord = { x: 28, y: 40 }, plat: MacroCoord = { x: 13, y: 23 }, far: MacroCoord = { x: 60, y: 40 };
    for (const p of [hub, plat, far]) expect(tryPlace(ctx, 'building-stall', p.x, p.y), `stall@${p.x},${p.y}`).toBeTruthy();
    const reg = (p: MacroCoord) => a.region[p.y * W + p.x]!;
    const nodes: Node[] = [
      { kind: 'hub', pos: hub, region: reg(hub) },
      { kind: 'hamlet', pos: plat, region: reg(plat) },
      { kind: 'hamlet', pos: far, region: reg(far) },
    ];
    expect(new Set(nodes.map((n) => n.region)).size, 'three distinct regions').toBe(3);

    const { regionAdj } = scanPortals(ctx, a);
    buildNetwork(ctx, a, 1, nodes, regionAdj);
    expect(exec.commitStrokeGroup(0).length, 'rule-clean').toBe(0);

    const objs = [...state.objects.values()];
    expect(objs.filter((o) => bridgeIds.has(o.catalogId)).length, 'a bridge over the ford').toBeGreaterThan(0);
    expect(objs.filter((o) => rampIds.has(o.catalogId)).length, 'a ramp up the plateau').toBeGreaterThan(0);

    // Reachability: road ∪ bridge ∪ ramp cells (+ the connective hub core) form one 4-connected network
    // reaching every node. A crossing is enterable from its perimeter (you step off a ramp/bridge onto the
    // adjacent landing), so crossing footprints are dilated by one ring; roads are exact.
    const net = new Set<number>([hub.y * W + hub.x]);
    for (const o of objs) {
      const cross = bridgeIds.has(o.catalogId) || rampIds.has(o.catalogId);
      if (!cross && !roadIds.has(o.catalogId)) continue;
      const r = objectRect(o), pad = cross ? 1 : 0;
      for (let y = Math.floor(r.y) - pad; y < Math.ceil(r.y + r.h) + pad; y++) for (let x = Math.floor(r.x) - pad; x < Math.ceil(r.x + r.w) + pad; x++) if (x >= 0 && y >= 0 && x < W && y < H) net.add(y * W + x);
    }
    const adjNet = (p: MacroCoord): number => { // a net cell in p's 3x3 (door spurs may be diagonal)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = (p.y + dy) * W + (p.x + dx); if (net.has(i)) return i; }
      return -1;
    };
    const start = adjNet(hub);
    expect(start, 'hub reached by a road').toBeGreaterThanOrEqual(0);
    const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const seen = new Set<number>([start]), q = [start];
    while (q.length) { const i = q.pop()!, x = i % W, y = (i / W) | 0; for (const [dx, dy] of dirs) { const ni = (y + dy) * W + (x + dx); if (net.has(ni) && !seen.has(ni)) { seen.add(ni); q.push(ni); } } }
    for (const p of [plat, far]) { const ai = adjNet(p); expect(ai, `node@${p.x},${p.y} reached`).toBeGreaterThanOrEqual(0); expect(seen.has(ai), `node@${p.x},${p.y} connected to hub`).toBe(true); }
  });
});
