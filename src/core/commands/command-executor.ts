import type { KernelEvents } from './events';
import type { EventBus } from './event-bus';
import { cloneCell, clonePlacedObject, getCell } from '../model/grid-model';
import { cellKey } from '../grid/rect';
import type { RuleDispatcher } from '../model/rule-dispatcher';
import type { StrokeKernel, StrokePolicy } from '../model/stroke-policy';
import type { Authorship, HistoryRecorder } from '../model/history-recorder';
import {
  CommandType,
  type CellSnapshot,
  type Command,
  type GenerationMark,
  type GridState,
  type MacroCoord,
  type PlacedObject,
  type StrokeScope,
  type ValidationError,
  type ValidationResult,
} from '../model/types';
import type { SourceContext, MapProvenanceSummary } from '../provenance/types';
import {
  applyCommand,
  entryCells,
  getAffectedCells,
  reapplyEntryState,
  revertEntryState,
  touchedObjectId,
  readGenerationMark,
  writeGenerationMark,
  type HistoryEntry,
  type TrimApplier,
} from './command-apply';
import { reportRefusal } from './refusal';
import { holdObjectChanges, type ObjectChangeHold } from './held-object-changes';
import { TERRAIN_GRID } from '../game/profile';
import { cellSet, type CellSet } from '../grid/grids';
import { cellsOn } from '../grid/grid-convert';

/** Restored map cells as the one set they form: the map's cells lie on the terrain grid. */
function restoredCells(coords: MacroCoord[]): CellSet[] {
  return [cellSet(TERRAIN_GRID, coords)];
}

/** What an executor is built from. */
export interface ExecutorDeps {
  /** Where the kernel announces its events. */
  bus: EventBus<KernelEvents>;
  rules: RuleDispatcher;
  /** The game's repairs around each command and each commit; `NO_STROKE_POLICY` adds none. */
  policy: StrokePolicy;
  /** Authorship of every history step, bound to the executor's map. */
  provenance: HistoryRecorder;
  /** What a corner trim does to the map; the game's is `domain/edge-cut/trim-apply.ts:applyTrim`. */
  trims: TrimApplier;
}

/** How a stroke transaction runs its body. */
interface TransactionOptions {
  /** Authorship for every command the body issues; popped on every exit. */
  source?: SourceContext;
  /** Silence validation-failed across the whole body, its commit included. */
  silent?: boolean;
}

/**
 * A stroke group, begun at one history depth. Everything executed after it began belongs to it
 * until it commits, rolls back or collapses; a handle may be closed more than once, and a handle
 * begun inside another is a savepoint of the outer one.
 */
export interface Stroke {
  /** How many history entries stand above the stroke's start. */
  readonly size: number;
  /** The commands applied above the start, oldest first, as resolved: a bridge or ramp lands
   *  where its trait snapped it. Read before `commit`, whose collapse folds the group into one
   *  entry. */
  commands(): Command[];
  /** The history entries above the start, oldest first: each cell's and object's pre-image. */
  entries(): HistoryEntry[];
  /** The post-stroke commit over the group. `atomic` reverts the whole group when the post-stroke
   *  rules report a violation, where a plain commit reverts only until the map is clean. */
  commit(opts?: { reconcile?: boolean; atomic?: boolean }): ValidationError[];
  /** Silently revert everything above the start: no redo entries, no per-entry validation. */
  rollback(): void;
  /** Fold the entries above the start into one undo entry, with no validation of its own. */
  collapse(): void;
  /** Write the map's generation, recorded on the stroke's top entry so undo and redo restore it
   *  with the stroke. Called after `commit`; a stroke that left no entry writes it unrecorded. */
  setGeneration(mark: GenerationMark): void;
}

/**
 * Executes commands against GridState with two-phase validation, orchestrating validate, apply,
 * record, history and events. `command-apply.ts` holds the per-CommandType mutation and emits
 * `objects-changed`; the injected `HistoryRecorder` captures, merges and reverts authorship.
 *
 * `execute()` runs the pre-command rules and rejects the command, state unchanged, on any error.
 * `commitStroke()` runs the post-stroke rules and undoes the stroke's commands one at a time until
 * the state satisfies them all, so undo and redo skip illegal intermediate states. The stroke policy
 * (`core/model/stroke-policy.ts`) adds the game's repairs around both. Rules are pure.
 */
