/**
 * The generation worker's entry: one message in, one message out. The jobs that share it — a
 * Candidate (a whole planet built for a card), a macro preview or build (the cells a smart-build
 * press would change), and a carry preview (a whole build replayed onto another planet through the
 * rules) — run the same executor and rules at different sizes, and a second worker chunk would
 * carry the same code twice. The closure is browser-API-free by construction (it is the same code
 * the main-thread fallback runs); the worker scope is reached only through `workerScope`.
 */
import { decodeGridState, encodeGridState } from '../../../core/model/grid-wire';
import { isPlanetCanvasId } from './planet-canvas';
import { createRuleRegistry, type RuleSetName } from '../../../rules';
import type { GridState, MacroCoord, MapTemplate } from '../../../core/model/types';
import type { AnnotationsState } from '../../../core/model/annotations';
import type { GenerateConfig } from '../recipe';
import { buildMacroRun, type MacroBuild, type MacroId, type MacroOpts } from '../../macros/run';
import { detachedContext } from '../../macros/runtime/scratch';
import { previewMacro, type MacroPreview } from '../../macros/runtime/preview';
import { workerScope } from '../../../platform/async/worker-client';
import type { WireCandidate, WireGrid, WireTransferPreview } from './candidate-wire';
import { runCandidateOn } from './generation-run';
import { transferPreviewOf } from './planet-preview';

/** What each kind of job asks besides the grid it runs on. */
export interface CandidateJobs {
  candidate: { config: GenerateConfig; region: MacroCoord[] | null; rules: RuleSetName };
  preview: { macro: MacroId; opts: MacroOpts; rules: RuleSetName };
  macro: { macro: MacroId; opts: MacroOpts; rules: RuleSetName };
  /** The grid's wire leaves plan notes behind, so the carry is sent the ones it moves. */
  transfer: { targetId: string; annotations?: AnnotationsState };
}

/** One job, by kind. `templates` carries the templates a job names by id besides its grid's own,
 *  the first time this worker is sent each. */
export type CandidateJob = { grid: WireGrid; templates?: MapTemplate[] }
  & { [K in keyof CandidateJobs]: { kind: K } & CandidateJobs[K] }[keyof CandidateJobs];

/** What a finished job of each kind answers with. */
export interface CandidateAnswers {
  candidate: { run: WireCandidate };
  transfer: { preview: WireTransferPreview };
  macro: { built: MacroBuild | null };
  preview: { preview: MacroPreview };
}

/** The one message a job answers with: its kind's answer, or the error it threw. */
export type CandidateReply =
  | ({ ok: true } & CandidateAnswers[keyof CandidateAnswers])
  | { ok: false; error: string };

const scope = workerScope<CandidateJob, CandidateReply>();

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

scope.listen((job) => {
  void (async () => {
    try {
      for (const t of job.templates ?? []) keepTemplate(t.id, t);
      const state = reviveGrid(job.grid);
      if (job.kind === 'candidate') {
        const run = await runCandidateOn(state, { config: job.config, region: job.region, rules: job.rules });
        const answer: WireCandidate = { ...encodeGridState(state), outcome: run.outcome, commands: run.commands, bare: run.bare };
        scope.post({ ok: true, run: answer }, [answer.wire.buffer]);
        return;
      }
      if (job.kind === 'transfer') {
        if (job.annotations) state.annotations = job.annotations;
        const built = transferPreviewOf(state, knownTemplate(job.targetId));
        const preview: WireTransferPreview = {
          grid: encodeGridState(built.state), dropped: built.dropped, moved: built.moved, droppedCounts: built.droppedCounts,
          ...(built.state.annotations ? { annotations: built.state.annotations } : {}),
        };
        scope.post({ ok: true, preview }, [preview.grid.wire.buffer]);
        return;
      }
      if (job.kind === 'macro') {
        // The build half only: the accepted commands go back, the landing stays on the live map's
        // own thread where the undo stack and the provenance ledger live.
        const built = buildMacroRun(detachedContext(state, createRuleRegistry(job.rules)), job.macro, job.opts);
        scope.post({ ok: true, built });
        return;
      }
      const preview = previewMacro(detachedContext(state, createRuleRegistry(job.rules)), job.macro, job.opts);
      scope.post({ ok: true, preview });
    } catch (err) {
      scope.post({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
