/** Raster-first import: decodes the visible code band, verifies it, and loads it through the save-file loader. */
import { captureImageAttribution } from '../save/image-attribution';
import { clampNotes } from '../../core/model/notes';
import type { GridState } from '../../core/model/types';
import { parseSave } from '../save/parse';
import type { LandmarkClearance } from '../../tools/generation/transfer';
import { loadParsedSave } from '../import/open-save';
import { upgradeLandmarks } from '../../core/model/planet';
import { resolveTemplate } from '../../config/maps/resolve';
import { DEFAULT_LIMITS, type ShareLimits } from './errors';
import { ImportError, type ImportWarning } from '../save/import-error';
import { decodeGlyphAsync, type PixelOwnership } from './glyph/decode-async';
import { decodeMapPayload, type ProvenanceInfo } from './codec/payload';
import { isGenerationConfig } from '../save/generation-record';
import { toSaveJSON } from '../save/canonical';
import { importDriftWarnings } from './validate';
import { decodePng, type RasterImage } from './raster/png-raster';

export interface ImportSuccess { ok: true; state: GridState; warnings: ImportWarning[]; provenance: ProvenanceInfo; cleared?: LandmarkClearance }
export interface ImportFailure { ok: false; error: ImportError }
export type ImportResult = ImportSuccess | ImportFailure;

export async function importFromRaster(rgba: Uint8Array, width: number, height: number, ownership?: PixelOwnership): Promise<ImportResult> {
  try {
    const payload = await decodeGlyphAsync(rgba, width, height, ownership);
    if (!payload) return { ok: false, error: new ImportError('no-payload', 'No share code found in this image.') };
    const dec = await decodeMapPayload(payload); // throws corrupt / future-version / decode-failed
    // A carried planet's landmarks take the profile's footprints, and the map the planet's new id.
    const planet = dec.template && upgradeLandmarks(dec.template);
    const templateId = planet ? planet.id : dec.canonical.templateId;
    const saveJson = toSaveJSON({ ...dec.canonical, templateId }, dec.annotations);
    const { state, cleared } = loadParsedSave(parseSave(JSON.parse(saveJson), { template: resolveTemplate(templateId, planet) }));
    if (isGenerationConfig(dec.generation)) state.generation = dec.generation;
    state.notes = dec.notes ?? clampNotes({ title: dec.provenance.title });
    if (!dec.provenance.aiUsed && !dec.provenance.proceduralUsed) {
      state.imageAttribution = captureImageAttribution(state);
    }
    // The compact frame-level provenance flags seed disclosure after import; per-cell provenance
    // is not part of the PetitGlyph payload.
    if (state.provenance) {
      if (dec.provenance.aiUsed) state.provenance.session.aiWritesUsed = true;
      if (dec.provenance.proceduralUsed) state.provenance.session.proceduralRuns = Math.max(1, state.provenance.session.proceduralRuns);
      state.provenance.summary = null;
    }
    const warnings = importDriftWarnings(state.template, dec);
    return { ok: true, state, warnings, provenance: dec.provenance, cleared };
  } catch (e) {
    // Anything but a reader's refusal is a fault, left to the caller to log.
    if (e instanceof ImportError) return { ok: false, error: e };
    throw e;
  }
}

/** PNG bytes entry (node + tests). The UI decodes any raster format via createImageBitmap and
 *  calls importFromRaster directly. */
export async function importFromBytes(input: ArrayBuffer | Uint8Array, limits: ShareLimits = DEFAULT_LIMITS): Promise<ImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let img: RasterImage;
  try {
    img = await decodePng(bytes, limits);
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e };
    throw e;
  }
  return importFromRaster(img.data, img.width, img.height);
}
