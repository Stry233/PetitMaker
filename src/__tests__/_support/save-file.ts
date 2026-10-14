/** A save's JSON decoded as written, without the landmark clearance a load path adds through
 *  `io/import/open-save.ts:loadParsedSave`; tests pin the codec through it. */
import { decodeSave } from '../../io/save/json-codec';
import { parseSave } from '../../io/save/parse';
import type { GridState, MapTemplate } from '../../core/model/types';

export function deserialize(json: string, template: MapTemplate): GridState {
  return decodeSave(parseSave(JSON.parse(json), { template }));
}
