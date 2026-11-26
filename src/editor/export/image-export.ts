/**
 * The share picture's export from the live map: the map check, the text check of the picture's own
 * words, the composition and its PNG, the responsibility notice, and the download or delivery. The
 * export window keeps its busy flags and the paint before heavy work, and passes the checks and the
 * notice in, since their state belongs to the window.
 */
import { runImageExport } from '../../io/export/run-image-export';
import { prepareOwnImageReceipt } from '../../io/export/own-image-receipts';
import { formatFooterDate } from '../../io/export/footer-template';
import { deviceCanvasLimits } from '../../io/export/canvas-limits';
import { downloadBlob, exportFileName } from '../../io/export/download';
import { exportText } from '../../io/export/review-text';
import { RESOLUTION_KEYS, type ExportOptions, type PictureChoices, type ResolutionKey } from '../../io/export/types';
import { RESOLUTION_WIDTHS } from '../../io/export/compose';
import { pngSize } from '../../io/share';
import { SUPPORTS_PICTURE_DOWNLOAD } from '../../platform/build/edition';
import { DeliveryLimitError } from '../../platform/host/delivery-limit';
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { protectedImageNotes } from '../../state/notes-attribution';
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { automaticExportReview, automaticTextReview } from '../review/edition-review';
import { heldWords } from '../review/held-words';
import type { MapReview } from '../review/map-review';
import type { ReviewIssue, ReviewResult, TextPart } from '../review/text-review';
import { shownPlanetName } from '../session/planet-names';
import type { MapNotes } from '../../core/model/types';
import { brandInfo, loadBrandLockup, type HostMark } from './brand';
import { pictureOptions } from './picture-words';
import { footerTokenValues, selectedStylizedBase } from './preview';
import { renderShareCodeAsset, shareCodeIssueKey, shareCodeKey, type ShareCodeAsset } from './share-code';

export { openingExportOptions, rememberExportOptions } from '../../io/export/options-store';
export { withWords } from './picture-words';

/** The texts the check must approve before `options` reach a preview or an export: the title, the
 *  description and the footer as resolved from `footer`. */
export function exportReviewParts(options: ExportOptions, footer: Record<string, string>): TextPart[] {
  return exportText(options, { ...footer, date: formatFooterDate(), dims: '0×0' });
}

/** Shares a link to the live map through `share` once the words the link carries, the map's title and
 *  description, passed the check the export runs on them. */
export async function shareMapLink(
  options: ExportOptions, share: () => Promise<void>, checkText: (parts: TextPart[]) => Promise<ReviewResult>,
): Promise<{ status: 'held'; issue: ReviewIssue } | { status: 'done' }> {
  const issue = await heldWords(exportText({ ...options, footer: false }, {}), checkText);
  if (issue) return { status: 'held', issue };
  await share();
  return { status: 'done' };
}

/** The words a preview may paint: `notes` once their text is approved, or ready to go to the check
 *  the export runs (or where this edition leaves the check to the export notice), else none. */
export function previewWords(notes: MapNotes, approved: boolean, composing: boolean): MapNotes | null {
  return (!automaticTextReview && !composing) || approved ? notes : null;
}

interface ImageExportRequest {
  /** The picture's choices; its title and description are read from the map (`pictureOptions`). */
  options: PictureChoices;
  /** Export without the title, description and footer text. */
  withoutText: boolean;
  /** The band the preview built, reused when its width and payload inputs match the slot; a band
   *  built for the export carries the same timestamp, or its own where no preview stood. */
  previewCode: ShareCodeAsset | null;
  /** The deployment's canonical origin for the maker's band. */
  site: string;
  /** The QR the deployment's host makes for the band at a size, in place of the site's. */
  mark?: (resolution: ResolutionKey) => Promise<HostMark | null>;
}

interface ImageExportHooks {
  signal: AbortSignal;
  /** The map check; it runs first where the edition checks automatically. */
  checkMap: () => Promise<MapReview>;
  /** The text check of the picture's own words. */
  checkText: (parts: TextPart[]) => Promise<ReviewResult>;
  /** Called once the map check passed; resolves after the window painted its busy state. */
  begin: () => Promise<void>;
  /** Whether the text check is running on the export's words. */
  reviewing: (checking: boolean) => void;
  /** How far a tiled export has come, or null while it is not tiled. */
  progress: (fraction: number | null) => void;
  /** The responsibility notice; resolves whether it was confirmed. */
  confirmNotice: (carriesCode: boolean) => Promise<boolean>;
  /** Sends the picture somewhere other than a download. */
  deliver?: (image: Blob) => Promise<void>;
}

type ImageExportOutcome =
  /** Aborted, refused by the map check, declined at the notice, or nothing to export. */
  | { status: 'stopped' }
  /** The text check refused the words or could not run. */
  | { status: 'held'; issue: ReviewIssue }
  | { status: 'failed' }
  /** The picture passed the limit of the container it was sent to and was not sent; `fits` is the
   *  largest smaller size expected to pass, null where none is. */
  | { status: 'too-large'; fits: ResolutionKey | null }
  | { status: 'done' };

