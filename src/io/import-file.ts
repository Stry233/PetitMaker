/** Shared JSON and PetitGlyph import path. Inspection decodes without replacing the live map; callers present the returned outcomes. */
import { SUPPORTS_JSON_FILES } from '../core/runtime/edition';
import { isOwnImageExport } from './image-ownership';
import { deserializeParsed, templateOfSave } from './json-codec';
import { MAX_IMPORT_BYTES } from './import-limits';
import { isImageFile, isJsonFile } from './import-kind';
import { verifyIntegrity } from './export-json';
import { applyOptionalSections, type SectionRestoreDeps } from './import-sections';
import { importFromRaster, type ShareErrorCode } from './share';
import { readRasterImage } from './raster-image';
import { adoptInstalledPlanet } from './planet-library';
import type { GridState, MapNotes } from '../core/model/types';

/** Structured warnings translated by the import UI. */
export type ImportWarning =
  | { kind: 'dropped-section'; section: string }
  | { kind: 'template-drift' }
  | { kind: 'catalog-drift' }
  | { kind: 'modified-after-export' };

/** A decoded file, not yet installed: what the confirmation shows before the map is replaced. */
export interface ImportPreview {
  /** Selects the warning order in the import UI. */
  source: 'json' | 'raster';
  state: GridState;
  notes?: MapNotes;
  warnings: ImportWarning[];
}

/** The result of reading a file without touching the editor; `commit` installs the decoded map. */
export type ImportInspection =
  | { status: 'ready'; preview: ImportPreview; commit: (deps: ImportFileDeps) => FileImportOutcome }
  | { status: 'unsupported' }
  | { status: 'failed'; code?: ShareErrorCode };

export type FileImportOutcome =
  | { status: 'imported'; source: 'json'; warnings: ImportWarning[]; notes?: MapNotes }
  | { status: 'imported'; source: 'raster'; warnings: ImportWarning[]; notes?: MapNotes }
  /** Neither a `.json` nor a decodable-image name/type — e.g. a dropped `.txt`. */
  | { status: 'unsupported' }
  | { status: 'failed'; code?: ShareErrorCode };

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
  settle: (deps: ImportFileDeps) => ImportWarning[],
): ImportInspection {
  return {
    status: 'ready',
    preview: { source, state, warnings, ...(state.notes ? { notes: state.notes } : {}) },
    commit: (deps) => {
      deps.loadMap(state);
      adoptInstalledPlanet(state);
      return { status: 'imported', source, warnings: settle(deps), ...(state.notes ? { notes: state.notes } : {}) };
    },
  };
}

/** Decodes without installing. Unreadable inputs return a failure outcome. */
export async function inspectImportFile(file: File | Blob, name: string): Promise<ImportInspection> {
  try {
    if (file.size > MAX_IMPORT_BYTES) return { status: 'failed' };
    if (SUPPORTS_JSON_FILES && isJsonFile(file, name)) {
      const text = await file.text();
      const parsed = JSON.parse(text) as { templateId?: string };
      // Modified exports remain importable with a warning; files without a checksum stay silent.
      const integrity = verifyIntegrity(parsed);
      const state = deserializeParsed(parsed, templateOfSave(parsed));
      return readyImport('json', state, [], (deps) => {
        const sections = applyOptionalSections(parsed, deps.getSectionDeps());
        const warnings: ImportWarning[] = sections.dropped.map((section) => ({ kind: 'dropped-section' as const, section }));
        if (integrity === 'modified') warnings.push({ kind: 'modified-after-export' });
        return warnings;
      });
    }

    if (!isImageFile(file, name)) return { status: 'unsupported' };

    const { pixels, width, height } = await readRasterImage(file);
    const result = await importFromRaster(pixels, width, height, {
      recoverPixels: async () => (await readRasterImage(file)).pixels,
    });
    if (!result.ok) return { status: 'failed', code: result.error.code };
    if (result.state.imageAttribution && await isOwnImageExport(result.state)) delete result.state.imageAttribution;
    const warnings: ImportWarning[] = result.warnings.map((w) => (w === 'template-drift' ? { kind: 'template-drift' as const } : { kind: 'catalog-drift' as const }));
    return readyImport('raster', result.state, warnings, () => warnings);
  } catch {
    return { status: 'failed' };
  }
}

/** Inspect and install in one step, for callers that need no confirmation. */
export async function importFile(file: File | Blob, name: string, deps: ImportFileDeps): Promise<FileImportOutcome> {
  const inspection = await inspectImportFile(file, name);
  return inspection.status === 'ready' ? inspection.commit(deps) : inspection;
}
