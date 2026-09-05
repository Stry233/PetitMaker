import type { GridState } from '../model/types';
import { cellKey } from '../model/grid-model';
import { ProvenanceTracker } from './tracker';
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

const KNOWN_SOURCES = new Set<string>(Object.values(ProvSource).map(String));

/** A share of [0,1] or 0 — the contribution vector is untrusted like every field beside it. */
function share(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;
}

/** One taint record off the wire, or null when it does not hold together. Every neighbouring
 *  decoder treats a save as untrusted; the disclosure record is the LAST place a hand-edited
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
  const originOk = typeof r.origin === 'string' && KNOWN_SOURCES.has(r.origin);
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

export function deserializeProvenance(raw: SerializedProvenance | undefined, width: number, height: number): ProvenanceState {
  const cellTaint: (UnitTaint | null)[][] = Array.from({ length: height }, () => Array<UnitTaint | null>(width).fill(null));
  const objectTaint = new Map<string, UnitTaint>();
  if (!raw) {
    return { ledger: [], cellTaint, objectTaint, session: emptySession(), summary: null };
  }
  for (const { k, t } of Array.isArray(raw.cells) ? raw.cells : []) {
    const [x, y] = String(k).split(',').map(Number);
    const clean = sanitizeTaint(t);
    if (clean && Number.isInteger(x) && Number.isInteger(y) && cellTaint[y!] && x! >= 0 && x! < width) cellTaint[y!]![x!] = clean;
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
  return { ledger: Array.isArray(raw.ledger) ? raw.ledger : [], cellTaint, objectTaint, session, summary: null };
}

function emptySession(): ProvenanceState['session'] {
  return { aiAnalysisUsed: false, aiWritesUsed: false, aiAcceptedCount: 0, proceduralRuns: 0, analysisOnlyCalls: 0, humanAfterAi: false, aiAfterHuman: false };
}

/** Legacy load: a map with no provenance gets all existing CONTENT marked Unknown
 *  (cells with terrain, and all objects) — pre-provenance content is never claimed as human-made. New empty cells stay null. */
export function markLegacyUnknown(state: GridState): void {
  const tracker = new ProvenanceTracker(state.template.width, state.template.height);
  tracker.pushSource({ source: ProvSource.Imported });
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y]; if (!row) continue;
    for (let x = 0; x < state.template.width; x++) if (row[x]?.terrain) cells.push({ x, y });
  }
  const objects = [...state.objects.values()].filter((o) => !o.locked).map((o) => ({ id: o.id, kind: 'create' as const }));
  if (cells.length || objects.length) tracker.record('create', cells, objects, { layers: [], zones: [] });
  // Pin UNKNOWN + origin Unknown directly, independent of what the Imported policy derives:
  // legacy content stays 'unknown' even if that policy changes.
  for (const c of cells) { const t = tracker.state.cellTaint[c.y]![c.x]!; t.flags = setFlag(t.flags, TaintFlag.UNKNOWN); t.origin = ProvSource.Unknown; }
  for (const o of objects) { const t = tracker.state.objectTaint.get(o.id)!; t.flags = setFlag(t.flags, TaintFlag.UNKNOWN); t.origin = ProvSource.Unknown; }
  tracker.popSource();
  state.provenance = tracker.state;
}
