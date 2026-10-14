import { commandGrid, getCell, sameTerrain } from '../model/grid-model';
import { TERRAIN_GRID } from '../game/profile';
import {
  CommandType,
  type CellSnapshot,
  type Command,
  type GridState,
  type MacroCell,
  type PlacedObject,
} from '../model/types';
import { cellKey } from '../grid/rect';
import { boundedMap } from '../base/bounded-map';
import { ProvenanceTracker, type Author, type TaintDelta } from '../provenance/tracker';
import type { SourceContext, MapProvenanceSummary, UnitTaint } from '../provenance/types';
import type { OpKind } from '../provenance/policy';
import type { HistoryRecorder } from '../model/history-recorder';

/** How many removed objects' taint the recorder keeps for a re-seat to find. */
const TOMBSTONE_MAX = 4096;

/**
 * The executor's history recorder for authorship: the ProvenanceTracker, the derived-op depth (set
 * while the stroke policy's repairs issue their own commands), per-command taint capture, group
 * merge and the revert/reapply lockstep, called in the order `model/history-recorder.ts` states.
 */
export class ProvenanceRecorder implements HistoryRecorder {
  private tracker: ProvenanceTracker;
  private state: GridState;
  private deriving = 0;
  /** The taint of recently removed objects, by id: the one way a move keeps its author. A move or a
   *  rotation is RemoveObject followed by PlaceObject under the same id (fresh objects always draw
   *  fresh ids, and undo and redo bypass capture), so a place that finds its id here is a re-seat:
   *  the unit keeps the taint it had instead of being re-authored by whoever dragged it. Bounded:
   *  genuinely deleted objects leave entries behind and the oldest go first, so a re-seat after
   *  `TOMBSTONE_MAX` later removals counts as new work. */
  private tombstones = boundedMap<string, UnitTaint>(TOMBSTONE_MAX);

  /** `appVersion` is the running build's version, stamped on every operation recorded here. */
  constructor(state: GridState, appVersion?: string) {
    this.state = state;
    this.tracker = new ProvenanceTracker(state.template.width, state.template.height, { adopt: state.provenance, appVersion });
    state.provenance = this.tracker.state;
  }

  /** Run `fn` inside the derived-op scope: commands captured while it runs (the auto-reconcile repairs)
   *  are flagged derived. Restores the depth even on throw. */
  deriveScope<T>(fn: () => T): T {
    this.deriving++;
    try { return fn(); } finally { this.deriving--; }
  }

