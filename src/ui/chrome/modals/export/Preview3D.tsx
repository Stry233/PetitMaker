import { helpTargetAttr } from '../../../session/help-targets';
import { ActionButton } from '../../../primitives/ActionButton';
import { showToast } from '../../../../platform/channels/toast-bus';
import { SUPPORTS_DOWNLOADS } from '../../../../platform/build/edition';
/**
 * Full-screen 3D preview overlay. Mounts a MapRenderer3D from the current GridState
 * snapshot, owns its entrance/exit motion (Quiet Toybox: scale-in via springs,
 * ease-out exit), and tears the scene down on unmount. Dismiss with Esc or the
 * close button. Respects prefers-reduced-motion.
 */
import { useChromeScale, useViewportSize } from '../../../design/scale';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useCameraOnly } from '../../../../view/interaction/use-camera-only';
import { useHeldPan } from '../../../../view/interaction/use-view-shortcuts';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { useEditorStore } from '../../../../state/store';
import { useT } from '../../../../i18n/context';
import { font, shadows, radii, cursors, z } from '../../../design/styles';
import { CANVAS_GREEN, ON_DARK, rgbaOf } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { roleFont } from '../../../design/text-weight';
import { downloadView3d } from '../../../../editor/export/files';
import { MapRenderer3D } from '../../../../view/map3d/scene/map-renderer';
import { replaceShot } from '../../../../view/map3d/capture/shot-list';
import { CARD_3D_CELL_ASPECT } from '../../../../io/export/facts';
import { NO_MOTION, framerMotion } from '../../../design/motion';
import { SurfaceOwner, useSurfaceScope } from '../../../primitives/surface-scope';
import { useEffectEvent } from '../../../primitives/use-effect-event';

// Cozy float button, matching the zoom/history controls idiom (dark glyph on a
// cream squircle with the espresso float shadow). Stacked top-right of the view.
function floatBtn(top: number): CSSProperties {
  return {
    position: 'absolute', top, right: 18, width: 46, height: 46, borderRadius: radii.field,
    background: skin.plate, color: skin.ink, border: 'none', cursor: cursors.clickable,
    boxShadow: shadows.float, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: font.family, fontWeight: 900, fontSize: 24, lineHeight: 1, WebkitTapHighlightColor: 'transparent',
  };
}

