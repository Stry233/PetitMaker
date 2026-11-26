/** Raster-first import: decodes the visible code band, verifies it, and loads it through the save-file loader. */
import { captureImageAttribution } from '../save/image-attribution';
import { clampNotes } from '../../core/model/notes';
import type { GridState } from '../../core/model/types';
import { parseSave } from '../save/parse';
import type { LandmarkClearance } from '../../tools/repair';
import { loadParsedSave } from '../import/open-save';
import { upgradeLandmarks } from '../../core/model/planet';
import { resolveTemplate } from '../../config/maps/resolve';
import { ImportError, type ImportWarning } from '../save/import-error';
import { decodeGlyphAsync, type PixelOwnership } from './glyph/decode-async';
import { decodeMapPayload, type ProvenanceInfo } from './codec/payload';
import { isGenerationConfig } from '../save/generation-record';
import { toSaveFile } from '../save/canonical';
import { importDriftWarnings } from './validate';

export interface ImportSuccess { ok: true; state: GridState; warnings: ImportWarning[]; provenance: ProvenanceInfo; cleared?: LandmarkClearance }
export interface ImportFailure { ok: false; error: ImportError }
export type ImportResult = ImportSuccess | ImportFailure;

/** The refusal for each way a share image yields no payload. */
const GLYPH_REFUSALS = {
  nothing: () => new ImportError('no-payload', 'No share code found in this image.'),
  damaged: () => new ImportError('decode-failed', 'The share code in this image could not be recovered.'),
  newer: () => new ImportError('future-version', 'The share code in this image was written by a newer build.'),
} as const;

export async function importFromRaster(rgba: Uint8Array, width: number, height: number, ownership?: PixelOwnership): Promise<ImportResult> {
  try {
    const read = await decodeGlyphAsync(rgba, width, height, ownership);
    if (!read.payload) return { ok: false, error: GLYPH_REFUSALS[read.found]() };
    return await importFromPayload(read.payload);
  } catch (e) {
    // Anything but a reader's refusal is a fault, left to the caller to log.
    if (e instanceof ImportError) return { ok: false, error: e };
    throw e;
  }
}

/** The map a share code's payload carries, however the payload travelled: a picture's band or a link. */
export async function importFromPayload(payload: Uint8Array): Promise<ImportResult> {
  try {
    const dec = await decodeMapPayload(payload); // throws corrupt / future-version / decode-failed
    // A carried planet's landmarks take the profile's footprints, and the map the planet's new id.
    const planet = dec.template && upgradeLandmarks(dec.template);
    const templateId = planet ? planet.id : dec.canonical.templateId;
    const save = toSaveFile({ ...dec.canonical, templateId }, dec.annotations);
    const { state, cleared } = loadParsedSave(parseSave(save, { template: resolveTemplate(templateId, planet) }));
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
