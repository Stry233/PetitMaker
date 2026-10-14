import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { radii, font } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { Spinner } from '../../../primitives/Spinner';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import type { ExportOptions } from '../../../../io/export/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import { captureBaseMap, captureCard3dAngles, loadBrandLockup, paintPreview, type BaseMapSource } from '../../../../editor/export/preview';
import { LEGAL } from '../../../../legal/config';
import { CodeWarn } from './ExportControls';
import type { ShareCodeIssue } from './use-share-code';
import { angleKey } from '../../../../view/map3d/capture/stills';
import { usePanZoom } from './use-pan-zoom';
import { PanZoomResetHint, stageOutline } from './pan-zoom-stage';
import { useStylizeVersions } from './stylize/use-stylize-versions';
import { useTransition } from '../../../design/motion/use-motion';
import { useSettledValue } from '../../../primitives/use-settled-value';
import { useEffectEvent } from '../../../primitives/use-effect-event';

/** Interactive export preview. Expensive captures (map, 3D) are cached and refresh only when the
 *  map / resolution / 3D toggle change; typing title/description re-paints cheaply. Pan with drag,
 *  zoom with the wheel, double-click to reset.
 *
 *  `open` gates every capture and resets the view, and is a prop rather than a store read: the
 *  window this preview sits in is not always the one the `modals.export` flag describes. */
