// The real-map-shaped corpus and the adversarial high-entropy map shared by the codec and degradation tests.
import { createDefaultRegistry } from '../../../rules/index';
import { makeState, makeTemplate } from '../../_support/map-state';
import { openSave } from '../../../io/import/open-save';
import { clearUnderLandmarks } from '../../../state/landmark-clearance';
import { applyRelocation } from '../../../state/relocation-plan';
import { getMapTemplate, MAP_TEMPLATES } from '../../../config/maps';
import { createGrid } from '../../../core/model/grid-model';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { getPlaceableByCategory } from '../../../state/catalog';
import { makeRng } from '../../../core/base/rng';
import { TerrainType, type Corners, type CornerTrim, type GridState, type MapTemplate } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';
import { CellZone } from '../../../core/game/zones';
import { templateAnchor } from '../../../core/model/landmarks';
import { wholeCellsOf } from '../../../core/grid/footprint';
import { rectContains } from '../../../core/grid/rect';
import { readFileSync } from 'node:fs';
import { createExecutor } from '../../../state/executor';
import { generateWith } from '../../_support/generation';
import { ItemCategory } from '../../../config/catalog/categories';

/** Generates in one silent stroke group, in `runGeneration`'s order, so the map is one the app can
 *  produce. Leaves `state.generation` unset; callers set it so hand-built states never carry one. */
function genOn(state: GridState, cfg: GenerateConfig): GridState {
  const exec = createExecutor(state, createDefaultRegistry());
  exec.transaction({ silent: true }, () => {
    generateWith(state, exec, cfg);
  });
  exec.beginStroke().commit();
  return state;
}

function islandCfg(seed: number): GenerateConfig {
  return defaultConfig('designed', { maxElevation: 8, seed });
}

/** The hexia template opened from a near-empty save: the base of every hexia case. */
function hexiaBlank(): GridState {
  const raw = readFileSync('src/__tests__/fixtures/saves/petit-planet-hexia-1782022830197.json', 'utf8');
  return openSave(raw, getMapTemplate((JSON.parse(raw) as { templateId?: string }).templateId));
}

/** A synthetic state under its own registered template id: `makeState` always uses 'test', and
 *  cases of different sizes would collide in `MAP_TEMPLATES`. */
function namedState(id: string, width: number, height: number): GridState {
  const template: MapTemplate = { ...makeTemplate(width, height), id };
  MAP_TEMPLATES[id] = template;
  return { ...makeState(width, height), template, cells: createGrid(template) };
}

/** `state` after a load's automatic repair, so every later load leaves it as it is. */
function repaired(state: GridState): GridState {
  const rules = createDefaultRegistry();
  const { report } = clearUnderLandmarks(state, rules);
  if (report) applyRelocation(createExecutor(state, rules), state, report.plan);
  return state;
}

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
  return repaired(state);
}

function mazeCase(): GridState {
  const cfg: GenerateConfig = defaultConfig('maze', { maxElevation: 3, seed: 5 });
  const state = genOn(namedState('maze-64', 64, 64), cfg);
  state.generation = cfg;
  return state;
}

/** A deterministic hexia map of terrain, corner and object noise the codec's context models predict
 *  worst, within the ranges the loader admits. Written directly, bypassing rules, since it probes the
 *  compression ceiling. `n` caps the object count. */
export function adversarialState(n: number, seed: number): GridState {
  const state = hexiaBlank();
  const rng = makeRng(seed);
  const { width, height } = state.template;

  // Every load strips terrain under a landmark (`clearUnderLandmarks`), so terrain written under the
  // plaza would vanish on a round trip and break content equality for a reason unrelated to the codec.
  const anchor = templateAnchor(state.template)!;
  const plaza = wholeCellsOf({ x: anchor.x, y: anchor.y, w: anchor.width, h: anchor.height });
  const underPlaza = (x: number, y: number): boolean => rectContains(plaza, x, y);

  // Checkerboard mountains at random tiers 1 to 3, so no cell matches its west or north neighbour
  // and the codec's neighbour predictions miss.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x + y) % 2 !== 0) continue;
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || underPlaza(x, y)) continue;
      cell.terrain = { type: TerrainType.Mountain, elevation: 1 + rng.int(3) };
    }
  }

  // Scattered ponds on off-phase cells whose four neighbours are flat, so no waterfall is implied.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if ((x + y) % 2 === 0) continue;
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || cell.terrain || underPlaza(x, y)) continue;
      if (rng.float() >= 0.015) continue;
      const allFlat = NEIGHBORS4.every(([dx, dy]) => {
        const nb = state.cells[y + dy]?.[x + dx];
        return !!nb && !nb.terrain;
      });
      if (allFlat) cell.terrain = { type: TerrainType.Water, elevation: 0 };
    }
  }

  // Random trims where the west or north neighbour differs in elevation; the loader checks only
  // type and elevation ranges, not cut geometry.
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

  return repaired(state);
}

/** The hand-edited corpus case alone, for tests that need no other. */
export function handEditedCase(): GridState {
  return repaired(handEditSmall());
}

export async function corpusCases(): Promise<{ name: string; state: GridState }[]> {
  const cases: { name: string; state: GridState }[] = [];

  cases.push({ name: 'empty-hexia', state: hexiaBlank() });
  cases.push({ name: 'hand-edit-small', state: handEditedCase() });

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
