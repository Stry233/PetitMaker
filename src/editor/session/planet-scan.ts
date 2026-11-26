// The planet video import as the page holds it: one read at a time with its stop, the planet read
// kept until the planet editor opens it, and that hand-off; with its stages and the painter of its
// progress picture bound to the scan's preview vocabulary. The scan itself lives in `pipelines/planet-scan/`.
import {
  PREVIEW_GRASS, PREVIEW_SAND, PREVIEW_SEA, PREVIEW_UNSEEN, SCAN_PROFILE, VideoImportError, previewClass, scanVideo,
  type ImportFailure, type ScanOutcome, type ScanPreview, type ScanProgress, type ScanVideo,
} from '../../pipelines/planet-scan';
import { createSignal } from '../../core/base/signal';
import { CellZone } from '../../core/game/zones';
import { quantityParams, translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import { useEditorStore } from '../../state/store';
import { ScanPreviewPainter, type ScanPictureLook, type ScanVocabulary } from '../../view/map2d/capture/scan-preview-painter';
import { openPlanetEditor } from './planet-editing';
import { draftFromScan } from './planet-library';

export { SCAN_STAGES, type ScanPreview, type ScanProgress, type ScanStage } from '../../pipelines/planet-scan';
export type { ScanPictureLook, ScanPreviewPainter };

/** How a read ended: the planet read, or the reason it was not. */
type PlanetScanResult = { status: 'read'; outcome: ScanOutcome } | { status: 'failed'; reason: ImportFailure };

/** Reads a planet from a recording with `scan`; null when `signal` stopped it. A failure that is
 *  not one of the import's own refusals is logged and reads as a plain failure. */
async function scanPlanetVideo(
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

/**
 * Opens a planet read from a video in the planet editor, as a new planet with its cells to check,
 * closing Change Planet and its import window, and says how much of the coast a partial read
 * covered. False, with nothing opened or said, when the planet editor cannot open now.
 */
export function openScanned(outcome: ScanOutcome): boolean {
  if (!openPlanetEditor(draftFromScan(outcome))) return false;
  if (outcome.partial) {
    const percent = Math.round(outcome.coverage * 100);
    showToast(translate('planet.scan_partial', quantityParams(useEditorStore.getState().locale, { percent })), 'info');
  }
  return true;
}

/** The video import as its window draws it. */
interface PlanetScanState {
  /** A read is under way. */
  reading: boolean;
  /** How far the read under way has come. */
  progress: ScanProgress;
  /** Why the last read ended with no planet, until the next read or a cancel. */
  failure: ImportFailure | null;
  /** The planet the last read ended with, kept until the planet editor opens it, another read
   *  starts or a cancel puts it down; a window closing leaves it. */
  held: ScanOutcome | null;
}

const NOT_STARTED: ScanProgress = { stage: 'reading', share: 0 };
const IDLE: PlanetScanState = { reading: false, progress: NOT_STARTED, failure: null, held: null };

/** How a read ended: with a planet now held, with a failure, stopped by a cancel, or never started
 *  because one was under way. */
type ScanEnd = 'read' | 'failed' | 'stopped' | 'busy';

/** The video import's session, an external store its window reads. */
export interface PlanetScan {
  /** Reads `file`, one read at a time; a read that starts puts down the last failure and a planet
   *  still held. */
  read(file: File): Promise<ScanEnd>;
  /** Stops a read under way and puts down the last failure and a planet not yet opened, as Cancel does. */
  cancel(): void;
  /** Opens the held planet in the planet editor (`openScanned`) and lets go of it. False, with the
   *  planet kept for another try, when the editor cannot open now, or when none is held. */
  openHeld(): boolean;
  subscribe(listener: () => void): () => void;
  snapshot(): PlanetScanState;
}

/** A video import reading with `scan` and opening what it read with `open`. */
export function createPlanetScan(scan: ScanVideo = scanVideo, open: (outcome: ScanOutcome) => boolean = openScanned): PlanetScan {
  const state = createSignal<PlanetScanState>(IDLE);
  let running: AbortController | null = null;
  const publish = (next: PlanetScanState): void => { if (state.get() !== next) state.emit(next); };
  return {
    async read(file) {
      if (running) return 'busy';
      const controller = new AbortController();
      running = controller;
      publish({ ...IDLE, reading: true });
      const result = await scanPlanetVideo(scan, file, controller.signal, (progress) => {
        if (running === controller) publish({ ...state.get(), progress });
      });
      if (!result || running !== controller) return 'stopped';
      running = null;
      if (result.status === 'read') {
        publish({ ...IDLE, progress: state.get().progress, held: result.outcome });
        return 'read';
      }
      publish({ ...IDLE, failure: result.reason });
      return 'failed';
    },
    cancel() {
      running?.abort();
      running = null;
      publish(IDLE);
    },
    openHeld() {
      const { held } = state.get();
      if (!held || !open(held)) return false;
      publish(IDLE);
      return true;
    },
    subscribe: (listener) => state.subscribe(() => listener()),
    snapshot: () => state.get(),
  };
}

/** The page's one video import, held here so a planet read outlives the window that read it. */
export const planetScan: PlanetScan = createPlanetScan();

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
