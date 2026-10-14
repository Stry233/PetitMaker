import { cellKey, regionBounds } from '../grid/rect';
import type { MacroCoord } from '../base/coords';
import { wallClock } from '../base/clock';
import { SOURCE_ROLES, applyMoveToTaint, applyOpToTaint, deriveSummary, dominantAuthor, type OpKind } from './policy';
import {
  ProvSource, UNSTAMPED_APP_VERSION, type SourceContext, type UnitTaint, type ProvenanceOperation,
  type ProvenanceState, type MapProvenanceSummary, type OperationScope, type DisclosureClass, type AuthorClass,
} from './types';

/** Whose work a unit is — see `dominantAuthor`. */
export type Author = AuthorClass | null;

export interface TaintDelta {
  cells: { x: number; y: number; before: UnitTaint | null; after: UnitTaint | null }[];
  objects: { id: string; before: UnitTaint | null; after: UnitTaint | null }[];
  opIds: string[];
}

interface ScopeMeta { layers: number[]; zones: number[]; derived?: boolean }

const DEFAULT_SOURCE: SourceContext = { source: ProvSource.Human };

function clone(t: UnitTaint | null): UnitTaint | null {
  return t ? { ...t, contribution: { ...t.contribution } } : null;
}

/** Operation-history cap. Oldest ops are dropped past this; cell/object taint is exact regardless. */
export const LEDGER_MAX = 2000;

export class ProvenanceTracker {
  readonly state: ProvenanceState;
  private stack: SourceContext[] = [];
  private opSeq = 0;
  private now: () => number;
  private appVersion: string;
  private schemaVersion: number;

  constructor(width: number, height: number, opts: { now?: () => number; appVersion?: string; schemaVersion?: number; adopt?: ProvenanceState } = {}) {
    this.now = opts.now ?? wallClock;
    // The caller passes the running build's version: a literal stamped here would mark every later
    // build's provenance records with a version that build is not.
    this.appVersion = opts.appVersion ?? UNSTAMPED_APP_VERSION;
    this.schemaVersion = opts.schemaVersion ?? 1;
    if (opts.adopt) {
      this.state = opts.adopt;
      for (const op of this.state.ledger) { const m = /^op-(\d+)$/.exec(op.id); if (m) this.opSeq = Math.max(this.opSeq, Number(m[1])); }
    } else {
      this.state = {
        ledger: [], cellTaint: emptyGrid(width, height), objectTaint: new Map(),
        session: {
          aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0, proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false,
          aiAfterHuman: false,
        },
        summary: null,
      };
    }
  }

  pushSource(ctx: SourceContext): void { this.stack.push(ctx); }
  popSource(): void { this.stack.pop(); }
  currentSource(): SourceContext { return this.stack[this.stack.length - 1] ?? DEFAULT_SOURCE; }
  withSource<T>(ctx: SourceContext, fn: () => T): T { this.pushSource(ctx); try { return fn(); } finally { this.popSource(); } }

  record(kind: OpKind, cells: MacroCoord[], objects: { id: string; kind: OpKind }[], scope: ScopeMeta): TaintDelta {
    const ctx = this.currentSource();
    const id = `op-${++this.opSeq}`;
    const delta: TaintDelta = { cells: [], objects: [], opIds: [id] };

    for (const c of cells) {
      const before = clone(this.state.cellTaint[c.y]?.[c.x] ?? null);
      const after = applyOpToTaint(before, ctx.source, kind, id);
      this.setCellTaint(c.x, c.y, after);
      delta.cells.push({ x: c.x, y: c.y, before, after: clone(after) });
    }
    for (const o of objects) {
      const before = clone(this.state.objectTaint.get(o.id) ?? null);
      const after = applyOpToTaint(before, ctx.source, o.kind, id);
      if (after) this.state.objectTaint.set(o.id, after); else this.state.objectTaint.delete(o.id);
      delta.objects.push({ id: o.id, before, after: clone(after) });
    }

    this.updateSession(ctx.source);
    this.appendOp(this.makeOp(id, ctx, { kind, cells, objects }, scope));
    return delta;
  }

