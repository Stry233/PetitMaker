/*
 * How a map that breaks a post-stroke rule gives way at a flagged cell. A transfer's arrival and the
 * repair every load runs both take content back cell by cell until the rules pass; each caller owns
 * its rounds and applies the removals its own way.
 */
import type { GridState, MacroCoord, PlacedObject } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { cellKey } from '../core/grid/rect';
import { NEIGHBORS4 } from '../core/grid/directions';
import { surfaceElevation } from '../core/domain/terrain/terrain-surface';

/** The removals a settle makes; each answers whether it took effect. */
export interface SettleActions {
  eraseTerrain(c: MacroCoord): boolean;
  removeObject(obj: PlacedObject): boolean;
}

export interface BackOffOptions {
  /** The removable object standing on `c`, if any. */
  standingAt(c: MacroCoord): PlacedObject | null | undefined;
  /** "x,y" keys of cells whose terrain is fixed. A held cell never gives up its terrain; where a
   *  flagged cell is held, its unheld neighbours give way instead. */
  held?: ReadonlySet<string>;
}

/**
 * What the flagged cell `c` gives up, cheapest first: its own terrain, else the object standing on
 * it, else the terrain beside it that stands above it (and, at a held cell, any unheld neighbour's
 * terrain). Whether anything was taken.
 */
export function backOffAt(state: GridState, act: SettleActions, c: MacroCoord, opts: BackOffOptions): boolean {
  const held = opts.held;
  const isHeld = (x: number, y: number): boolean => !!held && held.has(cellKey(x, y));
  const cell = getCell(state.cells, c.x, c.y);
  if (cell?.terrain && !isHeld(c.x, c.y) && act.eraseTerrain(c)) return true;

  const obj = opts.standingAt(c);
  if (obj && act.removeObject(obj)) return true;

  const own = surfaceElevation(cell?.terrain);
  const ownHeld = isHeld(c.x, c.y);
  let changed = false;
  for (const [dx, dy] of NEIGHBORS4) {
    const x = c.x + dx, y = c.y + dy;
    const n = getCell(state.cells, x, y);
    if (!n?.terrain) continue;
    const gives = surfaceElevation(n.terrain) > own ? !isHeld(x, y) : ownHeld && !isHeld(x, y);
    if (gives && act.eraseTerrain({ x, y })) changed = true;
  }
  return changed;
}
