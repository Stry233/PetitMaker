/**
 * What a generation confined to a painted REGION may touch, and what taking it back may take.
 *
 * Both show up as one symptom — "generating in a new region deletes the placements in the old one, and
 * Clear wipes the map" — and they are two separate faults:
 *
 *   1. AN ID DERIVED FROM THE SEED (`gen-<seed>-<n>`) is not unique across runs: the panel's seed does
 *      not change between clicks, so a second run reissues the first run's ids. `state.objects` is keyed
 *      by id, so a reissue REPLACES an object elsewhere on the map, and the 2D layer (which only adds
 *      ids it has never seen) keeps the sprite where it was — the new region looks empty and the old one
 *      empties.
 *   2. CLEAR READING THE CURRENT PAINTED REGION, which a finished run has already dropped, falls back
 *      to the whole map and takes the person's own work with it.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { createGrid, createPlazaObject, getCell, isBuildableZone } from '../../../core/model/grid-model';
import { generateTerrain, clearAllObjects, clearAllTerrain } from '../../../tools/generation/terrain-generator';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { ProvSource } from '../../../core/provenance/types';
import type {
  Command, EditorEvents, GenerateConfig, GridState, MacroCoord, MapTemplate, PlacedObject,
} from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

function realState(): GridState {
  const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells: createGrid(template), objects, lockedLayers: new Set() };
}

/** The buildable cells of a square centred on (cx, cy). */
function square(state: GridState, cx: number, cy: number, half: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
    const c = getCell(state.cells, x, y);
    if (c && isBuildableZone(c.zone)) out.push({ x, y });
  }
  return out;
}

/** The roomiest open grass on one side of the map — a region the generator can actually fill. */
function grassSpot(state: GridState, side: 'w' | 'e'): MacroCoord {
  const { width, height } = state.template;
  let best = { x: 0, y: 0, n: -1 };
  for (let y = 16; y < height - 16; y += 4) for (let x = 16; x < width - 16; x += 4) {
    if (side === 'w' ? x > width * 0.4 : x < width * 0.6) continue;
    let n = 0;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const c = getCell(state.cells, x + dx, y + dy);
      if (c && isBuildableZone(c.zone) && !c.terrain) n++;
    }
    if (n > best.n) best = { x, y, n };
  }
  return { x: best.x, y: best.y };
}

/** One Generate run, as the panel does it: clear the scope, then build — under the Procedural
 *  source, which is what marks the result as the generator's work. */
async function generate(state: GridState, exec: CommandExecutor, seed: number, region: MacroCoord[] | null) {
  const config = {
    algorithm: 'designed', mode: 'mixed', maxElevation: 8, richness: 1, seed, region,
  } as GenerateConfig;
  const exe = (c: Command) => exec.execute(c);
  exec.pushSource({ source: ProvSource.Procedural, tool: 'generate', procedural: { seed, algorithm: 'designed', configHash: '' } });
  try {
    clearAllObjects(state, exe, region ?? undefined);
    clearAllTerrain(state, exe, region ?? undefined);
    return await exec.runSilentlyAsync(async () => {
      const t = generateTerrain(config, state, exe, exec.getRegistry());
      return t;
    });
  } finally {
    exec.popSource();
  }
}

/** The objects a run left standing, by id → what they are. */
function snapshot(state: GridState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, o] of state.objects) if (!o.locked) out.set(id, `${o.catalogId}@${o.position.x},${o.position.y}`);
  return out;
}

describe('generating into a region', () => {
  it('leaves an earlier region\'s placements exactly as they were', async () => {
    const state = realState();
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const west = grassSpot(state, 'w'), east = grassSpot(state, 'e');
    const regionA = square(state, west.x, west.y, 14);
    const regionB = square(state, east.x, east.y, 14);
    const inB = new Set(regionB.map((c) => `${c.x},${c.y}`));

    await generate(state, exec, 42, regionA);
    const afterA = snapshot(state);
    expect(afterA.size, 'the first region got placements').toBeGreaterThan(20);

    await generate(state, exec, 42, regionB);   // the panel's seed is the same on every click
    const afterB = snapshot(state);
    const lost = [...afterA].filter(([id, what]) => !inB.has(what.slice(what.indexOf('@') + 1)) && afterB.get(id) !== what);
    expect(lost.map(([, what]) => what).slice(0, 5)).toEqual([]);
  }, 120000);

  it('never reissues an id a standing object already holds', async () => {
    const state = realState();
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const spot = grassSpot(state, 'w');
    const held = new Map<string, string>();
    for (const seed of [42, 42, 7]) {
      await generate(state, exec, seed, square(state, spot.x, spot.y, 10));
      const now = snapshot(state);
      // An id present in both runs must still be the SAME object: a reissue would have moved it.
      const stolen = [...now].filter(([id, what]) => held.has(id) && held.get(id) !== what);
      expect(stolen.slice(0, 5)).toEqual([]);
      for (const [id, what] of now) held.set(id, what);
    }
  }, 120000);
});

describe('clearing after a generation', () => {
  it('takes back the generator\'s work and leaves the map\'s own', async () => {
    const state = realState();
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const west = grassSpot(state, 'w'), east = grassSpot(state, 'e');
    const region = square(state, west.x, west.y, 14);

    await generate(state, exec, 42, region);
    const genCount = [...state.objects.values()].filter((o) => !o.locked).length;
    expect(genCount, 'the region got placements').toBeGreaterThan(20);

    // Somebody's own work, in both places: a tree inside the region and one outside it.
    // Both go down through the ordinary command path, so they are recorded as a person's.
    const inRegion = new Set(region.map((c) => `${c.x},${c.y}`));
    const plant = (near: MacroCoord, want: boolean): PlacedObject => {
      for (let r = 0; r < 40; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
        const p = { x: near.x + dx!, y: near.y + dy! };
        if (inRegion.has(`${p.x},${p.y}`) !== want) continue;
        const o: PlacedObject = { id: generateObjectId(), catalogId: 'tree-apple', position: p, rotation: 0, elevation: 0 };
        if (exec.execute(objectPlacementCommand(o)).success) return o;
      }
      throw new Error('nowhere to plant');
    };
    const mine = [plant(west, true), plant(east, false)];

    // Clear, as the panel does it after a run: the remembered region, sparing what a person made.
    const prov = exec.getProvenanceTracker();
    const exe = (c: Command) => exec.execute(c);
    clearAllObjects(state, exe, region, (o) => prov.objectAuthor(o.id) === 'human');
    clearAllTerrain(state, exe, region, (x, y) => prov.cellAuthor(x, y) === 'human');

    for (const o of mine) expect(state.objects.has(o.id), `the tree at ${o.position.x},${o.position.y} survived`).toBe(true);
    const left = [...state.objects.values()].filter((o) => !o.locked && !mine.some((m) => m.id === o.id));
    expect(left.filter((o) => inRegion.has(`${o.position.x},${o.position.y}`))).toEqual([]);
  }, 120000);

  it('scrubs a map that carries no authorship, as it always did', () => {
    // A map loaded from a save without provenance: nothing is anybody's, so nothing is spared.
    const state = realState();
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const spot = grassSpot(state, 'w');
    const obj: PlacedObject = { id: 'loaded-1', catalogId: 'tree-apple', position: spot, rotation: 0, elevation: 0 };
    state.objects.set(obj.id, obj);   // straight into the map, no command → no taint
    const prov = exec.getProvenanceTracker();
    clearAllObjects(state, (c: Command) => exec.execute(c), undefined, (o) => prov.objectAuthor(o.id) === 'human');
    expect(state.objects.has('loaded-1')).toBe(false);
  });
});
