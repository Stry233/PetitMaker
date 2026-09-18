import { prepareOwnImageReceipt } from '../../../../io/image-ownership';
import { useAttribution } from './use-attribution';
import { protectedImageNotes } from '../../../../core/provenance/image-attribution';
import { automaticExportReview, isReviewTooLong, useMapReview, useTextReview } from './edition-export';
import { SUPPORTS_DOWNLOADS } from '../../../../core/runtime/edition';
import { MapReviewStatus } from './review/MapReviewStatus';
import { useExportNotice } from './review/ExportNotice';
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { radii, font, buttonMotion, cursors } from '../../../design/styles';
import { skin, windowCard, windowFooterGhost, windowFooterPrimary, windowTitle } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { useCursorCss } from '../../../design/cursors/cursor-vars';
import { Spinner } from '../../../primitives/Spinner';
import { useT, translate } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import type { ExportOptions } from '../../../../io/export/types';
import { ExportControls } from './ExportControls';
import { ExportPreview } from './ExportPreview';
import { footerTokenValues } from './render-preview-bridge';
import { ModalShell } from '../../../primitives/ModalShell';
import { host } from '../../../../kit/host';
import { paintComposition, CARD_3D_CELL_ASPECT, type CompositionAssets } from '../../../../io/export/paint';
import { brandInfo, loadBrandLockup } from './brand';
import { DEFAULT_FOOTER, formatFooterDate } from '../../../../io/export/footer-template';
import { loadRememberedExportOptions, rememberExportOptions } from '../../../../io/export/options-store';
import { captureMapStills } from '../../../../canvas/map3d/capture';
import { seedShots } from '../../../../canvas/map3d/shot-list';
import { loadImage } from '../../../../io/export/canvas-helpers';
import { badgesFor, renderExport } from '../../../../io/export/render';
import { layersFor } from '../../../../io/export/layer-preview';
import { needsBanding, renderBanded } from '../../../../io/export/banded';
import { TiledMap } from '../../../../io/export/tiled-map';
import { CANVAS_LIMITS, mapNativePx, clampedCaptureRequestPx } from '../../../../io/export/sizing';
import { deviceCanvasLimits } from '../../../../io/export/canvas-limits';
import { useShareCode, renderShareCodeAsset, shareCodeKey, shareCodeIssueKey, type ShareCodeIssue } from './use-share-code';
import type { ExportComposition } from '../../../../io/export/types';
import { computeComposition, RESOLUTION_WIDTHS } from '../../../../io/export/compose';
import { downloadBlob } from '../../../../io/image-export';
import { showToast } from '../../floating/Toast';
import { selectedVersion } from './stylize/use-stylize-versions';
import { composeStylizedBaseMap } from './stylize/compose-stylized';
import { exportText, type ReviewProgress, type ReviewResult } from '../../../../io/moderation/text/policy';
import { Expand } from '../../../primitives/Expand';

/** What either baseMap producer (a real capture, or a stylized composite) actually is — narrower
 *  than `CanvasImageSource` so `.width`/`.height` stay plain numbers downstream. */
type BaseMapSource = HTMLImageElement | HTMLCanvasElement;

/** Exported: the Help Center's share figure pictures the window under these same defaults. */
/** How long the shell's opening spring (`springs.stiff`) takes to come to rest, in ms. */
const ENTRANCE_SETTLE_MS = 360;

export const DEFAULT_OPTIONS: ExportOptions = { title: '', description: '', preset: 'share', importable: true, showBadge: true, layerPreview: true, card3d: false, grid: true, footer: true, annotations: true, footerTemplate: DEFAULT_FOOTER, resolution: 'standard' };

/** Minimum dimension (px) to consider a 3D still usable. */
const MIN_3D_PX = 32;

/** Illustrative dims for the footer editor's reference menu (the real footer is resolved at paint
 *  time from the actual composition). */
function footerDimsSample(res: ExportOptions['resolution']): string {
  if (res === 'original') return 'native';
  const w = RESOLUTION_WIDTHS[res];
  return `${w}×${Math.round(w / 1.2)}`;
}

