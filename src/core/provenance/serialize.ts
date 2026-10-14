import { cellKey, parseCellKey } from '../grid/rect';
import { LEDGER_MAX, ProvenanceTracker, type TaintDelta } from './tracker';
import {
  ProvSource, TaintFlag, setFlag,
  type ProvenanceState, type ProvenanceOperation, type UnitTaint,
} from './types';

/** Compact wire shape. Cell taint is a sparse list keyed by "x,y" (most cells are null). */
export interface SerializedProvenance {
  v: 1;
  ledger: ProvenanceOperation[];
  session: ProvenanceState['session'];
  cells: { k: string; t: UnitTaint }[];
  objects: { id: string; t: UnitTaint }[];
}

export function serializeProvenance(state: ProvenanceState): SerializedProvenance {
  const cells: { k: string; t: UnitTaint }[] = [];
  for (let y = 0; y < state.cellTaint.length; y++) {
    const row = state.cellTaint[y]; if (!row) continue;
    for (let x = 0; x < row.length; x++) { const t = row[x]; if (t) cells.push({ k: cellKey(x, y), t }); }
  }
  const objects = [...state.objectTaint.entries()].map(([id, t]) => ({ id, t }));
  return { v: 1, ledger: state.ledger, session: state.session, cells, objects };
}

/** A persisted origin: one of `ProvSource`'s numeric values. */
function isProvSource(v: unknown): v is ProvSource {
  return typeof v === 'number' && Number.isInteger(v) && ProvSource[v] !== undefined;
}

/** A share of [0,1] or 0 — the contribution vector is untrusted like every field beside it. */
function share(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;
}

/** One taint record off the wire, or null when it does not hold together. Every neighbouring
 *  decoder treats a save as untrusted; the disclosure record is the last place a hand-edited
 *  field should pass unread — a crafted `contribution.ai = 0` beside real AI flags would export
 *  AI work as human-made. Contribution shares clamp; a source outside the enum reads Unknown and
 *  wears the flag, so a forged origin surfaces instead of laundering. */
function sanitizeTaint(t: unknown): UnitTaint | null {
  if (!t || typeof t !== 'object') return null;
  const r = t as UnitTaint;
  const contribution = {
    ai: share(r.contribution?.ai),
    human: share(r.contribution?.human),
    procedural: share(r.contribution?.procedural),
  };
  const originOk = isProvSource(r.origin);
  let flags = typeof r.flags === 'number' && Number.isInteger(r.flags) ? r.flags : 0;
  if (!originOk) flags = setFlag(flags, TaintFlag.UNKNOWN);
  if (contribution.ai > 0) flags = setFlag(flags, TaintFlag.CONTAINS_AI);
  if (contribution.procedural > 0) flags = setFlag(flags, TaintFlag.CONTAINS_PROC);
  return {
    createdByOp: typeof r.createdByOp === 'string' ? r.createdByOp.slice(0, 64) : '',
    lastModifiedByOp: typeof r.lastModifiedByOp === 'string' ? r.lastModifiedByOp.slice(0, 64) : '',
    origin: originOk ? r.origin : ProvSource.Unknown,
    contribution,
    flags,
  };
}

/** A unit's taint on one side of a delta: absent, or a record through `sanitizeTaint`. */
function deltaSide(v: unknown): { ok: boolean; taint: UnitTaint | null } {
  if (v === null || v === undefined) return { ok: true, taint: null };
  const taint = sanitizeTaint(v);
  return { ok: taint !== null, taint };
}

/** A saved undo step's taint delta, every unit read like the saved provenance record's; null when
 *  its shape does not hold, so the caller drops the step's whole history. Cells must lie inside
 *  `width` by `height`. */
export function readTaintDelta(raw: unknown, width: number, height: number): TaintDelta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof TaintDelta, unknown>>;
  if (!Array.isArray(r.cells) || !Array.isArray(r.objects) || !Array.isArray(r.opIds)) return null;
  const cells: TaintDelta['cells'] = [];
  for (const c of r.cells as unknown[]) {
    if (!c || typeof c !== 'object') return null;
    const { x, y, before, after } = c as Record<string, unknown>;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    if ((x as number) < 0 || (y as number) < 0 || (x as number) >= width || (y as number) >= height) return null;
    const b = deltaSide(before), a = deltaSide(after);
    if (!b.ok || !a.ok) return null;
    cells.push({ x: x as number, y: y as number, before: b.taint, after: a.taint });
  }
  const objects: TaintDelta['objects'] = [];
  for (const o of r.objects as unknown[]) {
    if (!o || typeof o !== 'object') return null;
    const { id, before, after } = o as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    const b = deltaSide(before), a = deltaSide(after);
    if (!b.ok || !a.ok) return null;
    objects.push({ id, before: b.taint, after: a.taint });
  }
  if (!(r.opIds as unknown[]).every((id) => typeof id === 'string' && id.length <= 64)) return null;
  return { cells, objects, opIds: [...(r.opIds as string[])] };
}

