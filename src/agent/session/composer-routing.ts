/**
 * The composer's four routes as one pure function: what a submitted message DOES depends only on
 * the session phase it lands in (spec 0.2's state-inventory table). idle/aborted/incident have no
 * job running, so a submission STARTS one; the mid-job phases (thinking/streaming/executing/
 * retrying/pausing) queue a steer instead; gated answers the outstanding gate in words; paused
 * appends a resume note AND queues it as a steer, since the note itself is only the log's record
 * of the resume and the caller's re-invoked `runJob` picks up guidance through the steer queue.
 */
import { answerGate, pendingGate } from '../core/gates';
import { append, type SessionLog } from '../core/log';
import type { SessionPhase } from '../core/project-view';
import { queueSteer } from '../core/steering';
import type { OrderRegion } from '../core/types';

export type ComposerRoute = 'order' | 'steer' | 'gate-words' | 'resume-note';

export function composerRoute(phase: SessionPhase): ComposerRoute {
  switch (phase) {
    case 'idle': case 'aborted': case 'incident': return 'order';
    case 'gated': return 'gate-words';
    case 'paused': return 'resume-note';
    case 'thinking': case 'streaming': case 'executing': case 'retrying': case 'pausing':
      return 'steer';
    default: {
      // Exhaustiveness guard: a new SessionPhase member must be routed above, not silently
      // dropped here as a no-op.
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** Routes `text` per `composerRoute(phase)` and applies its effect on `log`. Blank text (empty or
 *  whitespace-only) is a no-op on every route: the route is still reported, but nothing is
 *  appended. `opts.mapContext` rides on an `order` event only; the runner supplies the real map
 *  snapshot, and a caller with none yet gets the empty string rather than an optional field.
 *  `opts.region` rides on an `order` event too, and only there — the other three routes append no
 *  event that carries a region at all, so it is ignored by construction rather than by a check.
 *  `opts.mapId` rides the same way: it is the template the order is filed against, and only an
 *  `order` event records one. */
export function submitComposer(
  log: SessionLog, phase: SessionPhase, text: string,
  opts?: { mapContext?: string; region?: OrderRegion; mapId?: string },
): { route: ComposerRoute; startsJob: boolean } {
  const trimmed = text.trim();
  const route = composerRoute(phase);
  if (trimmed === '') return { route, startsJob: false };

  switch (route) {
    case 'order':
      append(log, {
        kind: 'order', text: trimmed, mapContext: opts?.mapContext ?? '',
        ...(opts?.region ? { region: opts.region } : {}),
        ...(opts?.mapId ? { mapId: opts.mapId } : {}),
      });
      return { route, startsJob: true };
    case 'steer':
      queueSteer(log, trimmed);
      return { route, startsJob: false };
    case 'gate-words': {
      const gate = pendingGate(log);
      if (gate) {
        answerGate(log, gate.gateId, 'words', trimmed);
        return { route, startsJob: false };
      }
      // Defensive: the projected phase says gated but the log carries no open gateAsked. Steer
      // rather than drop the text on the floor.
      queueSteer(log, trimmed);
      return { route: 'steer', startsJob: false };
    }
    case 'resume-note':
      append(log, { kind: 'resumed', note: trimmed });
      // The event alone reaches no model: `runJob`'s next request is built fresh, so the note
      // rides in as a queued steer, which `deliverSteers` folds into the resumed job's first turn.
      queueSteer(log, trimmed);
      return { route, startsJob: false };
  }
}
