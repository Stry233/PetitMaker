import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { colors, radii, font, inkTint } from '../../styles';
import { Spinner } from '../../Spinner';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { ExportOptions } from '../../../io/export/types';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import { captureBaseMap, captureCard3dAngles, paintPreview } from './render-preview-bridge';
import { angleKey } from '../../../canvas/map3d/capture';
import { clamp } from '../../../core/model/math';
import { useCursorCss } from '../../cursors/cursor-vars';


/** Interactive export preview. Expensive captures (map, 3D) are cached and refresh only when the
 *  map / resolution / 3D toggle change; typing title/description re-paints cheaply. Pan with drag,
 *  zoom with the wheel, double-click to reset. */
export function ExportPreview({ options, summary, codeImg, codePending }: { options: ExportOptions; summary: MapProvenanceSummary | null; codeImg?: HTMLCanvasElement | null; codePending?: boolean }) {
  const t = useT();
  const state = useEditorStore((s) => s.gridState);
  const locale = useEditorStore((s) => s.locale);
  const open = useEditorStore((s) => s.modals.export);
  const [baseMap, setBaseMap] = useState<HTMLImageElement | null>(null);
  const [card3d, setCard3d] = useState<HTMLImageElement[]>([]);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // The preview image pans, so it wears the same hand the canvas does. Both are resolved here
  // because the drag state that picks between them is a ref, read during render.
  const grab = useCursorCss('hand-open');
  const grabbing = useCursorCss('hand-closed');

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
    // animation mid-flight — which caused the layout to snap on the final frame.
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

  useEffect(() => { setView({ tx: 0, ty: 0, scale: 1 }); }, [open, baseMap]);

  const onWheel = (e: React.WheelEvent) => { const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; setView((v) => ({ ...v, scale: clamp(v.scale * f, 0.5, 6) })); };
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) })); };
  const onUp = () => { drag.current = null; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={stage} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onDoubleClick={() => setView({ tx: 0, ty: 0, scale: 1 })}>
        {loading && <div style={hintStyle}><Spinner /><div>{t('export.load_t')}</div></div>}
        {dataUrl && !loading && (
          <img src={dataUrl} alt="" draggable={false}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, userSelect: 'none', transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transition: drag.current ? 'none' : 'transform .08s', cursor: drag.current ? grabbing : grab }} />
        )}
        {!loading && !dataUrl && <div style={hintStyle}><div style={{ fontSize: 28 }}>🗺️</div><div>{t('export.fail_t')}</div></div>}
        <div style={hintPill}>{t('export.preview_hint')}</div>
      </div>
    </div>
  );
}

const stage: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, borderRadius: radii.lg, background: 'linear-gradient(180deg,#f0ebe2,#e7dfd2)', boxShadow: `inset 0 0 0 1.5px ${inkTint(0.06)}`, display: 'grid', placeItems: 'center', overflow: 'hidden', touchAction: 'none' };
const hintStyle: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: colors.textSecondary, fontFamily: font.family, fontWeight: 700, fontSize: 13 };
const hintPill: CSSProperties = { position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 10.5, fontWeight: 700, color: colors.textSecondary, background: 'rgba(255,255,255,0.85)', borderRadius: 999, padding: '3px 11px', whiteSpace: 'nowrap', pointerEvents: 'none', fontFamily: font.family };
