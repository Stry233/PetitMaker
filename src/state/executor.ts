/** The one way to bind an executor to a map: the road lookup answers for that same map. The macro
 *  scratch recorder (`tools/macros/scratch.ts:RecordingExecutor`) is the one other construction. */
import { CommandExecutor } from '../core/commands/command-executor';
import { EventBus } from '../core/commands/event-bus';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import type { EditorEvents, GridState } from '../core/model/types';
import { roadLookup } from './object-index';

/** An executor over `state`. A detached map passes no bus and gets one nobody listens to. */
export function createExecutor(
  state: GridState, registry: RuleDispatcher, bus: EventBus<EditorEvents> = new EventBus<EditorEvents>(),
): CommandExecutor {
  return new CommandExecutor(state, bus, registry, roadLookup(state));
}
