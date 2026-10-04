/**
 * Carrying a build onto a custom planet, and the detached preview of that carry.
 *
 * The planet's own mountains arrive with it, the build wins wherever the two overlap, and the
 * preview is the same transfer run on a detached map: it reports what the real one drops, in the
 * destination's coordinates, and leaves the live editor untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateMap, newMap, plazaOffset, previewTransfer, requestTransferPreview, transferMap } from '../../kit/operations';
import { currentKit } from '../../kit/context';
import { getMapTemplate } from '../../config/maps';
import { createDefaultRegistry } from '../../rules';
import { getCell } from '../../core/model/grid-model';
import { mapFingerprint } from '../../tools/macros/scratch';
import { useEditorStore } from '../../state/store';
import { createGridState } from '../../core/model/planet';
import { CellZone, CommandType, TerrainType } from '../../core/model/types';
import type { GenerateConfig, GridState, MacroCoord, MapTemplate } from '../../core/model/types';

const rules = createDefaultRegistry();

/** Grass inside a two-cell void rim, a 3 x 3 plaza at the centre, and optional mountains. */
function customPlanet(id: string, size: number, terrain?: (x: number, y: number) => number): MapTemplate {
  const zones: CellZone[][] = [];
  for (let y = 0; y < size; y++) {
    const row: CellZone[] = [];
    for (let x = 0; x < size; x++) row.push(x < 2 || y < 2 || x >= size - 2 || y >= size - 2 ? CellZone.Void : CellZone.Grass);
    zones.push(row);
  }
  const plazaAt = size / 2 - 1.5;
  let seeded: Uint8Array | undefined;
  if (terrain) {
    seeded = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) seeded[y * size + x] = zones[y]![x] === CellZone.Grass ? terrain(x, y) : 0;
  }
  return {
    id: `custom-${id}`, name: { en: id }, width: size, height: size, zones,
    plaza: { x: plazaAt, y: plazaAt, width: 3, height: 3, elevation: 1 },
    ...(seeded ? { terrain: seeded } : {}),
  };
}

function takesTerrain(state: GridState, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell || cell.terrain) return false;
  return rules.validatePreCommand({
    type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
  }, state).length === 0;
}

/** A source cell that takes terrain and lands where `where` accepts, scanning outward from the plaza. */
function sourceCellLanding(source: GridState, offset: MacroCoord, where: (d: MacroCoord) => boolean): MacroCoord {
  for (let y = 0; y < source.template.height; y++) {
    for (let x = 0; x < source.template.width; x++) {
      if (where({ x: x + offset.x, y: y + offset.y }) && takesTerrain(source, x, y)) return { x, y };
    }
  }
  throw new Error('no source cell lands there');
}

