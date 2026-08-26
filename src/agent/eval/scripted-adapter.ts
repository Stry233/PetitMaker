/** A deterministic `Adapter` test double: turns are scripted ahead of time rather than computed
 *  by a real dialect, so the loop plan's tests drive it with no SDK and no network. */
import type { StreamEvent, TurnError } from '../core/types';
import type { Adapter, AdapterRequest } from '../providers/types';

export type ScriptedTurn =
  | { events: StreamEvent[] }
  | { error: TurnError }
  | ((req: AdapterRequest) => StreamEvent[]);

const EXHAUSTED: StreamEvent[] = [{ t: 'text', delta: '(script exhausted)' }, { t: 'done', stop: 'stop' }];

export function createScriptedAdapter(turns: ScriptedTurn[]): Adapter & { requests: AdapterRequest[] } {
  const requests: AdapterRequest[] = [];
  let cursor = 0;

  return {
    requests,
    async *stream(req: AdapterRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      requests.push(req);
      const turn = cursor < turns.length ? turns[cursor++] : undefined;

      if (turn && 'error' in turn) {
        yield { t: 'error', error: turn.error };
        return;
      }
      const events = turn === undefined ? EXHAUSTED : typeof turn === 'function' ? turn(req) : turn.events;

      for (const event of events) {
        if (signal.aborted) {
          yield { t: 'done', stop: 'aborted' };
          return;
        }
        yield event;
      }
    },
    async listModels(): Promise<string[]> {
      return ['scripted-model'];
    },
  };
}
