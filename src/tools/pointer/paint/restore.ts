/**
 * Putting part of the map back to an earlier picture through commands, so the restore joins the
 * caller's own undo step and passes the same rules as any edit.
 *
 * `restoreCommands` turns a target (cells with the terrain they must hold, objects as they must
 * stand) into the commands that reach it from the live map. `StrokePreimage` builds that target
 * from the history a stroke left: the first `before` snapshot of every cell it touched, including
 * the neighbours its auto-trim reached, and the first pre-image of every object it removed or
 * changed. An adjusted curve restores through it before it is laid again.
 */
import { eraseTerrainCommand, paintTerrainCommand, placeObjectCommand, removeObjectCommand, materialisePatchCommand, trimTerrainCommand } from '../../../core/model/command-build';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { SQUARE_CORNERS } from '../../../core/model/corners';
import { clonePlacedObject, sameTerrain } from '../../../core/model/grid-model';
import { cellKey } from '../../../core/grid/rect';
import {
  TerrainType,
  type CellSnapshot, type Command, type Corners, type GridState, type MacroCoord, type PlacedObject, type TerrainCell,
} from '../../../core/model/types';
import type { HistoryEntry } from '../../../core/commands/command-apply';
import type { CommandSink } from '../../../core/model/command-sink';

/** What a restore must reach. */
export interface RestoreTarget {
  /** Cells to put back, with the terrain each must hold. */
  readonly cells: Iterable<{ readonly x: number; readonly y: number; readonly terrain: TerrainCell | null }>;
  /** What each object in scope must be; an in-scope id missing here must not exist. */
  readonly objects: ReadonlyMap<string, PlacedObject>;
  /** The object ids the restore may touch; absent means every object on the map. */
  readonly scope?: ReadonlySet<string>;
}

/** Field-order-independent object equality: history copies and live objects build their fields in
 *  different orders. */
function canonical(obj: PlacedObject | undefined): string {
  return obj === undefined ? '' : JSON.stringify(obj, Object.keys(obj).concat(Object.keys(obj.position)).sort());
}

/** The commands that turn `current` into `target`: object removals, erasures, paints stacked up from
 *  each cell's standing surface, silhouettes, then object placements. */
export function restoreCommands(current: GridState, target: RestoreTarget): Command[] {
  const commands: Command[] = [], replacements: Command[] = [];
  for (const [id, obj] of current.objects) {
    if (target.scope && !target.scope.has(id)) continue;
    if (canonical(obj) !== canonical(target.objects.get(id))) commands.push(removeObjectCommand(obj));
  }
  for (const [id, obj] of target.objects) {
    if (canonical(obj) !== canonical(current.objects.get(id))) replacements.push(placeObjectCommand(obj));
  }
  const erase: MacroCoord[] = [];
  const mountains = new Map<number, MacroCoord[]>(), water = new Map<number, MacroCoord[]>();
  const corners: Command[] = [];
  const group = (groups: Map<number, MacroCoord[]>, e: number, c: MacroCoord): void => {
    const cells = groups.get(e) ?? []; cells.push(c); groups.set(e, cells);
  };
  for (const { x, y, terrain: wanted } of target.cells) {
    const standing = current.cells[y]?.[x]?.terrain ?? null;
    if (sameTerrain(wanted, standing, { patchOnly: 'flag' })) continue;
    const c = { x, y };
    const sameBody = wanted && standing && wanted.type === standing.type && wanted.elevation === standing.elevation
      && !wanted.patchOnly && !standing.patchOnly;
    if (!wanted || wanted.type === TerrainType.None) erase.push(c);
    else if (!wanted.patchOnly && !sameBody) {
      const from = surfaceElevation(standing);
      for (let e = Math.min(from + 1, wanted.elevation); e <= wanted.elevation; e++) {
        if (e === wanted.elevation && wanted.type === TerrainType.Water) group(water, e, c);
        else group(mountains, e, c);
      }
    }
    if (wanted && (wanted.corners || wanted.patchOnly || sameBody && standing?.corners)) {
      const after: Corners = wanted.corners ? [...wanted.corners] : [...SQUARE_CORNERS];
      corners.push(wanted.patchOnly
        ? materialisePatchCommand(x, y, after, { terrainType: wanted.type, elevation: wanted.elevation, patchBase: wanted.patchBase })
        : trimTerrainCommand(x, y, after));
    }
  }
  if (erase.length > 0) commands.push(eraseTerrainCommand(erase));
  for (const [type, groups] of [[TerrainType.Mountain, mountains], [TerrainType.Water, water]] as const) {
    for (const [e, cells] of [...groups].sort(([a], [b]) => a - b)) {
      commands.push(paintTerrainCommand(cells, type, e));
    }
  }
  return [...commands, ...corners, ...replacements];
}

/** The map as it stood before a run of strokes, read off their history, for the cells and objects
 *  they touched. Later strokes only add what earlier ones left alone, so the picture stays the one
 *  before the first stroke. */
export class StrokePreimage {
  private readonly cells = new Map<string, CellSnapshot>();
  private readonly objects = new Map<string, PlacedObject>();
  private readonly scope = new Set<string>();

  /** Fold in the entries one stroke left. Read them before anything rolls them back. */
  record(entries: readonly HistoryEntry[]): void {
    for (const entry of entries) {
      for (const s of entry.before) {
        const k = cellKey(s.coord.x, s.coord.y);
        if (!this.cells.has(k)) this.cells.set(k, s);
      }
      const ops = entry.objectOps ?? { removed: [], added: [] };
      for (const o of ops.removed) {
        if (this.scope.has(o.id)) continue;
        this.scope.add(o.id);
        this.objects.set(o.id, clonePlacedObject(o));
      }
      for (const o of ops.added) this.scope.add(o.id);
    }
  }

  /** The commands that put `current` back to this picture; empty once it is there. */
  commands(current: GridState): Command[] {
    const cells = [...this.cells.values()]
      .sort((a, b) => a.coord.y - b.coord.y || a.coord.x - b.coord.x)
      .map((s) => ({ x: s.coord.x, y: s.coord.y, terrain: s.cell.terrain ?? null }));
    return restoreCommands(current, { cells, objects: this.objects, scope: this.scope });
  }
}

/**
 * Put the map back to `preimage`, all or nothing: a refused command stops the restore and returns
 * false, for the caller to roll back. A terrain restore runs the executor's cut repair on its
 * neighbours, so a second pass puts back any silhouette the first one moved. Returns whether the
 * map now matches the picture.
 */
export function restoreStroke(host: CommandSink, preimage: StrokePreimage): boolean {
  for (let pass = 0; pass < 2; pass++) {
    const commands = preimage.commands(host.state);
    if (commands.length === 0) return true;
    for (const cmd of commands) if (!host.execute(cmd).success) return false;
  }
  return preimage.commands(host.state).length === 0;
}
