/** The one way to bind an executor to a map: the terrain policy's road lookup answers for that same
 *  map. */
import { CommandExecutor, type ExecutorDeps } from '../core/commands/command-executor';
import { EventBus } from '../core/commands/event-bus';
import { ProvenanceRecorder } from '../core/commands/provenance-recorder';
import { terrainStrokePolicy, type TerrainStrokePolicy } from '../core/domain/edge-cut/stroke-policy';
import { applyTrim } from '../core/domain/edge-cut/trim-apply';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import type { GridState } from '../core/model/types';
import type { MapProvenanceSummary } from '../core/provenance/types';
import type { EditorEvents } from './editing/events';
import { roadLookup } from './object-index';
import { APP_VERSION } from '../platform/build/build-info';

/** What the editor builds an executor over `state` from. A detached map passes no bus and gets one
 *  nobody listens to. */
function executorDeps(
  state: GridState, registry: RuleDispatcher, bus: EventBus<EditorEvents> = new EventBus<EditorEvents>(),
): ExecutorDeps & { policy: TerrainStrokePolicy } {
  return { bus, rules: registry, policy: terrainStrokePolicy(roadLookup(state)), provenance: new ProvenanceRecorder(state, APP_VERSION), trims: applyTrim };
}

/** An executor over `state` with the editor's policy. */
export function createExecutor(
  state: GridState, registry: RuleDispatcher, bus?: EventBus<EditorEvents>,
): CommandExecutor {
  return new CommandExecutor(state, executorDeps(state, registry, bus));
}

/** The live map's provenance summary, for a selector over the store; undefined before a map loads. */
export function provenanceSummaryOf(s: { commandExecutor?: CommandExecutor | null }): MapProvenanceSummary | undefined {
  return s.commandExecutor?.getProvenanceSummary();
}
