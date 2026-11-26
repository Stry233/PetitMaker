/** Builds a scene's neighbourhood and cleared plot off the main thread, keeping each template's
 *  neighbourhood for the next request while the worker lives. */
import type { GridState } from '../../core/model/types';
import { workerScope } from '../../platform/async/worker-client';
import { sceneNeighbourhood, scenePlot, type ScenePlot } from './neighbourhood';
import { storedWorld, type StoredWorld } from './stored-world';

/** A template id and, for a scene with one, the plot it clears. */
export interface SceneWorldRequest { templateId?: string; plot?: ScenePlot }
/** The neighbourhood and, when asked, the cleared plot, in their stored form. */
export interface SceneWorldReply { base: StoredWorld; plot?: StoredWorld }

const built = new Map<string, GridState>();
const scope = workerScope<SceneWorldRequest & { id: number }, SceneWorldReply & { id: number }>();
scope.listen(({ id, templateId, plot }) => {
  const key = templateId ?? '';
  let base = built.get(key);
  if (!base) { base = sceneNeighbourhood(templateId); built.set(key, base); }
  scope.post({ id, base: storedWorld(base), ...(plot ? { plot: storedWorld(scenePlot(base, plot)) } : {}) });
});
