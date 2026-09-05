/** Routes submitted text by session phase: new order, steer, gate answer, or resume note. */
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

/** Applies the phase route. Map context, region and template identity attach only to new orders. */
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
      // If projection and log disagree, preserve the submitted text as steering guidance.
      queueSteer(log, trimmed);
      return { route: 'steer', startsJob: false };
    }
    case 'resume-note':
      append(log, { kind: 'resumed', note: trimmed });
      // Queue the note as steering so it reaches the resumed job's first provider turn.
      queueSteer(log, trimmed);
      return { route, startsJob: false };
  }
}
