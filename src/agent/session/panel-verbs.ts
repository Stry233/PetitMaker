/*
 * What the assistant panel's buttons ask of the session, beside the runner: exporting the log,
 * clearing settled records, recalling a queued note, answering a gate, taking a job back, and the
 * readings its record cards need (which jobs belong to another map, how many cells a gated write covers).
 * A take-back reads the live session and map itself and refuses by `core/job-readings.ts:takeBackStanding`,
 * so no caller can rewind past it.
 */
import type { GridState } from '../../core/model/types';
import { downloadJSON, exportFileName } from '../../io/export/download';
import { answerGate, answerWithOption } from '../core/gates';
import type { GateAnswer } from '../core/types';
import type { JobView, OpRow, PanelView } from '../core/project-view';
import { recallSteer } from '../core/steering';
import { resolveCells } from '../tools/cells';
import { serializeLog } from './log-codec';
import { panelView, useAgentSession } from './store';
import { takeBackStanding, type TakeBackFacts } from '../core/job-readings';
import { PHASE_TRAITS } from '../core/view-types';
import { liveUndoDepth, rewindLiveMap } from '../../editor/editing/rewind';
import { useEditorStore } from '../../state/store';

/** Downloads the stored bytes that failed to load when there are any, else the live session log. */
export function exportSessionLog(): void {
  const state = useAgentSession.getState();
  downloadJSON(state.corruptRaw ?? serializeLog(state.log), exportFileName(['agent-log', Date.now()], 'json'));
}

/** Removes the settled records without changing the map. */
export function clearJobs(): void {
  const store = useAgentSession.getState();
  store.clearRecords(panelView(store).jobs.map((job) => job.orderSeq));
}

/** The facts a take-back is read against, as the session and the open map stand now; undefined
 *  with no map open. A job counts as running while the loop owns it; a log restored from storage
 *  has no loop behind it. */
function liveTakeBackFacts(): TakeBackFacts | undefined {
  const undoDepth = liveUndoDepth();
  if (undoDepth === undefined) return undefined;
  const session = useAgentSession.getState();
  const view = panelView(session);
  return {
    running: !session.restored && PHASE_TRAITS[view.phase].inFlight,
    undoDepth,
    ...jobsByMap(recordsOf(view), useEditorStore.getState().gridState?.template.id),
  };
}

/** Rewinds the live map as `takeBackStanding` allows; false where it refuses or no map is open. */
function takeBack(job: JobView, to: number | 'whole'): boolean {
  const facts = liveTakeBackFacts();
  if (!facts) return false;
  const standing = takeBackStanding(job, to, facts);
  if (standing.refused !== undefined) return false;
  rewindLiveMap(standing.at);
  return true;
}

/** Takes the whole of `job` back off the live map: the map rewinds to the job's first checkpoint,
 *  later edits above it included. False, with the map untouched, where the take-back is refused. */
export function takeBackJob(job: JobView): boolean {
  return takeBack(job, 'whole');
}

/** Takes `job` back to its checkpoint at `checkpointIndex`, later edits above it included. False,
 *  with the map untouched, where the take-back is refused. */
export function takeBackTo(job: JobView, checkpointIndex: number): boolean {
  return takeBack(job, checkpointIndex);
}

/** Takes a queued note back before the model reads it. */
export function recallNote(steerSeq: number): void {
  recallSteer(useAgentSession.getState().log, steerSeq);
}

/** Answers the gate `gateId`; false when it is stale or already answered. */
export function answerStandingGate(gateId: string, answer: GateAnswer, words?: string): boolean {
  try {
    answerGate(useAgentSession.getState().log, gateId, answer, words);
    return true;
  } catch {
    return false;
  }
}

/** Answers the gate `gateId` by taking its option at `index`; false when it is stale, already
 *  answered or offers no such option. */
export function pickGateOption(gateId: string, index: number): boolean {
  try {
    answerWithOption(useAgentSession.getState().log, gateId, index);
    return true;
  } catch {
    return false;
  }
}

/** The order the latest job ran, which a retry files again. */
export function lastOrderText(): string | undefined {
  return panelView(useAgentSession.getState()).jobs.slice(-1)[0]?.orderText;
}

/** Every job of the session, the one in the seat included: what `jobsByMap` sorts for a take-back. */
export function recordsOf(view: PanelView): readonly JobView[] {
  return view.current ? [...view.jobs, view.current] : view.jobs;
}

/** The records made on another map, and those whose map cannot be told, by order seq; none while
 *  no map is live. */
export function jobsByMap(jobs: readonly JobView[], liveMapId: string | undefined): { otherMap: Set<number>; unknownMap: Set<number> } {
  const otherMap = new Set<number>();
  const unknownMap = new Set<number>();
  if (liveMapId !== undefined) {
    for (const job of jobs) {
      if (job.mapId === undefined) unknownMap.add(job.orderSeq);
      else if (job.mapId !== liveMapId) otherMap.add(job.orderSeq);
    }
  }
  return { otherMap, unknownMap };
}

/** How many cells the standing tool gate's write (among the current job's `ops`) resolves to on
 *  `grid`; undefined for a plan gate, a write of one cell, or none. */
export function gateCellCount(gate: PanelView['gate'], ops: readonly OpRow[] | undefined, grid: GridState | null): number | undefined {
  if (gate?.scope !== 'tool' || gate.callId === undefined || !grid) return undefined;
  const input = ops?.find((op) => op.callId === gate.callId)?.input;
  if (!input) return undefined;
  const n = resolveCells(input, grid).length;
  return n > 1 ? n : undefined;
}
