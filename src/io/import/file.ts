/** Shared JSON and PetitGlyph import path. Inspection decodes without replacing the live map; callers present the returned outcomes. */
import { isOwnImageExport } from '../export/own-image-receipts';
import { parseSave } from '../save/parse';
import type { CompatibilityReport, LandmarkClearance } from '../../state/landmark-clearance';
import { loadParsedSave } from './open-save';
import { ImportError, type ImportErrorCode, type ImportWarning } from '../save/import-error';
import { MAX_IMPORT_BYTES } from '../save/limits';
import { classifyImportSource } from './kind';
import { verifyIntegrity } from '../save/sections';
import { applyOptionalSections, type SectionRestoreDeps } from './sections-restore';
import { importFromRaster } from '../share';
import { readRasterImage } from './raster';
import { readBlob } from './read-blob';
import { adoptInstalledPlanet } from '../storage/planet-library';
import type { GridState, MapNotes } from '../../core/model/types';

export type { ImportWarning } from '../save/import-error';

/** The warning a load's landmark clearance reports, or none when it took nothing off. */
function clearanceWarnings(cleared: LandmarkClearance): ImportWarning[] {
  return cleared.objects + cleared.cells > 0 ? [{ kind: 'landmark-cleared', objects: cleared.objects, cells: cleared.cells }] : [];
}

/** A decoded file, not yet installed: what the confirmation shows before the map is replaced. */
export interface ImportPreview {
  /** Selects the warning order in the import UI. */
  source: 'json' | 'raster';
  state: GridState;
  notes?: MapNotes;
  warnings: ImportWarning[];
  /** What the load found under the planet's landmarks, when it found anything. */
  report?: CompatibilityReport;
}

/** The result of reading a file without touching the editor; `commit` installs the decoded map. */
export type ImportInspection =
  | { status: 'ready'; preview: ImportPreview; commit: (deps: ImportFileDeps) => FileImportOutcome }
  | { status: 'unsupported' }
  | { status: 'failed'; code?: ImportErrorCode };

export type FileImportOutcome =
  | { status: 'imported'; source: 'json'; warnings: ImportWarning[]; notes?: MapNotes }
  | { status: 'imported'; source: 'raster'; warnings: ImportWarning[]; notes?: MapNotes }
  /** Neither a `.json` nor a decodable-image name/type — e.g. a dropped `.txt`. */
  | { status: 'unsupported' }
  | { status: 'failed'; code?: ImportErrorCode };

export interface ImportFileDeps {
  /** Installs the map with a fresh executor and rule registry. */
  loadMap: (state: GridState) => void;
  /** Read after loadMap so optional sections restore into the new executor and state. */
  getSectionDeps: () => SectionRestoreDeps;
}

/** A decoded map ready to install: its preview, and the commit that installs it and reports the
 *  warnings `settle` gives once the map is in. */
function readyImport(
  source: ImportPreview['source'], state: GridState, warnings: ImportWarning[],
  settle: (deps: ImportFileDeps) => ImportWarning[], report: CompatibilityReport | undefined,
): ImportInspection {
  return {
    status: 'ready',
    preview: { source, state, warnings, ...(state.notes ? { notes: state.notes } : {}), ...(report ? { report } : {}) },
    commit: (deps) => {
      deps.loadMap(state);
      adoptInstalledPlanet(state);
      return { status: 'imported', source, warnings: settle(deps), ...(state.notes ? { notes: state.notes } : {}) };
    },
  };
}

/** Reads a map save's text; text that is not JSON is a malformed save. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportError('malformed', 'Invalid save file: not JSON.');
  }
}

/** Decodes without installing. What the file is comes from `classifyImportFile`'s own decision;
 *  an input the readers refuse returns a failure outcome, and anything else they throw is logged. */
export async function inspectImportFile(file: File | Blob, name: string): Promise<ImportInspection> {
  try {
    if (file.size > MAX_IMPORT_BYTES) return { status: 'failed' };
    const source = await classifyImportSource(file, name);
    if (source === 'map-save') {
      const text = await readBlob(file, 'text');
      const parsed = parseSave(parseJson(text));
      // Modified exports remain importable with a warning; files without a checksum stay silent.
      const integrity = verifyIntegrity(parsed.raw);
      const { state, cleared } = loadParsedSave(parsed);
      return readyImport('json', state, [], (deps) => {
        const sections = applyOptionalSections(parsed.file, deps.getSectionDeps());
        const warnings: ImportWarning[] = sections.dropped.map((section) => ({ kind: 'dropped-section' as const, section }));
        warnings.push(...clearanceWarnings(cleared));
        if (integrity === 'modified') warnings.push({ kind: 'modified-after-export' });
        return warnings;
      }, cleared.report);
    }

    if (source !== 'map-image') return { status: 'unsupported' };

    // An image the browser cannot decode is an ordinary refusal, not a fault.
    const raster = await readRasterImage(file).catch(() => null);
    if (!raster) return { status: 'failed' };
    const result = await importFromRaster(raster.pixels, raster.width, raster.height, {
      recoverPixels: async () => (await readRasterImage(file)).pixels,
    });
    if (!result.ok) return { status: 'failed', code: result.error.code };
    if (result.state.imageAttribution && await isOwnImageExport(result.state)) delete result.state.imageAttribution;
    const warnings: ImportWarning[] = [...result.warnings];
    if (result.cleared) warnings.push(...clearanceWarnings(result.cleared));
    return readyImport('raster', result.state, warnings, () => warnings, result.cleared?.report);
  } catch (e) {
    if (e instanceof ImportError) return { status: 'failed', code: e.code };
    console.error('[import] unexpected failure', e);
    return { status: 'failed' };
  }
}

/** Inspect and install in one step, for callers that need no confirmation. */
export async function importFile(file: File | Blob, name: string, deps: ImportFileDeps): Promise<FileImportOutcome> {
  const inspection = await inspectImportFile(file, name);
  return inspection.status === 'ready' ? inspection.commit(deps) : inspection;
}
