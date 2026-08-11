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

export function deserializeProvenance(raw: SerializedProvenance | undefined, width: number, height: number): ProvenanceState {
  const cellTaint: (UnitTaint | null)[][] = Array.from({ length: height }, () => Array<UnitTaint | null>(width).fill(null));
  const objectTaint = new Map<string, UnitTaint>();
  if (!raw) {
    return { ledger: [], cellTaint, objectTaint, session: emptySession(), summary: null };
  }
  for (const { k, t } of raw.cells) { const [x, y] = k.split(',').map(Number); if (cellTaint[y!]) cellTaint[y!]![x!] = t; }
  for (const { id, t } of raw.objects) objectTaint.set(id, t);
  return { ledger: raw.ledger, cellTaint, objectTaint, session: raw.session, summary: null };
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
