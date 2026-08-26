// src/io/share/import.ts — raster-first import: locate + decode the visible code band, gate on
// SHA-256, then feed the save pipeline itself — never a parallel loader.
import type { GridState } from '../../core/model/types';
import { migrateToCurrent, type RawSave } from '../save-format';
import { deserialize } from '../json-codec';
import { getMapTemplate } from '../../config/maps';
import { ShareError, DEFAULT_LIMITS, type ShareLimits } from './errors';
import { decodeGlyph } from './glyph/decode';
import { decodeMapPayload, type ProvenanceInfo } from './codec/payload';
import { toSaveJSON } from './canonical';
import { validateImportedState } from './validate';
import { decodePng } from './raster/png-raster';

export interface ImportSuccess { ok: true; state: GridState; warnings: string[]; provenance: ProvenanceInfo }
export interface ImportFailure { ok: false; error: ShareError }
export type ImportResult = ImportSuccess | ImportFailure;

export async function importFromRaster(rgba: Uint8Array, width: number, height: number): Promise<ImportResult> {
  try {
    const payload = decodeGlyph(rgba, width, height);
    if (!payload) return { ok: false, error: new ShareError('no-payload', 'No share code found in this image.') };
    const dec = await decodeMapPayload(payload); // throws corrupt / future-version / decode-failed
    const saveJson = toSaveJSON(dec.canonical);
    migrateToCurrent(JSON.parse(saveJson) as RawSave);
    const state = deserialize(saveJson, getMapTemplate(dec.canonical.templateId));
    if (dec.generation) state.generation = dec.generation; // sticky replay: re-export stays tiny
    const { warnings } = validateImportedState(state, { templateId: dec.canonical.templateId, templateHash: dec.templateHash, catalogHash: dec.catalogHash });
    return { ok: true, state, warnings, provenance: dec.provenance };
  } catch (e) {
    if (e instanceof ShareError) return { ok: false, error: e };
    return { ok: false, error: new ShareError('decode-failed', e instanceof Error ? e.message : 'Import failed.') };
  }
}

/** PNG bytes entry (node + tests). The UI decodes ANY raster format via createImageBitmap and
 *  calls importFromRaster directly. */
export async function importFromBytes(input: ArrayBuffer | Uint8Array, limits: ShareLimits = DEFAULT_LIMITS): Promise<ImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  try {
    const img = await decodePng(bytes, limits);
    return importFromRaster(img.data, img.width, img.height);
  } catch {
    return { ok: false, error: new ShareError('not-an-image', 'Not a decodable image.') };
  }
}
