import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { radii, font, exitTransition } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { Spinner } from '../../../primitives/Spinner';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import type { ExportOptions } from '../../../../io/export/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import { captureBaseMap, captureCard3dAngles, paintPreview } from './render-preview-bridge';
import { CodeWarn } from './ExportControls';
import type { ShareCodeIssue } from './use-share-code';
import { angleKey } from '../../../../canvas/map3d/capture';
import { clamp } from '../../../../core/model/math';
import { useCursorCss } from '../../../design/cursors/cursor-vars';

/** How long a quiet spell (no pan/zoom) must last before the reset hint fades back out. */
const HINT_QUIET_MS = 2500;

/** Interactive export preview. Expensive captures (map, 3D) are cached and refresh only when the
 *  map / resolution / 3D toggle change; typing title/description re-paints cheaply. Pan with drag,
 *  zoom with the wheel, double-click to reset.
 *
 *  `open` gates every capture and resets the view, and is a PROP rather than a store read: the
 *  window this preview sits in is not always the one the `modals.export` flag describes. */
export function ExportPreview({ open, options, summary, codeImg, codePending, codeIssue }: { open: boolean; options: ExportOptions; summary: MapProvenanceSummary | null; codeImg?: HTMLCanvasElement | null; codePending?: boolean; codeIssue?: ShareCodeIssue | null }) {
  const t = useT();
  const state = useEditorStore((s) => s.gridState);
  const locale = useEditorStore((s) => s.locale);
  const [baseMap, setBaseMap] = useState<HTMLImageElement | null>(null);
  const [card3d, setCard3d] = useState<HTMLImageElement[]>([]);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // The reset hint: hidden at rest, shown once the user has actually panned or zoomed, and faded
  // back out after a quiet spell so it doesn't linger as a permanent fixture.
  const [showResetHint, setShowResetHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteInteraction = () => {
    setShowResetHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowResetHint(false), HINT_QUIET_MS);
  };
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  // The preview image pans, so it wears the same hand the canvas does. Both are resolved here
  // because the drag state that picks between them is a ref, read during render.
  // The pointer is captured by the STAGE for the whole drag, so the cursor belongs there and not
  // on the image: an image-only cursor reverts to the arrow the moment the drag starts. `move` is
  // what the map views show while panning, and this pans a picture.
  const panCursor = useCursorCss('move');

  // EXPENSIVE: capture the 2D map — only when the map or the grid toggle changes (the grid
  // is baked into the capture by the real 2D renderer, so toggling it must recapture). The
  // capture is fixed at preview resolution, so the export Size choice never re-runs it.
  useEffect(() => {
    if (!open || !state) return;
    let alive = true; setLoading(true);
    // Capture the preview map at a crisp resolution so it stays sharp when zoomed in the preview
    // stage (the chosen export Size still governs the final file; this is preview-only).
    captureBaseMap(1440, options.grid).then((img) => { if (alive) setBaseMap(img); }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, state, options.grid]);

  // EXPENSIVE: capture the 3D stills — when toggled on, the map changes, or the user edits the
  // chosen shots (so the preview card matches the exported card exactly).
  const shots = useEditorStore((s) => s.export3dShots);
  const shotsKey = shots.map(angleKey).join('|');
  useEffect(() => {
    if (!open || !state || !options.card3d) { setCard3d([]); return; }
    let alive = true;
    // Defer this (heavy, main-thread-blocking) 3D re-capture until AFTER the shots strip's
    // add/expand spring settles (~400ms), so building the throwaway scene never stalls that
    // animation mid-flight (a stall snaps the layout on the final frame).
    const id = setTimeout(() => {
      captureCard3dAngles(state, shots.length ? shots : undefined).then((imgs) => { if (alive) setCard3d(imgs); }).catch(() => undefined);
    }, 480);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized shots
  }, [open, state, options.card3d, shotsKey]);

  // CHEAP: re-paint from cached assets on any option/text change (debounced); never recaptures.
  // codeImg is the REAL share-code band (built async by the modal). There is NO placeholder:
  // while a code is still building (codePending) the preview simply stays in its loading state
  // and paints only once the actual modules exist.
  useEffect(() => {
    if (!baseMap || !state) return;
    if (codePending) { setLoading(true); return; }
    const id = setTimeout(() => { setDataUrl(paintPreview({ options, summary: summary ?? null, state, locale, baseMap, card3dAngles: card3d, codeImg: codeImg ?? null })); setLoading(false); }, 50);
    return () => clearTimeout(id);
  }, [options, summary, state, locale, baseMap, card3d, codeImg, codePending]);

  useEffect(() => { setView({ tx: 0, ty: 0, scale: 1 }); setShowResetHint(false); }, [open, baseMap]);

  const onWheel = (e: React.WheelEvent) => { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; setView((v) => ({ ...v, scale: clamp(v.scale * f, 0.5, 6) })); noteInteraction(); };
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) })); noteInteraction(); };
  const onUp = () => { drag.current = null; };
  const onReset = () => {
    setView({ tx: 0, ty: 0, scale: 1 });
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setShowResetHint(false); // back at rest — nothing left to reset
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ ...stage, cursor: panCursor }} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onDoubleClick={onReset}>
        {loading && <div style={hintStyle}><Spinner /><div>{t('export.load_t')}</div></div>}
        {dataUrl && !loading && (
          <img src={dataUrl} alt="" draggable={false}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, userSelect: 'none', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transition: drag.current ? 'none' : 'transform .08s' }} />
        )}
        {!loading && !dataUrl && <div style={hintStyle}><div style={{ fontSize: 28 }}>🗺️</div><div>{t('export.fail_t')}</div></div>}
        {/* Transient reset hint: hidden at rest, appears once the user has actually panned/zoomed
            the picture, fades back out after a quiet spell (see HINT_QUIET_MS) or on reset itself. */}
        <AnimatePresence>
          {showResetHint && (
            <motion.div key="reset-hint" style={hintPill}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: exitTransition }}>
              {t('export.preview_reset_hint')}
            </motion.div>
          )}
        </AnimatePresence>
        {/* Painted AFTER the image (later DOM = later paint) so the hairline outline reads all the
            way round even when the picture is panned/zoomed to fill the whole stage — an inset
            box-shadow on `stage` itself would paint under the image and get covered by it. */}
        <div style={outlineStyle} aria-hidden />
      </div>
      {/* The band in the picture above is blank when the encoder refused the map, which reads as a
          rendering fault unless the preview says otherwise. The picture itself still exports. */}
      {codeIssue && <CodeWarn text={t(codeIssue)} />}
    </div>
  );
}

const stage: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, borderRadius: radii.lg, background: skin.inset, display: 'grid', placeItems: 'center', overflow: 'hidden', touchAction: 'none' };
// A sibling overlay rather than `stage`'s own box-shadow: see the JSX comment above its use.
const outlineStyle: CSSProperties = { position: 'absolute', inset: 0, borderRadius: radii.lg, boxShadow: `inset 0 0 0 1.5px ${skin.line}`, pointerEvents: 'none' };
const hintStyle: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: skin.muted, fontFamily: font.family, ...roleFont('label') };
const hintPill: CSSProperties = { position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', ...roleFont('caption'), color: skin.plateInk, background: skin.plate, borderRadius: 999, padding: '3px 11px', whiteSpace: 'nowrap', pointerEvents: 'none', fontFamily: font.family };