export class CommandExecutor {
  private state: GridState;
  private eventBus: EventBus<KernelEvents>;
  /** What commands, reverts and replays announce object changes through; see `transaction`. */
  private objectChanges: ObjectChangeHold;
  private registry: RuleDispatcher;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Silenced runs in progress; while any is, rejected commands emit no validation-failed (no error
   *  toast). A count, so async runs that overlap and settle in any order restore it exactly. */
  private silentRuns = 0;
  /** The objects the open stroke took off the map, by id; cleared when it commits, rolls back or
   *  is abandoned. Placement rules judge a re-placed object on its net change through it. */
  private readonly lifted = new Map<string, PlacedObject>();
  private readonly scope: StrokeScope = { lifted: this.lifted };
  /** The causes named by `withCause` runs in progress, innermost last. */
  private causes: string[] = [];
  private provenance: HistoryRecorder;
  private policy: StrokePolicy;
  private trims: TrimApplier;
  /** This executor as its policy sees it. */
  private kernel: StrokeKernel;

  /** A policy that reads a map must answer for `state`. */
  constructor(state: GridState, deps: ExecutorDeps) {
    this.state = state;
    this.eventBus = deps.bus;
    this.objectChanges = holdObjectChanges(deps.bus);
    this.registry = deps.rules;
    this.policy = deps.policy;
    this.provenance = deps.provenance;
    this.trims = deps.trims;
    this.kernel = {
      state,
      execute: (cmd) => this.execute(cmd),
      validatePre: (cmd) => this.validatePre(cmd),
    };
  }

  /** Pre-command validation with no execution and no validation-failed event — the reconcile
   *  passes probe with this, since their refusals are outcomes, not errors. */
  validatePre(cmd: Command): ValidationError[] {
    return this.registry.validatePreCommand(cmd, this.state, this.scope);
  }


  /** Run `fn` with `cause` on the `cells-changed` and `objects-changed` its commands emit, so a
   *  listener can tell this change from any other. Restores even on throw. */
  withCause<T>(cause: string, fn: () => T): T {
    this.causes.push(cause);
    try { return fn(); } finally { this.causes.pop(); }
  }

  /**
   * Run `body` as one stroke group: the start is taken, `source` is pushed and `silent` applied
   * around the body, and a throw reverts the group before it propagates. The body decides when to
   * commit or roll back through the handle; a body that returns without committing leaves its
   * entries uncollapsed on the stack. This is the one door for silence and authorship: a caller
   * that tries many candidate commands and expects refusals passes `silent`.
   *
   * `objects-changed` is held for the whole body and published, merged, when the outermost
   * transaction returns or throws (`held-object-changes.ts`), so a group edit of many commands is
   * a few notifications, not one per command.
   */
  transaction<T>(opts: TransactionOptions, body: (tx: Stroke) => T): T {
    return this.objectChanges.hold(() => {
      const start = this.undoStack.length;
      const tx = this.beginStroke();
      if (opts.source) this.pushSource(opts.source);
      if (opts.silent) this.silentRuns++;
      try {
        return body(tx);
      } catch (err) {
        this.rollbackAfterThrow(start);
        throw err;
      } finally {
        if (opts.silent) this.silentRuns--;
        if (opts.source) this.popSource();
      }
    });
  }