  /** Re-seat an object that was removed and immediately re-placed under the same id — a move or a
   *  rotation. `taint` is what it carried before the remove; it keeps it (see `applyMoveToTaint`),
   *  and the op enters the ledger as cosmetic under the mover's source. */
  restoreObjectTaint(objectId: string, taint: UnitTaint, scope: ScopeMeta): TaintDelta {
    const ctx = this.currentSource();
    const id = `op-${++this.opSeq}`;
    const before = clone(this.state.objectTaint.get(objectId) ?? null);
    const after = applyMoveToTaint(clone(taint)!, ctx.source, id);
    this.state.objectTaint.set(objectId, after);
    this.updateSession(ctx.source);
    this.appendOp(this.makeOp(id, ctx, { kind: 'cosmetic', cells: [], objects: [{ id: objectId, kind: 'cosmetic' }] }, scope));
    return { cells: [], objects: [{ id: objectId, before, after: clone(after) }], opIds: [id] };
  }

  /**
   * Adopt a prior map's provenance across a transfer, after the replay recorded its own placeholder
   * ops: cell taint shifts by `offset` where the replay landed content, object taint follows the
   * surviving ids, and the ledger and session flags carry over. Carried ops are re-keyed (`xfer-`)
   * away from this tracker's `op-N` sequence and taint references are remapped with them; a reference
   * to an op the source had already capped away stays as it was.
   */
  adoptTransplant(
    prev: ProvenanceState,
    offset: MacroCoord,
    keepCell: (x: number, y: number) => boolean,
    keepObject: (id: string) => boolean,
  ): void {
    const remap = new Map<string, string>();
    for (const op of prev.ledger) remap.set(op.id, `xfer-${op.id}`);
    const reref = (t: UnitTaint | null): UnitTaint | null => {
      if (!t) return null;
      return {
        ...t,
        contribution: { ...t.contribution },
        createdByOp: remap.get(t.createdByOp) ?? t.createdByOp,
        lastModifiedByOp: remap.get(t.lastModifiedByOp) ?? t.lastModifiedByOp,
      };
    };
    for (let sy = 0; sy < prev.cellTaint.length; sy++) {
      const row = prev.cellTaint[sy]!;
      for (let sx = 0; sx < row.length; sx++) {
        const t = row[sx];
        if (!t) continue;
        const dx = sx + offset.x, dy = sy + offset.y;
        if (!this.state.cellTaint[dy] || dx < 0 || dx >= this.state.cellTaint[dy]!.length) continue;
        if (!keepCell(dx, dy)) continue;
        this.state.cellTaint[dy]![dx] = reref(t);
      }
    }
    for (const [id, t] of prev.objectTaint) {
      if (keepObject(id)) this.state.objectTaint.set(id, reref(t)!);
    }
    this.state.ledger = [...prev.ledger.map((op) => ({ ...op, id: remap.get(op.id)! })), ...this.state.ledger];
    this.capLedger();
    const a = this.state.session, b = prev.session;
    a.aiAnalysisUsed ||= b.aiAnalysisUsed;
    a.aiWritesUsed ||= b.aiWritesUsed;
    a.aiAcceptedCount += b.aiAcceptedCount;
    a.proceduralRuns += b.proceduralRuns;
    a.analysisOnlyCalls += b.analysisOnlyCalls;
    a.humanAfterAi ||= b.humanAfterAi;
    a.aiAfterHuman ||= b.aiAfterHuman;
    this.state.summary = null;
  }

  applyDelta(delta: TaintDelta, dir: 'before' | 'after'): void {
    for (const c of delta.cells) this.setCellTaint(c.x, c.y, clone(c[dir]));
    for (const o of delta.objects) {
      const v = clone(o[dir]);
      if (v) this.state.objectTaint.set(o.id, v); else this.state.objectTaint.delete(o.id);
    }
    this.state.summary = null;
  }

  mergeDeltas(deltas: TaintDelta[]): TaintDelta {
    const firstBefore = new Map<string, TaintDelta['cells'][number]>();
    const lastAfter = new Map<string, TaintDelta['cells'][number]>();
    const objFirst = new Map<string, TaintDelta['objects'][number]>();
    const objLast = new Map<string, TaintDelta['objects'][number]>();
    const opIds: string[] = [];
    for (const d of deltas) {
      opIds.push(...d.opIds);
      for (const c of d.cells) { const k = cellKey(c.x, c.y); if (!firstBefore.has(k)) firstBefore.set(k, c); lastAfter.set(k, c); }
      for (const o of d.objects) { if (!objFirst.has(o.id)) objFirst.set(o.id, o); objLast.set(o.id, o); }
    }
    const cells = [...firstBefore.keys()].map(
      (k) => ({ x: firstBefore.get(k)!.x, y: firstBefore.get(k)!.y, before: clone(firstBefore.get(k)!.before), after: clone(lastAfter.get(k)!.after) }),
    );
    const objects = [...objFirst.keys()].map((id) => ({ id, before: clone(objFirst.get(id)!.before), after: clone(objLast.get(id)!.after) }));
    return { cells, objects, opIds };
  }

