/**
 * The coordinate spaces at the editor's seams do not mix: a cell of one grid is not a cell of
 * another, a continuous map point is not a cell, a bare `{ x, y }` is neither until something that
 * knows its space says so, and a storage bucket is not a reference region. These are compile-time
 * facts, checked by the type checker over this file.
 */
import { describe, expectTypeOf, it } from 'vitest';
import {
  cellSet, evidenceOn, gridCell, mapPoint, onGrid,
  type CellSet, type GridCell, type GridId, type MapPoint,
} from '../../../core/grid/grids';
import { bucketOf } from '../../../core/grid/buckets';
import { mapChunkAt } from '../../../core/grid/map-chunks';
import type { BucketCoord, MacroCoord, RegionCoord, ValidationError } from '../../../core/model/types';
import { resolvePointer } from '../../../tools/pointer/runtime/pointer';
import { cellAtPoint, cellUnder, halfPoint } from '../../../core/grid/pointer';
import type { Tool } from '../../../tools/pointer/runtime/types';
import type { ToolOverlay, ViewProjection } from '../../../tools/pointer/runtime';

type ObjectCell = GridCell<'object'>;
type TerrainCell = GridCell<'terrain'>;

describe('grid cells', () => {
  it('keep each grid apart', () => {
    expectTypeOf<ObjectCell>().not.toMatchTypeOf<TerrainCell>();
    expectTypeOf<TerrainCell>().not.toMatchTypeOf<ObjectCell>();
  });

  it('are cells of some grid and plain coordinates', () => {
    expectTypeOf<ObjectCell>().toMatchTypeOf<GridCell>();
    expectTypeOf<TerrainCell>().toMatchTypeOf<GridCell<GridId>>();
    expectTypeOf<ObjectCell>().toMatchTypeOf<MacroCoord>();
  });

  it('are not made from a bare coordinate without naming the grid', () => {
    expectTypeOf<MacroCoord>().not.toMatchTypeOf<GridCell>();
    expectTypeOf(gridCell('terrain', { x: 1, y: 2 })).toEqualTypeOf<TerrainCell>();
    expectTypeOf(onGrid('object', [{ x: 1, y: 2 }])).toEqualTypeOf<ObjectCell[]>();
  });
});

describe('map points', () => {
  it('are neither cells nor bare coordinates', () => {
    expectTypeOf<MapPoint>().not.toMatchTypeOf<GridCell>();
    expectTypeOf<GridCell>().not.toMatchTypeOf<MapPoint>();
    expectTypeOf<MacroCoord>().not.toMatchTypeOf<MapPoint>();
    expectTypeOf(mapPoint({ x: 0.5, y: 2.25 })).toEqualTypeOf<MapPoint>();
  });

  it('are what a view reads and what a cell is resolved from', () => {
    expectTypeOf<ViewProjection['screenToPoint']>().returns.toEqualTypeOf<MapPoint>();
    expectTypeOf(cellAtPoint<'terrain'>).parameter(0).toEqualTypeOf<MapPoint>();
    expectTypeOf(cellAtPoint(mapPoint({ x: 0, y: 0 }), 'terrain')).toEqualTypeOf<TerrainCell>();
    expectTypeOf(cellUnder<'object'>).returns.toEqualTypeOf<ObjectCell>();
    expectTypeOf(halfPoint).parameter(0).toEqualTypeOf<MapPoint>();
    // @ts-expect-error a bare coordinate is no map point
    cellAtPoint({ x: 0, y: 0 }, 'object');
  });
});

describe('tools', () => {
  it('take a cell of their own grid and a map point', () => {
    expectTypeOf<Tool<'object'>['onPointerDown']>().parameter(0).toEqualTypeOf<ObjectCell>();
    expectTypeOf<Tool<'terrain'>['onPointerMove']>().parameter(0).toEqualTypeOf<TerrainCell>();
    expectTypeOf<Tool<'object'>['onPointerUp']>().parameter(1).toEqualTypeOf<MapPoint>();
    expectTypeOf<ObjectCell>().not.toMatchTypeOf<Parameters<Tool<'terrain'>['onPointerDown']>[0]>();
  });

  it('get the cell resolved on the grid they declare', () => {
    expectTypeOf(resolvePointer<'terrain'>).returns.toHaveProperty('cell').toEqualTypeOf<TerrainCell>();
  });
});

describe('cell sets and validation evidence', () => {
  it('tie their cells to the grid they name', () => {
    expectTypeOf(cellSet('terrain', [{ x: 1, y: 1 }])).toEqualTypeOf<CellSet<'terrain'>>();
    expectTypeOf<{ grid: 'terrain'; cells: readonly ObjectCell[] }>().not.toMatchTypeOf<CellSet>();
    expectTypeOf<{ grid: 'object'; cells: readonly ObjectCell[] }>().toMatchTypeOf<CellSet>();
    expectTypeOf<ToolOverlay['flashCommit']>().parameter(0).toEqualTypeOf<readonly CellSet[]>();
  });

  it('carry evidence on the grid each error names', () => {
    const terrainEvidence = { ruleId: 'r', message: 'm', ...evidenceOn('terrain', [{ x: 1, y: 1 }]) };
    expectTypeOf(terrainEvidence).toMatchTypeOf<ValidationError>();
    expectTypeOf<{ ruleId: string; message: string; grid: 'terrain'; cells: ObjectCell[] }>()
      .not.toMatchTypeOf<ValidationError>();
    expectTypeOf<{ ruleId: string; message: string; grid: 'object'; cells: MacroCoord[] }>()
      .not.toMatchTypeOf<ValidationError>();
  });
});

describe('chunks', () => {
  it('keep storage buckets and reference regions apart', () => {
    expectTypeOf<BucketCoord>().not.toMatchTypeOf<RegionCoord>();
    expectTypeOf<RegionCoord>().not.toMatchTypeOf<BucketCoord>();
    expectTypeOf(bucketOf).returns.toEqualTypeOf<BucketCoord>();
    expectTypeOf(mapChunkAt).returns.toEqualTypeOf<RegionCoord>();
  });
});