/** Yield to the browser so a pending React state change (the loading overlay) actually paints
 *  before a heavy synchronous step runs — double rAF guarantees one composited frame. */
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export interface ImageDelivery {
  id: string;
  label: string;
  available: boolean;
  send: (image: Blob) => Promise<void>;
}

/** The share-picture controls on their own, so the "save and share" window can carry them as one
 *  of its three sections. Everything expensive here is gated on `open` — the provenance summary,
 *  the share-code build, the preview's captures — so a mounted-but-hidden section costs nothing. */
export function ExportPanel({ open, onDone, deliveries }: { open: boolean; onDone: () => void; deliveries?: readonly ImageDelivery[] }) {
  const t = useT();
  const busy = useCursorCss('busy');
  // Gated on `open`: this selector runs on EVERY store update, and the provenance
  // summary re-derives a full cell-taint scan per edit — a closed, always-mounted
  // modal must cost nothing while the user paints.
  const summary = useEditorStore((s) => (open ? s.commandExecutor?.getProvenanceSummary() : undefined));
  const gridState = useEditorStore((s) => s.gridState);
  const locale = useEditorStore((s) => s.locale);
  // The window opens the way it was left: every choice but the map's own words is remembered.
  const [remembered, setOptions] = useState<ExportOptions>(() => ({ ...DEFAULT_OPTIONS, ...loadRememberedExportOptions() }));
  // The title and description are the map's own notes, shared with the JSON export and the share code.
  useEditorStore((s) => s.notesEpoch);
  const setMapNotes = useEditorStore((s) => s.setMapNotes);
  const attribution = useAttribution(open);
  const notes = attribution.notes;
  const notesKey = JSON.stringify(notes);
  const options = useMemo<ExportOptions>(() => ({ ...remembered, title: notes.title ?? '', description: notes.description ?? '' }), [remembered, notesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- content key
  const [exporting, setExporting] = useState(false);
  /** How far a tiled export has come, or null while the export is not tiled. */
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [reviewProgress, setReviewProgress] = useState<ReviewProgress | null>(null);
  const [reviewIssue, setReviewIssue] = useState<Exclude<ReviewResult, { allowed: true }> | 'unavailable' | 'too-long' | null>(null);
  const notice = useExportNotice(open, options, gridState);
  const exportRun = useRef<AbortController | null>(null);
  function cancelExport() {
    exportRun.current?.abort(); exportRun.current = null;
    setExporting(false); setReviewProgress(null);
  }
  useEffect(() => {
    if (!open) cancelExport();
    return () => { exportRun.current?.abort(); exportRun.current = null; };
  }, [open]);
  useEffect(() => { setReviewIssue(null); }, [options]);

  // THE ENTRANCE COMES FIRST. The preview's capture, its paint and the share-code encode are all
  // synchronous main-thread work that would land inside the card's opening spring and stall it, so
  // the picture starts once the spring has settled; a reduced-motion open has no spring to protect.
  const reduced = useReducedMotionConfig() === true;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!open) { setSettled(false); return; }
    if (reduced) { setSettled(true); return; }
    const id = setTimeout(() => setSettled(true), ENTRANCE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [open, reduced]);
  const mapReview = useMapReview(open, settled, true);
  useEffect(() => { cancelExport(); }, [gridState, mapReview.revision]);
  const ready = open && settled && mapReview.previewReady;

  // One timestamp per modal session: it goes into the code's payload, so fixing it at open makes
  // the PREVIEWED band pixel-identical to the exported one (the export reuses the cached asset).
  const [createdAt, setCreatedAt] = useState('');
  useEffect(() => { if (open) setCreatedAt(new Date().toISOString()); }, [open]);

  const [composing, setComposing] = useState(false);
  useEffect(() => { if (!open) setComposing(false); }, [open]);
  const footerValues = open && gridState ? footerTokenValues(gridState, options, locale, summary ?? null) : {};
  const reviewParts = exportText(options, { ...footerValues, date: formatFooterDate(), dims: '0×0' });
  const textReview = useTextReview(open, reviewParts, composing);
  const issue = reviewIssue ?? textReview.issue;
  const textlessExportDisabled = attribution.locked || exporting || mapReview.pending || mapReview.result?.status === 'blocked';
  const exportDisabled = composing || exporting || mapReview.pending || mapReview.result?.status === 'blocked' || (issue !== null && typeof issue === 'object');

  // The web edition waits for review; Lite uses the manual export acknowledgement.
  const safeOptions = (!automaticExportReview && !composing) || textReview.allowed ? options : { ...options, title: '', description: '', footerTemplate: DEFAULT_FOOTER };
  const previewKey = JSON.stringify(safeOptions);
  const previewOptions = useMemo(() => safeOptions, [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps -- content key
  const safeFooter = { ...footerValues, title: previewOptions.title };
  const footerKey = JSON.stringify(safeFooter);
  const previewFooter = useMemo(() => safeFooter, [footerKey]); // eslint-disable-line react-hooks/exhaustive-deps -- content key
  const { title: _liveTitle, description: _liveDescription, ...optionRest } = options;
  const optionRestKey = JSON.stringify(optionRest);
  const openedWith = useRef(optionRestKey);
  useEffect(() => {
    if (optionRestKey !== openedWith.current) rememberExportOptions(options);
  }, [optionRestKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the remembered fields ARE optionRest

  // The real share-code band, built async + debounced — never on the open animation frame and
  // never per keystroke, because a synchronous build is heavy enough to freeze the modal's
  // entrance. While it builds, the preview keeps its last picture (or its loading state when
  // there is none yet — no placeholder band).
  const code = useShareCode(ready, gridState ?? null, summary ?? null, options.importable, options.resolution, createdAt, notesKey);
  const codeAsset = code.asset;
  const codeIssue = code.issue;

  async function handleExport(withoutText = false, delivery?: ImageDelivery) {
    if (delivery && !delivery.available) return;
    if (exportRun.current || !open || (withoutText ? textlessExportDisabled : exportDisabled)) return;
    const controller = new AbortController();
    exportRun.current = controller;
    const { signal } = controller;
    if (automaticExportReview) {
      const mapResult = await mapReview.check().catch(() => null);
      if (!mapResult || mapResult.status === 'blocked' || signal.aborted) {
        if (exportRun.current === controller) exportRun.current = null;
        return;
      }
    }
    const selectedOptions = withoutText ? { ...options, title: '', description: '', footerTemplate: DEFAULT_FOOTER } : options;
    setReviewIssue(null);
    if (withoutText) textReview.cancel();
    signal.addEventListener('abort', textReview.cancel, { once: true });
    setExporting(true);
    await nextFrame(); // let the loading overlay paint before the heavy synchronous work begins
    try {
      if (signal.aborted) return;
      const store = useEditorStore.getState();
      const executor = store.commandExecutor;
      const gridState = store.gridState;
      if (withoutText && gridState && protectedImageNotes(gridState)) return;
      if (!executor || !gridState) {
        return;
      }

      const now = Date.now();
      // What this device's canvas can actually allocate: a composition past it is a blank image,
      // not a large one. Desktop's own ceiling is what the probe confirms there.
      const limits = deviceCanvasLimits();
      const sum = executor.getProvenanceSummary();
      const footerValues = footerTokenValues(gridState, selectedOptions, store.locale, sum);
      const parts = exportText(selectedOptions, { ...footerValues, date: formatFooterDate(), dims: '0×0' });
      if (automaticExportReview && parts.length) {
        setReviewProgress({ phase: 'checking' });
        try {
          const result = await textReview.check(parts);
          if (signal.aborted) return;
          if (!result.allowed) { setReviewIssue(result); return; }
        } catch (error) {
          if (!signal.aborted) setReviewIssue(isReviewTooLong(error) ? 'too-long' : 'unavailable');
          return;
        }
        setReviewProgress(null);
      }
      if (signal.aborted) return;

      const stylizeSelected = selectedVersion();
      // The Original composition every device produces, sized against desktop's constants rather
      // than this device's ceiling. Where this device cannot hold it in one canvas, the export is
      // painted in tiles from a map captured region by region.
      const nativePx = mapNativePx(gridState.template);
      const wide = selectedOptions.resolution === 'original' && !stylizeSelected
        ? computeComposition(selectedOptions, nativePx.w / nativePx.h, badgesFor(sum), { layerCount: layersFor(gridState).length, mapPx: nativePx, limits: CANVAS_LIMITS })
        : null;
      // Tiled where one canvas cannot hold the composition, and also where one capture cannot hold
      // the map: a GPU texture cap below the native size would otherwise shrink the Original.
      const tiled = wide !== null && (needsBanding(wide, limits) || Math.max(nativePx.w, nativePx.h) > host.capture2dTextureCap());

      // A selected stylize version REPLACES the map bitmap: the map itself is never captured, and
      // the user's own ink (if any) is composed back over the generated picture at its own rect.
      // 原图 (no selection) keeps today's plain capture path byte for byte.
      let baseImg: BaseMapSource | TiledMap;
      let mapAspect: number;
      let mapPx: { w: number; h: number };
      if (stylizeSelected) {
        const inkUrl = selectedOptions.annotations ? host.capture2dAnnotations(2048) : null;
        const inkImg = inkUrl ? await loadImage(inkUrl).catch(() => null) : null;
        const gridUrl = selectedOptions.grid ? host.capture2dGrid(2048) : null;
        const gridImg = gridUrl ? await loadImage(gridUrl).catch(() => null) : null;
        baseImg = composeStylizedBaseMap(stylizeSelected.image, inkImg, stylizeSelected.kind === 'model' ? translate('export.ai_tag') : '', gridImg);
        mapAspect = (baseImg.width / baseImg.height) || 1.2;
        mapPx = { w: baseImg.width, h: baseImg.height };
      } else if (tiled) {
        const tile = Math.min(4096, host.capture2dTextureCap());
        baseImg = new TiledMap(nativePx.w, nativePx.h, (region) => host.capture2dRegionCanvas(region, 1, selectedOptions.grid, selectedOptions.annotations), tile);
        mapAspect = nativePx.w / nativePx.h;
        mapPx = nativePx;
      } else {
        // Capture the 2D map. Native mode asks for the map's native resolution the device can hold
        // (so the composed map band is full-resolution); presets use a bounded capture. The renderer
        // also clamps to GPU MAX_TEXTURE_SIZE, so the achieved size is read back from the loaded
        // image either way.
        const capturePx = selectedOptions.resolution === 'original' ? clampedCaptureRequestPx(gridState.template, limits) : 2400;
        const baseUrl = host.capture2d(capturePx, selectedOptions.grid, selectedOptions.annotations);
        if (!baseUrl) {
            showToast(translate('toast.export_image_failed'), 'error');
          return;
        }
        baseImg = await loadImage(baseUrl);
        mapAspect = (baseImg.width / baseImg.height) || 1.2;
        mapPx = { w: baseImg.width, h: baseImg.height };
      }

      // The visible PetitGlyph band is built inside `capture` at the exact width reserved by the
      // composition. `codeTooSmall` defers the toast until after export completes.
      let codeImg: HTMLCanvasElement | null = null;
      let codeTooSmall = false;
      let codeFailed: ShareCodeIssue | null = null;
      let codeNotice: ShareCodeIssue | null = null;

      // Everything the painter needs besides the map: the code band at the width the composition
      // reserved, the 3D card's shots, the brand lockup.
      const prepareAssets = async (comp: ExportComposition): Promise<CompositionAssets> => {
        // The reserved band can be narrower than the canvas; encoding at canvas width clips it.
        if (comp.codeBandUnavailable) {
          codeTooSmall = true; // chosen Size can't host a legible code (Compact)
        } else if (comp.codeBand) {
          // Reuse the previewed asset only when its pixel width and payload inputs match this slot.
          if (codeAsset && codeAsset.canvas.width === comp.codeBand.w && codeAsset.builtKey === shareCodeKey(comp.codeBand.w, createdAt)) {
            codeImg = codeAsset.canvas;
            codeNotice = codeAsset.notice;
          } else {
            // A failed code leaves the picture export available, with a warning after download.
            try {
              const asset = await renderShareCodeAsset(gridState, sum, { createdAt }, comp.codeBand.w);
              codeImg = asset?.canvas ?? null;
              codeNotice = asset?.notice ?? null;
              if (!codeImg) codeTooSmall = true;
            } catch (e) {
              console.error('[export] share code build failed', e);
              codeFailed = shareCodeIssueKey(gridState);
              comp.codeBand = undefined;
            }
          }
        }

        // Optionally capture several smart-angle 3D thumbnails (degrades to none if 3D unavailable).
        let card3dAngles: HTMLImageElement[] = [];
        if (selectedOptions.card3d && comp.card3d) {
          // Render the user's edited shots (the 3D-shots menu); fall back to fresh smart angles if
          // the strip was never opened, so the exported card always matches what the preview showed.
          const chosen = useEditorStore.getState().export3dShots;
          const shots = chosen.length ? chosen : seedShots(gridState);
          const urls = await captureMapStills(gridState, shots, { maxPx: Math.round(comp.card3d.h * CARD_3D_CELL_ASPECT), aspect: CARD_3D_CELL_ASPECT });
          const loaded = await Promise.all(urls.map((u) => (u ? loadImage(u).catch(() => null) : Promise.resolve(null))));
          card3dAngles = loaded.filter((im): im is HTMLImageElement => !!im && im.width >= MIN_3D_PX && im.height >= MIN_3D_PX);
          if (card3dAngles.length === 0) comp.card3d = undefined;
        }

        const brandLockup = await loadBrandLockup(store.locale);
        return {
          baseMap: baseImg,
          card3dAngles,
          codeImg,
          grid: selectedOptions.grid,
          brand: brandInfo(store.locale, selectedOptions, brandLockup),
          footerTemplate: selectedOptions.footerTemplate,
          footerTokens: footerValues,
          state: gridState,
          summary: sum,
          title: selectedOptions.title,
          description: selectedOptions.description,
          translate,
        };
      };

      // Paints the full composition into one offscreen canvas.
      const capture = async (comp: ExportComposition): Promise<HTMLCanvasElement | null> => {
        const assets = await prepareAssets(comp);
        const canvas = document.createElement('canvas');
        canvas.width = comp.width;
        canvas.height = comp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        paintComposition(ctx, comp, assets);
        return canvas;
      };

      // Plain PNG encode — the share code (if any) is already a visible band painted into the
      // composition above, so there is no pixel-level embedding step here. The painted canvas is
      // encoded as it stands: at export sizes a round trip through ImageData reads ~6 MPx out to
      // the CPU and writes them into a second canvas before the encoder ever sees them.
      const encode = (c: HTMLCanvasElement): Promise<Blob> => {
        return new Promise((res, rej) => {
          c.toBlob((blob) => { blob ? res(blob) : rej(new Error('toBlob returned null')); }, 'image/png');
        });
      };

      await nextFrame(); // keep the overlay visible across the compose/encode block
      let blob: Blob | null;
      if (tiled && wide) {
        setExportProgress(0);
        const assets = await prepareAssets(wide);
        blob = await renderBanded({
          width: wide.width, height: wide.height, limits, signal,
          paint: (ctx, window) => paintComposition(ctx, wide, { ...assets, window }),
          onProgress: setExportProgress,
        });
      } else {
        ({ blob } = await renderExport({
          summary: sum,
          gridState,
          options: selectedOptions,
          mapAspect,
          mapPx,
          limits,
          capture,
          encode,
        }));
      }

      if (!blob) {
        showToast(translate('toast.export_image_failed'), 'error');
        return;
      }

      const rememberOwnImage = codeImg ? await prepareOwnImageReceipt(gridState) : () => {};
      if (signal.aborted) return;
      // The final composition determines whether the image carries PetitGlyph.
      if (!await notice.request(!!codeImg) || signal.aborted) return;
      if (delivery) await delivery.send(blob);
      else if (SUPPORTS_DOWNLOADS) downloadBlob(blob, `petit-planet-${now}.png`);
      else throw new Error('Image delivery unavailable');
      if (signal.aborted) return;
      rememberOwnImage();
      useEditorStore.getState().markExported();   // this map has now left the browser
      if (codeTooSmall) showToast(translate('export.code_too_small'), 'info');
      if (codeFailed) showToast(translate(codeFailed), 'info');
      showToast(translate(codeNotice ?? (codeImg ? 'toast.exported_embedded' : 'toast.exported_image')), 'info');
      onDone();
    } catch (e) {
      if (signal.aborted) return;
      console.error('[export] export failed', e);
      showToast(translate('toast.export_image_failed'), 'error');
    } finally {
      signal.removeEventListener('abort', textReview.cancel);
      if (exportRun.current === controller) {
        exportRun.current = null; setExporting(false); setReviewProgress(null); setExportProgress(null);
      }
    }
  }

  // Current footer token values for the footer editor's reference menu (date/dims are illustrative).
  const footerSamples = open && gridState ? { ...footerTokenValues(gridState, options, locale, summary ?? null), date: formatFooterDate(), dims: footerDimsSample(options.resolution) } : {};

  const settingsRef = useRef<HTMLDivElement>(null);
  const activeProgress = textReview.progress ?? reviewProgress;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      {notice.notice}
      {/* Loading overlay — covers the panel while the (partly synchronous) export runs, so the
          modal reads as busy instead of frozen. */}
      <AnimatePresence>
        {exporting && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(253,251,224,0.82)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, borderRadius: radii.lg }}
          >
            <Spinner size={38} thickness={4} />
            <div role="status" style={{ fontFamily: font.family, ...roleFont('label'), color: skin.ink }}>{activeProgress ? t('export.review.checking') : exportProgress !== null ? t('export.progress', { percent: Math.round(exportProgress * 100) }) : t('export.exporting')}</div>
            {activeProgress && <div style={{ ...roleFont('caption'), color: skin.muted, maxWidth: 320, textAlign: 'center' }}>{t('export.review.private')}</div>}
            <button autoFocus style={windowFooterGhost} onClick={cancelExport}>{t('export.review.cancel')}</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body: left column = settings (scroll) + buttons; right column = preview spanning the
          FULL height of the left column (so the buttons row never wastes the preview's space). */}
      <div {...(exporting ? { inert: '' } as unknown as HTMLAttributes<HTMLDivElement> : {})} style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* scrollbar-gutter: stable reserves the scrollbar track so the
              settings column doesn't shift sideways when expanding a panel
              makes it overflow and the scrollbar appears. paddingLeft gives the
              inputs' :focus-visible outline (~5px reach) room so overflowX:hidden
              doesn't clip its left edge. NO SCROLL FADE HERE: this column renders
              FooterEditor's token menu and HelpBubble's tooltips inline, both
              `position: fixed` so they can escape the modal's own clipping — but a
              mask clips its WHOLE painted subtree including fixed descendants, so
              a scroller whose subtree renders fixed-position overlays inline
              cannot wear one; the menu would be clipped along with it. */}
          <div ref={settingsRef} onCompositionStartCapture={() => setComposing(true)} onCompositionEndCapture={() => setComposing(false)} style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0, scrollbarGutter: 'stable', paddingLeft: 6, paddingRight: 8, flex: '1 1 auto' }}>
            <ExportControls options={options} setOptions={setOptions} notes={notes} setNotes={setMapNotes} titleLocked={attribution.titleLocked} descriptionLocked={attribution.descriptionLocked} summary={summary ?? null} footerSamples={footerSamples} checkingFields={textReview.pending && !exporting ? reviewParts.map((part) => part.field) : []} refusedFields={issue && typeof issue === 'object' ? issue.fields : []} reviewLabel={t('export.review.checking')} />
          </div>
          {!mapReview.pending && <MapReviewStatus result={mapReview.result} pending={false} onRetry={mapReview.retry} />}
          {/* Keep hover and focus inside the collapsing clip without narrowing the controls. */}
          <div style={{ margin: '0 -12px' }}>
            <Expand open={!!issue || textReview.paused}>
              <div role={issue ? "alert" : undefined} style={{ padding: 12, color: skin.ink, ...roleFont('caption'), lineHeight: 1.5 }}>
                {issue === 'unavailable' ? t('export.review.unavailable') : issue === 'too-long' ? t('export.review.too_long') : issue ? t('export.review.content', { fields: issue.fields.map((field) => t(field === 'title' ? 'export.field_title' : field === 'description' ? 'export.field_desc' : 'export.opt_footer')).join(', ') }) : ''}
                {(textReview.paused || issue === 'unavailable') && <button style={{ ...windowFooterGhost, marginTop: 8, width: '100%' }} onClick={() => { setReviewIssue(null); textReview.retry(); }}>{t('export.review.retry')}</button>}
                {issue && !attribution.locked && <motion.button disabled={textlessExportDisabled} style={{ ...windowFooterGhost, marginTop: 8, width: '100%', opacity: textlessExportDisabled ? 0.6 : 1 }} onClick={() => void handleExport(true)} {...(textlessExportDisabled ? {} : buttonMotion)}>{t('export.review.without_text')}</motion.button>}
              </div>
            </Expand>
          </div>
          <div style={{ display: 'flex', flexDirection: deliveries ? 'column' : 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, flex: 'none' }}>
            {/* A render in flight is BUSY, not refused, so it names the busy cursor rather than
                letting the sheet's disabled rule call it blocked (same as ExportJsonModal). */}
            {deliveries ? deliveries.map((delivery) => <motion.button key={delivery.id} style={{ ...windowFooterPrimary, opacity: exportDisabled || !delivery.available ? 0.6 : 1 }} onClick={() => void handleExport(false, delivery)} disabled={exportDisabled || !delivery.available} {...buttonMotion} aria-busy={exporting}>{delivery.label}</motion.button>) : <motion.button style={{ ...windowFooterPrimary, opacity: exportDisabled ? 0.6 : 1, cursor: exporting ? busy : exportDisabled ? cursors.default : cursors.clickable }} onClick={() => void handleExport()} disabled={exportDisabled} {...(exportDisabled ? {} : buttonMotion)} aria-busy={exporting}>{exporting ? '…' : t('export.btn_export')}</motion.button>}
            <motion.button style={windowFooterGhost} onClick={onDone} {...buttonMotion}>{t('export.btn_cancel')}</motion.button>
          </div>
        </div>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ExportPreview key={mapReview.revision} open={ready} preparing={open && mapReview.previewReady} checkingMap={mapReview.pending} options={previewOptions} summary={summary ?? null} codeImg={codeAsset?.canvas ?? null} codePending={code.pending} codeIssue={codeIssue} footerTokens={previewFooter} />
        </div>
      </div>
    </div>
  );
}

/** The share picture as its own window. The shell reaches
 *  the same panel through the save-and-share window instead. */
export function ExportModal() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.export);
  const setModal = useEditorStore((s) => s.setModal);
  const close = () => setModal('export', false);
  return (
    <ModalShell
      open={open}
      onClose={close}
      width={980}
      maxVwPct={94}
      height={848}
      maxVhPct={92}
      cardStyle={{ ...windowCard, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '24px 26px 20px' }}
      ariaLabel={t('export.title')}
    >
      <div style={{ ...windowTitle, marginBottom: 4 }}>{t('export.title')}</div>
      <ExportPanel open={open} onDone={close} />
    </ModalShell>
  );
}
