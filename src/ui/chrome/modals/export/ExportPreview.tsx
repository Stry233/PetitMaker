import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { radii, font } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { roleFont, roleSize } from '../../../design/text-weight';
import { Spinner } from '../../../primitives/Spinner';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import type { PictureChoices } from '../../../../io/export/types';
import type { MapNotes } from '../../../../core/model/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import { captureBaseMap, captureCard3dAngles, loadBrandLockup, paintPreview, type BaseMapSource } from '../../../../editor/export/preview';
import type { HostMark } from '../../../../editor/export/brand';
import { LEGAL } from '../../../../legal/config';
import { CodeWarn } from './ExportControls';
import type { ShareCodeIssue } from './use-share-code';
import { angleKey } from '../../../../view/map3d/capture/stills';
import { shotsOf } from '../../../../state/shot-list';
import { usePanZoom } from '../../../primitives/use-pan-zoom';
import { PanZoomResetHint, stageOutline } from '../../../primitives/pan-zoom-stage';
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
export function ExportPreview({
  open, preparing = open, checkingMap = false, options, words, summary, codeImg, codePending, codeIssue, footerTokens, mark = null,
}: {
  open: boolean; preparing?: boolean; checkingMap?: boolean; options: PictureChoices;
  /** The title and description the picture may show, or null to paint it without its words. */
  words: MapNotes | null;
  summary: MapProvenanceSummary | null;
  codeImg?: HTMLCanvasElement | null; codePending?: boolean; codeIssue?: ShareCodeIssue | null; footerTokens?: Record<string, string>;
  /** The footer QR the deployment's host made, in place of the site's. */
  mark?: HostMark | null;
}) {
  const t = useT();
  const statusTransition = useTransition('export.preview.status');
  const state = useEditorStore((s) => s.gridState);
  const locale = useLocale();
  const [baseMap, setBaseMap] = useState<BaseMapSource | null>(null);
  const [brandLockup, setBrandLockup] = useState<HTMLImageElement | null>(null);
  const [card3d, setCard3d] = useState<HTMLImageElement[]>([]);
  const [loading, setLoading] = useState(true);
  const busy = checkingMap || (preparing && loading);
  const hidden = !open || busy;
  // The pictures on the stage, oldest first: each fades in over those before it, which leave once it
  // has landed, so a run of quick changes ends on the newest without the stage showing through.
  const [pictures, setPictures] = useState<Picture[]>([]);
  const picture = pictures[pictures.length - 1] ?? null;
  const reduced = useReducedMotionConfig();
  const shown = reduced ? pictures.slice(-1) : pictures;
  const nextPicture = useRef(0);
  // A picture replaces the ones before at once under reduced motion, as no landing comes to retire
  // them, and on a hidden stage, which shows it again without a fade.
  const addPicture = useEffectEvent((canvas: HTMLCanvasElement) => {
    const next = { id: nextPicture.current++, canvas };
    setPictures((all) => (reduced || hidden ? [next] : [...all, next]));
  });
  const landed = useCallback((id: number) => {
    setPictures((all) => { const at = all.findIndex((p) => p.id === id); return at > 0 ? all.slice(at) : all; });
  }, []);
  useEffect(() => { if (hidden) setPictures((all) => (all.length > 1 ? all.slice(-1) : all)); }, [hidden]);
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
      captureCard3dAngles(state, shotsOf(shots, state)).then((imgs) => { if (alive) setCard3d(imgs); }).catch(() => undefined);
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
      const painted = paintPreview(
        { options, words, summary: summaryRef.current ?? null, state, locale, baseMap, card3dAngles: card3d, codeImg: codeImg ?? null, brandLockup,
          footerTokens, site: mark ?? LEGAL.canonicalOrigin },
      );
      // A canvas the browser refuses a context leaves the picture before it standing.
      if (painted) addPicture(painted);
      hasPicture.current = true;
      setLoading(false);
    }, 50);
    return () => clearTimeout(id);
    // The summary is read from a ref.
  }, [open, options, words, state, locale, baseMap, card3d, codeImg, codePending, brandLockup, footerTokens, mark]);

  const resetView = useEffectEvent(pz.reset);
  useEffect(() => { resetView(); }, [open, baseMap]);

  // The maker's band's lockup art, per locale; the preview repaints when it lands.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadBrandLockup(locale).then((img) => { if (live) setBrandLockup(img); });
    return () => { live = false; };
  }, [open, locale]);

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
        {!hidden && picture && (
          // The moved layer holds every picture of a swap, so a zoomed view carries through it.
          <div style={{ position: 'absolute', inset: 0, ...pz.viewStyle }}>
            <AnimatePresence initial={false}>
              {shown.map((p) => (
                <PreviewPicture key={p.id} canvas={p.canvas} current={p === picture} onLanded={() => landed(p.id)} />
              ))}
            </AnimatePresence>
          </div>
        )}
        {!hidden && !picture && <div style={hintStyle}><div style={{ fontSize: roleSize('title') }}>🗺️</div><div>{t('export.fail_t')}</div></div>}
        <PanZoomResetHint show={pz.showResetHint} label={t('export.preview_reset_hint')} />
        <div style={stageOutline} aria-hidden />
      </div>
      {codeIssue && <CodeWarn text={t(codeIssue)} />}
    </div>
  );
}

interface Picture { id: number; canvas: HTMLCanvasElement }

/** One composed picture on the stage; only the newest is the preview `data-export-preview` names. */
function PreviewPicture({ canvas, current, onLanded }: { canvas: HTMLCanvasElement; current: boolean; onLanded: () => void }) {
  const swap = useTransition('export.preview.swap');
  const reduced = useReducedMotionConfig();
  const draw = useCallback((el: HTMLCanvasElement | null) => { el?.getContext('2d')?.drawImage(canvas, 0, 0); }, [canvas]);
  return (
    <motion.canvas ref={draw} width={canvas.width} height={canvas.height} data-export-preview={current ? '' : undefined} aria-hidden
      initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={swap}
      onAnimationComplete={onLanded} style={pictureStyle} />
  );
}

const pictureStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', borderRadius: radii.chip, userSelect: 'none' };
const stage: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, borderRadius: radii.lg, background: skin.inset, display: 'grid', placeItems: 'center', overflow: 'hidden' };
const hintStyle: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: skin.muted, fontFamily: font.family, ...roleFont('label') };
