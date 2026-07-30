/**
 * Full-screen 3D preview overlay. Mounts a ThreeScene from the current GridState
 * snapshot, owns its entrance/exit motion (Quiet Toybox: scale-in via springs,
 * ease-out exit), and tears the scene down on unmount. Dismiss with Esc or the
 * close button. Respects prefers-reduced-motion.
 */
import { useChromeScale } from '../../ui/menu/scale';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { useT } from '../../i18n/context';
import { springs, exitTransition, colors, font, shadows, pressable, radii, cursors } from '../../ui/styles';
import { downloadBlob, dataUrlToBlob } from '../../io/image-export';
import { ThreeScene } from './scene/scene';
import { replaceShot } from './shot-list';
import { CARD_3D_CELL_ASPECT } from '../../io/export/paint';

// Cozy float button, matching the zoom/history controls idiom (dark glyph on a
// cream squircle with the espresso float shadow). Stacked top-right of the view.
function floatBtn(top: number): CSSProperties {
  return {
    position: 'absolute', top, right: 18, width: 46, height: 46, borderRadius: 16,
    background: colors.panelCream, color: colors.frameDark, border: 'none', cursor: cursors.clickable,
    boxShadow: shadows.float, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: font.family, fontWeight: 900, fontSize: 24, lineHeight: 1, WebkitTapHighlightColor: 'transparent',
  };
}

export function Preview3D({ onClose }: { onClose: () => void }) {
  const chrome = useChromeScale();
  const t = useT();
  const reduced = useReducedMotionConfig();
  const [visible, setVisible] = useState(true);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ThreeScene | null>(null);
  const gridState = useEditorStore.getState().gridState;
  // When set, this overlay is editing an export 3D-shot: seed the camera to that shot's angle and
  // show the Use-this-view / Cancel bar. Read reactively so the bar renders; the seeding reads the
  // value at mount (it is set before the overlay opens).
  const edit = useEditorStore((s) => s.preview3DEdit);

  // Mount the three.js scene once, against the host div.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !gridState) return;
    const scene = new ThreeScene(host, gridState);
    sceneRef.current = scene;
    // Edit mode: jump straight to the shot's angle instead of the intro fly-in, so the user tweaks
    // from where the thumbnail was framed.
    const ed = useEditorStore.getState().preview3DEdit;
    if (ed) {
      scene.skipIntroAndRender();
      scene.captureFromAngle(ed.angle.az, ed.angle.el, ed.angle.dist, ed.angle.tx ?? 0, ed.angle.tz ?? 0);
    }
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [gridState]);

  // Esc closes (triggers the exit animation).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setVisible(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => setVisible(false);

  // Edit mode: capture whatever the user orbited to into the target shot, then close. Cancel/Esc/×
  // just close (the shot keeps its previous angle); preview3DEdit is cleared on exit-complete below.
  const useThisView = () => {
    const scene = sceneRef.current;
    const st = useEditorStore.getState();
    const ed = st.preview3DEdit;
    if (scene && ed) st.setExport3dShots(replaceShot(st.export3dShots, ed.index, scene.getCurrentAngle()));
    setVisible(false);
  };

  // Save a PNG of the current 3D framing. Decode the capture's data: URL to a
  // Blob directly — fetch() of a data: URL is blocked by the CSP's connect-src.
  const onCapture = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    // In edit mode the download is the framed slice (matches the viewfinder + the
    // exported shot); otherwise it's the whole view.
    const editing = !!useEditorStore.getState().preview3DEdit;
    const url = editing ? scene.captureFramed(CARD_3D_CELL_ASPECT) : scene.capture();
    if (!url) return;
    downloadBlob(dataUrlToBlob(url), 'petit-planet-3d.png');
  };

  return (
    <AnimatePresence onExitComplete={() => { useEditorStore.getState().setPreview3DEdit(null); onClose(); }}>
      {visible && (
        <motion.div
          key="preview3d"
          role="dialog"
          aria-label={t('preview3d.title')}
          initial={reduced ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.98, transition: exitTransition }}
          transition={springs.stiff}
          style={{
            position: 'fixed', inset: 0, zIndex: 250,
            background: colors.bgCanvas, overflow: 'hidden',
          }}
        >
          {/* WebGL host fills the surface; the scene appends its canvas here. The scene
              renders the WHOLE view so there's context around the frame. */}
          <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

          {/* Edit mode viewfinder — now TRUTHFUL. The export re-renders the shot at
              CARD_3D_CELL_ASPECT with the SAME vertical FOV as this full-screen view,
              so the exported still is exactly the full-HEIGHT, centre-WIDTH slice of
              what's on screen. The frame marks that slice (largest centred box of the
              cell's aspect → full height for a wide screen) and dims the rest; the
              download (onCapture) crops to the same region. */}
          {edit && gridState && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              {/* Largest centred box of the cell's aspect that fits the viewport
                  (a CONTAIN rect): width = the smaller of the full width or the
                  aspect-scaled full height, so it never balloons to full screen on
                  a window narrower than the cell aspect. */}
              <div style={{ width: `min(100vw, ${CARD_3D_CELL_ASPECT} * 100vh)`, aspectRatio: String(CARD_3D_CELL_ASPECT), boxSizing: 'border-box', borderRadius: 12, border: '2px solid rgba(255,255,255,0.92)', boxShadow: '0 0 0 4000px rgba(22,20,18,0.42)' }} />
            </div>
          )}

          {/* exit — cozy float button (orbit/zoom/WASD/Esc controls live in Help). */}
          <motion.button
            type="button"
            onClick={close}
            aria-label={t('preview3d.close')}
            title={t('preview3d.close')}
            {...pressable}
            style={{ ...floatBtn(18), zoom: chrome }}
          >
            <span aria-hidden>×</span>
          </motion.button>

          {/* save a PNG of the current framing */}
          {gridState && (
            <motion.button
              type="button"
              onClick={onCapture}
              aria-label={t('menu.image')}
              title={t('menu.image')}
              {...pressable}
              style={{ ...floatBtn(74), zoom: chrome }}
            >
              <span aria-hidden>⤓</span>
            </motion.button>
          )}

          {!gridState && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', ...font.h2, color: colors.frameDark,
            }}>
              {t('preview3d.empty')}
            </div>
          )}

          {/* Edit mode: orbit freely, then commit this framing to the export shot. Dismissing
              without committing (the × close button / Esc) keeps the shot's previous angle. */}
          {edit && gridState && (
            <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', gap: 10, zoom: chrome }}>
              <motion.button type="button" onClick={useThisView} {...pressable}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: colors.panelCream, color: colors.frameDark, border: 'none', borderRadius: radii.md, padding: '11px 22px', fontFamily: font.family, fontWeight: 800, fontSize: 15, cursor: cursors.clickable, boxShadow: shadows.float }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" stroke={colors.accentPrimary} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('export.use_this_view')}
              </motion.button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
