/**
 * propose.test.ts — the sketch proposals, over REAL maps.
 *
 * EVERY FIXTURE HERE IS THE SHIPPED ISLAND. `createBlankGridState('hexia')` is the same state the
 * editor cold-starts on (the real template's zones, the real locked plaza), and everything laid on
 * top of it goes through the real `CommandExecutor` with the real rule registry — so a fixture
 * cannot describe a map the app would refuse to build. A hand-typed grid would let an analyser pass
 * against a shape no map has.
 *
 * WHAT IS BEING PINNED is that each family fires on the map that HAS its feature, that its geometry
 * lands on the map it is about, and that a map with nothing to say yields nothing at all: the card's
 * whole honesty rests on the empty list being reachable.
 */
import { describe, it, expect } from 'vitest';

import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createGrid } from '../../../core/model/grid-model';
import {
  CellZone, CommandType, ItemCategory, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type MapTemplate,
} from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { getPlaceableByCategory } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { createBlankGridState } from '../../../io/share/codec/blank-grid';
import { proposeSketches, type SketchIdea } from '../../../ui/agent/sketchbook/propose';

function executorFor(state: GridState): CommandExecutor {
  return new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
}

function rect(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push({ x, y });
  return out;
}

/** Paints through the real executor and REFUSES TO CONTINUE if the rules said no: a fixture whose
 *  water never landed would test the analyser against a map it never built. */
function paint(state: GridState, cells: MacroCoord[], type: TerrainType, elevation: number): void {
  const ok = executorFor(state).execute({
    type: CommandType.PaintTerrain, cells, terrainType: type, elevation, timestamp: 0,
  });
  if (!ok.success) throw new Error(`the fixture's paint was refused: ${ok.errors?.[0]?.message ?? ''}`);
}

function place(state: GridState, catalogId: string, x: number, y: number, id: string): void {
  const ok = executorFor(state).execute({
    type: CommandType.PlaceObject,
    object: { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 },
    loadValue: 0,
    timestamp: 0,
  });
  if (!ok.success) throw new Error(`the fixture's placement was refused: ${ok.errors?.[0]?.message ?? ''}`);
}

/** Whether a `size` x `size` square from (x,y) is untouched buildable grass on the real template. */
function allGrass(state: GridState, x: number, y: number, size: number): boolean {
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const cell = state.cells[y + j]?.[x + i];
      if (!cell || cell.zone !== CellZone.Grass || cell.terrain) return false;
    }
  }
  return true;
}

/** A square of the real template that is buildable Grass, searched from a starting point outwards,
 *  so a fixture names a place the island actually has rather than a coordinate that happens to work.
 *  One cell of margin UP-LEFT, for the same micro-block bleed the ridge keeps off. */
function grassNear(state: GridState, from: MacroCoord, want: number): MacroCoord {
  const { width, height } = state.template;
  for (let r = 0; r < Math.max(width, height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = from.x + dx; const y = from.y + dy;
        if (x < 1 || y < 1 || x + want > width || y + want > height) continue;
        if (allGrass(state, x - 1, y - 1, want + 1)) return { x, y };
      }
    }
  }
  throw new Error('the template has no open grass square that size');
}

const kinds = (ideas: readonly SketchIdea[]): string[] => ideas.map((idea) => idea.kind);
const of = (ideas: readonly SketchIdea[], kind: string): SketchIdea | undefined =>
  ideas.find((idea) => idea.kind === kind);

/** Every point a figure draws, so "inside the map" can be asked of the whole family at once. */
function points(idea: SketchIdea): { x: number; y: number }[] {
  const art = idea.art;
  if (art.shape === 'lane') return [art.from, art.via, art.to];
  if (art.shape === 'pond') {
    return [{ x: art.cx - art.rx, y: art.cy - art.ry }, { x: art.cx + art.rx, y: art.cy + art.ry }];
  }
  if (art.shape === 'bridge') {
    return [{ x: art.x, y: art.y }, { x: art.x + art.w, y: art.y + art.h },
      ...art.approach.flatMap(([a, b]) => [a, b])];
  }
  return art.pips.map((pip) => ({ x: pip.x, y: pip.y }));
}

function inside(state: GridState, idea: SketchIdea): boolean {
  return points(idea).every((p) => p.x >= 0 && p.y >= 0
    && p.x <= state.template.width && p.y <= state.template.height);
}

/* ── the three maps ─────────────────────────────────────────── */

/**
 * GROUND WITH NO ROAD UP TO IT: the real island with its southern end raised one tier, and a lane of
 * real path tiles laid in the north. The terrace is what makes the southern ground a place of its
 * own — `segmentRegions` cuts a region at a step as well as at water — and the pavement is only ever
 * on the other side of the step. Raised rather than flooded because a channel cut to the coast is
 * water the zone rule refuses, and a fixture may not build what the app would not.
 */
