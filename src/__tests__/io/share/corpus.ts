// src/__tests__/io/share/corpus.ts — real-map-shaped corpus + adversarial "entropy bomb" builder
// for the PetitGlyph v2 codec measurement test (codec-measure.test.ts). NOT a test file itself —
// pure builders, reused by the measurement test and (later) the degradation matrix.
//
// `genOn`: a silent CommandExecutor stroke group drives generateTerrain, then one
// commitStrokeGroup collapses it to a single undo entry — exactly the live Generate path.
// It does NOT set `state.generation` (matching the existing pattern); callers that want the
// P_REPLAY predictor exercised set it manually afterward.
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState, makeTemplate } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { deserialize } from '../../../io/json-codec';
import { getMapTemplate, MAP_TEMPLATES } from '../../../config/maps';
import { createGrid, NEIGHBORS4 } from '../../../core/model/grid-model';
import { getPlaceableByCategory } from '../../../state/catalog';
import { makeRng } from '../../../core/model/rng';
import {
  CellZone,
  ItemCategory,
  TerrainType,
  type Command,
  type Corners,
  type CornerTrim,
  type EditorEvents,
  type GenerateConfig,
  type GridState,
  type MapTemplate,
} from '../../../core/model/types';
// @ts-ignore
import { readFileSync } from 'node:fs';
import { roadLookup } from '../../../state/object-index';

// ── Shared generation helpers (the genOn stroke-group pattern) ─────────────────────────────────

/** Drive the real Generate path inside one silent stroke group (the same order as
 *  `kit/operations/generate.ts:runGeneration`, so these are maps the app itself can produce). Does
 *  NOT set `state.generation` — callers do that explicitly so hand-built states never carry it. */
function genOn(state: GridState, cfg: GenerateConfig): GridState {
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  exec.runSilently(() => {
    generateTerrain(cfg, state, (c: Command) => exec.execute(c), exec.getRegistry());
  });
  exec.commitStrokeGroup(exec.getUndoStackSize());
  return state;
}

function islandCfg(seed: number): GenerateConfig {
  return { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed, region: null };
}

/** The hexia map template with a blank grid (no cells painted) — the real-map baseline case, and
 *  the base every hexia-derived corpus case starts from. */
function hexiaBlank(): GridState {
  const raw = readFileSync('src/__tests__/io/__fixtures__/petit-planet-hexia-1782022830197.json', 'utf8');
  return deserialize(raw, getMapTemplate((JSON.parse(raw) as { templateId?: string }).templateId));
}

/** `makeState` always builds template id 'test' (see src/__tests__/rules/_helpers.ts), so two
 *  synthetic corpus cases of different sizes would collide in the shared MAP_TEMPLATES registry if
 *  they both used the default id. Give each synthetic case its own id and register it up front —
 *  the same approach payload.test.ts uses for a single synthetic map, generalized to many. */
function namedState(id: string, width: number, height: number): GridState {
  const template: MapTemplate = { ...makeTemplate(width, height), id };
  MAP_TEMPLATES[id] = template;
  return { ...makeState(width, height), template, cells: createGrid(template) };
}

// ── Corpus cases ─────────────────────────────────────────────────────────────────────────────

function handEditSmall(): GridState {
  const state = namedState('hand-edit-small', 24, 24);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
  for (let y = 14; y < 18; y++) for (let x = 3; x < 7; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Water, elevation: 0 };

  const floraItems = getPlaceableByCategory(ItemCategory.Flora);
  for (let i = 0; i < 10; i++) {
    const item = floraItems[i % floraItems.length]!;
    const x = 15 + (i % 5), y = 15 + Math.floor(i / 5);
    const id = `hand-o${i}`;
    state.objects.set(id, { id, catalogId: item.id, position: { x, y }, rotation: 0, elevation: 0 });
  }
  return state;
}

function generatedThenEdited(): GridState {
  const cfg = islandCfg(7);
  const state = genOn(namedState('generated-then-edited', 64, 64), cfg);
  state.generation = cfg;

  // 30 direct cell edits on top of the generated terrain.
  const editRng = makeRng(4242);
  const { width, height } = state.template;
  let edits = 0;
  for (let tries = 0; edits < 30 && tries < 4000; tries++) {
    const x = editRng.int(width), y = editRng.int(height);
    const cell = state.cells[y]![x]!;
    if (cell.zone !== CellZone.Grass) continue;
    cell.terrain = edits % 6 === 0 ? null : { type: TerrainType.Mountain, elevation: 1 + (edits % 3) };
    edits++;
  }

  // 2 object removals + 3 object additions = 5 object edits.
  const removable = [...state.objects.values()].filter((o) => !o.locked);
  for (let i = 0; i < 2 && i < removable.length; i++) state.objects.delete(removable[i]!.id);

  const floraItems = getPlaceableByCategory(ItemCategory.Flora);
  let added = 0;
  for (let y = 0; y < height && added < 3; y++) {
    for (let x = 0; x < width && added < 3; x++) {
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || cell.terrain) continue;
      if ([...state.objects.values()].some((o) => o.position.x === x && o.position.y === y)) continue;
      const item = floraItems[added % floraItems.length]!;
      const id = `edit-o${added}`;
      state.objects.set(id, { id, catalogId: item.id, position: { x, y }, rotation: 0, elevation: 0 });
      added++;
    }
  }
  return state;
}

function mazeCase(): GridState {
  const cfg: GenerateConfig = { algorithm: 'maze', mode: 'earth', corridorWidth: 1, maxElevation: 3, seed: 5, region: null };
  const state = genOn(namedState('maze-64', 64, 64), cfg);
  state.generation = cfg;
  return state;
}