  /** Records the provenance delta for a just-applied command. Returns undefined when the command
   *  produced no tainting op (e.g. a no-op terrain paint). */
  capture(cmd: Command, before: CellSnapshot[], after: CellSnapshot[], objects?: { removed: PlacedObject[] }): TaintDelta | undefined {
    const { layers, zones } = scopeLayersZones(commandGrid(cmd) === TERRAIN_GRID ? after.map((s) => s.cell) : this.anchorCell(cmd, objects?.removed));
    const meta = (derived: boolean) => ({ layers, zones, derived });
    const deltas: TaintDelta[] = [];
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      const beforeT = new Map(before.map((s) => [cellKey(s.coord.x, s.coord.y), s.cell.terrain]));
      const byKind: Record<OpKind, { x: number; y: number }[]> = { create: [], replace: [], cosmetic: [], delete: [] };
      for (const s of after) {
        const had = beforeT.get(cellKey(s.coord.x, s.coord.y)) ?? null;
        const now = s.cell.terrain;
        if (!had && now) byKind.create.push(s.coord);
        // A repaint that changed nothing re-authors nothing: the water brush repaints every cell
        // under it by design, and presence-only classing handed a whole standing lake to whoever
        // dragged across it.
        else if (had && now && !sameTerrain(had, now, { patchOnly: 'exact' })) byKind.replace.push(s.coord);
        else if (had && !now) byKind.delete.push(s.coord);
      }
      for (const k of ['create', 'replace', 'delete'] as OpKind[]) {
        if (byKind[k].length) deltas.push(this.tracker.record(k, byKind[k], [], meta(this.deriving > 0)));
      }
    } else if (cmd.type === CommandType.PlaceObject) {
      const carried = this.tombstones.get(cmd.object.id);
      if (carried) {
        this.tombstones.delete(cmd.object.id);
        deltas.push(this.tracker.restoreObjectTaint(cmd.object.id, carried, meta(this.deriving > 0)));
      } else {
        deltas.push(this.tracker.record('create', [], [{ id: cmd.object.id, kind: 'create' }], meta(this.deriving > 0)));
      }
    } else if (cmd.type === CommandType.RemoveObject) {
      const live = this.tracker.state.objectTaint.get(cmd.objectId);
      if (live) {
        // Delete-then-set: Map.set on a standing key keeps its old insertion slot, and eviction
        // walks insertion order — a mass clear must not push out the object about to be dragged.
        this.tombstones.delete(cmd.objectId);
        this.tombstones.set(cmd.objectId, { ...live, contribution: { ...live.contribution } });
      }
      deltas.push(this.tracker.record('delete', [], [{ id: cmd.objectId, kind: 'delete' }], meta(this.deriving > 0)));
    } else if (cmd.type === CommandType.TrimCorners) {
      if (cmd.layer === 'road') {
        const kind: OpKind = this.state.objects.has(cmd.objectId) ? 'cosmetic' : 'delete';
        deltas.push(this.tracker.record(kind, [], [{ id: cmd.objectId, kind }], meta(this.deriving > 0)));
      } else {
        // A corner cycle that took the last of the cell (all-empty corners on a bare patch) is a
        // delete: a cosmetic op never clears taint, and bare ground with an author is a ghost the
        // summary counts forever.
        const emptied = !getCell(this.state.cells, cmd.x, cmd.y)?.terrain;
        deltas.push(this.tracker.record(emptied ? 'delete' : 'cosmetic', [{ x: cmd.x, y: cmd.y }], [], meta(this.deriving > 0)));
      }
    }
    return deltas.length ? this.tracker.mergeDeltas(deltas) : undefined;
  }

  /** An object edit snapshots no map cell; its op is scoped by the map cell at its anchor's index.
   *  A removal reads the anchor of the object it took off the map. */
  private anchorCell(cmd: Command, removed: readonly PlacedObject[] = []): MacroCell[] {
    const at = cmd.type === CommandType.PlaceObject ? cmd.object.position
      : cmd.type === CommandType.RemoveObject ? removed.find((o) => o.id === cmd.objectId)?.position
        : cmd.type === CommandType.TrimCorners ? { x: cmd.x, y: cmd.y } : null;
    const cell = at && getCell(this.state.cells, at.x, at.y);
    return cell ? [cell] : [];
  }

  /** Merges a collapsed group's per-entry taint deltas into one; a re-seat inside the group already
   *  carried its taint through the tombstones. Returns undefined when the group carried no taint. */
  mergeGroup(taints: (TaintDelta | undefined)[]): TaintDelta | undefined {
    const deltas = taints.filter((d): d is TaintDelta => !!d);
    return deltas.length ? this.tracker.mergeDeltas(deltas) : undefined;
  }

  /** Restore an entry's taint to its `before` state and mark its ops reverted. Call before the cell restore. */
  revertTaint(taint: TaintDelta): void {
    this.tracker.applyDelta(taint, 'before');
    this.tracker.markReverted(taint.opIds);
  }

  /** Restore an entry's taint to its `after` state and mark its ops applied. Call before the cell restore. */
  reapplyTaint(taint: TaintDelta): void {
    this.tracker.applyDelta(taint, 'after');
    this.tracker.markApplied(taint.opIds);
  }

  pushSource(ctx: SourceContext): void { this.tracker.pushSource(ctx); }
  popSource(): void { this.tracker.popSource(); }
  withSource<T>(ctx: SourceContext, fn: () => T): T { return this.tracker.withSource(ctx, fn); }
  getSummary(): MapProvenanceSummary { return this.tracker.getSummary(); }
  currentSource(): SourceContext { return this.tracker.currentSource(); }
  cellAuthor(x: number, y: number): Author { return this.tracker.cellAuthor(x, y); }
  objectAuthor(id: string): Author { return this.tracker.objectAuthor(id); }
  adoptTransplant(...args: Parameters<ProvenanceTracker['adoptTransplant']>): void { this.tracker.adoptTransplant(...args); }
}

function scopeLayersZones(after: readonly MacroCell[]): { layers: number[]; zones: number[] } {
  const L = new Set<number>(), Z = new Set<number>();
  for (const cell of after) {
    Z.add(cell.zone);
    const e = cell.terrain?.elevation;
    if (e) for (let i = 1; i <= e; i++) L.add(i);
  }
  return { layers: [...L], zones: [...Z] };
}
