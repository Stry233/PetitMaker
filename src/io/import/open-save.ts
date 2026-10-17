// The one way a parsed save becomes a map to install: decoded as saved, then cleared under its
// landmarks, what they stood over parked and reported with a plan to set it back. Every load path
// (autosave restore, JSON and share import, `openSave`) goes through it.
import { decodeSave } from '../save/json-codec';
import { parseSave, type ParsedSave } from '../save/parse';
import { clearUnderLandmarks, type LandmarkClearance } from '../../state/landmark-clearance';
import { createDefaultRegistry } from '../../rules';
import { applyRelocation } from '../../state/relocation-plan';
import { createExecutor } from '../../state/executor';
import type { GridState, MapTemplate } from '../../core/model/types';

export interface LoadedSave { state: GridState; cleared: LandmarkClearance }

export function loadParsedSave(parsed: ParsedSave): LoadedSave {
  const state = decodeSave(parsed);
  return { state, cleared: clearUnderLandmarks(state, createDefaultRegistry(), parsed.landmarksAsSaved) };
}

/** A save's JSON opened for callers that install the map without going through an import surface,
 *  repaired as the automatic repair does: its plan landed on the detached map. */
export function openSave(json: string, template: MapTemplate): GridState {
  const { state, cleared } = loadParsedSave(parseSave(JSON.parse(json), { template }));
  if (cleared.report) {
    const rules = createDefaultRegistry();
    applyRelocation(createExecutor(state, rules), state, cleared.report.plan);
  }
  return state;
}