  markReverted(opIds: string[]): void { this.setStatus(opIds, 'reverted'); }
  markApplied(opIds: string[]): void { this.setStatus(opIds, 'applied'); }
  private setStatus(opIds: string[], status: 'applied' | 'reverted'): void {
    const set = new Set(opIds);
    for (const op of this.state.ledger) if (set.has(op.id)) op.status = status;
    this.state.summary = null;
  }

  /** Whose work this cell is (see `dominantAuthor`); null if nothing has touched it. */
  cellAuthor(x: number, y: number): Author {
    return dominantAuthor(this.state.cellTaint[y]?.[x] ?? null);
  }

  /** Whose work this object is; null if it predates the ledger (a map loaded without provenance). */
  objectAuthor(id: string): Author {
    return dominantAuthor(this.state.objectTaint.get(id) ?? null);
  }

  getSummary(): MapProvenanceSummary {
    if (!this.state.summary) this.state.summary = deriveSummary(this.state.cellTaint, this.state.objectTaint, this.state.session);
    return this.state.summary;
  }

  /** One op onto the ledger, which then keeps its newest `LEDGER_MAX`. */
  private appendOp(op: ProvenanceOperation): void {
    this.state.ledger.push(op);
    this.capLedger();
    this.state.summary = null;
  }

  /** The ledger grows one op per command and rides in every autosave; unbounded it would trip the
   *  storage quota. Taint stays exact, so dropping the oldest ops coarsens only the history. */
  private capLedger(): void {
    if (this.state.ledger.length > LEDGER_MAX) this.state.ledger.splice(0, this.state.ledger.length - LEDGER_MAX);
  }

  private setCellTaint(x: number, y: number, t: UnitTaint | null): void {
    const row = this.state.cellTaint[y]; if (row) row[x] = t;
  }

  private updateSession(source: ProvSource): void {
    const s = this.state.session;
    if (source === ProvSource.AiWrite) s.aiWritesUsed = true;
    if (source === ProvSource.AiAccepted) { s.aiWritesUsed = true; s.aiAcceptedCount++; }
    if (source === ProvSource.Procedural) s.proceduralRuns++;
  }

  private makeOp(
    id: string, ctx: SourceContext, change: { kind: OpKind; cells: MacroCoord[]; objects: { id: string; kind: OpKind }[] }, scope: ScopeMeta,
  ): ProvenanceOperation {
    const { kind, cells, objects } = change;
    const cls = SOURCE_ROLES[ctx.source].author;
    const disclosure: DisclosureClass = cls === 'ai' ? 'contains_ai_assisted' : cls === 'procedural' ? 'procedural' : 'human_created';
    return {
      id, parents: [], timestamp: this.now(), appVersion: this.appVersion, schemaVersion: this.schemaVersion,
      source: ctx.source, actor: SOURCE_ROLES[ctx.source].actor, disclosure,
      tool: ctx.tool, status: 'applied', derived: scope.derived,
      scope: makeScope(cells, objects, kind, scope),
      ai: ctx.ai, procedural: ctx.procedural,
    };
  }
}

function emptyGrid(w: number, h: number): (UnitTaint | null)[][] {
  return Array.from({ length: h }, () => Array<UnitTaint | null>(w).fill(null));
}

function makeScope(cells: MacroCoord[], objects: { id: string; kind: OpKind }[], kind: OpKind, meta: ScopeMeta): OperationScope {
  const box = regionBounds(cells);
  const bbox = box && { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 };
  let objAdded = 0, objModified = 0, objDeleted = 0;
  for (const o of objects) { if (o.kind === 'delete') objDeleted++; else if (o.kind === 'create') objAdded++; else objModified++; }
  return {
    bbox,
    counts: { terrain: cells.length, water: 0, road: 0, edgeCutCorners: kind === 'cosmetic' ? cells.length : 0, objAdded, objModified, objDeleted },
    layers: meta.layers, zones: meta.zones,
    objectIds: objects.length <= 64 ? objects.map((o) => o.id) : undefined,
    coverageCells: cells.length,
  };
}
