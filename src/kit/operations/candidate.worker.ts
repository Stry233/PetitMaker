/**
 * The generation worker's entry: one message in, one message out. The jobs that share it — a
 * CANDIDATE (a whole planet built for a card), a macro PREVIEW or BUILD (the cells a smart-build
 * press would change), and a carry preview (a whole build replayed onto another planet through the
 * rules) — run the same executor and rules at different sizes, and a second worker chunk would
 * carry the same code twice. The closure is browser-API-free by construction (it is the same code
 * the main-thread fallback runs), so the only thing this file knows about the worker environment
 * is `postMessage`.
 */
import { decodeGridState, encodeGridState } from '../../core/model/grid-wire';
import { isPlanetCanvasId } from '../../core/model/planet';
import { createDefaultRegistry } from '../../rules';
import type { GenerateConfig, GridState, MacroCoord, MapTemplate } from '../../core/model/types';
import { buildMacroRun, detachedContext, previewMacro, type MacroId, type MacroOpts } from '../../tools/macros';
import type { WireCandidate, WireGrid, WireTransferPreview } from './candidate-pool';
import { runCandidateOn } from './generate';
import { transferPreviewOf } from './planet-preview';

/** `templates` carries the templates a job names by id besides its grid's own, the first time this
 *  worker is sent each. */
type In = { id: number; grid: WireGrid; templates?: MapTemplate[] } & (
  | { kind: 'candidate'; config: GenerateConfig; region: MacroCoord[] | null }
  | { kind: 'preview'; macro: MacroId; opts: MacroOpts }
  | { kind: 'macro'; macro: MacroId; opts: MacroOpts }
  | { kind: 'transfer'; targetId: string }
);

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

/** Templates are immutable per map, so each arrives once and is read from here after — its
 *  `zones` array is as big as the cells, and resending it per job would give back half of what
 *  the wire encoding saves. */
const templates = new Map<string, MapTemplate>();

/** Stores `t`. A planet editor canvas replaces the one before it: each session's canvas has its own
 *  id, and an earlier session's id never comes back. */
function keepTemplate(id: string, t: MapTemplate): void {
  if (isPlanetCanvasId(id)) for (const known of templates.keys()) if (known !== id && isPlanetCanvasId(known)) templates.delete(known);
  templates.set(id, t);
}

function reviveGrid(grid: WireGrid): GridState {
  if (grid.template) keepTemplate(grid.templateId, grid.template);
  return decodeGridState(grid, knownTemplate(grid.templateId));
}

function knownTemplate(id: string): MapTemplate {
  const template = templates.get(id);
  if (!template) throw new Error(`unknown template ${id}`);
  return template;
}

scope.onmessage = (e: MessageEvent) => {
  const job = e.data as In;
  void (async () => {
    try {
      for (const t of job.templates ?? []) keepTemplate(t.id, t);
      const state = reviveGrid(job.grid);
      if (job.kind === 'candidate') {
        const run = await runCandidateOn(state, { config: job.config, region: job.region });
        const answer: WireCandidate = { ...encodeGridState(state), outcome: run.outcome, commands: run.commands, bare: run.bare };
        scope.postMessage({ id: job.id, ok: true, run: answer }, [answer.wire.buffer]);
        return;
      }
      if (job.kind === 'transfer') {
        const built = transferPreviewOf(state, knownTemplate(job.targetId));
        const preview: WireTransferPreview = {
          grid: encodeGridState(built.state), dropped: built.dropped, moved: built.moved, droppedCounts: built.droppedCounts,
        };
        scope.postMessage({ id: job.id, ok: true, preview }, [preview.grid.wire.buffer]);
        return;
      }
      if (job.kind === 'macro') {
        // The build half only: the accepted commands go back, the landing stays on the live map's
        // own thread where the undo stack and the provenance ledger live.
        const built = buildMacroRun(detachedContext(state, createDefaultRegistry()), job.macro, job.opts);
        scope.postMessage({ id: job.id, ok: true, built });
        return;
      }
      const preview = previewMacro(detachedContext(state, createDefaultRegistry()), job.macro, job.opts);
      scope.postMessage({ id: job.id, ok: true, preview });
    } catch (err) {
      scope.postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
