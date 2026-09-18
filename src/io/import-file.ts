import { SUPPORTS_JSON_FILES } from '../core/runtime/edition';
/** Shared JSON and PetitGlyph import path. Inspection decodes without replacing the live map; callers present the returned outcomes. */
import { isOwnImageExport } from './image-ownership';
import { deserializeParsed } from './json-codec';
import { MAX_IMPORT_BYTES } from './import-limits';
import { verifyIntegrity } from './export-json';
import { applyOptionalSections, type SectionRestoreDeps } from './import-sections';
import { getMapTemplate } from '../config/maps';
import { importFromRaster, type ShareErrorCode } from './share';
import { readRasterImage } from './raster-image';
import type { GridState, MapNotes } from '../core/model/types';

/** Structured warnings translated by the import UI. */
export type ImportWarning =
  | { kind: 'dropped-section'; section: string }
  | { kind: 'template-drift' }
  | { kind: 'catalog-drift' }
  | { kind: 'modified-after-export' };

/** The source selects warning order in the import UI. */
/** A decoded file, not yet installed: what the confirmation shows before the map is replaced. */
export interface ImportPreview {
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

function isJsonFile(file: File | Blob, name: string): boolean {
  return name.toLowerCase().endsWith('.json') || file.type === 'application/json';
}

/** Some drag sources omit MIME types, so supported extensions are also accepted. */
function isImageFile(file: File | Blob, name: string): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp)$/i.test(name);
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
      const state = deserializeParsed(parsed, getMapTemplate(parsed.templateId));
      const preview: ImportPreview = { source: 'json', state, warnings: [], ...(state.notes ? { notes: state.notes } : {}) };
      return {
        status: 'ready', preview,
        commit: (deps) => {
          deps.loadMap(state);
          const sections = applyOptionalSections(parsed, deps.getSectionDeps());
          const warnings: ImportWarning[] = sections.dropped.map((section) => ({ kind: 'dropped-section' as const, section }));
          if (integrity === 'modified') warnings.push({ kind: 'modified-after-export' });
          return { status: 'imported', source: 'json', warnings, ...(state.notes ? { notes: state.notes } : {}) };
        },
      };
    }

    if (!isImageFile(file, name)) return { status: 'unsupported' };

    const { pixels, width, height } = await readRasterImage(file);
    const result = await importFromRaster(pixels, width, height, {
      recoverPixels: async () => (await readRasterImage(file)).pixels,
    });
    if (!result.ok) return { status: 'failed', code: result.error.code };
    if (result.state.imageAttribution && await isOwnImageExport(result.state)) delete result.state.imageAttribution;
    const warnings: ImportWarning[] = result.warnings.map((w) => (w === 'template-drift' ? { kind: 'template-drift' as const } : { kind: 'catalog-drift' as const }));
    const preview: ImportPreview = { source: 'raster', state: result.state, warnings, ...(result.state.notes ? { notes: result.state.notes } : {}) };
    return {
      status: 'ready', preview,
      commit: (deps) => {
        deps.loadMap(result.state);
        return { status: 'imported', source: 'raster', warnings, ...(result.state.notes ? { notes: result.state.notes } : {}) };
      },
    };
  } catch {
    return { status: 'failed' };
  }
}

/** Inspect and install in one step, for callers that need no confirmation. */
export async function importFile(file: File | Blob, name: string, deps: ImportFileDeps): Promise<FileImportOutcome> {
  const inspection = await inspectImportFile(file, name);
  return inspection.status === 'ready' ? inspection.commit(deps) : inspection;
}
