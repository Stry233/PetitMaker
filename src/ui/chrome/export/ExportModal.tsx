import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { modalTitle, colors, radii, font, buttonMotion, footerPrimary, footerGhost, cursors } from '../../styles';
import { useCursorCss } from '../../cursors/cursor-vars';
import { Spinner } from '../../Spinner';
import { useT, translate, localizedName } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { ExportOptions } from '../../../io/export/types';
import { ExportControls } from './ExportControls';
import { ExportPreview } from './ExportPreview';
import { footerTokenValues } from './render-preview-bridge';
import { ModalShell } from '../ModalShell';
import { petitWindow } from '../../../core/runtime/window-bridge';
import { paintComposition, CARD_3D_CELL_ASPECT } from '../../../io/export/paint';
import { DEFAULT_FOOTER, formatFooterDate } from '../../../io/export/footer-template';
import { captureMapStills } from '../../../canvas/map3d/capture';
import { seedShots } from '../../../canvas/map3d/shot-list';
import type { PixelBuffer } from '../../../io/export/paint-types';
import { loadImage } from '../../../io/export/canvas-helpers';
import { renderExport } from '../../../io/export/render';
import { originalCaptureRequestPx } from '../../../io/share';
import { useShareCode, renderShareCodeCanvas, shareCodeKey } from './use-share-code';
import type { ExportComposition } from '../../../io/export/types';
import { layersFor } from '../../../io/export/layer-preview';
import { RESOLUTION_WIDTHS } from '../../../io/export/compose';
import { downloadBlob } from '../../../io/image-export';
import { showToast } from '../Toast';

const DEFAULT_OPTIONS: ExportOptions = { title: '', description: '', preset: 'share', importable: true, showBadge: true, layerPreview: true, card3d: false, grid: true, footer: true, footerTemplate: DEFAULT_FOOTER, resolution: 'standard' };

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

