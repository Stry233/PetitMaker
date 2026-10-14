/**
 * The pool's end of the generation worker's wire: the grid a job crosses with, and each answer
 * revived as the main thread reads it. Grids cross as `core/model/grid-wire` buffers, never as
 * structured-cloned grid objects; `candidate.worker.ts` is the other end.
 */
import { decodeGridState, encodeGridState, type WireGridState } from '../../../core/model/grid-wire';
import type { GridState, MacroCoord, MapTemplate } from '../../../core/model/types';
import type { TransferPreview } from './planet-preview';
import type { TransferCounts } from '../transfer';
import type { Run } from './generation-run';

/**
 * A grid on its way to a worker (`core/model/grid-wire`), naming its template and carrying it only
 * the first time each worker sees it — a template is immutable per map and its `zones` array is as
 * big as the cells.
 */
export interface WireGrid extends WireGridState {
  templateId: string;
  template?: MapTemplate;
}

/** What a worker hands back for a candidate: the run on the grid it built. */
export type CandidateRun = Run & { state: GridState };

/** The same, as it crosses. The grid goes back the way it came — one transferable buffer rather
 *  than ~24k nested objects — because the answer is deserialized on the main thread, where the
 *  clone costs the frame the pool exists to protect. The template never crosses either way: this
 *  side has the one the job was sent with. */
export type WireCandidate = WireGridState & Run;

/** A carry preview as it crosses back: the destination grid on the wire and the loss report as
 *  plain data. */
export interface WireTransferPreview {
  grid: WireGridState;
  dropped: MacroCoord[];
  moved: TransferCounts;
  droppedCounts: TransferCounts;
}

/** `state` as it crosses to a worker, its template included only when `withTemplate`. */
export function wireGrid(state: GridState, withTemplate: boolean): WireGrid {
  return {
    ...encodeGridState(state),
    templateId: state.template.id,
    ...(withTemplate ? { template: state.template } : {}),
  };
}

/** The worker's candidate answer as a grid again. */
export function reviveCandidate(run: WireCandidate, template: MapTemplate): CandidateRun {
  return { state: decodeGridState(run, template), outcome: run.outcome, commands: run.commands, bare: run.bare };
}

/** The worker's carry preview as the painter reads it. */
export function reviveTransferPreview(wire: WireTransferPreview, target: MapTemplate): TransferPreview {
  return { state: decodeGridState(wire.grid, target), dropped: wire.dropped, moved: wire.moved, droppedCounts: wire.droppedCounts };
}
