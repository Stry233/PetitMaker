/**
 * Each sketch family fires on a map that has its feature, draws inside that map, and a map with nothing
 * to say yields an empty list. Fixtures start from the shipped island and are built through the real
 * executor and rule registry, so none describes a map the app would refuse.
 */
import { describe, it, expect } from 'vitest';

import { CommandExecutor } from '../../../core/commands/command-executor';
import { createGrid } from '../../../core/model/grid-model';
import { CommandType, TerrainType, type GridState, type MacroCoord, type MapTemplate } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { createDefaultRegistry } from '../../../rules';
import { getPlaceableByCategory } from '../../../state/catalog';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { proposeSketches, type SketchProposal } from '../../../agent/tools/sketch';
import { createExecutor } from '../../../state/executor';
import { ItemCategory } from '../../../config/catalog/categories';

function executorFor(state: GridState): CommandExecutor {
  return createExecutor(state, createDefaultRegistry());
}

function rect(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) out.push({ x, y });
  return out;
}

/** Paints through the real executor and throws if the rules refuse, so a fixture never silently
 *  lacks its feature. */
function paint(state: GridState, cells: MacroCoord[], type: TerrainType, elevation: number): void {
  const ok = executorFor(state).execute({
    type: CommandType.PaintTerrain, cells, terrainType: type, elevation,   });
  if (!ok.success) throw new Error(`the fixture's paint was refused: ${ok.errors?.[0]?.message ?? ''}`);
}

function place(state: GridState, catalogId: string, x: number, y: number, id: string): void {
  const ok = executorFor(state).execute({
    type: CommandType.PlaceObject,
    object: { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 },
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

/** The nearest open grass square of the real template, searched outwards from `from`, with one cell
 *  of margin up-left for the micro-block bleed V-ZONE-01 refuses (see `unroadedBay`). */
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

const kinds = (ideas: readonly SketchProposal[]): string[] => ideas.map((idea) => idea.kind);
const of = (ideas: readonly SketchProposal[], kind: string): SketchProposal | undefined =>
  ideas.find((idea) => idea.kind === kind);

/** Every point a figure draws, so "inside the map" can be asked of the whole family at once. */
function points(idea: SketchProposal): { x: number; y: number }[] {
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

function inside(state: GridState, idea: SketchProposal): boolean {
  return points(idea).every((p) => p.x >= 0 && p.y >= 0
    && p.x <= state.template.width && p.y <= state.template.height);
}

/**
 * The island with its southern end raised one tier and a short path laid in the north: the step cuts
 * the south into its own region (`segmentRegions` splits at steps as well as water) with no pavement.
 */
function unroadedBay(): GridState {
  const state = createGridState(getMapTemplate('hexia'));
  const { width, height } = state.template;
  const terrace: MacroCoord[] = [];
  for (let y = Math.round(height * 0.72); y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A painted block reaches half a cell up-left of its cell, and V-ZONE-01 refuses the whole
      // command if one bleeds onto unbuildable ground, so the terrace keeps one cell clear on that side.
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

/** The island as it opens: nothing built, nothing painted. */
function flatEmpty(): GridState {
  return createGridState(getMapTemplate('hexia'));
}

/** A four-cell river (inside the game's 3 to 6 bridge span) with level grass banks, and three trees
 *  standing close together. */
function riverAndGrove(): GridState {
  const state = createGridState(getMapTemplate('hexia'));
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

/** A template with no land at all. */
function openSea(): GridState {
  const template: MapTemplate = {
    id: 'sea', name: { en: 'Open sea' }, width: 40, height: 40,
    zones: Array.from({ length: 40 }, () => Array.from({ length: 40 }, () => CellZone.Void)),
    landmarks: [],
  };
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

describe('the lane: a place with no road down to it', () => {
  it('proposes one from the plaza to the far end of the cut-off ground', () => {
    const state = unroadedBay();
    const ideas = proposeSketches(state);
    const lane = of(ideas, 'lane');
    expect(kinds(ideas), 'the bay map offers a lane').toContain('lane');
    expect(lane && inside(state, lane)).toBe(true);
    expect(lane!.art.shape).toBe('lane');
    const art = lane!.art as { shape: 'lane'; from: { x: number; y: number }; to: { x: number; y: number } };
    expect(art.from).not.toEqual(art.to);
    // The caption's number is the lane's length.
    expect(lane!.params.n).toBeGreaterThan(0);
  });

  it('says nothing about a road where the ground it would reach is already paved to', () => {
    const state = unroadedBay();
    const road = getPlaceableByCategory(ItemCategory.Road)[0]!;
    const lane = of(proposeSketches(state), 'lane')!;
    const art = lane.art as { to: { x: number; y: number } };
    // The landing may sit against the step, where a tile is refused as not flat; pave the nearest
    // cell that accepts one.
    let laid = 0;
    for (let r = 0; r <= 4 && laid === 0; r++) {
      for (let dy = -r; dy <= r && laid === 0; dy++) {
        for (let dx = -r; dx <= r && laid === 0; dx++) {
          const x = art.to.x + dx; const y = art.to.y + dy;
          const ok = executorFor(state).execute({
            type: CommandType.PlaceObject,
            object: { id: `patch-${x}-${y}`, catalogId: road.id, position: { x, y }, rotation: 0, elevation: 0 },
          });
          if (ok.success) laid++;
        }
      }
    }
    expect(laid, 'the fixture paved something').toBeGreaterThan(0);
    const after = of(proposeSketches(state), 'lane');
    // The family may decline or pick another place, but not keep proposing the one now paved.
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
    // The centre stands on buildable ground.
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
  it('carries its readings as finite numbers', () => {
    for (const state of [unroadedBay(), flatEmpty(), riverAndGrove()]) {
      for (const idea of proposeSketches(state)) {
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
