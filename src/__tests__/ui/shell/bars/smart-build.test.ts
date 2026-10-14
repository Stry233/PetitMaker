/** Surface actions use registered macros; network operations remain available to programmatic callers. */
import { describe, expect, it } from 'vitest';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { createGridState } from '../../../../core/model/template';
import { CommandType, TerrainType, type Command, type GridState, type MacroCoord } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { getMapTemplate } from '../../../../config/maps';
import { createDefaultRegistry } from '../../../../rules';
import { categoryOf, getCatalogItem } from '../../../../state/catalog';
import { getObjectIndex } from '../../../../state/object-index';
import { clearAllObjects } from '../../../../tools/generation';
import { analyzeTerrain } from '../../../../tools/placement/analysis';
import { applyMacro, MACRO_IDS, type MacroId } from '../../../../tools/macros';
import { generateObjectId } from '../../../../core/model/object-id';
import { SMART_MENU } from '../../../../ui/shell/bars/smart-menu';
import { translations } from '../../../../i18n/translations';
import { createExecutor } from '../../../../state/executor';
import { generateWith } from '../../../_support/generation';
import { ItemCategory } from '../../../../config/catalog/categories';

const offered = (): MacroId[] => Object.values(SMART_MENU).flat().map((a) => a.id);

describe('smart construction', () => {
  it('offers one aimed action per terrain surface and keeps network operations out of the toolbar', () => {
    expect(SMART_MENU.mountain.map(a => a.id)).toEqual(['raise']);
    expect(SMART_MENU.water.map(a => a.id)).toEqual(['stream']);
    expect(SMART_MENU.road.map(a => a.id)).toEqual(['road-link']);
    for (const id of offered()) expect(MACRO_IDS).toContain(id);
  });

  /**
   * Being in this table is not the same as being reachable: an entry under a surface with no bar
   * mounting the control is offered by the table and drawn by nobody. The surfaces offering macros
   * are the ones whose bars render it, which `terrain-bar.test.tsx` (the pill on each terrain bar)
   * and `object-shelf.test.tsx` (the planting card) press.
   */
  it('offers macros only on the surfaces whose bars draw the control', () => {
    expect(Object.keys(SMART_MENU).sort()).toEqual(['mountain', 'object', 'road', 'water']);
  });

  /** Each macro is offered once. Two surfaces claiming the same one would make which surface you
   *  were on decide which of two identical entries you got. */
  it('offers each of them exactly once', () => {
    const seen = offered();
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('has no keep, cancel, or plan-heading strings left to draw', () => {
    const gone = ['smart.keep', 'smart.cancel', 'smart.plan_hill', 'smart.plan_field',
      'smart.plan_stream', 'smart.plan_roads'];
    for (const [locale, table] of Object.entries(translations)) {
      for (const key of gone) expect(`${locale}:${key in table}`).toBe(`${locale}:false`);
    }
  });

  /**
   * Every action names itself in every locale, and the two empty reports exist there too — the
   * one case a macro toasts. A landing macro says nothing: what it built is on the map, which is
   * the feedback every other stroke has, and a toast per press is the noise the toast standard
   * exists to prevent.
   */
  it('names every action, and the empty reports, in all seven locales', () => {
    for (const [locale, table] of Object.entries(translations)) {
      for (const action of Object.values(SMART_MENU).flat()) {
        expect(`${locale}:${action.labelKey}`).toBe(`${locale}:${action.labelKey in table ? action.labelKey : 'MISSING'}`);
      }
      for (const key of [
        'smart.empty', 'smart.empty_roads', 'smart.terrain_blocked',
        'smart.river_blocked', 'smart.empty_link', 'smart.no_door',
        'smart.roads_settled', 'smart.unrouted', 'smart.blocked',
      ]) {
        expect(`${locale}:${key}`).toBe(`${locale}:${key in table ? key : 'MISSING'}`);
      }
      for (const key of Object.keys(table)) {
        expect(key.startsWith('smart.done_'), `${locale}:${key} is a landing toast`).toBe(false);
      }
    }
  });

  // Generated terrain exposes orphan crossings that a repeated network call could otherwise add.
  it('a re-press with nothing changed says so, on terrain that could grow crossings', () => {
    const template = getMapTemplate('hexia');
    const state = {
      template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
    } as unknown as GridState;
    const plaza = (templateLandmarkObjects(template)[0] ?? null);
    expect(plaza, 'the scenario needs the plaza standing').not.toBeNull();
    state.objects.set(plaza!.id, plaza!);

    const exec = createExecutor(state, createDefaultRegistry());
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const config: GenerateConfig = defaultConfig('designed', { maxElevation: 8, seed: 7 });
    generateWith(state, exec, config);
    // Terrain only: the island generator furnishes what it builds, and this case plants its own two
    // houses below to say what "already connected" means. The plaza is locked and stays.
    clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
    const raised = state.cells.flat().filter((c) => (c.terrain?.elevation ?? 0) > 0).length;
    expect(raised, 'the fixture has to have relief for this test to mean anything').toBeGreaterThan(1000);

    // Two houses on level, open patches the analysis itself found, both in the hub's own region, so
    // both are genuinely servable and "already connected" is the truth to report. Found at runtime
    // rather than written down: the spots belong to the generator's output, and a hardcoded pair
    // would quietly land in the sea the day that output moves.
    const a = analyzeTerrain(state, null);
    const W = a.width;
    const hubRegion = a.rankedRegions[0]!;
    const spots: (MacroCoord & { elevation: number })[] = [];
    const house = getCatalogItem('building-boat-cabin')!;
    // A cell's dry level: its mountain layer, 0 on bare ground, -1 under water.
    const level = (x: number, y: number): number => {
      const t = state.cells[y]![x]!.terrain;
      return !t ? 0 : t.type === TerrainType.Mountain ? t.elevation : -1;
    };
    for (let y = 4; y < template.height - 8; y += 6) {
      for (let x = 4; x < template.width - 8; x += 6) {
        if ((a.region[y * W + x] ?? -1) !== hubRegion) continue;
        const elevation = level(x, y);
        let open = elevation >= 0;
        // The house plus the flat trait's own +1 right/bottom margin and a cell to spare, all at one
        // level: the trait refuses a footprint whose cells step.
        for (let dy = 0; dy < house.height + 2; dy++) for (let dx = 0; dx < house.width + 2; dx++) {
          if (a.open[(y + dy) * W + (x + dx)] !== 1 || level(x + dx, y + dy) !== elevation) open = false;
        }
        if (open) spots.push({ x, y, elevation });
      }
    }
    expect(spots.length, 'no open ground in the hub region to stand a house on').toBeGreaterThan(1);
    // Two different cabins: a landmark building is capped at one on the map (V-PLACE-MAX).
    for (const [i, s] of [spots[0]!, spots[spots.length - 1]!].entries()) {
      const catalogId = ['building-boat-cabin', 'building-forest-cabin'][i]!;
      const obj = { id: generateObjectId(), catalogId, position: { x: s.x, y: s.y }, rotation: 0 as const, elevation: s.elevation };
      const r = exec.execute({ type: CommandType.PlaceObject, object: obj });
      expect(r.success, `house@${s.x},${s.y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
    }

    const first = applyMacro(ctx, 'roads', { seed: 3 });
    expect(first.changes, first.reason ?? '').toBeGreaterThan(0);
    const count = (cat: ItemCategory): number => [...state.objects.values()].filter((o) => categoryOf(o) === cat).length;
    const roadsBefore = count(ItemCategory.Road);
    const crossingsBefore = count(ItemCategory.Bridge) + count(ItemCategory.Ramp);

    for (const seed of [4, 5, 6]) {
      const again = applyMacro(ctx, 'roads', { seed });
      expect(again.changes, `press at seed ${seed} laid ${again.changes}`).toBe(0);
      expect(again.code).toBe('already-connected');
    }
    // Honest: a report that changed nothing changed nothing — no pavement, and no crossing either.
    expect(count(ItemCategory.Road)).toBe(roadsBefore);
    expect(count(ItemCategory.Bridge) + count(ItemCategory.Ramp)).toBe(crossingsBefore);

    // And nothing the press built stands alone: every crossing on the map has pavement within reach
    // of one of its ends — an orphan ramp in bare grass is what repeated presses would otherwise
    // accumulate.
    const { roadByCell } = getObjectIndex(state);
    for (const o of state.objects.values()) {
      const cat = categoryOf(o);
      if (cat !== ItemCategory.Bridge && cat !== ItemCategory.Ramp) continue;
      let paved = false;
      for (let dy = -2; dy <= 3 && !paved; dy++) {
        for (let dx = -2; dx <= 3 && !paved; dx++) {
          if (roadByCell.has(`${o.position.x + dx},${o.position.y + dy}`)) paved = true;
        }
      }
      expect(paved, `${o.catalogId}@${o.position.x},${o.position.y} stands with no pavement at either end`).toBe(true);
    }
  });
});