/** The wire ledger, keeping the newest entries the tracker can key by id. */
function sanitizeLedger(raw: unknown): ProvenanceOperation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((op): op is ProvenanceOperation => !!op && typeof op === 'object' && typeof (op as ProvenanceOperation).id === 'string')
    .slice(-LEDGER_MAX);
}

export function deserializeProvenance(raw: SerializedProvenance | undefined, width: number, height: number): ProvenanceState {
  const cellTaint: (UnitTaint | null)[][] = Array.from({ length: height }, () => Array<UnitTaint | null>(width).fill(null));
  const objectTaint = new Map<string, UnitTaint>();
  if (!raw) {
    return { ledger: [], cellTaint, objectTaint, session: emptySession(), summary: null };
  }
  for (const { k, t } of Array.isArray(raw.cells) ? raw.cells : []) {
    const { x, y } = parseCellKey(String(k));
    const clean = sanitizeTaint(t);
    if (clean && Number.isInteger(x) && Number.isInteger(y) && cellTaint[y] && x >= 0 && x < width) cellTaint[y]![x] = clean;
  }
  for (const { id, t } of Array.isArray(raw.objects) ? raw.objects : []) {
    const clean = sanitizeTaint(t);
    if (clean && typeof id === 'string') objectTaint.set(id.slice(0, 64), clean);
  }
  const s = (raw.session ?? {}) as ProvenanceState['session'];
  const session: ProvenanceState['session'] = {
    aiAnalysisUsed: s.aiAnalysisUsed === true,
    aiWritesUsed: s.aiWritesUsed === true,
    aiAcceptedCount: Number.isInteger(s.aiAcceptedCount) && s.aiAcceptedCount >= 0 ? s.aiAcceptedCount : 0,
    proceduralRuns: Number.isInteger(s.proceduralRuns) && s.proceduralRuns >= 0 ? s.proceduralRuns : 0,
    analysisOnlyCalls: Number.isInteger(s.analysisOnlyCalls) && s.analysisOnlyCalls >= 0 ? s.analysisOnlyCalls : 0,
    humanAfterAi: s.humanAfterAi === true,
    aiAfterHuman: s.aiAfterHuman === true,
  };
  return { ledger: sanitizeLedger(raw.ledger), cellTaint, objectTaint, session, summary: null };
}

function emptySession(): ProvenanceState['session'] {
  return { aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0, proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false, aiAfterHuman: false };
}

/** The parts of a map `markLegacyUnknown` reads and the ledger it writes. */
interface LegacyMap {
  template: { width: number; height: number };
  cells: readonly (readonly ({ terrain: unknown } | null | undefined)[] | undefined)[];
  objects: ReadonlyMap<string, { id: string; locked?: boolean }>;
  provenance?: ProvenanceState;
}

/** Legacy load: a map with no provenance gets all existing content marked Unknown
 *  (cells with terrain, and all objects) — pre-provenance content is never claimed as human-made. New empty cells stay null. */
export function markLegacyUnknown(state: LegacyMap, appVersion?: string): void {
  const tracker = new ProvenanceTracker(state.template.width, state.template.height, { appVersion });
  tracker.pushSource({ source: ProvSource.Imported });
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y]; if (!row) continue;
    for (let x = 0; x < state.template.width; x++) if (row[x]?.terrain) cells.push({ x, y });
  }
  const objects = [...state.objects.values()].filter((o) => !o.locked).map((o) => ({ id: o.id, kind: 'create' as const }));
  if (cells.length || objects.length) tracker.record('create', cells, objects, { layers: [], zones: [] });
  // Pin `UNKNOWN` + origin Unknown directly, independent of what the Imported policy derives:
  // legacy content stays 'unknown' even if that policy changes.
  for (const c of cells) { const t = tracker.state.cellTaint[c.y]![c.x]!; t.flags = setFlag(t.flags, TaintFlag.UNKNOWN); t.origin = ProvSource.Unknown; }
  for (const o of objects) { const t = tracker.state.objectTaint.get(o.id)!; t.flags = setFlag(t.flags, TaintFlag.UNKNOWN); t.origin = ProvSource.Unknown; }
  tracker.popSource();
  state.provenance = tracker.state;
}