  /** `transaction` for a body that awaits; the source and silence hold until it settles. Object
   *  changes are not held across its awaits, so the map shows its progress. */
  async transactionAsync<T>(opts: TransactionOptions, body: (tx: Stroke) => Promise<T>): Promise<T> {
    const start = this.undoStack.length;
    const tx = this.beginStroke();
    if (opts.source) this.pushSource(opts.source);
    if (opts.silent) this.silentRuns++;
    try {
      return await body(tx);
    } catch (err) {
      this.rollbackAfterThrow(start);
      throw err;
    } finally {
      if (opts.silent) this.silentRuns--;
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

  /**
   * Begin a stroke group at the current history depth. The pointer tools begin one per gesture
   * through their host and the editor operations their own; any other caller runs its group through
   * `transaction` (`stroke-doors.test.ts`).
   */
  beginStroke(): Stroke {
    const start = this.undoStack.length;
    const depth = (): number => this.undoStack.length;
    return {
      get size() { return depth() - start; },
      commands: () => this.commandsSince(start),
      entries: () => this.undoStack.slice(start),
      commit: ({ reconcile, atomic = false } = {}) => {
        const violations = this.commitStroke(start, reconcile === undefined ? {} : { reconcile });
        if (atomic && violations.length > 0) this.rollbackTo(start);
        return violations;
      },
      rollback: () => { this.rollbackTo(start); },
      collapse: () => { this.collapseHistory(start); },
      setGeneration: (mark) => { this.recordGeneration(start, mark); },
    };
  }

  private recordGeneration(start: number, mark: GenerationMark): void {
    const top = this.undoStack.length > start ? this.undoStack[this.undoStack.length - 1]! : undefined;
    if (top) top.generation = { before: top.generation?.before ?? readGenerationMark(this.state), after: mark };
    writeGenerationMark(this.state, mark);
  }

  /** True while the policy's `afterCommand` is issuing its own commands through execute(). */
  private inAfterCommand = false;

  /** Forget what the open stroke lifted and what its policy holds: a later commit must not act on
   *  a stroke that was rolled back, undone past, or replaced by a restored history. */
  private abandonStroke(): void {
    this.lifted.clear();
    this.policy.endStroke?.();
  }

  /**
   * Resolves, validates and applies a single command; history, the events and the policy see it
   * as resolved (`RuleDispatcher.resolve`), and `requested` itself is never written to. Returns
   * success/failure with errors. State unchanged on failure.
   */
  execute(requested: Command): ValidationResult {
    const cmd = this.registry.resolve(requested, this.state);
    const errors: ValidationError[] = this.registry.validatePreCommand(cmd, this.state, this.scope);

    if (errors.length > 0) {
      if (this.silentRuns === 0) reportRefusal(this.eventBus, { cmd, errors });
      return { success: false, errors };
    }

    const sets = getAffectedCells(cmd, this.state);
    const coords = cellsOn(sets, TERRAIN_GRID);
    const before = this.snapshot(coords);
    const touched = touchedObjectId(cmd);
    const objectBefore = touched === undefined ? undefined : this.state.objects.get(touched);
    const removed = objectBefore ? [clonePlacedObject(objectBefore)] : [];
    const cause = this.causes[this.causes.length - 1];
    applyCommand(cmd, this.state, this.objectChanges.sink, this.trims, cause);
    const objectAfter = touched === undefined ? undefined : this.state.objects.get(touched);
    const objectOps = removed.length > 0 || objectAfter ? { removed, added: objectAfter ? [clonePlacedObject(objectAfter)] : [] } : undefined;
    if (cmd.type === CommandType.RemoveObject && removed[0]) this.lifted.set(cmd.objectId, removed[0]);
    const after = this.snapshot(coords);
    const taint = this.provenance.capture(cmd, before, after, objectOps);

    this.undoStack.push(objectOps ? { cmd, before, after, objectOps, taint } : { cmd, before, after, taint });
    this.redoStack = [];

    this.eventBus.emit('cells-changed', cause === undefined ? { cells: sets } : { cells: sets, cause });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });

    // Guarded, since the policy's repairs issue commands through here.
    const afterCommand = this.policy.afterCommand;
    if (afterCommand && !this.inAfterCommand) {
      this.inAfterCommand = true;
      try {
        this.provenance.deriveScope(() => afterCommand.call(this.policy, this.kernel, cmd));
      } finally {
        this.inAfterCommand = false;
      }
    }

    return { success: true, errors: [] };
  }

  /**
   * Validates the current state after a brush stroke completes; reached through `Stroke.commit`.
   * @param strokeStartSize - undo stack size when the stroke began
   * @returns The initial violations found (empty if state was clean). Auto-reverts until clean.
   *
   * The stroke and its policy's repairs collapse into one undo entry, so a gesture is a single,
   * atomic undo step. A repair is never undoable on its own: reverting it while the change that
   * called for it stays applied would restore the state the repair fixed.
   */
  private commitStroke(strokeStartSize: number, opts: { reconcile?: boolean } = {}): ValidationError[] {
    try {
      return this.commitStrokeGroup(strokeStartSize, opts.reconcile ?? true);
    } finally {
      this.lifted.clear();
    }
  }

