import type { MapRenderer } from '../../canvas/map2d/map-renderer';
import type { EditorView } from '../../canvas/view-projection';
import { ToolManager } from '../../tools/tool-manager';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import type { EditorEvents, GridState } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

// A stub EditorView: ToolManager.buildCtx only READS projection/overlay (never calls
// through them) unless a tool's onPointer* handler runs, which cursor-focused suites
// never trigger — they only swap the active tool and read its cursor/context.
export function makeStubRenderer(): MapRenderer {
  const view: EditorView = {
    projection: {} as EditorView['projection'],
    overlay: { showGhost() {}, showGhostSpans() {}, clearGhost() {}, flashCommit() {} } as unknown as EditorView['overlay'],
    applyCameraTransform: () => {},
    leftDragPans: true,
  };
  return { asEditorView: () => view } as unknown as MapRenderer;
}

/** A real ToolManager over a fresh grid + executor + stub renderer: the minimum
 *  wiring needed to switch tools and read their cursor/context headlessly. */
export function makeTestToolManager(state: GridState = makeState(10, 10)): ToolManager {
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  return new ToolManager(makeStubRenderer(), exec, state);
}
