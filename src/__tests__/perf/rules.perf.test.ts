/*
 * Times both validation phases on the dense map: a post-stroke pass over the whole state, and
 * pre-command checks, which a generation run issues by the thousand and whose index-backed rules
 * scale with the object count.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { denseIsland } from './_fixtures';
import { generateObjectId } from '../../core/model/object-id';
import { getCell } from '../../core/model/grid-model';
import { getPlaceableByCategory } from '../../state/catalog';
import { CommandType, TerrainType, type MacroCoord, type PaintTerrainCommand, type PlaceObjectCommand } from '../../core/model/types';
import type { World } from './_fixtures';
import { ItemCategory } from '../../config/catalog/categories';

const s = perfSuite('rules');

/** The first cell in raster order that `executor.validatePre` accepts a bare-ground repaint of, so
 *  every PaintTerrain pre-command rule runs and passes rather than being dodged by a hand-picked cell. */
function findLegalPaintCell(world: World): MacroCoord {
  const { state, executor } = world;
  const { width, height } = state.template;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const cmd: PaintTerrainCommand = {
        type: CommandType.PaintTerrain,         cells: [{ x, y }], terrainType: TerrainType.None, elevation: 0,
      };
      if (executor.validatePre(cmd).length === 0) return { x, y };
    }
  }
  throw new Error('perf fixture: no legal paint cell found on the dense map');
}

/** Water cells in raster order, evenly sampled down to `limit`: the likeliest bridge anchors, though
 *  most still refuse because a span needs flat equal-height banks on both sides. */
function sampleWaterCells(world: World, limit: number): MacroCoord[] {
  const { state } = world;
  const { width, height } = state.template;
  const all: MacroCoord[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (getCell(state.cells, x, y)?.terrain?.type === TerrainType.Water) all.push({ x, y });
    }
  }
  if (all.length <= limit) return all;
  const stride = all.length / limit;
  return Array.from({ length: limit }, (_, i) => all[Math.floor(i * stride)]!);
}

function placeCmd(catalogId: string, position: MacroCoord): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,     object: { id: generateObjectId(), catalogId, position, rotation: 0, elevation: 0 },
  };
}

describe.runIf(PERF)('perf: rules', () => {
  it('post-stroke: full validation pass over the dense map', async () => {
    const world = denseIsland();
    await s.bench('post-stroke/validate-dense', () => {
      world.executor.getRegistry().validatePostStroke(world.state);
    }, { meta: { objects: world.state.objects.size } });
  });

  it('pre-command: 500 validations of a legal PaintTerrain command', async () => {
    const world = denseIsland();
    const cell = findLegalPaintCell(world);
    const cmd: PaintTerrainCommand = {
      type: CommandType.PaintTerrain,       cells: [cell], terrainType: TerrainType.None, elevation: 0,
    };
    await s.bench('pre-command/paint-probe-500', () => {
      for (let i = 0; i < 500; i++) world.executor.validatePre(cmd);
    }, { meta: { objects: world.state.objects.size } });
  });

  it('pre-command: a large Building placement over 100 positions', async () => {
    const world = denseIsland();
    const buildings = getPlaceableByCategory(ItemCategory.Building);
    const item = buildings.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    const { width, height } = world.state.template;
    const w = Math.max(1, width - item.width), h = Math.max(1, height - item.height);
    const positions = Array.from({ length: 100 }, (_, i) => ({ x: (i * 41) % w, y: (i * 61) % h }));
    let validatedOk = 0;
    for (const pos of positions) if (world.executor.validatePre(placeCmd(item.id, pos)).length === 0) validatedOk++;

    await s.bench('pre-command/place-building', () => {
      for (const pos of positions) world.executor.validatePre(placeCmd(item.id, pos));
    }, { meta: { catalogId: item.id, footprint: `${item.width}x${item.height}`, validatedOk } });
  });

  it('pre-command: a bridge placement over 100 water positions', async () => {
    const world = denseIsland();
    const item = getPlaceableByCategory(ItemCategory.Bridge)[0]!;
    const positions = sampleWaterCells(world, 100);
    let validatedOk = 0;
    for (const pos of positions) if (world.executor.validatePre(placeCmd(item.id, pos)).length === 0) validatedOk++;

    await s.bench('pre-command/place-bridge', () => {
      for (const pos of positions) world.executor.validatePre(placeCmd(item.id, pos));
    }, { meta: { catalogId: item.id, positions: positions.length, validatedOk } });
  });
});