function unroadedBay(): GridState {
  const state = createBlankGridState('hexia');
  const { width, height } = state.template;
  const terrace: MacroCoord[] = [];
  for (let y = Math.round(height * 0.72); y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A painted block renders half a cell UP-LEFT of its zone cell, so V-ZONE-01 refuses a paint
      // whose micro-block bleeds onto unbuildable ground — and refuses the whole command with it.
      // The terrace therefore keeps one cell clear of the zone boundary on that side.
      if (allGrass(state, x - 1, y - 1, 2)) terrace.push({ x, y });
    }
  }
  paint(state, terrace, TerrainType.Mountain, 1);

  const road = getPlaceableByCategory(ItemCategory.Road)[0]!;
  const start = grassNear(state, { x: Math.round(width / 2), y: Math.round(height * 0.3) }, 1);
  for (let k = 0; k < 6; k++) {
    place(state, road.id, start.x + k, start.y, `road-${k}`);
  }
  return state;
}

/** THE ISLAND AS IT OPENS: nothing built, nothing painted. One flat empty expanse. */
function flatEmpty(): GridState {
  return createBlankGridState('hexia');
}

/**
 * A RIVER WITH LEVEL BANKS, and a stand of three trees: the two features the last two families read.
 * The river is four cells wide (inside the game's own 3-6 span rule) with untouched grass on each
 * side, and the trees stand within a few cells of each other.
 */
function riverAndGrove(): GridState {
  const state = createBlankGridState('hexia');
  const { width, height } = state.template;
  const at = grassNear(state, { x: Math.round(width * 0.3), y: Math.round(height * 0.4) }, 12);
  paint(state, rect(at.x + 4, at.y, at.x + 7, at.y + 11), TerrainType.Water, 0);

  const tree = getPlaceableByCategory(ItemCategory.Tree)[0]!;
  const grove = grassNear(state, { x: Math.round(width * 0.62), y: Math.round(height * 0.62) }, 8);
  place(state, tree.id, grove.x, grove.y, 'tree-a');
  place(state, tree.id, grove.x + 3, grove.y + 1, 'tree-b');
  place(state, tree.id, grove.x + 1, grove.y + 4, 'tree-c');
  return state;
}

/** A template that is all sea: no land at all, which is the map that must say nothing. */
function openSea(): GridState {
  const template: MapTemplate = {
    id: 'sea', name: { en: 'Open sea' }, width: 40, height: 40,
    zones: Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => CellZone.Void)),
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 },
  };
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
}

/* ── what each map offers ───────────────────────────────────── */

describe('the lane: a place with no road down to it', () => {
  it('proposes one from the plaza to the far end of the cut-off ground', () => {
    const state = unroadedBay();
    const ideas = proposeSketches(state);
    const lane = of(ideas, 'lane');
    expect(kinds(ideas), 'the bay map offers a lane').toContain('lane');
    expect(lane && inside(state, lane)).toBe(true);
    expect(lane!.art.shape).toBe('lane');
    // It comes FROM somewhere paved (the plaza is the map's own) and GOES somewhere that is not.
    const art = lane!.art as { shape: 'lane'; from: { x: number; y: number }; to: { x: number; y: number } };
    expect(art.from).not.toEqual(art.to);
    // The reading in the caption is the size of the place it is about, not a decoration.
    expect(lane!.params.n).toBeGreaterThan(0);
  });

  it('says nothing about a road where the ground it would reach is already paved to', () => {
    const state = unroadedBay();
    // Pave THROUGH the channel: the southern ground now has a made surface at its edge.
    const road = getPlaceableByCategory(ItemCategory.Road)[0]!;
    const lane = of(proposeSketches(state), 'lane')!;
    const art = lane.art as { to: { x: number; y: number } };
    // The landing may sit against the step, where a tile is refused for not being flat — which is
    // the rules answering honestly rather than the fixture failing. Take the first ground that
    // accepts one.
    let laid = 0;
    for (let r = 0; r <= 4 && laid === 0; r++) {
      for (let dy = -r; dy <= r && laid === 0; dy++) {
        for (let dx = -r; dx <= r && laid === 0; dx++) {
          const x = art.to.x + dx; const y = art.to.y + dy;
          const ok = executorFor(state).execute({
            type: CommandType.PlaceObject,
            object: { id: `patch-${x}-${y}`, catalogId: road.id, position: { x, y }, rotation: 0, elevation: 0 },
            loadValue: 0,
            timestamp: 0,
          });
          if (ok.success) laid++;
        }
      }
    }
    expect(laid, 'the fixture paved something').toBeGreaterThan(0);
    const after = of(proposeSketches(state), 'lane');
    // Either the family declines, or it has found a DIFFERENT place: what it may not do is keep
    // proposing a road to ground a road now reaches.
    if (after) expect((after.art as { to: { x: number; y: number } }).to).not.toEqual(art.to);
  });
});

