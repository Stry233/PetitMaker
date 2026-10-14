/*
 * What the assistant panel's buttons ask of the session, beside the runner: exporting the log,
 * clearing settled records, recalling a queued note, answering a gate, and the readings its record
 * cards need (which jobs belong to another map, how many cells a gated write covers).
 */
import type { GridState } from '../../core/model/types';
import { downloadJSON } from '../../io/export/download';
import { answerGate } from '../core/gates';
import type { GateAnswer } from '../core/types';
import type { JobView, OpRow, PanelView } from '../core/project-view';
import { recallSteer } from '../core/steering';
import { resolveCells } from '../tools/cells';
import { serializeLog } from './log-codec';
import { panelView, useAgentSession } from './store';

/** Downloads the stored bytes that failed to load when there are any, else the live session log. */
export function exportSessionLog(): void {
  const state = useAgentSession.getState();
  downloadJSON(state.corruptRaw ?? serializeLog(state.log), `petitmaker-agent-log-${Date.now()}.json`);
}

/** Removes the settled records without changing the map. */
export function clearJobs(): void {
  const store = useAgentSession.getState();
  store.clearRecords(panelView(store).jobs.map((job) => job.orderSeq));
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

/** The order the latest job ran, which a retry files again. */
export function lastOrderText(): string | undefined {
  return panelView(useAgentSession.getState()).jobs.slice(-1)[0]?.orderText;
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