/** Deterministic "entropy bomb": a real hexia-sized map filled with the worst-case terrain/corner/
 *  object noise the codec's context models are least able to predict, all still within the ranges
 *  `validateImportedState` accepts (type/elevation) — built by DIRECT cell/object writes (no
 *  commands, no rule registry) since we're measuring the compression ceiling, not exercising rules.
 *  `n` caps how many objects are placed (the corpus asks for a few thousand — the game's load
 *  budget order of magnitude); `seed` makes the noise reproducible. */
export function adversarialState(n: number, seed: number): GridState {
  const state = hexiaBlank();
  const rng = makeRng(seed);
  const { width, height } = state.template;

  // `cell.zone` reads Grass under the plaza too (createGrid folds the template's raw Plaza zone
  // into Grass since the plaza is a locked PlacedObject, not terrain-bearing zone data) — but
  // json-codec's deserialize() deliberately strips any terrain baked onto a RAW-Plaza cell on
  // load (io/json-codec.ts:195, keyed off `template.zones`, not the live `cell.zone`), since the
  // plaza object always occupies that footprint in real gameplay. Writing terrain there via this
  // rule-bypassing builder would silently vanish on the next save/load round trip, breaking the
  // E2E content-equality assertion for a reason that has nothing to do with the codec. Gate on
  // the raw template zone (matching deserialize's own check) so every terrain write here is one
  // that actually survives a real save/load.
  const rawZone = (x: number, y: number): CellZone => state.template.zones[y]?.[x] ?? CellZone.Void;

  // 1) Checkerboard-noise mountains at elevations 1-3 over Grass cells only — layers 1-3 auto-pass
  //    the 3x3 base rule, so single isolated cells at any of these elevations are legal.
  //    Adjacent cells never match in type/elevation (checkerboard), defeating the W/N same-as-
  //    neighbour fast paths in terrain-coder.ts on (close to) every cell.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x + y) % 2 !== 0) continue;
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || rawZone(x, y) === CellZone.Plaza) continue;
      cell.terrain = { type: TerrainType.Mountain, elevation: 1 + rng.int(3) };
    }
  }

  // 2) Scattered ground-level ponds on off-phase Grass cells whose 4 neighbours are still flat
  //    (never adjacent to a drop, so no waterfall condition is implied).
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if ((x + y) % 2 === 0) continue;
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || cell.terrain || rawZone(x, y) === CellZone.Plaza) continue;
      if (rng.float() >= 0.015) continue;
      const allFlat = NEIGHBORS4.every(([dx, dy]) => {
        const nb = state.cells[y + dy]?.[x + dx];
        return !!nb && !nb.terrain;
      });
      if (allFlat) cell.terrain = { type: TerrainType.Water, elevation: 0 };
    }
  }

  // 3) Legal corner deviations: a cell whose W or N neighbour differs in elevation has a free
  //    convex corner there (the edge-cut policy) — sprinkle a fan/tri trim on it. Heuristic,
  //    not exhaustive (validateImportedState only checks type/elevation ranges, not cut geometry).
  const TRIMS: readonly CornerTrim[] = ['fan', 'tri-NW', 'tri-NE', 'tri-SW', 'tri-SE'];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = state.cells[y]![x]!.terrain;
      if (!t) continue;
      const w = x > 0 ? state.cells[y]![x - 1]!.terrain : null;
      const nb = y > 0 ? state.cells[y - 1]![x]!.terrain : null;
      const wDiff = (w?.elevation ?? 0) !== t.elevation;
      const nDiff = (nb?.elevation ?? 0) !== t.elevation;
      if (!wDiff && !nDiff) continue;
      if (rng.float() >= 0.3) continue;
      const trim = TRIMS[rng.int(TRIMS.length)]!;
      const corners: Corners = [trim, 'square', 'square', 'square'];
      t.corners = corners;
    }
  }

  // 4) Objects up to the load budget (`n`) on flat null-terrain Grass cells.
  const floraItems = getPlaceableByCategory(ItemCategory.Flora);
  let placed = 0;
  for (let y = 0; y < height && placed < n; y++) {
    for (let x = 0; x < width && placed < n; x++) {
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || cell.terrain) continue;
      const item = floraItems[rng.int(floraItems.length)]!;
      const id = `adv-o${placed}`;
      state.objects.set(id, { id, catalogId: item.id, position: { x, y }, rotation: 0, elevation: 0 });
      placed++;
    }
  }

  return state;
}

export async function corpusCases(): Promise<{ name: string; state: GridState }[]> {
  const cases: { name: string; state: GridState }[] = [];

  cases.push({ name: 'empty-hexia', state: hexiaBlank() });
  cases.push({ name: 'hand-edit-small', state: handEditSmall() });

  const gen64Cfg = islandCfg(7);
  const gen64 = genOn(namedState('generated-64', 64, 64), gen64Cfg);
  gen64.generation = gen64Cfg;
  cases.push({ name: 'generated-64', state: gen64 });

  const gen96Cfg = islandCfg(11);
  const gen96 = genOn(namedState('generated-96', 96, 96), gen96Cfg);
  gen96.generation = gen96Cfg;
  cases.push({ name: 'generated-96', state: gen96 });

  const genHexiaCfg = islandCfg(7);
  const genHexia = genOn(hexiaBlank(), genHexiaCfg);
  genHexia.generation = genHexiaCfg;
  cases.push({ name: 'generated-hexia', state: genHexia });

  cases.push({ name: 'generated-then-edited', state: generatedThenEdited() });
  cases.push({ name: 'maze-64', state: mazeCase() });
  cases.push({ name: 'adversarial', state: adversarialState(3000, 13) });

  return cases;
}
