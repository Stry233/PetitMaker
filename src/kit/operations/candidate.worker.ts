/**
 * The generation worker's entry: one message in, one message out. Two kinds of job share it — a
 * CANDIDATE (a whole island built for a card) and a macro PREVIEW (the cells a smart-build press
 * would change) — because they are the same closure at two sizes, and a second worker chunk would
 * carry the same code twice. The closure is browser-API-free by construction (it is the same code
 * the main-thread fallback runs), so the only thing this file knows about the worker environment
 * is `postMessage`.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { decodeCells, encodeCells } from '../../core/model/grid-wire';
import { createDefaultRegistry } from '../../rules';
import { roadLookup } from '../../state/object-index';
import { catalogLoadValue } from '../../state/catalog';
import type { EditorEvents, GenerateConfig, GridState, MacroCoord, MapTemplate } from '../../core/model/types';
import { buildMacroRun, previewMacro, type MacroContext, type MacroId, type MacroOpts } from '../../tools/macros';
import type { WireCandidate, WireGrid } from './candidate-pool';
import { runCandidateOn } from './generate';

type In =
  | { id: number; kind: 'candidate'; grid: WireGrid; config: GenerateConfig; region: MacroCoord[] | null }
  | { id: number; kind: 'preview'; grid: WireGrid; macro: MacroId; opts: MacroOpts }
  | { id: number; kind: 'macro'; grid: WireGrid; macro: MacroId; opts: MacroOpts };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

/** Templates are immutable per map, so each arrives once and is read from here after — its
 *  `zones` array is as big as the cells, and resending it per job would give back half of what
 *  the wire encoding saves. */
const templates = new Map<string, MapTemplate>();

function reviveGrid(grid: WireGrid): GridState {
  if (grid.template) templates.set(grid.templateId, grid.template);
  const template = templates.get(grid.templateId);
  if (!template) throw new Error(`unknown template ${grid.templateId}`);
  return {
    template,
    cells: decodeCells(grid.wire),
    objects: new Map(grid.objects.map((o) => [o.id, o])),
    lockedLayers: new Set(grid.lockedLayers),
    cellsVersion: grid.cellsVersion,
    objectsVersion: grid.objectsVersion,
  };
}

function contextOver(state: GridState): MacroContext {
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state), catalogLoadValue);
  return { state, executor, registry: executor.getRegistry() };
}

scope.onmessage = (e: MessageEvent) => {
  const job = e.data as In;
  void (async () => {
    try {
      const state = reviveGrid(job.grid);
      if (job.kind === 'candidate') {
        const run = await runCandidateOn(state, { config: job.config, region: job.region });
        // Back the way it came: the cells as one transferable buffer, since the receiving side is
        // the main thread and a structured clone of the grid is deserialized there.
        const wire = encodeCells(state.cells, state.template.width, state.template.height);
        const answer: WireCandidate = {
          wire,
          objects: [...state.objects.values()],
          lockedLayers: [...state.lockedLayers],
          cellsVersion: state.cellsVersion ?? 0,
          objectsVersion: state.objectsVersion ?? 0,
          outcome: run.outcome,
          commands: run.commands,
          bare: run.bare,
        };
        scope.postMessage({ id: job.id, ok: true, run: answer }, [wire.buffer]);
        return;
      }
      if (job.kind === 'macro') {
        // The build half only: the accepted commands go back, the landing stays on the live map's
        // own thread where the undo stack and the provenance ledger live.
        const built = buildMacroRun(contextOver(state), job.macro, job.opts);
        scope.postMessage({ id: job.id, ok: true, built });
        return;
      }
      const preview = previewMacro(contextOver(state), job.macro, job.opts);
      scope.postMessage({ id: job.id, ok: true, preview });
    } catch (err) {
      scope.postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
