import { EventBus } from './event-bus';
import { cloneCell, clonePlacedObject, getCell, cellKey, NEIGHBORS4 } from '../model/grid-model';
import type { RuleDispatcher } from '../model/rule-dispatcher';
import type { RoadLookup } from '../model/road-lookup';
import { reconcileCuts } from '../edge-cut/cut-reconcile';
import { reconcileRoads } from './road-reconcile';
import {
  CommandType,
  type CellSnapshot,
  type Command,
  type EditorEvents,
  type GridState,
  type MacroCoord,
  type PlacedObject,
  type ValidationError,
  type ValidationResult,
} from '../model/types';
import type { ProvenanceTracker } from '../provenance/tracker';
import type { SourceContext, MapProvenanceSummary } from '../provenance/types';
import {
  applyCommand,
  detachCommand,
  getAffectedCells,
  reapplyEntryState,
  revertEntryState,
  unrecoverableObjectOps,
  type HistoryEntry,
} from './command-apply';
import { ProvenanceRecorder } from './provenance-recorder';
import { reportRefusal } from './refusal';

/** How a stroke transaction runs its body. */
export interface TransactionOptions {
  /** Authorship for every command the body issues; popped on every exit. */
  source?: SourceContext;
  /** Silence validation-failed across the whole body, its commit included. */
  silent?: boolean;
}

/** The body's handle on its stroke group. */
export interface StrokeTransaction {
  /** The undo stack size when the transaction opened. */
  readonly start: number;
  /** `commitStroke` over the group. `atomic` reverts the whole group when the post-stroke rules
   *  report a violation, where a plain commit reverts only until the map is clean. */
  commit(opts?: { reconcile?: boolean; atomic?: boolean }): ValidationError[];
  /** Silently revert everything the group applied. */
  rollback(): void;
}

/**
 * Executes commands against GridState with two-phase validation.
 *
 * This class is the ORCHESTRATOR: validate → apply → record → history → events.
 * The two mechanical halves live in collaborators it drives, so this file reads
 * as the control flow only:
 *   - `command-apply.ts`  — the per-CommandType state mutation (cells + objects)
 *     for apply/revert/reapply, plus `getAffectedCells`. `objects-changed` is
 *     emitted at those mutation sites.
 *   - `provenance-recorder.ts` — the ProvenanceTracker, the derived-op scope, and
 *     all taint capture/merge/revert threading. Its calls must stay in the exact
 *     order relative to state mutation documented in that file.
 *
 * Phase 1 (pre-command): `execute()` runs all applicable pre-command rules.
 * If any return errors, the command is rejected and state is unchanged.
 *
 * Phase 2 (post-stroke): `commitStroke()` runs all post-stroke rules against
 * the current state. If violations exist, it auto-undoes commands from the
 * stroke one at a time until the state is clean or the stroke is fully reverted.
 *
 * Assumptions:
 * - State is owned exclusively by this executor during command execution.
 * - Rules are pure functions that never mutate state.
 * - Commands carry no snapshots; the executor records before/after cells on its own history entries.
 *
 * Guarantees:
 * - After `execute()` returns failure, state is unchanged.
 * - After `commitStroke()`, state satisfies all post-stroke rules.
 * - Undo skips through illegal intermediate states via post-stroke validation.
 */
export class CommandExecutor {
  private state: GridState;
  private eventBus: EventBus<EditorEvents>;
  private registry: RuleDispatcher;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Silenced runs in progress; while any is, rejected commands emit no validation-failed (no error
   *  toast). A count, so async runs that overlap and settle in any order restore it exactly. */
  private silentRuns = 0;
  private provenance: ProvenanceRecorder;
  /** Satisfies `CutReconcileTarget` and `RoadReconcileTarget` — the executor passes itself as the
   *  reconcile target. */
  readonly roadAt: RoadLookup;

  /** `roadAt` must answer for `state`. The reconcile pass reads terrain from one and coatings from
   *  the other and treats them as one map, so a lookup bound to a different grid reports roads that
   *  are not on the map being repaired. Bind the pair in one expression. */
  constructor(
    state: GridState,
    eventBus: EventBus<EditorEvents>,
    registry: RuleDispatcher,
    roadAt: RoadLookup,
  ) {
    this.state = state;
    this.eventBus = eventBus;
    this.registry = registry;
    this.roadAt = roadAt;
    this.provenance = new ProvenanceRecorder(state);
  }

