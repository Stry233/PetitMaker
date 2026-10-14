/**
 * The share picture's export from the live map: the map check, the text check of the picture's own
 * words, the composition and its PNG, the responsibility notice, and the download or delivery. The
 * export window keeps its busy flags and the paint before heavy work, and passes the checks and the
 * notice in, since their state belongs to the window.
 */
import { runImageExport } from '../../io/export/run-image-export';
import { prepareOwnImageReceipt } from '../../io/export/own-image-receipts';
import { DEFAULT_FOOTER, formatFooterDate } from '../../io/export/footer-template';
import { deviceCanvasLimits } from '../../io/export/canvas-limits';
import { downloadBlob, exportFileName } from '../../io/export/download';
import { exportText } from '../../io/export/review-text';
import type { ExportOptions } from '../../io/export/types';
import { SUPPORTS_DOWNLOADS } from '../../platform/build/edition';
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { protectedImageNotes } from '../../state/notes-attribution';
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { automaticExportReview, isReviewTooLong } from '../review/edition-review';
import type { MapReview } from '../review/map-review';
import type { ReviewIssue, ReviewResult, TextPart } from '../review/text-review';
import { shownPlanetName } from '../session/planet-names';
import { brandInfo, loadBrandLockup } from './brand';
import { footerTokenValues, selectedStylizedBase } from './preview';
import { renderShareCodeAsset, shareCodeIssueKey, shareCodeKey, type ShareCodeAsset } from './share-code';

export { openingExportOptions, rememberExportOptions } from '../../io/export/options-store';

/** The options with the map's own words taken out, as "export without text" writes them. */
export function textlessOptions(options: ExportOptions): ExportOptions {
  return { ...options, title: '', description: '', footerTemplate: DEFAULT_FOOTER };
}

/** The texts the check must approve before `options` reach a preview or an export: the title, the
 *  description and the footer as resolved from `footer`. */
export function exportReviewParts(options: ExportOptions, footer: Record<string, string>): TextPart[] {
  return exportText(options, { ...footer, date: formatFooterDate(), dims: '0×0' });
}

/** What a preview may show: `options` once their text is approved (or where this edition leaves the
 *  check to the export notice), else the options without their text. */
export function previewSafeOptions(options: ExportOptions, approved: boolean, composing: boolean): ExportOptions {
  return (!automaticExportReview && !composing) || approved ? options : textlessOptions(options);
}

export interface ImageExportRequest {
  options: ExportOptions;
  /** Export without the title, description and footer text. */
  withoutText: boolean;
  /** The window session's timestamp, which the share code's payload carries. */
  createdAt: string;
  /** The band the preview built, reused when its width and payload inputs match the slot. */
  previewCode: ShareCodeAsset | null;
  /** The deployment's canonical origin for the maker's band. */
  site: string;
}

export interface ImageExportHooks {
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

export type ImageExportOutcome =
  /** Aborted, refused by the map check, declined at the notice, or nothing to export. */
  | { status: 'stopped' }
  /** The text check refused the words or could not run. */
  | { status: 'held'; issue: ReviewIssue }
  | { status: 'failed' }
  | { status: 'done' };

/** Exports the share picture of the live map, raising the result's notices. */
export async function exportImage(request: ImageExportRequest, hooks: ImageExportHooks): Promise<ImageExportOutcome> {
  const { signal } = hooks;
  if (automaticExportReview) {
    const mapResult = await hooks.checkMap().catch(() => null);
    if (!mapResult || mapResult.status === 'blocked' || signal.aborted) return { status: 'stopped' };
  }
  const options = request.withoutText ? textlessOptions(request.options) : request.options;
  await hooks.begin();
  try {
    if (signal.aborted) return { status: 'stopped' };
    const store = useEditorStore.getState();
    const executor = store.commandExecutor;
    const state = store.gridState;
    if (request.withoutText && state && protectedImageNotes(state)) return { status: 'stopped' };
    if (!executor || !state) return { status: 'stopped' };

    const now = Date.now();
    // What this device's canvas can actually allocate: a composition past it is a blank image,
    // not a large one. Desktop's own ceiling is what the probe confirms there.
    const limits = deviceCanvasLimits();
    const summary = executor.getProvenanceSummary();
    const footerTokens = footerTokenValues(state, options, store.locale, summary);
    const parts = exportReviewParts(options, footerTokens);
    if (automaticExportReview && parts.length) {
      hooks.reviewing(true);
      try {
        const result = await hooks.checkText(parts);
        if (signal.aborted) return { status: 'stopped' };
        if (!result.allowed) return { status: 'held', issue: result };
      } catch (error) {
        if (signal.aborted) return { status: 'stopped' };
        return { status: 'held', issue: isReviewTooLong(error) ? 'too-long' : 'unavailable' };
      }
      hooks.reviewing(false);
    }
    if (signal.aborted) return { status: 'stopped' };

    const lockup = await loadBrandLockup(store.locale);
    const shownName = shownPlanetName(state.template, store.locale);
    const { previewCode, createdAt } = request;
    const result = await runImageExport(host, {
      state, summary, options, limits,
      stylized: selectedStylizedBase(translate('export.ai_tag')),
      shots: useEditorStore.getState().export3dShots,
      footerTokens,
      brand: brandInfo(store.locale, options, lockup, request.site),
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
    if (hooks.deliver) await hooks.deliver(blob);
    else if (SUPPORTS_DOWNLOADS) downloadBlob(blob, exportFileName([now], 'png'));
    else throw new Error('Image delivery unavailable');
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