function paint(cells: MacroCoord[], elevation: number): void {
  const kit = currentKit()!;
  const watermark = kit.executor.getUndoStackSize();
  // A block stands on the tier below it, so a column is raised one tier at a time.
  for (let tier = 1; tier <= elevation; tier++) {
    const result = kit.executor.execute({
      type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: TerrainType.Mountain, elevation: tier,
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
  }
  kit.executor.commitStroke(watermark);
}

const key = (c: MacroCoord): string => `${c.x},${c.y}`;

const makeFresh = (t: MapTemplate): GridState => createGridState(t);

beforeEach(() => newMap('hexia'));

describe('the preview reports what the transfer drops', () => {
  it('names a cell that lands on sea, and one that lands off the planet, in destination coordinates', () => {
    const target = customPlanet('small', 40);
    const source = currentKit()!.state;
    const offset = plazaOffset(source.template, target);

    const interior = (d: MacroCoord) => d.x >= 5 && d.x <= 12 && d.y >= 5 && d.y <= 12;
    const onSea = (d: MacroCoord) => d.x === 1 && d.y >= 10 && d.y <= 30;
    const offPlanet = (d: MacroCoord) => d.x === -4 && d.y >= 10 && d.y <= 30;
    const kept = sourceCellLanding(source, offset, interior);
    const sea = sourceCellLanding(source, offset, onSea);
    const off = sourceCellLanding(source, offset, offPlanet);
    for (const c of [kept, sea, off]) paint([c], 1);

    const preview = previewTransfer(currentKit()!, target);
    const at = (c: MacroCoord): MacroCoord => ({ x: c.x + offset.x, y: c.y + offset.y });

    const dropped = new Set(preview.dropped.map(key));
    expect(dropped.has(key(at(sea)))).toBe(true);
    expect(dropped.has(key(at(off)))).toBe(true);
    expect(dropped.has(key(at(kept)))).toBe(false);
    expect(preview.dropped).toHaveLength(2);
    expect(preview.moved).toEqual({ cells: 1, objects: 0 });
    expect(preview.droppedCounts).toEqual({ cells: 2, objects: 0 });

    expect(preview.state.template.id).toBe(target.id);
    expect(getCell(preview.state.cells, at(kept).x, at(kept).y)?.terrain?.elevation).toBe(1);
    expect(getCell(preview.state.cells, at(sea).x, at(sea).y)?.terrain ?? null).toBeNull();
  });

  it('counts a dropped object and marks its footprint', () => {
    const target = customPlanet('small-objects', 40);
    const kit = currentKit()!;
    const offset = plazaOffset(kit.state.template, target);
    const spot = sourceCellLanding(kit.state, offset, (d) => d.x === -6 && d.y === 20);
    const watermark = kit.executor.getUndoStackSize();
    expect(kit.executor.execute({
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'tree-off', catalogId: 'tree-apple', position: { ...spot }, rotation: 0, elevation: 0 },
    }).success).toBe(true);
    kit.executor.commitStroke(watermark);

    const preview = previewTransfer(kit, target);
    expect(preview.droppedCounts).toEqual({ cells: 0, objects: 1 });
    expect(preview.dropped.map(key)).toContain(key({ x: spot.x + offset.x, y: spot.y + offset.y }));
  });

  it('is what the real transfer arrives at', async () => {
    const config: GenerateConfig = {
      algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed: 31, region: null, richness: 1,
    };
    await generateMap(currentKit()!, { config, region: null });
    const target = customPlanet('medium', 120, (x, y) => ((x * 7 + y * 3) % 23 === 0 ? 1 : 0));

    const preview = previewTransfer(currentKit()!, target);
    const outcome = transferMap(currentKit()!, { target });

    expect(mapFingerprint(preview.state)).toBe(mapFingerprint(currentKit()!.state));
    expect(preview.moved).toEqual(outcome.moved);
    expect(preview.droppedCounts).toEqual(outcome.dropped);
  }, 60_000);

  it('leaves the live editor untouched', async () => {
    const config: GenerateConfig = {
      algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed: 8, region: null, richness: 1,
    };
    await generateMap(currentKit()!, { config, region: null });
    const before = useEditorStore.getState();
    const print = mapFingerprint(before.gridState!);
    const undo = before.commandExecutor!.getUndoStackSize();

    previewTransfer(currentKit()!, getMapTemplate('tafa'));

    const after = useEditorStore.getState();
    expect(after.gridState).toBe(before.gridState);
    expect(after.commandExecutor).toBe(before.commandExecutor);
    expect(mapFingerprint(after.gridState!)).toBe(print);
    expect(after.commandExecutor!.getUndoStackSize()).toBe(undo);
    expect(after.gridState!.template.id).toBe('hexia');
  }, 60_000);
});

describe('a planet with its own terrain', () => {
  it('arrives with its mountains where the build laid nothing', () => {
    const target = customPlanet('hills', 40, (x, y) => (x === 8 && y === 30 ? 2 : 0));
    transferMap(currentKit()!, { target });
    expect(getCell(currentKit()!.state.cells, 8, 30)?.terrain).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('gives way to the build where the two overlap, higher or lower', () => {
    const source = currentKit()!.state;
    const planet = (x: number, y: number) => (y >= 3 && y <= 6 && x >= 4 && x <= 16 ? 2 : 0);
    const target = customPlanet('ridge', 40, planet);
    const offset = plazaOffset(source.template, target);
    const low = sourceCellLanding(source, offset, (d) => d.y === 4 && d.x >= 5 && d.x <= 8);
    const high = sourceCellLanding(source, offset, (d) => d.y === 4 && d.x >= 11 && d.x <= 15);
    paint([low], 1);
    paint([high], 3);

    const preview = previewTransfer(currentKit()!, target);
    expect(preview.dropped).toEqual([]);
    expect(getCell(preview.state.cells, low.x + offset.x, low.y + offset.y)?.terrain?.elevation).toBe(1);
    expect(getCell(preview.state.cells, high.x + offset.x, high.y + offset.y)?.terrain?.elevation).toBe(3);
    // The rest of the ridge stands as the planet laid it.
    expect(getCell(preview.state.cells, 10, 5)?.terrain?.elevation).toBe(2);
  });
});

describe('a build laid over the planet\'s own mountains', () => {
  it('arrives exactly as it would on the bare planet', async () => {
    const config: GenerateConfig = {
      algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed: 4242, region: null, richness: 1,
    };
    await generateMap(currentKit()!, { config, region: null });
    const source = currentKit()!.state;
    const bare = customPlanet('wide', 200);
    const offset = plazaOffset(source.template, bare);
    // A mountain under every carried cell, water included.
    const hills = customPlanet('wide-hills', 200, (x, y) => (source.cells[y - offset.y]?.[x - offset.x]?.terrain ? 1 : 0));
    expect(source.cells.flat().some((c) => c.terrain?.type === TerrainType.Water)).toBe(true);

    const onBare = previewTransfer(currentKit()!, bare);
    const onHills = previewTransfer(currentKit()!, hills);

    expect(onHills.moved).toEqual(onBare.moved);
    expect(onHills.droppedCounts).toEqual(onBare.droppedCounts);
    for (let y = 0; y < source.template.height; y++) {
      for (let x = 0; x < source.template.width; x++) {
        if (!source.cells[y]![x]!.terrain) continue;
        const dx = x + offset.x, dy = y + offset.y;
        expect(getCell(onHills.state.cells, dx, dy)?.terrain, `${dx},${dy}`).toEqual(getCell(onBare.state.cells, dx, dy)?.terrain);
      }
    }
  }, 60_000);

  it('lays a fillet from empty ground where the planet had a mountain', () => {
    const kit = currentKit()!;
    const offset = plazaOffset(kit.state.template, customPlanet('knoll', 40));
    // An L of blocks wrapping the empty cell (x, y + 1) at its top-right corner.
    const at = sourceCellLanding(kit.state, offset, (d) => d.x >= 6 && d.x <= 12 && d.y >= 4 && d.y <= 6);
    const notch = { x: at.x, y: at.y + 1 };
    const block = [at, notch, { x: at.x + 1, y: at.y }, { x: at.x + 1, y: at.y + 1 }];
    for (const c of block) expect(takesTerrain(kit.state, c.x, c.y), `${c.x},${c.y} takes terrain`).toBe(true);
    // The planet's own mountain fills the whole two-by-two the build's notch sits in.
    const under = new Set(block.map((c) => key({ x: c.x + offset.x, y: c.y + offset.y })));
    const target = customPlanet('knoll', 40, (x, y) => (under.has(key({ x, y })) ? 1 : 0));
    paint([at, { x: at.x + 1, y: at.y }, { x: at.x + 1, y: at.y + 1 }], 1);
    const watermark = kit.executor.getUndoStackSize();
    expect(kit.executor.execute({
      type: CommandType.TrimCorners, timestamp: 0, x: notch.x, y: notch.y, layer: 'terrain',
      beforeCorners: undefined, afterCorners: ['empty', 'fan', 'empty', 'empty'],
      patchOnly: true, terrainType: TerrainType.Mountain, elevation: 1, patchBase: 0,
    }).success).toBe(true);
    kit.executor.commitStroke(watermark);
    const fillet = getCell(kit.state.cells, notch.x, notch.y)?.terrain;
    expect(fillet?.patchOnly).toBe(true);

    const preview = previewTransfer(kit, target);
    expect(getCell(preview.state.cells, notch.x + offset.x, notch.y + offset.y)?.terrain).toEqual(fillet);
    expect(preview.dropped).toEqual([]);
  });

  it('keeps a ground islet cut where the planet had a mountain', () => {
    const kit = currentKit()!;
    const offset = plazaOffset(kit.state.template, customPlanet('islet', 40));
    // The islet cell's top-left corner is wrapped by ground-level water on all three sides.
    const islet = sourceCellLanding(kit.state, offset, (d) => d.x >= 8 && d.x <= 12 && d.y >= 6 && d.y <= 9);
    const water = [{ x: islet.x - 1, y: islet.y }, { x: islet.x, y: islet.y - 1 }, { x: islet.x - 1, y: islet.y - 1 }];
    for (const c of water) expect(takesTerrain(kit.state, c.x, c.y), `${c.x},${c.y} takes terrain`).toBe(true);
    const watermark = kit.executor.getUndoStackSize();
    expect(kit.executor.execute({
      type: CommandType.PaintTerrain, timestamp: 0, cells: water, terrainType: TerrainType.Water, elevation: 0,
    }).success).toBe(true);
    expect(kit.executor.execute({
      type: CommandType.TrimCorners, timestamp: 0, x: islet.x, y: islet.y, layer: 'terrain',
      beforeCorners: undefined, afterCorners: ['fan', 'square', 'square', 'square'],
    }).success).toBe(true);
    kit.executor.commitStroke(watermark);
    const cut = getCell(kit.state.cells, islet.x, islet.y)?.terrain;
    expect(cut?.type).toBe(TerrainType.None);

    const at = { x: islet.x + offset.x, y: islet.y + offset.y };
    const target = customPlanet('islet-hill', 40, (x, y) => (x === at.x && y === at.y ? 1 : 0));
    const preview = previewTransfer(kit, target);
    expect(getCell(preview.state.cells, at.x, at.y)?.terrain).toEqual(cut);
    expect(preview.dropped).toEqual([]);
    expect(preview.droppedCounts).toEqual({ cells: 0, objects: 0 });
  });

  it('stands a carried object on the ground it stood on, clearing the planet under it', () => {
    const kit = currentKit()!;
    const target = customPlanet('tree-ridge', 40, (x, y) => (y >= 3 && y <= 6 && x >= 4 && x <= 16 ? 2 : 0));
    const offset = plazaOffset(kit.state.template, target);
    const spot = sourceCellLanding(kit.state, offset, (d) => d.y === 4 && d.x >= 8 && d.x <= 12);
    const watermark = kit.executor.getUndoStackSize();
    expect(kit.executor.execute({
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'tree-on-ridge', catalogId: 'tree-apple', position: { ...spot }, rotation: 0, elevation: 0 },
    }).success).toBe(true);
    kit.executor.commitStroke(watermark);

    const preview = previewTransfer(kit, target);
    const tree = preview.state.objects.get('tree-on-ridge');
    const at = { x: spot.x + offset.x, y: spot.y + offset.y };
    expect(tree?.position).toEqual(at);
    expect(tree?.elevation).toBe(0);
    // A whole-cell footprint rests on the two-by-two of terrain cells from its own cell down-right.
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      expect(getCell(preview.state.cells, at.x + dx, at.y + dy)?.terrain ?? null).toBeNull();
    }
    expect(preview.droppedCounts).toEqual({ cells: 0, objects: 0 });
    // The ridge stands everywhere else.
    expect(getCell(preview.state.cells, at.x + 2, at.y)?.terrain?.elevation).toBe(2);
    expect(getCell(preview.state.cells, at.x - 1, at.y)?.terrain?.elevation).toBe(2);
  });

  it('clears the planet under the terrain cells a half-step footprint rests on', () => {
    const kit = currentKit()!;
    const target = customPlanet('deck-ridge', 40, (x, y) => (y >= 3 && y <= 8 && x >= 4 && x <= 16 ? 1 : 0));
    const offset = plazaOffset(kit.state.template, target);
    const spot = sourceCellLanding(kit.state, offset, (d) => d.y === 5 && d.x === 8);
    // Laid straight into the map: a bridge needs water to stand, and only its footprint is at issue.
    kit.state.objects.set('deck', {
      id: 'deck', catalogId: 'bridge-plank', position: { x: spot.x + 0.5, y: spot.y + 0.5 },
      rotation: 0, spanLength: 3, elevation: 0,
    });

    const preview = previewTransfer(kit, target);
    // x from 8.5 to 11.5 and y from 5.5 to 6.5 rest on terrain columns 9 to 11 of row 6, which
    // spans y 5.5 to 6.5 on the terrain grid.
    for (let x = 9; x <= 11; x++) expect(getCell(preview.state.cells, x, 6)?.terrain ?? null, `${x},6`).toBeNull();
    for (const [x, y] of [[8, 6], [12, 6], [10, 5], [10, 7]] as const) {
      expect(getCell(preview.state.cells, x, y)?.terrain?.elevation, `${x},${y}`).toBe(1);
    }
    kit.state.objects.delete('deck');
  });

  it('keeps carried low ground beside a tall planet ridge', () => {
    const kit = currentKit()!;
    // A supported ridge: a core at 4 on a ring at 1.
    const planet = (x: number, y: number): number => {
      if (x < 4 || x > 18 || y < 3 || y > 12) return 0;
      return x >= 5 && x <= 17 && y >= 4 && y <= 11 ? 4 : 1;
    };
    const target = customPlanet('tall-ridge', 40, planet);
    const offset = plazaOffset(kit.state.template, target);
    const first = sourceCellLanding(kit.state, offset, (d) => d.y === 4 && d.x === 6);
    const run = [0, 1, 2, 3].map((i) => ({ x: first.x + i, y: first.y }));
    for (const c of run) expect(takesTerrain(kit.state, c.x, c.y), `${c.x},${c.y} takes terrain`).toBe(true);
    paint(run, 1);
    expect(rules.validatePostStroke(makeFresh(target))).toEqual([]);

    const preview = previewTransfer(kit, target);
    expect(preview.droppedCounts.cells).toBe(0);
    for (const c of run) expect(getCell(preview.state.cells, c.x + offset.x, c.y + offset.y)?.terrain?.elevation).toBe(1);
  });
});

describe('asking for the preview', () => {
  const deferred = () => { let open!: () => void; const idle = new Promise<void>((r) => { open = r; }); return { idle, open }; };

  it('replays on this thread only once it is idle, where no worker runs', async () => {
    paint([{ x: 40, y: 40 }], 1);
    const target = getMapTemplate('tafa');
    const { idle, open } = deferred();
    let answered = false;
    const asked = requestTransferPreview(currentKit()!.state, target, { signal: { cancelled: false }, whenIdle: () => idle });
    void asked.then(() => { answered = true; });
    await Promise.resolve();
    expect(answered).toBe(false);
    open();
    const preview = await asked;
    expect(mapFingerprint(preview!.state)).toBe(mapFingerprint(previewTransfer(currentKit()!, target).state));
  });

  it('answers null for a request cancelled before it ran', async () => {
    const { idle, open } = deferred();
    const signal = { cancelled: false };
    const asked = requestTransferPreview(currentKit()!.state, getMapTemplate('tafa'), { signal, whenIdle: () => idle });
    signal.cancelled = true;
    open();
    expect(await asked).toBeNull();
  });

  it('does not wait for idle time for a request already cancelled', async () => {
    const whenIdle = vi.fn(async () => {});
    expect(await requestTransferPreview(currentKit()!.state, getMapTemplate('tafa'), { signal: { cancelled: true }, whenIdle })).toBeNull();
    expect(whenIdle).not.toHaveBeenCalled();
  });

  it('replays on this thread when the worker pool cannot start', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('worker blocked'); } });
    try {
      const target = getMapTemplate('tafa');
      const preview = await requestTransferPreview(currentKit()!.state, target, { signal: { cancelled: false }, whenIdle: async () => {} });
      expect(preview?.state.template).toBe(target);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('cost', () => {
  it('previews a generated build onto a full-size planet', async () => {
    const config: GenerateConfig = {
      algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed: 4242, region: null, richness: 1,
    };
    await generateMap(currentKit()!, { config, region: null });
    const target = customPlanet('full', 256, (x, y) => ((x * 5 + y * 11) % 37 === 0 ? 1 : 0));
    previewTransfer(currentKit()!, target);
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      previewTransfer(currentKit()!, target);
      runs.push(performance.now() - t0);
    }
    const median = [...runs].sort((a, b) => a - b)[1]!;
    console.log(`[measure] previewTransfer hexia build onto 256x256: median ${median.toFixed(1)} ms (${runs.map((r) => r.toFixed(1)).join(', ')})`);
    expect(median).toBeGreaterThan(0);
  }, 120_000);
});
