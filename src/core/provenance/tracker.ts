// src/core/provenance/tracker.ts
import { cellKey } from '../model/grid-model';
import type { MacroCoord } from '../model/types';
import { applyOpToTaint, deriveSummary, dominantAuthor, type OpKind, sourceClass } from './policy';
import { APP_VERSION } from '../../version';
import {
  ProvSource, type SourceContext, type UnitTaint, type ProvenanceOperation,
  type ProvenanceState, type MapProvenanceSummary, type OperationScope, type ActorType, type DisclosureClass,
} from './types';

/** Whose work a unit is — see `dominantAuthor`. */
export type Author = 'ai' | 'human' | 'procedural' | null;

export interface TaintDelta {
  cells: { x: number; y: number; before: UnitTaint | null; after: UnitTaint | null }[];
  objects: { id: string; before: UnitTaint | null; after: UnitTaint | null }[];
  opIds: string[];
}

interface ScopeMeta { layers: number[]; zones: number[]; derived?: boolean }

const DEFAULT_SOURCE: SourceContext = { source: ProvSource.Human };

function actorFor(s: ProvSource): ActorType {
  if (s === ProvSource.AiWrite || s === ProvSource.AiAccepted || s === ProvSource.AiAnalysis) return 'ai';
  if (s === ProvSource.Procedural || s === ProvSource.AutoRepair || s === ProvSource.AutoTrim) return 'system';
  if (s === ProvSource.Imported || s === ProvSource.Unknown) return 'imported';
  return 'user';
}

function clone(t: UnitTaint | null): UnitTaint | null {
  return t ? { ...t, contribution: { ...t.contribution } } : null;
}

/** Operation-history cap. Oldest ops are dropped past this; cell/object taint is exact regardless. */
const LEDGER_MAX = 2000;

export class ProvenanceTracker {
  readonly state: ProvenanceState;
  private stack: SourceContext[] = [];
  private opSeq = 0;
  private now: () => number;
  private appVersion: string;
  private schemaVersion: number;

  constructor(width: number, height: number, opts: { now?: () => number; appVersion?: string; schemaVersion?: number; adopt?: ProvenanceState } = {}) {
    this.now = opts.now ?? Date.now;
    // APP_VERSION, never a literal: a hardcoded default silently stamps provenance records
    // with a version the build is not (it read 0.1.0 for every build after 0.1.0 shipped).
    this.appVersion = opts.appVersion ?? APP_VERSION;
    this.schemaVersion = opts.schemaVersion ?? 1;
    if (opts.adopt) {
      this.state = opts.adopt;
      for (const op of this.state.ledger) { const m = /^op-(\d+)$/.exec(op.id); if (m) this.opSeq = Math.max(this.opSeq, Number(m[1])); }
    } else {
      this.state = {
        ledger: [], cellTaint: emptyGrid(width, height), objectTaint: new Map(),
        session: { aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0, proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false, aiAfterHuman: false },
        summary: null,
      };
    }
  }

  pushSource(ctx: SourceContext): void { this.stack.push(ctx); }
  popSource(): void { this.stack.pop(); }
  currentSource(): SourceContext { return this.stack[this.stack.length - 1] ?? DEFAULT_SOURCE; }
  withSource<T>(ctx: SourceContext, fn: () => T): T { this.pushSource(ctx); try { return fn(); } finally { this.popSource(); } }

  noteAnalysisOnly(): void {
    this.state.session.aiAnalysisUsed = true;
    this.state.session.analysisOnlyCalls++;
    this.state.summary = null;
  }

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
    this.state.ledger.push(this.makeOp(id, ctx, kind, cells, objects, scope));
    // The ledger grows one op per COMMAND (a brush stroke is dozens) and rides in
    // every autosave; unbounded it eventually trips the localStorage quota and
    // takes the autosave with it. The per-cell taint stays exact — dropping the
    // oldest ops only coarsens the operation history, never the area accounting.
    if (this.state.ledger.length > LEDGER_MAX) {
      this.state.ledger.splice(0, this.state.ledger.length - LEDGER_MAX);
    }
    this.state.summary = null;
    return delta;
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
    const cells = [...firstBefore.keys()].map((k) => ({ x: firstBefore.get(k)!.x, y: firstBefore.get(k)!.y, before: clone(firstBefore.get(k)!.before), after: clone(lastAfter.get(k)!.after) }));
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

  /** During collapse: when one stroke removed and re-added the SAME object id
   *  (a move / rotate / replace), re-derive its taint as a cosmetic modify of the
   *  original so prior contribution (e.g. AI) is preserved — a move/rotate must never launder taint — instead of the
   *  remove→delete + add→create that the individual ops produced. Mutates live state
   *  and the merged delta's `after` to match. */
  finalizeObjectModifies(merged: TaintDelta): TaintDelta {
    for (const o of merged.objects) {
      if (o.before && o.after && o.before.createdByOp !== o.after.createdByOp) {
        const re = applyOpToTaint(o.before, o.after.origin, 'cosmetic', o.after.lastModifiedByOp);
        o.after = clone(re);
        if (re) this.state.objectTaint.set(o.id, clone(re)!); else this.state.objectTaint.delete(o.id);
      }
    }
    this.state.summary = null;
    return merged;
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

  private setCellTaint(x: number, y: number, t: UnitTaint | null): void {
    const row = this.state.cellTaint[y]; if (row) row[x] = t;
  }

  private updateSession(source: ProvSource): void {
    const s = this.state.session;
    if (source === ProvSource.AiWrite) s.aiWritesUsed = true;
    if (source === ProvSource.AiAccepted) { s.aiWritesUsed = true; s.aiAcceptedCount++; }
    if (source === ProvSource.Procedural) s.proceduralRuns++;
  }

  private makeOp(id: string, ctx: SourceContext, kind: OpKind, cells: MacroCoord[], objects: { id: string; kind: OpKind }[], scope: ScopeMeta): ProvenanceOperation {
    const cls = sourceClass(ctx.source);
    const disclosure: DisclosureClass = cls === 'ai' ? 'contains_ai_assisted' : cls === 'procedural' ? 'procedural' : 'human_created';
    return {
      id, parents: [], timestamp: this.now(), appVersion: this.appVersion, schemaVersion: this.schemaVersion,
      source: ctx.source, actor: actorFor(ctx.source), disclosure,
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
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of cells) { x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x); y2 = Math.max(y2, c.y); }
  const bbox = cells.length ? { x1, y1, x2, y2 } : null;
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
