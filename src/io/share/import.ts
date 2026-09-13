// Raster-first import decodes the visible code band, verifies it, and uses the save-file loader.
import type { GridState } from '../../core/model/types';
import { migrateToCurrent, type RawSave } from '../save-format';
import { deserialize } from '../json-codec';
import { getMapTemplate } from '../../config/maps';
import { ShareError, DEFAULT_LIMITS, type ShareLimits } from './errors';
import { decodeGlyphAsync, type PixelOwnership } from './glyph/decode-async';
import { decodeMapPayload, type ProvenanceInfo } from './codec/payload';
import { isGenerationConfig } from '../import-sections';
import { toSaveJSON } from './canonical';
import { validateImportedState } from './validate';
import { decodePng } from './raster/png-raster';

export interface ImportSuccess { ok: true; state: GridState; warnings: string[]; provenance: ProvenanceInfo }
export interface ImportFailure { ok: false; error: ShareError }
export type ImportResult = ImportSuccess | ImportFailure;

export async function importFromRaster(rgba: Uint8Array, width: number, height: number, ownership?: PixelOwnership): Promise<ImportResult> {
  try {
    const payload = await decodeGlyphAsync(rgba, width, height, ownership);
    if (!payload) return { ok: false, error: new ShareError('no-payload', 'No share code found in this image.') };
    const dec = await decodeMapPayload(payload); // throws corrupt / future-version / decode-failed
    const saveJson = toSaveJSON(dec.canonical, dec.annotations);
    migrateToCurrent(JSON.parse(saveJson) as RawSave);
    const state = deserialize(saveJson, getMapTemplate(dec.canonical.templateId));
    if (isGenerationConfig(dec.generation)) state.generation = dec.generation;
    // The compact frame-level provenance flags seed disclosure after import; per-cell provenance
    // is not part of the PetitGlyph payload.
    if (state.provenance) {
      if (dec.provenance.aiUsed) state.provenance.session.aiWritesUsed = true;
      if (dec.provenance.proceduralUsed) state.provenance.session.proceduralRuns = Math.max(1, state.provenance.session.proceduralRuns);
      state.provenance.summary = null;
    }
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