  private commitStrokeGroup(strokeStartSize: number, reconcile: boolean): ValidationError[] {
    if (this.undoStack.length - strokeStartSize <= 0) return [];

    // The policy's commit hooks are not guarded against re-entry: a repair command they issue
    // runs `afterCommand` like any other.
    const { beforeValidate, afterValidate } = this.policy;
    if (reconcile && beforeValidate) {
      const changed = this.cellsChangedSince(strokeStartSize);
      if (changed.length > 0 || this.policy.pending?.()) {
        this.provenance.deriveScope(() => beforeValidate.call(this.policy, this.kernel, changed));
      }
    }
    this.policy.endStroke?.();
    const maxUndos = this.undoStack.length - strokeStartSize;

    const violations = this.registry.validatePostStroke(this.state);

    if (violations.length > 0) {
      const affectedCoords: MacroCoord[] = [];
      this.objectChanges.hold(() => {
        let undone = 0;
        while (undone < maxUndos) {
          const entry = this.undoStack.pop();
          if (!entry) break;
          affectedCoords.push(...this.revertEntry(entry));
          // Not pushed to the redo stack: an auto-reverted fragment is an illegal partial state.
          // Redo would reinstate it unvalidated, and the fragment, below every later stroke's revert
          // window, would then make every later commit revert its own stroke whole.
          undone++;
          const remaining = this.registry.validatePostStroke(this.state, { firstOnly: true });
          if (remaining.length === 0) break;
        }
      });
      if (affectedCoords.length > 0) {
        this.eventBus.emit('cells-changed', { cells: restoredCells(affectedCoords) });
        this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
      }
    }

    // Repairs over whatever this stroke still changed after any auto-revert, issued through
    // execute() and joining this stroke's history. A commit with `reconcile: false` skips them.
    if (reconcile && afterValidate) {
      const changed = this.cellsChangedSince(strokeStartSize);
      if (changed.length > 0) {
        this.provenance.deriveScope(() => afterValidate.call(this.policy, this.kernel, changed));
      }
    }

    // Fold the whole stroke — its commands and the reconcile repairs above — into one undo entry, so undo
    // reverts them together and can never stop at a reconcile-orphaned (illegal) intermediate. No-op when
    // the stroke is a single entry (collapseHistory returns early).
    this.collapseHistory(strokeStartSize);

    return violations;
  }

  /** Every cell touched by the entries above `strokeStartSize` — the region both reconcile
   *  passes work over. Re-collected between them, since repairs add entries of their own. */
  private cellsChangedSince(strokeStartSize: number): CellSet[] {
    const changed: CellSet[] = [];
    for (let i = strokeStartSize; i < this.undoStack.length; i++) {
      for (const set of entryCells(this.undoStack[i]!)) if (set.cells.length > 0) changed.push(set);
    }
    return changed;
  }

