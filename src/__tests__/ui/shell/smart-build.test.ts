/** Surface actions use registered macros; network operations remain available to programmatic callers. */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import {
  CommandType, ItemCategory,
  type Command, type EditorEvents, type GenerateConfig, type GridState, type MacroCoord,
} from '../../../core/model/types';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { categoryOf } from '../../../state/catalog';
import { getObjectIndex, roadLookup } from '../../../state/object-index';
import { clearAllObjects, generateTerrain } from '../../../tools/generation/terrain-generator';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import { applyMacro, MACRO_IDS, type MacroId } from '../../../tools/macros';
import { generateObjectId } from '../../../core/model/object-id';
import { SMART_MENU } from '../../../ui/shell/bars/smart-menu';
import objectShelfSource from '../../../ui/shell/bars/ObjectShelf.tsx?raw';
import terrainBarSource from '../../../ui/shell/bars/TerrainBar.tsx?raw';
import { translations } from '../../../i18n/translations';

const offered = (): MacroId[] => Object.values(SMART_MENU).flat().map((a) => a.id);

describe('smart construction', () => {
  it('offers one aimed action per terrain surface and keeps network operations out of the toolbar', () => {
    expect(SMART_MENU.mountain.map(a => a.id)).toEqual(['raise']);
    expect(SMART_MENU.water.map(a => a.id)).toEqual(['stream']);
    expect(SMART_MENU.road.map(a => a.id)).toEqual(['road-link']);
    for (const id of offered()) expect(MACRO_IDS).toContain(id);
  });

  /**
   * BEING IN THIS TABLE IS NOT THE SAME AS BEING REACHABLE, and the test above cannot tell the
   * difference: an entry under `object` with nothing mounting `SmartBuild` on the
   * object shelf is offered by the table and drawn by nobody.
   *
   * Every surface that offers a macro must therefore be a surface that draws the cell.
   */
  it('draws the control on every surface that offers a macro', () => {
    // The object shelf offers its macro as a CARD in the item row; the terrain bars as the pill.
    expect(objectShelfSource).toContain('SmartCard');
    expect(terrainBarSource).toContain('SmartBuild');
    // And nothing offers macros from a surface with no bar to draw them in.
    expect(Object.keys(SMART_MENU).sort()).toEqual(['mountain', 'object', 'road', 'water']);
  });

  /** Each macro is offered ONCE. Two surfaces claiming the same one would make which surface you
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
   * Every action names itself in every locale, and the two EMPTY reports exist there too — the
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
      template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
    } as unknown as GridState;
    const plaza = createPlazaObject(template);
    expect(plaza, 'the scenario needs the plaza standing').not.toBeNull();
    state.objects.set(plaza!.id, plaza!);

    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const config: GenerateConfig = {
      algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed: 7,
      region: null,
    };
    generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry());
    // TERRAIN ONLY: the island generator furnishes what it builds, and this case plants its own two
    // houses below to say what "already connected" means. The plaza is locked and stays.
    clearAllObjects(state, (c: Command) => exec.execute(c));
    const raised = state.cells.flat().filter((c) => (c.terrain?.elevation ?? 0) > 0).length;
    expect(raised, 'the fixture has to have relief for this test to mean anything').toBeGreaterThan(1000);

    // Two houses on level, open patches the analysis itself found, both in the hub's OWN region, so
    // both are genuinely servable and "already connected" is the truth to report. Found at runtime
    // rather than written down: the spots belong to the generator's output, and a hardcoded pair
    // would quietly land in the sea the day that output moves.
    const a = analyzeTerrain(state, null);
    const W = a.width;
    const hubRegion = a.rankedRegions[0]!;
    const spots: MacroCoord[] = [];
    for (let y = 4; y < template.height - 8; y += 6) {
      for (let x = 4; x < template.width - 8; x += 6) {
        if ((a.region[y * W + x] ?? -1) !== hubRegion) continue;
        let open = true;
        // A 5x4 house plus the flat trait's own +1 right/bottom margin, and GROUND level: the house
        // is placed at elevation 0, and the trait refuses a footprint whose cells step.
        for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 7; dx++) {
          if (a.open[(y + dy) * W + (x + dx)] !== 1 || state.cells[y + dy]![x + dx]!.terrain) open = false;
        }
        if (open) spots.push({ x, y });
      }
    }
    expect(spots.length, 'no open ground in the hub region to stand a house on').toBeGreaterThan(1);
    // Two DIFFERENT cabins: a landmark building is capped at one on the map (V-PLACE-MAX).
    for (const [i, s] of [spots[0]!, spots[spots.length - 1]!].entries()) {
      const catalogId = ['building-boat-cabin', 'building-forest-cabin'][i]!;
      const obj = { id: generateObjectId(), catalogId, position: s, rotation: 0 as const, elevation: 0 };
      const r = exec.execute({ type: CommandType.PlaceObject, timestamp: 1, object: obj, loadValue: 0 });
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

    // AND NOTHING THE PRESS BUILT STANDS ALONE: every crossing on the map has pavement within reach
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
