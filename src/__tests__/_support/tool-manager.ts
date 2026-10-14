import type { EditorView } from '../../tools/pointer/runtime';
import { ToolManager } from '../../tools/pointer/runtime/tool-manager';
import { createDefaultRegistry } from '../../rules/index';
import type { GridState } from '../../core/model/types';
import { makeState } from './map-state';
import { createExecutor } from '../../state/executor';
import { editorToolWiring } from '../../editor/session/tool-wiring';

/** A view's own verbs with nothing to animate: a stub view paints at once and renders no map. */
export function headlessViewVerbs(): Omit<EditorView, 'projection' | 'overlay'> {
  return {
    plopObject() {}, animateRotation() {}, animateGroupRotation() {},
    rendersState: () => null,
    onNextPaint: (cb) => cb(),
  };
}

// A stub EditorView: ToolManager.buildCtx only reads projection/overlay (never calls
// through them) unless a tool's onPointer* handler runs, which cursor-focused suites
// never trigger — they only swap the active tool and read its cursor/context.
export function makeStubView(): EditorView {
  return {
    projection: {} as EditorView['projection'],
    overlay: { showGhost() {}, showGhostSpans() {}, clearGhost() {}, flashCommit() {} } as unknown as EditorView['overlay'],
    ...headlessViewVerbs(),
  };
}

/** A real ToolManager over a fresh grid + executor + stub view: the minimum
 *  wiring needed to switch tools and read their cursor/context headlessly. */
export function makeTestToolManager(state: GridState = makeState(10, 10)): ToolManager {
  const exec = createExecutor(state, createDefaultRegistry());
  return new ToolManager(makeStubView(), exec, state, editorToolWiring());
}