export function ExportPreview({ open, preparing = open, checkingMap = false, options, summary, codeImg, codePending, codeIssue, footerTokens }: {
  open: boolean; preparing?: boolean; checkingMap?: boolean; options: ExportOptions; summary: MapProvenanceSummary | null;
  codeImg?: HTMLCanvasElement | null; codePending?: boolean; codeIssue?: ShareCodeIssue | null; footerTokens?: Record<string, string>;
}) {
  const t = useT();
  const statusTransition = useTransition('export.preview.status');
  const state = useEditorStore((s) => s.gridState);
  const locale = useLocale();
  const [baseMap, setBaseMap] = useState<BaseMapSource | null>(null);
  const [brandLockup, setBrandLockup] = useState<HTMLImageElement | null>(null);
  const [card3d, setCard3d] = useState<HTMLImageElement[]>([]);
  const [picture, setPicture] = useState<HTMLCanvasElement | null>(null);
  const displayPicture = useCallback((canvas: HTMLCanvasElement | null) => {
    if (canvas && picture) canvas.getContext('2d')?.drawImage(picture, 0, 0);
  }, [picture]);
  const [loading, setLoading] = useState(true);
  // Drag/wheel/double-click and the transient reset hint, shared with the stylize studio's canvas.
  const pz = usePanZoom();

  // A stylize selection changes what the map band even is, so the expensive capture below must
  // re-run on a selection change too, even though nothing else in its deps moved. Keyed on the
  // selected version's own id: retiring/minting/reselecting all move it, a re-render of an
  // unrelated store slice does not.
  const { selected: stylizeSelected } = useStylizeVersions();
  const stylizeEpoch = stylizeSelected?.id ?? null;

  // Expensive: capture the 2D map — only when the map, the grid toggle, or the stylize selection
  // changes (the grid is baked into the capture by the real 2D renderer, so toggling it must
  // recapture). The capture is fixed at preview resolution, so the export Size choice never re-runs it.
  useEffect(() => {
    if (!open || !state) return;
    let alive = true; setLoading(true);
    // Capture the preview map at a crisp resolution so it stays sharp when zoomed in the preview
    // stage (the chosen export Size still governs the final file; this is preview-only).
    captureBaseMap(1440, options.grid, options.annotations, t('export.ai_tag')).then((img) => { if (alive) setBaseMap(img); }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, state, options.grid, options.annotations, stylizeEpoch, t]);

  // Expensive: capture the 3D stills — when toggled on, the map changes, or the user edits the
  // chosen shots (so the preview card matches the exported card exactly).
  const shots = useSettledValue(useEditorStore((s) => s.export3dShots), (list) => list.map(angleKey).join('|'));
  useEffect(() => {
    if (!open || !state || !options.card3d) { setCard3d([]); return; }
    let alive = true;
    // Defer this (heavy, main-thread-blocking) 3D re-capture until after the shots strip's
    // add/expand spring settles (~400ms), so building the throwaway scene never stalls that
    // animation mid-flight (a stall snaps the layout on the final frame).
    const id = setTimeout(() => {
      captureCard3dAngles(state, shots.length ? shots : undefined).then((imgs) => { if (alive) setCard3d(imgs); }).catch(() => undefined);
    }, 480);
    return () => { alive = false; clearTimeout(id); };
  }, [open, state, options.card3d, shots]);

  // Cheap: re-paint from cached assets on any option/text change (debounced); never recaptures.
  // The title/description arrive settled (the modal holds them until typing stops), so a keystroke
  // never lands here. codeImg is the real share-code band (built async by the modal). There is no
  // placeholder: while a code is still building (codePending) the preview holds the last complete
  // picture it drew, and shows its loading state only when there is none to hold — a rebuild for a
  // retyped title must not blink an already-standing picture away.
  const hasPicture = useRef(false);
  // The provenance summary is a fresh object on every store read, and it only changes while
  // editing, which the modal blocks — read it through a ref (the same move use-share-code.ts
  // makes) so a parent re-render alone never reschedules the paint.
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  useEffect(() => {
    if (!open || !baseMap || !state) return;
    if (codePending) { if (!hasPicture.current) setLoading(true); return; }
    const id = setTimeout(() => {
      setPicture(paintPreview(
        { options, summary: summaryRef.current ?? null, state, locale, baseMap, card3dAngles: card3d, codeImg: codeImg ?? null, brandLockup, footerTokens,
          site: LEGAL.canonicalOrigin },
      ));
      hasPicture.current = true;
      setLoading(false);
    }, 50);
    return () => clearTimeout(id);
    // The summary is read from a ref.
  }, [open, options, state, locale, baseMap, card3d, codeImg, codePending, brandLockup, footerTokens]);

  const resetView = useEffectEvent(pz.reset);
  useEffect(() => { resetView(); }, [open, baseMap]);

  // The maker's band's lockup art, per locale; the preview repaints when it lands.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadBrandLockup(locale).then((img) => { if (live) setBrandLockup(img); });
    return () => { live = false; };
  }, [open, locale]);

  const busy = checkingMap || (preparing && loading);
  const statusLabel = t(checkingMap ? 'export.map_check.checking' : 'export.load_t');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div {...pz.stageProps} style={{ ...stage, ...pz.stageProps.style }}>
        {busy && <div role="status" aria-live="polite" aria-label={statusLabel} style={{ ...hintStyle, textAlign: 'center', padding: 16 }}>
          <Spinner />
          <div aria-hidden style={{ display: 'grid' }}>
            <AnimatePresence initial={false}>
              <motion.div key={statusLabel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={statusTransition} style={{ gridArea: '1 / 1' }}>{statusLabel}</motion.div>
            </AnimatePresence>
          </div>
        </div>}
        {open && picture && !busy && (
          <canvas ref={displayPicture} width={picture.width} height={picture.height} data-export-preview aria-hidden
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', borderRadius: radii.chip, userSelect: 'none', ...pz.viewStyle }} />
        )}
        {open && !busy && !picture && <div style={hintStyle}><div style={{ fontSize: 28 }}>🗺️</div><div>{t('export.fail_t')}</div></div>}
        <PanZoomResetHint show={pz.showResetHint} />
        <div style={stageOutline} aria-hidden />
      </div>
      {codeIssue && <CodeWarn text={t(codeIssue)} />}
    </div>
  );
}

const stage: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, borderRadius: radii.lg, background: skin.inset, display: 'grid', placeItems: 'center', overflow: 'hidden' };
const hintStyle: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: skin.muted, fontFamily: font.family, ...roleFont('label') };