describe('the pond: a flat empty expanse', () => {
  it('proposes one at the deepest point of the island\'s own open ground', () => {
    const state = flatEmpty();
    const ideas = proposeSketches(state);
    const pond = of(ideas, 'pond');
    expect(kinds(ideas), 'the empty island offers a pond').toContain('pond');
    expect(pond && inside(state, pond)).toBe(true);
    const art = pond!.art as { shape: 'pond'; cx: number; cy: number; rx: number; ry: number };
    expect(art.rx).toBeGreaterThanOrEqual(2);
    expect(art.ry).toBeGreaterThanOrEqual(2);
    // The centre stands on the island's buildable ground, which is the whole claim the caption makes.
    expect(state.cells[Math.floor(art.cy)]?.[Math.floor(art.cx)]?.zone).toBe(CellZone.Grass);
  });
});

describe('the bridge: two level banks across a water run', () => {
  it('proposes a deck at a span the game itself allows, with an approach on each bank', () => {
    const state = riverAndGrove();
    const ideas = proposeSketches(state);
    const bridge = of(ideas, 'bridge');
    expect(kinds(ideas), 'the river map offers a bridge').toContain('bridge');
    expect(bridge && inside(state, bridge)).toBe(true);
    const art = bridge!.art as {
      shape: 'bridge'; x: number; y: number; w: number; h: number;
      approach: readonly [{ x: number; y: number }, { x: number; y: number }][];
    };
    const span = Math.max(art.w, art.h);
    expect(span).toBeGreaterThanOrEqual(3);
    expect(span).toBeLessThanOrEqual(6);
    expect(bridge!.params.n).toBe(span);
    expect(art.approach).toHaveLength(2);
    // The deck stands ON the water it crosses.
    expect(state.cells[art.y]?.[art.x]?.terrain?.type).toBe(TerrainType.Water);
  });

  it('says nothing about a bridge on a map with no water at all', () => {
    expect(kinds(proposeSketches(flatEmpty()))).not.toContain('bridge');
  });
});

describe('the grove: a stand thin enough to thicken', () => {
  it('pips the trees that stand there and the ground beside them', () => {
    const state = riverAndGrove();
    const ideas = proposeSketches(state);
    const grove = of(ideas, 'grove');
    expect(kinds(ideas), 'the three-tree map offers a grove').toContain('grove');
    expect(grove && inside(state, grove)).toBe(true);
    expect(grove!.params.n).toBe(3);
    const art = grove!.art as { shape: 'grove'; pips: readonly { x: number; y: number; standing: boolean }[] };
    expect(art.pips.filter((pip) => pip.standing)).toHaveLength(3);
    // Every standing pip is on a tree the map really holds.
    const trees = [...state.objects.values()].filter((o) => o.catalogId.length > 0 && !o.locked);
    for (const pip of art.pips.filter((p) => p.standing)) {
      expect(trees.some((o) => Math.floor(o.position.x) === Math.floor(pip.x)
        && Math.floor(o.position.y) === Math.floor(pip.y))).toBe(true);
    }
  });

  it('says nothing about a grove on a map with no trees', () => {
    expect(kinds(proposeSketches(flatEmpty()))).not.toContain('grove');
  });
});

describe('a map with nothing to say', () => {
  it('offers no sketches at all for open sea, which is what leaves the card unrendered', () => {
    expect(proposeSketches(openSea())).toEqual([]);
  });
});

describe('what every idea carries', () => {
  it('names both its lines and its direction as keys, and its readings as numbers', () => {
    for (const state of [unroadedBay(), flatEmpty(), riverAndGrove()]) {
      for (const idea of proposeSketches(state)) {
        expect(idea.capKey, idea.kind).toMatch(/^agent3\.sketch_/);
        expect(idea.orderKey, idea.kind).toMatch(/^agent3\.sketch_/);
        expect(idea.dirKey, idea.kind).toMatch(/^agent3\.sketch_dir_/);
        for (const value of Object.values(idea.params)) {
          expect(typeof value, idea.kind).toBe('number');
          expect(Number.isFinite(value), idea.kind).toBe(true);
        }
      }
    }
  });

  it('answers the same map the same way, so the card\'s rotation is a clock and not a shuffle', () => {
    const state = riverAndGrove();
    expect(proposeSketches(state)).toEqual(proposeSketches(state));
  });
});
