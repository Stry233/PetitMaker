// src/tools/generation/field.ts
import { CellZone, type GridState, type MapTemplate, type PlacedObject } from '../../core/model/types';
import { createGrid, createPlazaObject, getCell, cellKey } from '../../core/model/grid-model';
import { buildObjectOccupancy } from '../../state/object-geometry';
import type { Field } from './types';

/** Build a height field masked to grass cells (NaN elsewhere), all heights 0.
 *  Cells under an immutable object (the central plaza) are excluded from grass: terrain must not
 *  generate on the no-build platform — otherwise the commit's PaintTerrain over those cells is rejected
 *  by V-PLACE-BLOCK and the whole tier fails, yielding an empty map. */
export function makeField(state: GridState): Field {
  const { width, height } = state.template;
  const grass = new Uint8Array(width * height);
  const occ = buildObjectOccupancy(state);
  const isGrass = (x: number, y: number): boolean => getCell(state.cells, x, y)?.zone === CellZone.Grass;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = getCell(state.cells, x, y);
      // A terrain block renders -HALF_TILE (up-left), bleeding onto its UP, LEFT, and UP-LEFT (diagonal)
      // neighbours — V-ZONE-01 rejects painting where ANY of those is non-buildable, so the generator must
      // not generate terrain there either (else the batched commit hits that rejection). Exclude grass
      // cells with a non-grass up/left/up-left in-bounds neighbour (off-map neighbours are fine). The
      // diagonal matters at a convex beach corner: up+left grass but up-left beach (the top-left micro-block).
      const up = y > 0 ? isGrass(x, y - 1) : true;
      const left = x > 0 ? isGrass(x - 1, y) : true;
      const upLeft = (x > 0 && y > 0) ? isGrass(x - 1, y - 1) : true;
      const g = !!cell && cell.zone === CellZone.Grass && !occ.has(cellKey(x, y)) && up && left && upLeft;
      grass[y * width + x] = g ? 1 : 0;
    }
  }
  return { width, height, grass };
}

/** A fresh editor-equivalent GridState (grass + plaza, no terrain) for scratch validation. */
export function makeScratchState(template: MapTemplate): GridState {
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}