  /** Pre-command validation with no execution and no validation-failed event — the reconcile
   *  passes probe with this, since their refusals are outcomes, not errors. */
  validatePre(cmd: Command): ValidationError[] {
    return this.registry.validatePreCommand(cmd, this.state);
  }

  /** Run `fn` with validation-failed events silenced — for bulk generation, which reject-and-skips many
   *  candidate commands by design and must not spew an error toast per rejection. Restores even on throw. */
  runSilently<T>(fn: () => T): T {
    this.silentRuns++;
    try { return fn(); } finally { this.silentRuns--; }
  }

  /** Async variant — keeps validation-failed silenced across awaits (cooperative generation yields between
   *  stages), restoring only once the whole run settles. */
  async runSilentlyAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.silentRuns++;
    try { return await fn(); } finally { this.silentRuns--; }
  }

  /**
   * Run `body` as one stroke group: the start is taken, `source` is pushed and `silent` applied
   * around the body, and a throw reverts the group before it propagates. The body decides when to
   * commit or roll back through the handle; a body that returns without committing leaves its
   * entries uncollapsed on the stack.
   */
  transaction<T>(opts: TransactionOptions, body: (tx: StrokeTransaction) => T): T {
    const tx = this.openTransaction();
    if (opts.source) this.pushSource(opts.source);
    try {
      return opts.silent ? this.runSilently(() => body(tx)) : body(tx);
    } catch (err) {
      this.rollbackAfterThrow(tx.start);
      throw err;
    } finally {
      if (opts.source) this.popSource();
    }
  }

  /** `transaction` for a body that awaits; the source and silence hold until it settles. */
  async transactionAsync<T>(opts: TransactionOptions, body: (tx: StrokeTransaction) => Promise<T>): Promise<T> {
    const tx = this.openTransaction();
    if (opts.source) this.pushSource(opts.source);
    try {
      return await (opts.silent ? this.runSilentlyAsync(() => body(tx)) : body(tx));
    } catch (err) {
      this.rollbackAfterThrow(tx.start);
      throw err;
    } finally {
      if (opts.source) this.popSource();
    }
  }

  /** A rollback that itself throws is logged, so the body's own error is the one that propagates. */
  private rollbackAfterThrow(start: number): void {
    try {
      this.rollbackTo(start);
    } catch (rollbackErr) {
      console.error('[command-executor] rollback after a failed transaction failed:', rollbackErr);
    }
  }

  private openTransaction(): StrokeTransaction {
    const start = this.undoStack.length;
    return {
      start,
      commit: ({ reconcile, atomic = false } = {}) => {
        const violations = this.commitStroke(start, reconcile === undefined ? {} : { reconcile });
        if (atomic && violations.length > 0) this.rollbackTo(start);
        return violations;
      },
      rollback: () => { this.rollbackTo(start); },
    };
  }

  /** True while a road-reconcile pass is issuing its own commands through execute(). */
  private reconciling = false;
  /** Roads the settle pass removed mid-stroke, kept so a footprint that settles back to uniform
   *  gets its road re-seated — emptied when the stroke commits. */
  private strokeRemovedRoads = new Map<string, PlacedObject>();

  /** Validates and applies a single command. Returns success/failure with errors. State unchanged on failure. */
  execute(cmd: Command): ValidationResult {
    const errors: ValidationError[] = this.registry.validatePreCommand(cmd, this.state);

    if (errors.length > 0) {
      if (this.silentRuns === 0) reportRefusal(this.eventBus, { cmd, errors });
      return { success: false, errors };
    }

    // Whether a removal is taking the coating at its cell — asked before the apply, since the
    // lookup cannot answer for an object already gone.
    const removesCoating = cmd.type === CommandType.RemoveObject
      && this.roadAt(cmd.removedObject.position.x, cmd.removedObject.position.y)?.id === cmd.objectId;

    const coords = getAffectedCells(cmd);
    const before = this.snapshot(coords);
    const objectOps = unrecoverableObjectOps(cmd, this.state);
    applyCommand(cmd, this.state, this.eventBus);
    if (cmd.type === CommandType.RemoveObject) (this.state.liftedObjects ??= new Map()).set(cmd.objectId, cmd.removedObject);
    const after = this.snapshot(coords);
    const taint = this.provenance.capture(cmd, before, after);

    // History keeps its own copy: the map's objects and corner arrays are edited in place later.
    const recorded = detachCommand(cmd);
    this.undoStack.push(objectOps ? { cmd: recorded, before, after, objectOps, taint } : { cmd: recorded, before, after, taint });
    this.redoStack = [];

    // A road tile's drawn boundary depends on its neighbours (road-shape.ts: roadEdgeInsets,
    // roadCutFeeds — the feather lifts where its surface continues, and a cut tile's gap is fed
    // by the wrap), so a coating arriving, leaving or changing its cut re-announces the roads it
    // borders — the objects-changed idiom a corner trim already uses, which both views answer by
    // redrawing the object in place.
    const seamHost = cmd.type === CommandType.PlaceObject
      ? (this.roadAt(cmd.object.position.x, cmd.object.position.y)?.id === cmd.object.id ? cmd.object : null)
      : removesCoating && cmd.type === CommandType.RemoveObject ? cmd.removedObject
      : cmd.type === CommandType.TrimCorners && cmd.layer === 'road' ? (objectOps?.removed[0] ?? this.roadAt(cmd.x, cmd.y)) : null;
    if (seamHost) {
      for (const [dx, dy] of NEIGHBORS4) {
        const n = this.roadAt(seamHost.position.x + dx, seamHost.position.y + dy);
        if (n && n.id !== seamHost.id) this.eventBus.emit('objects-changed', { added: [n] });
      }
    }

    this.eventBus.emit('cells-changed', { cells: coords });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });

    // A road rides the terrain change under it AS IT HAPPENS, not at the pointer's release: the
    // settle-only pass carries a road whose footprint stands uniform at a new level and leaves a
    // mixed one for commitStroke's full pass (mid-stroke, mixed usually means the stroke has not
    // finished covering the footprint). Edge cuts repair on the same beat — a fillet whose walls
    // this dab outgrew, a bevel the new mass covered — so the map is right under the moving
    // pointer, not at its release; commitStroke's full passes stay as the backstop. Guarded,
    // since both passes issue commands through here.
    if (!this.reconciling && (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain)) {
      this.reconciling = true;
      try {
        this.provenance.deriveScope(() => {
          reconcileRoads(cmd.cells, this.state, this, { settleOnly: true, removedPool: this.strokeRemovedRoads });
          reconcileCuts(cmd.cells, this.state, this);
        });
      } finally {
        this.reconciling = false;
      }
    }

    return { success: true, errors: [] };
  }

  /**
   * Validates the current state after a brush stroke completes.
   * @param strokeStartSize - undo stack size when the stroke began (from getUndoStackSize())
   * @returns The initial violations found (empty if state was clean). Auto-reverts until clean.
   *
   * The stroke + its auto-reconcile (edge-cut repairs) collapse into ONE undo entry, so a gesture is a
   * single, ATOMIC undo step. The reconcile must never be undoable on its own: reverting just the repair
   * (e.g. restoring a Γ-patch fillet) while the terrain change that invalidated it stays applied leaves an
   * illegal structure (an orphan fillet). One entry means undo reverts the change and its repair together.
   */
  commitStroke(strokeStartSize: number, opts: { reconcile?: boolean } = {}): ValidationError[] {
    try {
      return this.commitStrokeGroup(strokeStartSize, opts.reconcile ?? true);
    } finally {
      this.state.liftedObjects?.clear();
    }
  }

  private commitStrokeGroup(strokeStartSize: number, reconcile: boolean): ValidationError[] {
    if (this.undoStack.length - strokeStartSize <= 0) return [];

    // Roads follow the surface they coat, whoever edited it — this pass runs BEFORE the
    // post-stroke validation below so its re-places are validated (and auto-revertable) with the
    // stroke, unlike the cut repairs, which are legal by construction and run after.
    if (reconcile) {
      const changed = this.cellsChangedSince(strokeStartSize);
      if (changed.length > 0 || this.strokeRemovedRoads.size > 0) {
        this.provenance.deriveScope(() =>
          reconcileRoads(changed, this.state, this, { removedPool: this.strokeRemovedRoads }));
      }
    }
    this.strokeRemovedRoads.clear();
    const maxUndos = this.undoStack.length - strokeStartSize;

    const violations = this.registry.validatePostStroke(this.state);

    if (violations.length > 0) {
      const affectedCoords: MacroCoord[] = [];
      let undone = 0;
      while (undone < maxUndos) {
        const entry = this.undoStack.pop();
        if (!entry) break;
        affectedCoords.push(...this.revertEntry(entry));
        // Deliberately NOT pushed to the redo stack: an auto-reverted fragment is an
        // ILLEGAL partial state — redo would reinstate it unvalidated, and the fragment
        // (sitting below every later stroke's revert window) would then make every future
        // commitStroke fully revert its own stroke. Auto-reverted work is simply gone.
        undone++;
        const remaining = this.registry.validatePostStroke(this.state, { firstOnly: true });
        if (remaining.length === 0) break;
      }
      if (affectedCoords.length > 0) {
        this.eventBus.emit('cells-changed', { cells: affectedCoords });
        this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
      }
    }

    // Reconcile edge cuts on whatever this stroke actually changed (after any auto-revert), so cuts the new
    // context invalidated update to their closest valid form. Repairs are issued through execute(), joining
    // this stroke's history. SKIPPED for corner-only strokes (the edge-cut tool): an edge cut changes only
    // the silhouette, never terrain support, so it can't invalidate any cut — running the neighbourhood
    // repair there could only mis-touch a neighbour's cut. The tool already produces its final valid state.
    if (reconcile) {
      const changed = this.cellsChangedSince(strokeStartSize);
      if (changed.length > 0) {
        this.provenance.deriveScope(() => reconcileCuts(changed, this.state, this));
      }
    }

    // Fold the whole stroke — its commands AND the reconcile repairs above — into one undo entry, so undo
    // reverts them together and can never stop at a reconcile-orphaned (illegal) intermediate. No-op when
    // the stroke is a single entry (collapseHistory returns early).
    this.collapseHistory(strokeStartSize);

    return violations;
  }

  /** Every cell touched by the entries above `strokeStartSize` — the region both reconcile
   *  passes work over. Re-collected between them, since road repairs add entries of their own. */
  private cellsChangedSince(strokeStartSize: number): MacroCoord[] {
    const changed: MacroCoord[] = [];
    for (let i = strokeStartSize; i < this.undoStack.length; i++) {
      changed.push(...getAffectedCells(this.undoStack[i]!.cmd));
    }
    return changed;
  }

  /**
   * Silently revert every entry above `watermark`: no redo-stack entries, no per-entry
   * validation, one cells-changed/history-changed emission. For callers that must guarantee
   * "nothing happened" after a mid-operation failure (the agent tool bridge rolls a crashed
   * stroke back to its start so a crash never leaves half-applied, unvalidated edits).
   */
  rollbackTo(watermark: number): void {
    this.state.liftedObjects?.clear();
    if (this.undoStack.length <= watermark) return;
    const coords: MacroCoord[] = [];
    while (this.undoStack.length > watermark) {
      coords.push(...this.revertEntry(this.undoStack.pop()!));
    }
    this.eventBus.emit('cells-changed', { cells: coords });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  /**
   * Merge undoStack entries [start, top) into one: earliest `before` + latest `after` per
   * cell for terrain, plus the NET object add/removes (objectOps) so grouped object
   * placements/removals undo/redo together. Public so tools can fold follow-up commands
   * (auto-trim, a gamma click's raise+trim) into the user-visible step they belong to —
   * ATOMIC UNDO: a stroke and its auto-trims/repairs collapse into one undo entry.
   */
  collapseHistory(start: number): void {
    if (this.undoStack.length - start <= 1) return;
    const group = this.undoStack.splice(start);
    const firstBefore = new Map<string, CellSnapshot>();
    const lastAfter = new Map<string, CellSnapshot>();
    const added = new Map<string, PlacedObject>();
    const removed = new Map<string, PlacedObject>();
    /** Ids whose `removed` snapshot already holds an explicit pre-stroke rotation. */
    const rotationKnown = new Set<string>();
    /** The object `id` as a removal recorded after entry `index` kept it: a road a later all-empty
     *  trim deleted is gone from the map by now. Earlier removals do not count, since an object
     *  removed before the entry was not on the map when the entry ran. */
    const removedAfter = (index: number, id: string): PlacedObject | undefined => {
      for (let j = index + 1; j < group.length; j++) {
        const kept = group[j]!.objectOps?.removed.find((o) => o.id === id);
        if (kept) return kept;
      }
      return undefined;
    };
    for (const [index, entry] of group.entries()) {
      for (const s of entry.before) {
        const k = cellKey(s.coord.x, s.coord.y);
        if (!firstBefore.has(k)) firstBefore.set(k, s);
      }
      for (const s of entry.after) {
        lastAfter.set(cellKey(s.coord.x, s.coord.y), s);
      }
      // An entry with recorded `objectOps` (a collapsed group, whose `cmd` is only its last command,
      // or a command that cannot reverse its own object effect) is folded through the same
      // add/remove netting; deriving from the cmd would drop the ops it recorded.
      if (entry.objectOps) {
        for (const o of entry.objectOps.removed) {
          if (added.has(o.id)) added.delete(o.id);
          else removed.set(o.id, o);
        }
        for (const o of entry.objectOps.added) added.set(o.id, o);
        continue;
      }
      const c = entry.cmd;
      if (c.type === CommandType.PlaceObject) {
        // Keep any earlier removal of the same id (in `removed`) untouched so a
        // remove+re-add of one object — rotate/move in place — collapses to a
        // single modify: `removed` holds the original, `added` the new version.
        added.set(c.object.id, c.object);
      } else if (c.type === CommandType.RemoveObject) {
        // Add-then-remove within the group nets out (object never persisted).
        if (added.has(c.removedObject.id)) added.delete(c.removedObject.id);
        else removed.set(c.removedObject.id, c.removedObject);
      } else if (c.type === CommandType.TrimCorners && c.layer === 'road' && c.objectId) {
        // A road corner edit mutates the object IN PLACE (corners/rotation), which the
        // cell-snapshot + add/remove netting can't see — without this, undoing a collapsed
        // stroke would silently keep the repaired corners. Convert it to a remove(pre-state)
        // + add(post-state) pair of the SAME id, which the netting already treats as an
        // in-place modify. First trim wins for the `removed` snapshot (the true pre-stroke
        // state); a later trim that carries the group's only explicit beforeRotation
        // back-fills it (the earlier trim didn't rotate, so that IS the original rotation).
        const obj = this.state.objects.get(c.objectId) ?? removedAfter(index, c.objectId);
        if (obj) {
          if (added.has(c.objectId)) {
            added.set(c.objectId, clonePlacedObject(obj));
          } else {
            const prior = removed.get(c.objectId);
            if (!prior) {
              removed.set(c.objectId, {
                ...clonePlacedObject(obj),
                corners: c.beforeCorners ? [...c.beforeCorners] : undefined,
                rotation: c.beforeRotation ?? obj.rotation,
              });
              if (c.beforeRotation !== undefined) rotationKnown.add(c.objectId);
            } else if (!rotationKnown.has(c.objectId) && c.beforeRotation !== undefined) {
              prior.rotation = c.beforeRotation;
              rotationKnown.add(c.objectId);
            }
            added.set(c.objectId, clonePlacedObject(obj));
          }
        }
      }
    }
    const mergedTaint = this.provenance.mergeGroup(group.map((e) => e.taint));
    this.undoStack.push({
      cmd: group[group.length - 1]!.cmd,
      before: [...firstBefore.values()],
      after: [...lastAfter.values()],
      objectOps: { removed: [...removed.values()], added: [...added.values()] },
      taint: mergedTaint,
    });
  }

  undo(): boolean {
    this.state.liftedObjects?.clear();
    if (this.undoStack.length === 0) return false;

    const affectedCoords: MacroCoord[] = [];
    const reverted: HistoryEntry[] = [];

    while (this.undoStack.length > 0) {
      const entry = this.undoStack.pop()!;
      reverted.push(entry);
      affectedCoords.push(...this.revertEntry(entry));
      this.redoStack.push(entry);

      const violations = this.registry.validatePostStroke(this.state, { firstOnly: true });
      if (violations.length === 0) break;
    }

    this.eventBus.emit('cells-changed', { cells: affectedCoords });
    this.eventBus.emit('history-applied', { cells: affectedCoords, objects: this.flashObjects(reverted) });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  redo(): void {
    this.state.liftedObjects?.clear();
    const entry = this.redoStack.pop();
    if (!entry) return;

    const coords = this.reapplyEntry(entry);
    this.undoStack.push(entry);

    this.eventBus.emit('cells-changed', { cells: coords });
    this.eventBus.emit('history-applied', { cells: coords, objects: this.flashObjects([entry]) });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  /**
   * The objects a history step touched, for an object-anchored flash (rendered at the object's own
   * footprint, no terrain offset). Reported alongside the step's terrain cells rather than instead
   * of them: one step can move both — a stroke whose road reconcile carried a coating away, a
   * generate — and the renderer flashes each part on its own grid (`resolveHistoryFlash`).
   */
  private flashObjects(entries: HistoryEntry[]): PlacedObject[] | undefined {
    const out: PlacedObject[] = [];
    for (const e of entries) {
      if (e.objectOps) out.push(...e.objectOps.removed, ...e.objectOps.added);
      else if (e.cmd.type === CommandType.PlaceObject) out.push(e.cmd.object);
      else if (e.cmd.type === CommandType.RemoveObject) out.push(e.cmd.removedObject);
    }
    return out.length > 0 ? out : undefined;
  }

  /** Reverts a history entry: taint first (lockstep), then its cell/object state via command-apply. */
  private revertEntry(entry: HistoryEntry): MacroCoord[] {
    if (entry.taint) this.provenance.revertTaint(entry.taint);
    return revertEntryState(entry, this.state, this.eventBus);
  }

  /** Re-applies a history entry: taint first (lockstep), then its cell/object state via command-apply. */
  private reapplyEntry(entry: HistoryEntry): MacroCoord[] {
    if (entry.taint) this.provenance.reapplyTaint(entry.taint);
    return reapplyEntryState(entry, this.state, this.eventBus);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  getUndoStackSize(): number { return this.undoStack.length; }
  getRegistry(): RuleDispatcher { return this.registry; }

  /** Undo entries oldest-first, optionally limited to the stroke above a watermark. */
  getUndoEntries(watermark = 0): HistoryEntry[] {
    return this.undoStack.slice(watermark);
  }

  /**
   * The commands APPLIED above `watermark`, oldest first — what a caller that issued its commands
   * indirectly (through a populator, a macro, a per-cell loop) has to read to learn where its edit
   * actually landed. A placement trait SNAPS position during validation, so a command's final
   * footprint is knowable only after it has run, and never from the argument the caller passed.
   * Read it BEFORE commitStroke: the collapse folds the group into one entry.
   */
  commandsSince(watermark: number): Command[] {
    return this.undoStack.slice(watermark).map(e => e.cmd);
  }

  /** Seed the undo stack from an imported save's history section (redo cleared). The entries
   *  were produced by getUndoEntries() on the exporting side and validated by history-codec. */
  restoreHistory(entries: HistoryEntry[]): void {
    this.undoStack = [...entries];
    this.redoStack = [];
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  pushSource(ctx: SourceContext): void { this.provenance.pushSource(ctx); }
  popSource(): void { this.provenance.popSource(); }
  withSource<T>(ctx: SourceContext, fn: () => T): T { return this.provenance.withSource(ctx, fn); }
  noteAnalysisOnly(): void { this.provenance.noteAnalysisOnly(); }
  getProvenanceSummary(): MapProvenanceSummary { return this.provenance.getSummary(); }
  getProvenanceTracker(): ProvenanceTracker { return this.provenance.getTracker(); }

  private snapshot(coords: MacroCoord[]): CellSnapshot[] {
    return coords
      .map(coord => {
        const cell = getCell(this.state.cells, coord.x, coord.y);
        return cell ? { coord, cell: cloneCell(cell) } : null;
      })
      .filter((s): s is CellSnapshot => s !== null);
  }
}
