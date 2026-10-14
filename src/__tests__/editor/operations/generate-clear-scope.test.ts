/**
 * What `clearGenerated` takes back.
 *
 * Clear is the counterpart of the button beside it, so it is bounded by what that button did: the
 * region the last run was given, and the authorship the run left behind. Reading the current
 * painted region instead reads one a finished run has already dropped, so a Clear right after
 * generating into a region falls back to the whole map and scrubs everything, the person's own work
 * included. A caller therefore passes the region it was given (today's shell always passes null),
 * never the one the store is holding now.
 */
import { placeObjectCommand } from '../../../core/model/command-build';
import { describe, it, expect, beforeEach } from 'vitest';
import { clearGenerated, generateMap } from '../../../editor/operations';
import { currentEditor } from '../../../editor/session/context';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { getMapTemplate } from '../../../config/maps';
import { getCell } from '../../../core/model/grid-model';
import { isBuildableZone } from '../../../core/game/zones';
import { generateObjectId } from '../../../core/model/object-id';
import type { GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';

const config = (seed: number): GenerateConfig => defaultConfig('designed', { maxElevation: 8, seed, richness: 1 });

/** A square of buildable cells in the west half, well clear of the plaza. */
function westRegion(state: GridState, half: number): MacroCoord[] {
  const { width, height } = state.template;
  let best = { x: 0, y: 0, n: -1 };
  for (let y = 16; y < height - 16; y += 4) for (let x = 16; x < width * 0.4; x += 4) {
    let n = 0;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      const c = getCell(state.cells, x + dx, y + dy);
      if (c && isBuildableZone(c.zone)) n++;
    }
    if (n > best.n) best = { x, y, n };
  }
  const out: MacroCoord[] = [];
  for (let y = best.y - half; y <= best.y + half; y++) for (let x = best.x - half; x <= best.x + half; x++) {
    const c = getCell(state.cells, x, y);
    if (c && isBuildableZone(c.zone)) out.push({ x, y });
  }
  return out;
}

const gs = (): GridState => useEditorStore.getState().gridState!;

/** Run a generation the way the shell does, and wait for it. */
async function generate(seed: number, region: MacroCoord[] | null): Promise<void> {
  await generateMap(currentEditor()!, { config: config(seed), region });
}

describe('Generate → Clear', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(getMapTemplate('hexia')!, createDefaultRegistry());
  });

  it('takes back the last run\'s region, not the map, and not the person\'s own work', async () => {
    // A whole-map generation first, so there is generated content outside the region to come.
    await generate(42, null);
    const wholeMap = gs().objects.size;
    expect(wholeMap, 'the full generation placed something').toBeGreaterThan(50);

    // Then a region run. Nothing remembers the painted region afterwards — Clear must still know
    // the scope.
    const region = westRegion(gs(), 12);
    const inRegion = new Set(region.map((c) => `${c.x},${c.y}`));
    await generate(42, region);

    // Somebody plants a tree inside that region, by hand.
    const exec = useEditorStore.getState().commandExecutor!;
    let mine: PlacedObject | null = null;
    for (const c of region) {
      const o: PlacedObject = { id: generateObjectId(), catalogId: 'tree-apple', position: c, rotation: 0, elevation: 0 };
      if (exec.execute(placeObjectCommand(o)).success) { mine = o; break; }
    }
    expect(mine, 'planted a tree in the region').not.toBeNull();

    const outsideBefore = [...gs().objects.values()]
      .filter((o) => !o.locked && !inRegion.has(`${o.position.x},${o.position.y}`)).length;
    expect(outsideBefore, 'the rest of the map holds the full run\'s work').toBeGreaterThan(20);

    clearGenerated(currentEditor()!, { region: null });

    const after = [...gs().objects.values()].filter((o) => !o.locked);
    const outsideAfter = after.filter((o) => !inRegion.has(`${o.position.x},${o.position.y}`)).length;
    expect(outsideAfter, 'nothing outside the region was touched').toBe(outsideBefore);
    expect(gs().objects.has(mine!.id), 'the hand-planted tree stayed').toBe(true);
    expect(after.filter((o) => inRegion.has(`${o.position.x},${o.position.y}`) && o.id !== mine!.id))
      .toEqual([]);
  }, 120000);

  it('takes the whole map back when the run had no region', async () => {
    await generate(42, null);
    expect(gs().objects.size).toBeGreaterThan(50);

    clearGenerated(currentEditor()!, { region: null });
    expect([...gs().objects.values()].filter((o) => !o.locked)).toEqual([]);
  }, 120000);

  it("keeps each map's own scope: a map opened in between starts with none", async () => {
    const parked = currentEditor()!;
    const region = westRegion(parked.state, 6);
    await generateMap(parked, { config: defaultConfig('maze', { maxElevation: 2, seed: 7 }), region });

    useEditorStore.getState().initMap(getMapTemplate('hexia')!, createDefaultRegistry());
    expect(clearGenerated(currentEditor()!, { region: null }).cells, 'the new map has no scope').toEqual([]);
    expect(clearGenerated(parked, { region: null }).cells, 'the parked map kept its own').toEqual(region);
  }, 60000);
});
