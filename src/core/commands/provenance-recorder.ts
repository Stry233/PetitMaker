import {
  CommandType,
  type CellSnapshot,
  type Command,
  type GridState,
} from '../model/types';
import { cellKey } from '../model/grid-model';
import { ProvenanceTracker, type TaintDelta } from '../provenance/tracker';
import type { SourceContext, MapProvenanceSummary } from '../provenance/types';
import type { OpKind } from '../provenance/policy';

/**
 * Owns all provenance threading for the executor: the ProvenanceTracker, the
 * `deriving` depth (a derived-op scope, set while auto-reconcile issues its own
 * commands), per-command taint capture, group merge, and revert/reapply taint
 * lockstep. The executor keeps its public pass-throughs but forwards them here.
 *
 * ORDER CONTRACT — the executor must call these AROUND state mutation exactly as
 * it did inline: capture AFTER apply (reads before/after); revert/reapply taint
 * BEFORE the state restore; deriveScope wraps the reconcile pass so its nested
 * commands record as derived.
 */
export class ProvenanceRecorder {
  private tracker: ProvenanceTracker;
  private state: GridState;
  private deriving = 0;

  constructor(state: GridState) {
    this.state = state;
    this.tracker = new ProvenanceTracker(state.template.width, state.template.height, { adopt: state.provenance });
    state.provenance = this.tracker.state;
  }

  /** Run `fn` inside the DERIVED-op scope: commands captured while it runs (the auto-reconcile repairs)
   *  are flagged derived. Restores the depth even on throw. */
  deriveScope<T>(fn: () => T): T {
    this.deriving++;
    try { return fn(); } finally { this.deriving--; }
  }

  /** Records the provenance delta for a just-applied command. Returns undefined when the command
   *  produced no tainting op (e.g. a no-op terrain paint). */
  capture(cmd: Command, before: CellSnapshot[], after: CellSnapshot[]): TaintDelta | undefined {
    const { layers, zones } = scopeLayersZones(after);
    const meta = (derived: boolean) => ({ layers, zones, derived });
    const deltas: TaintDelta[] = [];
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      const beforeT = new Map(before.map((s) => [cellKey(s.coord.x, s.coord.y), s.cell.terrain]));
      const byKind: Record<OpKind, { x: number; y: number }[]> = { create: [], replace: [], cosmetic: [], delete: [] };
      for (const s of after) {
        const had = beforeT.get(cellKey(s.coord.x, s.coord.y)) ?? null;
        const now = s.cell.terrain;
        if (!had && now) byKind.create.push(s.coord);
        else if (had && now) byKind.replace.push(s.coord);
        else if (had && !now) byKind.delete.push(s.coord);
      }
      for (const k of ['create', 'replace', 'delete'] as OpKind[]) {
        if (byKind[k].length) deltas.push(this.tracker.record(k, byKind[k], [], meta(this.deriving > 0)));
      }
    } else if (cmd.type === CommandType.PlaceObject) {
      deltas.push(this.tracker.record('create', [], [{ id: cmd.object.id, kind: 'create' }], meta(this.deriving > 0)));
    } else if (cmd.type === CommandType.RemoveObject) {
      deltas.push(this.tracker.record('delete', [], [{ id: cmd.objectId, kind: 'delete' }], meta(this.deriving > 0)));
    } else if (cmd.type === CommandType.TrimCorners) {
      if (cmd.layer === 'road' && cmd.objectId) {
        const kind: OpKind = this.state.objects.has(cmd.objectId) ? 'cosmetic' : 'delete';
        deltas.push(this.tracker.record(kind, [], [{ id: cmd.objectId, kind }], meta(this.deriving > 0)));
      } else {
        deltas.push(this.tracker.record('cosmetic', [{ x: cmd.x, y: cmd.y }], [], meta(this.deriving > 0)));
      }
    }
    return deltas.length ? this.tracker.mergeDeltas(deltas) : undefined;
  }

  /** Merges a collapsed group's per-entry taint deltas into one, finalizing object-modify pairs.
   *  Returns undefined when the group carried no taint. */
  mergeGroup(taints: (TaintDelta | undefined)[]): TaintDelta | undefined {
    const deltas = taints.filter((d): d is TaintDelta => !!d);
    return deltas.length
      ? this.tracker.finalizeObjectModifies(this.tracker.mergeDeltas(deltas))
      : undefined;
  }

  /** Restore an entry's taint to its `before` state and mark its ops reverted. Call BEFORE the cell restore. */
  revertTaint(taint: TaintDelta): void {
    this.tracker.applyDelta(taint, 'before');
    this.tracker.markReverted(taint.opIds);
  }

  /** Restore an entry's taint to its `after` state and mark its ops applied. Call BEFORE the cell restore. */
  reapplyTaint(taint: TaintDelta): void {
    this.tracker.applyDelta(taint, 'after');
    this.tracker.markApplied(taint.opIds);
  }

  pushSource(ctx: SourceContext): void { this.tracker.pushSource(ctx); }
  popSource(): void { this.tracker.popSource(); }
  withSource<T>(ctx: SourceContext, fn: () => T): T { return this.tracker.withSource(ctx, fn); }
  noteAnalysisOnly(): void { this.tracker.noteAnalysisOnly(); }
  getSummary(): MapProvenanceSummary { return this.tracker.getSummary(); }
  getTracker(): ProvenanceTracker { return this.tracker; }
}

function scopeLayersZones(after: CellSnapshot[]): { layers: number[]; zones: number[] } {
  const L = new Set<number>(), Z = new Set<number>();
  for (const s of after) {
    Z.add(s.cell.zone);
    const e = s.cell.terrain?.elevation;
    if (e) for (let i = 1; i <= e; i++) L.add(i);
  }
  return { layers: [...L], zones: [...Z] };
}