  /**
   * Silently revert every entry above `watermark`: no redo-stack entries, no per-entry
   * validation, one cells-changed/history-changed emission; reached through `Stroke.rollback`, for
   * callers that must guarantee "nothing happened" after a mid-operation failure.
   */
  private rollbackTo(watermark: number): void {
    this.abandonStroke();
    if (this.undoStack.length <= watermark) return;
    const coords: MacroCoord[] = [];
    this.objectChanges.hold(() => {
      while (this.undoStack.length > watermark) {
        coords.push(...this.revertEntry(this.undoStack.pop()!));
      }
    });
    this.eventBus.emit('cells-changed', { cells: restoredCells(coords) });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  /**
   * Merge undoStack entries [start, top) into one: earliest `before` + latest `after` per
   * cell for terrain, plus the net object add/removes (objectOps) so grouped object
   * placements/removals undo/redo together. `Stroke.collapse` lets tools fold follow-up commands
   * into the user-visible step they belong to.
   */
  private collapseHistory(start: number): void {
    if (this.undoStack.length - start <= 1) return;
    const group = this.undoStack.splice(start);
    const firstBefore = new Map<string, CellSnapshot>();
    const lastAfter = new Map<string, CellSnapshot>();
    const added = new Map<string, PlacedObject>();
    const removed = new Map<string, PlacedObject>();
    const marked = group.filter((e) => e.generation);
    for (const entry of group) {
      for (const s of entry.before) {
        const k = cellKey(s.coord.x, s.coord.y);
        if (!firstBefore.has(k)) firstBefore.set(k, s);
      }
      for (const s of entry.after) {
        lastAfter.set(cellKey(s.coord.x, s.coord.y), s);
      }
      // Add-then-remove within the group nets out; a remove then re-add of one id (a move, a turn,
      // an edit in place) keeps the removal, so the group is one modify of the original.
      if (!entry.objectOps) continue;
      for (const o of entry.objectOps.removed) {
        if (added.has(o.id)) added.delete(o.id);
        else removed.set(o.id, o);
      }
      for (const o of entry.objectOps.added) added.set(o.id, o);
    }
    const mergedTaint = this.provenance.mergeGroup(group.map((e) => e.taint));
    this.undoStack.push({
      cmd: group[group.length - 1]!.cmd,
      before: [...firstBefore.values()],
      after: [...lastAfter.values()],
      objectOps: { removed: [...removed.values()], added: [...added.values()] },
      taint: mergedTaint,
      ...(marked.length > 0
        ? { generation: { before: marked[0]!.generation!.before, after: marked[marked.length - 1]!.generation!.after } }
        : {}),
    });
  }

  undo(): boolean {
    this.abandonStroke();
    if (this.undoStack.length === 0) return false;

    const affectedCoords: MacroCoord[] = [];
    const reverted: HistoryEntry[] = [];

    this.objectChanges.hold(() => {
      while (this.undoStack.length > 0) {
        const entry = this.undoStack.pop()!;
        reverted.push(entry);
        affectedCoords.push(...this.revertEntry(entry));
        this.redoStack.push(entry);

        const violations = this.registry.validatePostStroke(this.state, { firstOnly: true });
        if (violations.length === 0) break;
      }
    });

    const cells = restoredCells(affectedCoords);
    this.eventBus.emit('cells-changed', { cells });
    this.eventBus.emit('history-applied', { cells, objects: this.flashObjects(reverted) });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  /** Mirrors `undo`: reapplies until the map is legal, so one redo restores what one undo took back.
   *  False when there was nothing to redo. */
  redo(): boolean {
    this.abandonStroke();
    if (this.redoStack.length === 0) return false;

    const coords: MacroCoord[] = [];
    const reapplied: HistoryEntry[] = [];
    this.objectChanges.hold(() => {
      while (this.redoStack.length > 0) {
        const entry = this.redoStack.pop()!;
        reapplied.push(entry);
        coords.push(...this.reapplyEntry(entry));
        this.undoStack.push(entry);

        const violations = this.registry.validatePostStroke(this.state, { firstOnly: true });
        if (violations.length === 0) break;
      }
    });

    const cells = restoredCells(coords);
    this.eventBus.emit('cells-changed', { cells });
    this.eventBus.emit('history-applied', { cells, objects: this.flashObjects(reapplied) });
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  /**
   * The objects a history step touched, for an object-anchored flash (rendered at the object's own
   * footprint, no terrain offset). Reported alongside the step's terrain cells rather than instead
   * of them: one step can move both, and the renderer flashes each part on its own grid.
   */
  private flashObjects(entries: HistoryEntry[]): PlacedObject[] | undefined {
    const out: PlacedObject[] = [];
    for (const e of entries) if (e.objectOps) out.push(...e.objectOps.removed, ...e.objectOps.added);
    return out.length > 0 ? out : undefined;
  }

  /** Reverts a history entry: taint first (lockstep), then its cell/object state via command-apply. */
  private revertEntry(entry: HistoryEntry): MacroCoord[] {
    if (entry.taint) this.provenance.revertTaint(entry.taint);
    return revertEntryState(entry, this.state, this.objectChanges.sink);
  }

  /** Re-applies a history entry: taint first (lockstep), then its cell/object state via command-apply. */
  private reapplyEntry(entry: HistoryEntry): MacroCoord[] {
    if (entry.taint) this.provenance.reapplyTaint(entry.taint);
    return reapplyEntryState(entry, this.state, this.objectChanges.sink);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  /** How many entries the undo history holds: a depth to compare, never a stroke start. */
  historyDepth(): number { return this.undoStack.length; }
  getRegistry(): RuleDispatcher { return this.registry; }

  /** The whole undo history, oldest first, as a copy. */
  getUndoEntries(): HistoryEntry[] {
    return this.undoStack.slice();
  }

  /**
   * The commands applied above `watermark`, oldest first; reached through `Stroke.commands`.
   */
  private commandsSince(watermark: number): Command[] {
    return this.undoStack.slice(watermark).map(e => e.cmd);
  }

  /** Seed the undo stack from an imported save's history section (redo cleared). The entries
   *  were produced by getUndoEntries() on the exporting side and validated by history-codec. */
  restoreHistory(entries: HistoryEntry[]): void {
    this.abandonStroke();
    this.undoStack = [...entries];
    this.redoStack = [];
    this.eventBus.emit('history-changed', { canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  private pushSource(ctx: SourceContext): void { this.provenance.pushSource(ctx); }
  private popSource(): void { this.provenance.popSource(); }

  getProvenanceSummary(): MapProvenanceSummary { return this.provenance.getSummary(); }
  /** The map's authorship as the editor reads it; recording stays the executor's. */
  getAuthorship(): Authorship { return this.provenance; }

  private snapshot(coords: MacroCoord[]): CellSnapshot[] {
    return coords
      .map(coord => {
        const cell = getCell(this.state.cells, coord.x, coord.y);
        return cell ? { coord, cell: cloneCell(cell) } : null;
      })
      .filter((s): s is CellSnapshot => s !== null);
  }
}
