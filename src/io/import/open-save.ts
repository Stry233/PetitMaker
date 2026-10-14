// The one way a parsed save becomes a map to install: decoded as saved, then cleared under its
// landmarks. Every load path (autosave restore, JSON and share import, `openSave`) goes through it.
import { decodeSave } from '../save/json-codec';
import { parseSave, type ParsedSave } from '../save/parse';
import { clearUnderLandmarks, type LandmarkClearance } from '../../tools/generation/transfer';
import type { GridState, MapTemplate } from '../../core/model/types';

export interface LoadedSave { state: GridState; cleared: LandmarkClearance }

export function loadParsedSave(parsed: ParsedSave): LoadedSave {
  const state = decodeSave(parsed);
  return { state, cleared: clearUnderLandmarks(state) };
}

/** A save's JSON opened for callers that install the map without going through an import surface. */
export function openSave(json: string, template: MapTemplate): GridState {
  return loadParsedSave(parseSave(JSON.parse(json), { template })).state;
}
