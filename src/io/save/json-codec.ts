import { attributedNotes } from '../../state/notes-attribution';
import { readImageAttribution } from './image-attribution';
import { ImportError } from './import-error';
import { rleDecode, rleEncode } from './rle';
import { serializeTemplate } from './planet-codec';
import type { ParsedSave } from './parse';
import { isCustomTemplate } from '../../core/model/planet';
import { clampNotes } from '../../core/model/notes';
import { type GridState, type PlacedObject, type Rotation } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { createGrid } from '../../core/model/grid-model';
import { templateLandmarkObjects } from '../../core/model/landmarks';
import { generateObjectId } from '../../core/model/object-id';
import { admitSaveObject, isValidObjectId } from './admission';
import { MAX_OBJECTS_PER_CELL } from './limits';
import { CURRENT_VERSION, type SaveFile, type SaveObject, type PersistedCamera } from './format';
import { serializeProvenance, deserializeProvenance, markLegacyUnknown } from '../../core/provenance/serialize';
import { cellToToken, decodeCorners, encodeCorners, tokenToCell } from './terrain-token';
import { decodeAnnotations } from './annotations-codec';
import { APP_VERSION } from '../../platform/build/build-info';

/* Save files are migrated to the schema in ./format/types before decoding. */

/** Serializes map state with optional camera session data supplied by the caller. */
export function buildSaveFile(state: GridState, camera?: PersistedCamera): SaveFile {
  const { template, cells, objects } = state;
  const notes = clampNotes(attributedNotes(state));

  const tokens: string[] = [];
  for (let y = 0; y < template.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const cell = row[x];
      tokens.push(cell ? cellToToken(cell) : '_');
    }
  }

  const objectList: SaveObject[] = [];
  for (const obj of objects.values()) {
    if (obj.locked) continue; // immutable structures (the landmarks) are recreated from the template on load
    const saved: SaveObject = {
      id: obj.id,
      catalogId: obj.catalogId,
      x: obj.position.x,
      y: obj.position.y,
      rotation: obj.rotation,
      elevation: obj.elevation,
    };
    if (obj.spanLength !== undefined) saved.spanLength = obj.spanLength;
    if (obj.corners) {
      const suffix = encodeCorners(obj.corners);
      if (suffix) saved.corners = suffix;
    }
    if (obj.patchOnly) saved.patchOnly = true;
    objectList.push(saved);
  }

  const saveFile: SaveFile = {
    version: CURRENT_VERSION,
    templateId: template.id,
    cells: rleEncode(tokens),
    objects: objectList,
    metadata: { savedAt: new Date().toISOString() },
    ...(isCustomTemplate(template) ? { template: serializeTemplate(template) } : {}),
    ...(state.provenance ? { provenance: serializeProvenance(state.provenance) } : {}),
    ...(notes ? { notes } : {}),
    ...(state.imageAttribution ? { imageAttribution: state.imageAttribution } : {}),
    // An empty annotation layer has no persisted visibility or lock state.
    ...(state.annotations && (state.annotations.items.length > 0 || state.annotations.customTags?.length) ? { annotations: state.annotations } : {}),
    ...(camera && (camera.view2d || camera.view3d) ? { camera } : {}),
  };

  return saveFile;
}

export function serialize(state: GridState, camera?: PersistedCamera): string {
  return JSON.stringify(buildSaveFile(state, camera));
}

/** Decodes a parsed save into the map as saved; a load path installs it only through
 *  `import/open-save.ts:loadParsedSave`, which clears under its landmarks. */
export function decodeSave(parsed: ParsedSave): GridState {
  const { file: save, template } = parsed;
  const area = template.width * template.height;
  const tokens = rleDecode(save.cells, area);
  if (tokens.length !== area) {
    throw new ImportError('malformed', 'Invalid cell data: the save does not cover the map template.');
  }
  const cells = createGrid(template);

  let idx = 0;
  for (let y = 0; y < template.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const token = tokens[idx++];
      if (token) row[x] = tokenToCell(token, row[x]?.zone ?? CellZone.Grass);
    }
  }

  if (save.objects.length > area * MAX_OBJECTS_PER_CELL) {
    throw new ImportError('malformed', 'Invalid object data: more objects than the map can hold.');
  }

  const objects = new Map<string, PlacedObject>();
  // Provenance keys follow object IDs that are replaced during validation.
  const reIdedObjects = new Map<string, string>();
  for (const obj of save.objects) {
    // A landmark is recreated from the template below; catalog ids can enter model context, so
    // only registered ones load.
    const admitted = admitSaveObject(obj, template);
    if (!admitted) continue;
    const { catalogId } = admitted;
    // Object IDs can enter model context; replace values outside the app's emitted alphabet.
    const id = isValidObjectId(obj.id) ? obj.id : generateObjectId();
    if (id !== obj.id && typeof obj.id === 'string') reIdedObjects.set(obj.id, id);
    const placed: PlacedObject = {
      id,
      catalogId,
      position: { x: obj.x, y: obj.y },
      rotation: obj.rotation as Rotation,
      elevation: obj.elevation ?? 0,
    };
    if (obj.spanLength !== undefined) placed.spanLength = obj.spanLength;
    if (obj.corners) {
      placed.corners = decodeCorners(obj.corners);
    }
    if (obj.patchOnly) placed.patchOnly = true;
    objects.set(id, placed);
  }

  for (const o of templateLandmarkObjects(template)) objects.set(o.id, o);

  const result: GridState = {
    template,
    cells,
    objects,
    objectsVersion: 0,
    cellsVersion: 0,
    lockedLayers: new Set(),
  };
  if (save.provenance) {
    result.provenance = deserializeProvenance(save.provenance, template.width, template.height);
    // Keep provenance aligned with replaced and discarded object IDs.
    const taint = result.provenance.objectTaint;
    for (const [oldId, newId] of reIdedObjects) {
      const t = taint.get(oldId);
      if (t) { taint.delete(oldId); taint.set(newId, t); }
    }
    for (const id of [...taint.keys()]) {
      if (!objects.has(id)) taint.delete(id);
    }
  } else {
    markLegacyUnknown(result, APP_VERSION); // legacy / pre-provenance map → existing content is Unknown
  }
  // Notes are untrusted; the clamp also drops the author field older saves carried.
  const notes = clampNotes(save.notes);
  if (notes) result.notes = notes;
  if (save.imageAttribution !== undefined) {
    result.imageAttribution = readImageAttribution(save.imageAttribution, result, area * (1 + MAX_OBJECTS_PER_CELL));
    if (!result.imageAttribution) throw new ImportError('malformed', 'Invalid image attribution record.');
    result.notes = attributedNotes(result);
  }
  const annotations = decodeAnnotations(save.annotations);
  if (annotations) result.annotations = annotations;
  return result;
}