export function ExportModal() {
  const t = useT();
  const busy = useCursorCss('busy');
  const open = useEditorStore((s) => s.modals.export);
  const setModal = useEditorStore((s) => s.setModal);
  const close = (open: boolean) => setModal('export', open);
  // Gated on `open`: this selector runs on EVERY store update, and the provenance
  // summary re-derives a full cell-taint scan per edit — a closed, always-mounted
  // modal must cost nothing while the user paints.
  const summary = useEditorStore((s) => (s.modals.export ? s.commandExecutor?.getProvenanceSummary() : undefined));
  const gridState = useEditorStore((s) => s.gridState);
  const locale = useEditorStore((s) => s.locale);
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_OPTIONS);
  const [exporting, setExporting] = useState(false);

  // One timestamp per modal session: it goes into the code's payload, so fixing it at open makes
  // the PREVIEWED band pixel-identical to the exported one (the export reuses the cached asset).
  const [createdAt, setCreatedAt] = useState('');
  useEffect(() => { if (open) setCreatedAt(new Date().toISOString()); }, [open]);

  // The real share-code band, built async + debounced — never on the open animation frame and
  // never per keystroke, because a synchronous build is heavy enough to freeze the modal's
  // entrance. While it builds, the preview stays in its loading state (no placeholder band).
  const code = useShareCode(open, gridState ?? null, summary ?? null, options.importable, options.title, options.resolution, createdAt);
  const codeAsset = code.asset;

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    await nextFrame(); // let the loading overlay paint before the heavy synchronous work begins
    try {
      const store = useEditorStore.getState();
      const executor = store.commandExecutor;
      const gridState = store.gridState;
      if (!executor || !gridState) {
        setExporting(false);
        return;
      }

      const now = Date.now();
      const sum = executor.getProvenanceSummary();

      // Capture the 2D map. Native mode asks for the map's native resolution (so the composed map
      // band is full-resolution); presets use a bounded capture. The renderer clamps to GPU
      // MAX_TEXTURE_SIZE, so the achieved size is read back from the loaded image.
      const capturePx = options.resolution === 'original' ? originalCaptureRequestPx(gridState.template) : 2400;
      const baseUrl = petitWindow().__petitCaptureFullMap?.(capturePx, options.grid);
      if (!baseUrl) {
        setExporting(false);
        showToast(translate('toast.export_image_failed'), 'error');
        return;
      }

      const baseImg = await loadImage(baseUrl);
      const mapAspect = (baseImg.width / baseImg.height) || 1.2;
      const mapPx = { w: baseImg.width, h: baseImg.height };

      // The PetitGlyph v2 share-code band (a visible, decoder-only mosaic — no pixel-level
      // steganography) is built INSIDE `capture` below, sized from the POST-FIT `comp.width` —
      // the same width compose.ts sizes the codeBand rect from, so there is one source of truth
      // for the width the code is encoded at. `codeTooSmall` defers the toast until after export
      // completes so it never races the success toast.
      let codeImg: HTMLCanvasElement | null = null;
      let codeTooSmall = false;

      // Capture function: paints the full composition into an offscreen canvas and returns a PixelBuffer.
      // The computed ExportComposition is passed in so we can render the full layout including the 3D card.
      const capture = async (comp: ExportComposition): Promise<PixelBuffer | null> => {
        // Build the share code (if requested) at the composition's FINAL width — comp.codeBand
        // is only present when hasShareCode(options) AND the width fit a module base;
        // comp.codeBandUnavailable is compose.ts's own too-small signal (the source of truth for
        // the toast, rather than inferring it from buildShareCode returning null).
        if (comp.codeBandUnavailable) {
          codeTooSmall = true; // chosen Size can't host a legible code (Compact)
        } else if (comp.codeBand) {
          // Reuse the previewed asset when it was built for exactly this width + inputs — the
          // preview then IS the export, and the encode cost is paid once. A stale asset (title
          // typed within the debounce window, or the Original preset's native width differing
          // from the preview's) rebuilds with the SAME session createdAt → identical inputs.
          if (codeAsset && codeAsset.builtWidth === comp.width && codeAsset.builtKey === shareCodeKey(comp.width, options.title, createdAt)) {
            codeImg = codeAsset.canvas;
          } else {
            codeImg = await renderShareCodeCanvas(gridState, sum, { title: options.title, createdAt }, comp.width);
            if (!codeImg) codeTooSmall = true; // belt+braces: band reserved but the code failed to build
          }
        }

        // Optionally capture several smart-angle 3D thumbnails (degrades to none if 3D unavailable).
        let card3dAngles: HTMLImageElement[] = [];
        if (options.card3d && comp.card3d) {
          // Render the user's edited shots (the 3D-shots menu); fall back to fresh smart angles if
          // the strip was never opened, so the exported card always matches what the preview showed.
          const chosen = useEditorStore.getState().export3dShots;
          const shots = chosen.length ? chosen : seedShots(gridState);
          const urls = await captureMapStills(gridState, shots, { maxPx: Math.round(comp.card3d.h * CARD_3D_CELL_ASPECT), aspect: CARD_3D_CELL_ASPECT });
          const loaded = await Promise.all(urls.map((u) => (u ? loadImage(u).catch(() => null) : Promise.resolve(null))));
          card3dAngles = loaded.filter((im): im is HTMLImageElement => !!im && im.width >= MIN_3D_PX && im.height >= MIN_3D_PX);
          if (card3dAngles.length === 0) comp.card3d = undefined;
        }

        const canvas = document.createElement('canvas');
        canvas.width = comp.width;
        canvas.height = comp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        paintComposition(ctx, comp, {
          baseMap: baseImg,
          card3dAngles,
          codeImg,
          grid: options.grid,
          footerTemplate: options.footerTemplate,
          footerTokens: footerTokenValues(gridState, options, store.locale, sum),
          state: gridState,
          summary: sum,
          title: options.title,
          description: options.description,
          translate,
        });

        const imageData = ctx.getImageData(0, 0, comp.width, comp.height);
        return { data: imageData.data, width: comp.width, height: comp.height };
      };

      // Plain PNG encode — the share code (if any) is already a visible band painted into the
      // composition above, so there is no pixel-level embedding step here.
      const encode = (buf: PixelBuffer): Promise<Blob> => {
        return new Promise((res, rej) => {
          const c = document.createElement('canvas');
          c.width = buf.width; c.height = buf.height;
          const cx = c.getContext('2d');
          if (!cx) { rej(new Error('no 2d context')); return; }
          const id = new ImageData(buf.data, buf.width, buf.height);
          cx.putImageData(id, 0, 0);
          c.toBlob((blob) => { blob ? res(blob) : rej(new Error('toBlob returned null')); }, 'image/png');
        });
      };

      await nextFrame(); // keep the overlay visible across the compose/encode block
      const { blob } = await renderExport({
        summary: sum,
        gridState,
        options,
        mapAspect,
        mapPx,
        capture,
        encode,
      });

      if (!blob) {
        showToast(translate('toast.export_image_failed'), 'error');
        setExporting(false);
        return;
      }

      downloadBlob(blob, `petit-planet-${now}.png`);
      if (codeTooSmall) showToast(translate('export.code_too_small'), 'info');
      showToast(translate(codeImg ? 'toast.exported_embedded' : 'toast.exported_image'), 'info');
      setExporting(false);
      close(false);
    } catch (e) {
      console.error('[export] export failed', e);
      showToast(translate('toast.export_image_failed'), 'error');
      setExporting(false);
    }
  }

  // Build the map summary line (matches mockup: "Name · W × H · N layers · M objects").
  // The layer count is a whole-grid scan; skip all derived lines while closed.
  const mapName = open && gridState ? localizedName(gridState.template.name, locale) : '';
  const mapSummary = open && gridState
    ? t('export.map_summary', {
        name: mapName,
        w: String(gridState.template.width),
        h: String(gridState.template.height),
        layers: String(layersFor(gridState).length),
        objects: String(gridState.objects.size),
      })
    : null;

  // Provenance presence line: "AI-assisted 42% · Procedural 18%" when content is present.
  const provLine = summary && (summary.containsAi || summary.containsProcedural)
    ? [
        summary.containsAi ? `${t('prov.badge_ai')} ${summary.aiAreaPct}%` : null,
        summary.containsProcedural ? `${t('prov.badge_proc')} ${summary.proceduralAreaPct}%` : null,
      ].filter(Boolean).join(' · ')
    : null;

  // Current footer token values for the footer editor's reference menu (date/dims are illustrative).
  const footerSamples = open && gridState ? { ...footerTokenValues(gridState, options, locale, summary ?? null), date: formatFooterDate(), dims: footerDimsSample(options.resolution) } : {};

  return (
    <ModalShell
      open={open}
      onClose={() => close(false)}
      width={980}
      maxVwPct={94}
      height={848}
      maxVhPct={92}
      cardStyle={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '24px 26px 20px' }}
      ariaLabel={t('export.title')}
    >
      {/* Loading overlay — covers the panel while the (partly synchronous) export runs, so the
          modal reads as busy instead of frozen. */}
      <AnimatePresence>
        {exporting && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(255,253,245,0.78)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, borderRadius: radii.lg }}
          >
            <Spinner size={38} thickness={4} />
            <div style={{ fontFamily: font.family, fontWeight: 800, fontSize: 14, color: colors.frameDark }}>{t('export.exporting')}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed header */}
      <div style={{ ...modalTitle, marginBottom: 4 }}>{t('export.title')}</div>
      {mapSummary && <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.textSecondary, textAlign: 'center', marginBottom: provLine ? 4 : 14, fontVariantNumeric: 'tabular-nums' }}>{mapSummary}</div>}
      {provLine && <div style={{ fontSize: 12, fontWeight: 700, color: colors.textSecondary, textAlign: 'center', marginBottom: 14 }}>{provLine}</div>}

      {/* Body: left column = settings (scroll) + buttons; right column = preview spanning the
          FULL height of the left column (so the buttons row never wastes the preview's space). */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* scrollbar-gutter: stable reserves the scrollbar track so the
              settings column doesn't shift sideways when expanding a panel
              makes it overflow and the scrollbar appears. paddingLeft gives the
              inputs' :focus-visible outline (~5px reach) room so overflowX:hidden
              doesn't clip its left edge. */}
          <div style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0, scrollbarGutter: 'stable', paddingLeft: 6, paddingRight: 8, flex: '1 1 auto' }}>
            <ExportControls options={options} setOptions={setOptions} summary={summary ?? null} footerSamples={footerSamples} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flex: 'none' }}>
            {/* A render in flight is BUSY, not refused, so it names the busy cursor rather than
                letting the sheet's disabled rule call it blocked (same as ExportJsonModal). */}
            <motion.button style={{ ...footerPrimary, opacity: exporting ? 0.6 : 1, cursor: exporting ? busy : cursors.clickable }} onClick={handleExport} disabled={exporting} {...(exporting ? {} : buttonMotion)} aria-busy={exporting}>{exporting ? '…' : t('export.btn_export')}</motion.button>
            <motion.button style={footerGhost} onClick={() => close(false)} {...buttonMotion}>{t('export.btn_cancel')}</motion.button>
          </div>
        </div>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ExportPreview options={options} summary={summary ?? null} codeImg={codeAsset?.canvas ?? null} codePending={code.pending} />
        </div>
      </div>
    </ModalShell>
  );
}
