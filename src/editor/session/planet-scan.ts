// The planet video import's run for the Import planet window, its stages, and the painter of its
// progress picture bound to the scan's preview vocabulary. The scan itself lives in `pipelines/planet-scan/`.
import {
  PREVIEW_GRASS, PREVIEW_SAND, PREVIEW_SEA, PREVIEW_UNSEEN, SCAN_PROFILE, VideoImportError, previewClass,
  type ImportFailure, type ScanOutcome, type ScanPreview, type ScanProgress, type ScanVideo,
} from '../../pipelines/planet-scan';
import { CellZone } from '../../core/game/zones';
import { ScanPreviewPainter, type ScanPictureLook, type ScanVocabulary } from '../../view/map2d/capture/scan-preview-painter';

export {
  SCAN_STAGES, scanVideo, type ImportFailure, type ScanOutcome, type ScanPreview, type ScanProgress, type ScanStage, type ScanVideo,
} from '../../pipelines/planet-scan';
export type { ScanPictureLook, ScanPreviewPainter };

/** How a read ended: the planet read, or the reason it was not. */
export type PlanetScanResult = { status: 'read'; outcome: ScanOutcome } | { status: 'failed'; reason: ImportFailure };

/** Reads a planet from a recording with `scan`; null when `signal` stopped it. A failure that is
 *  not one of the import's own refusals is logged and reads as a plain failure. */
export async function scanPlanetVideo(
  scan: ScanVideo, file: File, signal: AbortSignal, onProgress: (progress: ScanProgress) => void,
): Promise<PlanetScanResult | null> {
  try {
    const outcome = await scan(file, { signal, onProgress: (p) => { if (!signal.aborted) onProgress(p); } });
    return signal.aborted ? null : { status: 'read', outcome };
  } catch (error) {
    if (signal.aborted) return null;
    if (!(error instanceof VideoImportError)) console.error('[planet] video import failed', error);
    return { status: 'failed', reason: error instanceof VideoImportError ? error.reason : 'failed' };
  }
}

/** The scan's preview grids as the import picture reads them; each class shows as its zone. */
const SCAN_PICTURE: ScanVocabulary<ScanPreview> = {
  cell: SCAN_PROFILE.cell,
  unseen: PREVIEW_UNSEEN,
  classOf: previewClass,
  zones: { [PREVIEW_SEA]: CellZone.Void, [PREVIEW_SAND]: CellZone.Beach, [PREVIEW_GRASS]: CellZone.Grass },
};

/** A painter for the import window's live picture, in the window's `look`. */
export function scanPicturePainter(look: ScanPictureLook): ScanPreviewPainter<ScanPreview> {
  return new ScanPreviewPainter(SCAN_PICTURE, look);
}
