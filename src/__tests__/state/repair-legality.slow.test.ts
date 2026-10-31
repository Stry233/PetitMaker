/**
 * After automatic repair a map passes the full rule set (`isLegalMap`), whether it came from a fixture
 * save, a released build's export or a map built here against every rule at once; and the plan the
 * repair's picture shows is the plan that lands, with nothing unplanned.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { parseSave } from '../../io/save/parse';
import { serialize } from '../../io/save/json-codec';
import { loadParsedSave } from '../../io/import/open-save';
import { createDefaultRegistry } from '../../rules';
import { applyRelocation, isLegalMap } from '../../state/relocation-plan';
import { createExecutor } from '../../state/executor';
import { catalogLoadValue, getCatalogItem, getPlaceableWhere } from '../../state/catalog';
import { getMapStats } from '../../state/map-stats';
import { isOverBudget } from '../../core/model/load';
import { findTrait } from '../../core/model/traits';
import { inlandSquare } from '../_support/legal-maps';
import { hasGate, objectRect } from '../../state/object-geometry';
import { makeRng } from '../../core/base/rng';
import { createGridState } from '../../core/model/template';
import { bumpObjectsVersion, createDefaultTerrainCell } from '../../core/model/grid-model';
import { isLaidLandmark } from '../../core/model/landmarks';
import { ELEVATION_MAX } from '../../core/game/profile';
import { getMapTemplate } from '../../config/maps';
import { TerrainType, type GridState, type PlacedObject, type Rotation } from '../../core/model/types';

// Every case decodes, plans and lands a whole map.
vi.setConfig({ testTimeout: 180_000 });

const FIXTURES = join(__dirname, '..', 'fixtures');
const SAVES_DIR = join(FIXTURES, 'saves');
const COMPAT = join(FIXTURES, 'compat', '1.5.557');
const SAVES: [string, string][] = [
  ...readdirSync(SAVES_DIR).filter((f) => f.endsWith('.json.gz')).sort()
    .map((f): [string, string] => [f.replace('.json.gz', ''), join(SAVES_DIR, f)]),
  ...readdirSync(COMPAT).filter((f) => f.endsWith('.json-min.json.gz')).sort()
    .map((f): [string, string] => [`${f.replace('.json-min.json.gz', '')} (released 1.5.557)`, join(COMPAT, f)]),
];

/** The map a load opens from `json` once its automatic repair has landed, with what the repair did. */
function autoRepaired(json: string) {
  const rules = createDefaultRegistry();
  const { state, cleared } = loadParsedSave(parseSave(JSON.parse(json)));
  const result = cleared.report ? applyRelocation(createExecutor(state, rules), state, cleared.report.plan) : null;
  return { state, cleared, result, legal: isLegalMap(state, rules) };
}

describe.each(SAVES)('auto repair of %s', (_name, file) => {
  it('[PLAN-27, PLAN-29] leaves a map every rule accepts, as its picture showed', () => {
    const { result, legal } = autoRepaired(gunzipSync(readFileSync(file)).toString('utf8'));
    expect(legal).toBe(true);
    expect(result?.unplanned ?? 0).toBe(0);
  });
});

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * A `planet` map written directly against the rules: random items at random spots and turns (overlapping,
 * on the sea, the edge and the landmark's ground), cliffs facing doors, terrain on the sea, peaks above
 * the top layer, lone columns and unwalled water.
 */
function lawless(planet: string, seed: number): GridState {
  const rng = makeRng(seed);
  const state = createGridState(getMapTemplate(planet));
  const { width, height } = state.template;
  const items = getPlaceableWhere(() => true);
  const landmark = [...state.objects.values()].find(isLaidLandmark)!;
  const ground = objectRect(landmark);
  const placed: PlacedObject[] = [];
  for (let i = 0; i < 140; i++) {
    const item = rng.pick(items);
    // Every third one on or beside the landmark's ground.
    const near = i % 3 === 0;
    const x = near ? Math.floor(ground.x + rng.range(-3, ground.w + 3)) : rng.int(width);
    const y = near ? Math.floor(ground.y + rng.range(-3, ground.h + 3)) : rng.int(height);
    placed.push({ id: `lawless-${i}`, catalogId: item.id, position: { x, y }, rotation: rng.pick(ROTATIONS), elevation: 0 });
  }
  for (const o of placed) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: placed });
  const paint = (x: number, y: number, type: TerrainType, elevation: number) => {
    const cell = state.cells[y]?.[x];
    if (cell) cell.terrain = createDefaultTerrainCell(type, elevation);
  };
  // A cliff on every side of each house, two cells out: some door faces it.
  for (const o of placed) {
    const item = getCatalogItem(o.catalogId);
    if (!item || !hasGate(item)) continue;
    const r = objectRect(o);
    for (let x = Math.floor(r.x) - 2; x <= Math.ceil(r.x + r.w) + 1; x++) {
      paint(x, Math.floor(r.y) - 2, TerrainType.Mountain, 3);
      paint(x, Math.ceil(r.y + r.h) + 1, TerrainType.Mountain, 3);
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = rng.int(width), y = rng.int(height);
    switch (i % 5) {
      case 0: paint(x, y, TerrainType.Mountain, rng.int(ELEVATION_MAX) + 1); break;
      case 1: paint(x, y, TerrainType.Mountain, ELEVATION_MAX + 1 + rng.int(3)); break;
      case 2: paint(x, y, TerrainType.Mountain, 6); break;
      case 3: for (let d = 0; d < 4; d++) paint(x + d, y, TerrainType.Water, 2); break;
      default: paint(x, y, TerrainType.Water, rng.int(4)); break;
    }
  }
  state.cellsVersion++;
  return state;
}

describe.each([['hexia', 1], ['tafa', 2], ['hexia', 3], ['tafa', 4], ['hexia', 5], ['tafa', 6]] as const)(
  'auto repair of a %s map against every rule (seed %i)',
  (planet, seed) => {
    it('[PLAN-27, PLAN-29] leaves a map every rule accepts, as its picture showed', () => {
      const lawlessMap = lawless(planet, seed);
      expect(isLegalMap(lawlessMap, createDefaultRegistry())).toBe(false);
      const { result, legal } = autoRepaired(serialize(lawlessMap));
      expect(legal).toBe(true);
      expect(result?.unplanned ?? 0).toBe(0);
    });
  },
);

describe('a map over the regional load limit', () => {
  it('[PLAN-27] is no violation: the load leaves it as it is and calls it legal', () => {
    // The limit raises its own notice when the map opens; no rule or repair answers to it.
    const state = createGridState(getMapTemplate('hexia'));
    const item = getPlaceableWhere((i) => i.width === 1 && i.height === 1 && !findTrait(i, 'exclusionRadius') && catalogLoadValue(i.id) > 0)[0]!;
    const at = inlandSquare(state.template, 20);
    const placed: PlacedObject[] = [];
    for (let y = at.y + 2; y < at.y + 18; y++) for (let x = at.x + 2; x < at.x + 18; x++) {
      placed.push({ id: `heavy-${x}-${y}`, catalogId: item.id, position: { x, y }, rotation: 0, elevation: 0 });
    }
    for (const o of placed) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { added: placed });
    expect([...getMapStats(state).chunks.values()].some((c) => isOverBudget(c.load))).toBe(true);
    expect(isLegalMap(state, createDefaultRegistry())).toBe(true);
    const { state: opened, cleared } = loadParsedSave(parseSave(JSON.parse(serialize(state))));
    expect(cleared.objects).toBe(0);
    expect(placed.every((o) => opened.objects.has(o.id))).toBe(true);
  });
});
