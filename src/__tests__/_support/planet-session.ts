/** The planet the open planet session's canvas holds, as its Finish cuts it. */
import { editorPort } from '../../editor/session/context';
import { finishPlanetSession } from '../../editor/operations/planet-session';
import type { PlanetCrop } from '../../core/model/planet';
import { useEditorStore } from '../../state/store';

/** The session's planet under the canvas's own name, so a cut keeps the name the canvas carries;
 *  null outside a session or on a canvas without ground. */
export function sessionCut(): PlanetCrop | null {
  const done = finishPlanetSession(editorPort, useEditorStore.getState().gridState?.template.name.en ?? '');
  return done.ok ? { template: done.template, rimSand: [...done.rimSand] } : null;
}
