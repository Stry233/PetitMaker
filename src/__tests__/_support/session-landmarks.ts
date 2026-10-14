// Places and removes a planet-session landmark straight through the live executor, each as one undo
// step, for tests and the feature smoke that set a planet up without driving the placement tool.
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import { landmarkSpec } from '../../core/game/profile';
import { ANCHOR_LANDMARK } from './anchor';
import { planetLandmarkObject } from '../../core/model/landmarks';
import type { MacroCoord, Rotation, ValidationError, ValidationResult } from '../../core/model/types';
import { editorPort } from '../../editor/session/context';
import type { SessionLandmarkResult } from '../../editor/operations/planet-session';

const NOT_IN_SESSION: SessionLandmarkResult = { success: false, errors: [] };

const sessionKit = () => (editorPort.planetSession() ? editorPort.live() : null);

const committed = (violations: ValidationError[]): ValidationResult => ({ success: violations.length === 0, errors: violations });

/** Places landmark `id` (the anchor's by default) with its top-left at `at` (half cells allowed);
 *  the rules decide. Refused outside a session. */
export function placeSessionLandmark(at: MacroCoord, rotation: Rotation, id: string = ANCHOR_LANDMARK.id): SessionLandmarkResult {
  const kit = sessionKit();
  const spec = landmarkSpec(id);
  if (!kit || !spec) return NOT_IN_SESSION;
  const cmd = placeObjectCommand(planetLandmarkObject(spec, at, rotation));
  return kit.executor.transaction({}, (tx): SessionLandmarkResult => {
    const res = kit.executor.execute(cmd);
    return res.success ? { ...committed(tx.commit()), cmd } : { ...res, cmd };
  });
}

/** Removes session landmark `id` (the anchor's by default). Refused outside a session or without it. */
export function removeSessionLandmark(id: string = ANCHOR_LANDMARK.id): ValidationResult {
  const kit = sessionKit();
  const landmark = kit?.state.objects.get(id);
  if (!kit || !landmark) return NOT_IN_SESSION;
  return kit.executor.transaction({}, (tx) => {
    const res = kit.executor.execute(removeObjectCommand(landmark));
    return res.success ? committed(tx.commit()) : res;
  });
}
