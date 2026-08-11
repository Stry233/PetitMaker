/**
 * The ONE file-import routine — routes a picked/dropped/pasted file to the JSON path or the
 * PetitGlyph raster path and installs the result. Shared by `ui/chrome/modals/import/ImportModal`'s file
 * picker/drop-zone and the window-level drag-drop overlay.
 *
 * Returns a RESULT rather than raising toasts, so the routing needs no DOM and
 * `ui/chrome/modals/import/import-toast.ts` is the single place a result becomes a message.
 */
import { deserialize } from './json-codec';
import { verifyIntegrity } from './export-json';
import { applyOptionalSections, type SectionRestoreDeps } from './import-sections';
import { getMapTemplate } from '../config/maps';
import { importFromRaster, type ShareErrorCode } from './share';
import type { GridState } from '../core/model/types';

/** One warning surfaced from a successful import. Carries enough shape for the toast mapper to
 *  pick the right i18n key (and, for a dropped section, its param) without re-deriving anything. */
export type ImportWarning =
  | { kind: 'dropped-section'; section: string }
  | { kind: 'template-drift' }
  | { kind: 'catalog-drift' }
  | { kind: 'modified-after-export' };

/** `source` distinguishes the two successful paths because their toasts fire in a DIFFERENT order:
 *  JSON is per-section warnings, then success, then the modified caution LAST; raster is success
 *  first, then its warnings. */
export type FileImportOutcome =
  | { status: 'imported'; source: 'json'; warnings: ImportWarning[] }
  | { status: 'imported'; source: 'raster'; warnings: ImportWarning[] }
  /** Neither a `.json` nor a decodable-image name/type — e.g. a dropped `.txt`. */
  | { status: 'unsupported' }
  | { status: 'failed'; code?: ShareErrorCode };

export interface ImportFileDeps {
  /** Installs the decoded map as the working grid (swaps in a fresh commandExecutor/gridState),
   *  building its own RuleRegistry (`kit/operations/map.ts:loadMap` in production). */
  loadMap: (state: GridState) => void;
  /** Read AFTER `loadMap` runs: the optional-sections restorer needs the executor/state loadMap
   *  just installed, not whatever was live before this import started. */
  getSectionDeps: () => SectionRestoreDeps;
}

function isJsonFile(file: File | Blob, name: string): boolean {
  return name.toLowerCase().endsWith('.json') || file.type === 'application/json';
}

/** MIME first (a drag from the OS file explorer sets it), then the extension for a source that
 *  doesn't, matching the file-picker's own `accept` list. */
function isImageFile(file: File | Blob, name: string): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp)$/i.test(name);
}

/**
 * Import a picked/dropped/pasted file. NEVER THROWS: an unreadable or unrecognized input comes back
 * as `unsupported`/`failed`, so a fire-and-forget drop handler needs no try/catch.
 */
export async function importFile(file: File | Blob, name: string, deps: ImportFileDeps): Promise<FileImportOutcome> {
  try {
    if (isJsonFile(file, name)) {
      const text = await file.text();
      const parsed = JSON.parse(text) as { templateId?: string };
      // Tamper check BEFORE loading: an exported file carries an integrity code, and a mismatch
      // means it was hand-edited after export. A caution, not a hard failure, so the import still
      // runs. 'absent' (legacy / hand-made / autosave) is silent.
      const integrity = verifyIntegrity(parsed);
      const state = deserialize(text, getMapTemplate(parsed.templateId));
      deps.loadMap(state);
      const sections = applyOptionalSections(parsed, deps.getSectionDeps());
      const warnings: ImportWarning[] = sections.dropped.map((section) => ({ kind: 'dropped-section' as const, section }));
      if (integrity === 'modified') warnings.push({ kind: 'modified-after-export' });
      return { status: 'imported', source: 'json', warnings };
    }

    if (!isImageFile(file, name)) return { status: 'unsupported' };

    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const result = await importFromRaster(
      new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength),
      bmp.width,
      bmp.height,
    );
    if (!result.ok) return { status: 'failed', code: result.error.code };
    deps.loadMap(result.state);
    const warnings: ImportWarning[] = result.warnings.map((w) => (w === 'template-drift' ? { kind: 'template-drift' as const } : { kind: 'catalog-drift' as const }));
    return { status: 'imported', source: 'raster', warnings };
  } catch {
    return { status: 'failed' };
  }
}