/** The share of a limit a re-sized picture is planned to fill: compression varies with the content. */
const FIT_HEADROOM = 0.85;

/** The largest size below `current` a picture should fit `limit` at, when at `width` px it ran to
 *  `length`: the encoded length follows the picture's area. */
function sizeThatFits(current: ResolutionKey, width: number, length: number, limit: number): ResolutionKey | null {
  const smaller = RESOLUTION_KEYS.slice(0, RESOLUTION_KEYS.indexOf(current)).filter((key) => RESOLUTION_WIDTHS[key] < width);
  return smaller.reverse().find((key) => length * (RESOLUTION_WIDTHS[key] / width) ** 2 <= limit * FIT_HEADROOM) ?? null;
}

/** Exports the share picture of the live map, raising the result's notices. */
export async function exportImage(request: ImageExportRequest, hooks: ImageExportHooks): Promise<ImageExportOutcome> {
  const { signal } = hooks;
  if (automaticExportReview) {
    const mapResult = await hooks.checkMap().catch(() => null);
    if (!mapResult || mapResult.status === 'blocked' || signal.aborted) return { status: 'stopped' };
  }
  await hooks.begin();
  try {
    if (signal.aborted) return { status: 'stopped' };
    const store = useEditorStore.getState();
    const executor = store.commandExecutor;
    const state = store.gridState;
    if (request.withoutText && state && protectedImageNotes(state)) return { status: 'stopped' };
    if (!executor || !state) return { status: 'stopped' };
    const options = pictureOptions(state, request.options, request.withoutText ? null : undefined);

    const now = Date.now();
    // What this device's canvas can actually allocate: a composition past it is a blank image,
    // not a large one. Desktop's own ceiling is what the probe confirms there.
    const limits = deviceCanvasLimits();
    const summary = executor.getProvenanceSummary();
    const footerTokens = footerTokenValues(state, options, store.locale, summary);
    const issue = await heldWords(exportReviewParts(options, footerTokens), hooks.checkText, hooks.reviewing);
    if (signal.aborted) return { status: 'stopped' };
    if (issue) return { status: 'held', issue };

    const lockup = await loadBrandLockup(store.locale);
    const mark = request.mark ? await request.mark(options.resolution) : null;
    const shownName = shownPlanetName(state.template, store.locale);
    const { previewCode } = request;
    const createdAt = previewCode?.createdAt ?? new Date().toISOString();
    const result = await runImageExport(host, {
      state, summary, options, limits,
      stylized: selectedStylizedBase(translate('export.ai_tag')),
      shots: useEditorStore.getState().export3dShots,
      footerTokens,
      brand: brandInfo(store.locale, options, lockup, mark ?? request.site),
      translate,
      shareCode: async (width) => {
        if (previewCode && previewCode.canvas.width === width && previewCode.builtKey === shareCodeKey(width, createdAt, shownName)) {
          return { canvas: previewCode.canvas, notice: previewCode.notice };
        }
        const asset = await renderShareCodeAsset(state, summary, { createdAt }, width);
        return asset ? { canvas: asset.canvas, notice: asset.notice } : null;
      },
    }, signal, hooks.progress);
    if (!result) return { status: 'stopped' };
    if (result.status !== 'done') {
      showToast(translate('toast.export_image_failed'), 'error');
      return { status: 'failed' };
    }
    const { blob } = result;

    const rememberOwnImage = result.carriesCode ? await prepareOwnImageReceipt(state) : () => {};
    if (signal.aborted) return { status: 'stopped' };
    // The final composition determines whether the image carries PetitGlyph.
    if (!await hooks.confirmNotice(result.carriesCode) || signal.aborted) return { status: 'stopped' };
    try {
      if (hooks.deliver) await hooks.deliver(blob);
      else if (SUPPORTS_PICTURE_DOWNLOAD) downloadBlob(blob, exportFileName([now], 'png'));
      else throw new Error('Image delivery unavailable');
    } catch (error) {
      if (!(error instanceof DeliveryLimitError) || signal.aborted) throw error;
      const width = (await pngSize(blob))?.width ?? RESOLUTION_WIDTHS[options.resolution === 'original' ? 'high' : options.resolution];
      return { status: 'too-large', fits: sizeThatFits(options.resolution, width, error.length, error.limit) };
    }
    if (signal.aborted) return { status: 'stopped' };
    rememberOwnImage();
    useEditorStore.getState().markExported();   // this map has now left the browser
    if (result.codeTooSmall) showToast(translate('export.code_too_small'), 'info');
    if (result.codeFailed) showToast(translate(shareCodeIssueKey(state)), 'info');
    showToast(translate(result.codeNotice ?? (result.carriesCode ? 'toast.exported_embedded' : 'toast.exported_image')), 'info');
    return { status: 'done' };
  } catch (e) {
    if (signal.aborted) return { status: 'stopped' };
    console.error('[export] export failed', e);
    showToast(translate('toast.export_image_failed'), 'error');
    return { status: 'failed' };
  }
}
