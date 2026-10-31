/*
 * The editor both editions mount: the reduced-motion and cursor gates, the locale, the input mode,
 * the dock fit, the shell around the map views and the floating chrome every edition shows. An
 * edition root supplies its map views, its session restore and the surfaces only it has.
 */
import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../i18n/context';
import { Shell } from '../shell/Shell';
import { ArrangementRoomProvider, DockRefProvider, type DockRef } from '../design/scale';
import { ARRANGEMENT_ROOM } from '../shell/panel-frame';
import { InputModeProvider } from '../design/input-mode';
import { useCursorVars } from '../design/cursors/cursor-vars';
import { useMotionEnabled } from '../session/use-motion-enabled';
import { useInputMode, useStoredLayoutShape } from '../session/use-input-mode';
import { ToastContainer } from '../chrome/floating/Toast';
import { CurveHandles } from '../chrome/floating/CurveHandles';
import { SelectionMarks } from '../chrome/floating/SelectionMarks';
import { MapLoupe } from '../chrome/floating/MapLoupe';
import { SelectionCard } from '../chrome/floating/SelectionCard';
import { AnnotationEditor } from '../chrome/floating/AnnotationEditor';
import { ContextMenu } from '../chrome/floating/ContextMenu';
import { HoldRing } from '../chrome/floating/HoldRing';
import { DeletePopover } from '../chrome/floating/DeletePopover';
import type { RestoredAutosave } from '../../io/storage/autosave';
import { installEditorSession } from '../../editor/session/install';
import { installInstalledImmersive } from '../../platform/device/installed-immersive';
import { seconds } from '../design/motion';
import { UiZoomShortcut } from './use-ui-zoom-shortcut';
import { handoffShift, HandoffStageProvider, type HandoffStage } from '../session/splash-handoff';

/**
 * The splash hand-off is two planes parting: the overlay slides up and away while this plane, the
 * whole app, slides its last stretch up into place on the same clock. The transform breaks
 * position:fixed anchoring inside the plane for exactly the boot hand-off (everything rides together,
 * which is the effect), and is removed entirely the moment the splash unmounts. A real full-viewport
 * box rather than a bare wrapper: the app's surfaces are position:fixed, so the plane must be their
 * containing block at viewport size for the translate to carry them.
 */
function planeStyle(stage: HandoffStage): CSSProperties | undefined {
  const shift = handoffShift(stage);
  return shift && { position: 'fixed', inset: 0, ...shift };
}

export function EditorRoot({ dockRef, onRestoreSession, splashActive, plane, beforeToasts, notices, after, children }: {
  /** The strip the docked panel takes, which the frame and chrome fit beside (`design/scale.tsx:DockRef`). */
  dockRef: DockRef;
  onRestoreSession: (save: RestoredAutosave) => void;
  splashActive?: boolean;
  /** Wraps the shell and its chrome in one plane that takes part in the splash's hand-off at
   *  `handoff`; omitted, they stand directly under the providers. */
  plane?: { handoff: HandoffStage };
  /** Chrome that paints before the toasts on their shared rung. */
  beforeToasts?: ReactNode;
  /** Edition notices, guards and gates, painted between the curve handles and the selection marks. */
  notices?: ReactNode;
  /** Surfaces standing outside the plane, such as the boot splash. */
  after?: ReactNode;
  /** The map views the shell stands around. */
  children: ReactNode;
}) {
  useCursorVars(); // publish the DOM cursors to <html>, which every non-canvas surface reads
  // The editor's session wiring lives as long as the editor, whichever map view is mounted.
  useEffect(() => installEditorSession({ frameFlashMs: seconds('planet.frame.flash') * 1000 }), []);
  useEffect(() => installInstalledImmersive(), []);
  // The Framer/DOM gate takes the effective value useMotionEnabled resolves for every gate.
  const reducedMotion = useMotionEnabled();
  const inputMode = useInputMode();
  const shape = useStoredLayoutShape();
  // The `?touchdebug=1` input readout is development-only: the dead branch drops its module from a production build.
  const [DevBadge, setDevBadge] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get('touchdebug') !== '1') return;
    void import('./dev/InputModeBadge').then(({ InputModeBadge }) => setDevBadge(() => InputModeBadge));
  }, []);
  const content = (
    <>
      <Shell onRestoreSession={onRestoreSession} splashActive={splashActive}>{children}</Shell>
      {beforeToasts}
      <ToastContainer />
      <CurveHandles />
      {notices}
      <SelectionMarks />
      <MapLoupe />
      <SelectionCard />
      <AnnotationEditor />
      <HoldRing />
      <ContextMenu />
      <DeletePopover />
      {DevBadge && <DevBadge />}
    </>
  );
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
      <I18nProvider>
        <InputModeProvider inputMode={inputMode} shape={shape}>
          <DockRefProvider value={dockRef}>
            <ArrangementRoomProvider value={ARRANGEMENT_ROOM}>
              <UiZoomShortcut />
              {plane ? (
                <HandoffStageProvider value={plane.handoff}>
                  <div style={planeStyle(plane.handoff)}>{content}</div>
                </HandoffStageProvider>
              ) : content}
              {after}
            </ArrangementRoomProvider>
          </DockRefProvider>
        </InputModeProvider>
      </I18nProvider>
    </MotionConfig>
  );
}