export function Preview3D({ onClose }: { onClose: () => void }) {
  const chrome = useChromeScale();
  const { w: windowW, h: windowH } = useViewportSize();
  const t = useT();
  const reduced = useReducedMotionConfig();
  const [visible, setVisible] = useState(true);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MapRenderer3D | null>(null);
  const gridState = useEditorStore.getState().gridState;
  // When set, this overlay is editing an export 3D-shot: seed the camera to that shot's angle and
  // show the Use-this-view / Cancel bar. Read reactively so the bar renders; the seeding reads the
  // value at mount (it is set before the overlay opens).
  const edit = useEditorStore((s) => s.preview3DEdit);

  const onPerformanceLimit = useEffectEvent(() => { showToast(t('view3d.unavailable'), 'error'); onClose(); });
  // Mount the three.js scene once, against the host div.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !gridState) return;
    const scene = new MapRenderer3D(host, gridState);
    scene.onPerformanceLimit = onPerformanceLimit;
    sceneRef.current = scene;
    // Edit mode: jump straight to the shot's angle instead of the intro fly-in, so the user tweaks
    // from where the thumbnail was framed.
    const ed = useEditorStore.getState().preview3DEdit;
    if (ed) {
      scene.skipIntroAndRender();
      scene.captureFromAngle(ed.angle);
    }
    return () => { scene.destroy(); sceneRef.current = null; };
  }, [gridState]);

  // Camera-only surface: the editor's gestures and the editor's cursors, minus the tools. Right
  // or middle drag orbits, left drags pan, the wheel dollies — the same reflexes as the 3D editor,
  // because they are the same module.
  useCameraOnly(hostRef, useCallback(() => sceneRef.current?.cameraVerbs() ?? null, []), visible);

  // The foreground surface while it stands: Escape puts it away (through its exit animation) and
  // focus stays inside it.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scope = useSurfaceScope({ open: visible, root: surfaceRef, onClose: () => setVisible(false), focus: 'contain' });

  // The user's pan keys walk the camera here too. This overlay is the foreground, so it pans even
  // though the export modal behind it holds the overlay lock that suppresses the editor's.
  useHeldPan(
    useCallback((dx: number, dy: number) => { sceneRef.current?.cameraVerbs().pan(dx, dy); }, []),
    useCallback(() => visible, [visible]),
  );

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

  // Save a PNG of the current 3D framing, decoding the capture's data: URL to a Blob.
  const onCapture = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    // In edit mode the download is the framed slice (matches the viewfinder + the
    // exported shot); otherwise it's the whole view.
    const editing = !!useEditorStore.getState().preview3DEdit;
    const url = editing ? scene.captureFramed(CARD_3D_CELL_ASPECT) : scene.captureImage();
    if (!url) return;
    downloadView3d(url);
  };

  return (
    <AnimatePresence onExitComplete={() => { useEditorStore.getState().setPreview3DEdit(null); onClose(); }}>
      {visible && (
        <motion.div
          key="preview3d"
          ref={surfaceRef}
          tabIndex={-1}
          {...helpTargetAttr('share', 'share-shots')}
          role="dialog"
          aria-label={t('view3d.preview_title')}
          initial={reduced ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0, transition: NO_MOTION } : { opacity: 0, scale: 0.98, transition: framerMotion('surface.leave') }}
          transition={framerMotion('surface.arrive')}
          style={{
            position: 'fixed', inset: 0, zIndex: z.takeover,
            background: CANVAS_GREEN, overflow: 'hidden',
          }}
       >
          {/* WebGL host fills the surface; the scene appends its canvas here. The scene
              renders the whole view so there's context around the frame. */}
          <div ref={hostRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
          <SurfaceOwner.Provider value={scope}>

          {/* Edit mode viewfinder. The export re-renders the shot at
              CARD_3D_CELL_ASPECT with the same vertical FOV as this full-screen view,
              so the exported still is exactly the full-HEIGHT, centre-WIDTH slice of
              what's on screen. The frame marks that slice (largest centred box of the
              cell's aspect → full height for a wide screen) and dims the rest; the
              download (onCapture) crops to the same region. */}
          {edit && gridState && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              {/* Largest centred box of the cell's aspect that fits the viewport
                  (a contain rect): width = the smaller of the full width or the
                  aspect-scaled full height, so it never balloons to full screen on
                  a window narrower than the cell aspect. */}
              <div style={{ width: Math.min(windowW, CARD_3D_CELL_ASPECT * windowH), aspectRatio: String(CARD_3D_CELL_ASPECT), boxSizing: 'border-box', borderRadius: radii.md, border: `2px solid ${rgbaOf(ON_DARK, 0.92)}`, boxShadow: shadows.spotlight }} />
            </div>
          )}

          {/* exit — cozy float button. */}
          <ActionButton
            onClick={close}
            aria-label={t('view3d.preview_close')}
            title={t('view3d.preview_close')}
            interaction="tile"
            style={{ ...floatBtn(18), zoom: chrome }}
         >
            <span aria-hidden>×</span>
          </ActionButton>

          {/* save a PNG of the current framing */}
          {gridState && SUPPORTS_DOWNLOADS && (
            <ActionButton
              onClick={onCapture}
              aria-label={t('menu.image')}
              title={t('menu.image')}
              interaction="tile"
              style={{ ...floatBtn(74), zoom: chrome }}
           >
              <span aria-hidden>⤓</span>
            </ActionButton>
          )}

          {!gridState && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', ...font.h2, color: skin.ink,
            }}>
              {t('view3d.preview_empty')}
            </div>
          )}

          {/* Edit mode: orbit freely, then commit this framing to the export shot. Dismissing
              without committing (the × close button / Esc) keeps the shot's previous angle. */}
          {edit && gridState && (
            <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', gap: 10, zoom: chrome }}>
              <ActionButton onClick={useThisView} interaction="tile"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: skin.ink, color: skin.plate, border: 'none', borderRadius: radii.md, padding: '10px 20px', fontFamily: font.family, ...roleFont('action'), cursor: cursors.clickable, boxShadow: shadows.float }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 13l4 4L19 7" stroke={skin.active} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t('export.use_this_view')}
              </ActionButton>
            </div>
          )}
          </SurfaceOwner.Provider>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
