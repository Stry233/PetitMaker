/*
 * The editor both editions mount: the reduced-motion and cursor gates, the locale, the dock fit, the
 * shell around the map views and the floating chrome every edition shows. An edition root supplies
 * its map views, its session restore and the surfaces only it has.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../i18n/context';
import { Shell } from '../shell/Shell';
import { DockRefProvider } from '../design/scale';
import { useCursorVars } from '../design/cursors/cursor-vars';
import { useMotionEnabled } from '../session/use-motion-enabled';
import { ToastContainer } from '../chrome/floating/Toast';
import { CurveHandles } from '../chrome/floating/CurveHandles';
import { SelectionMarks } from '../chrome/floating/SelectionMarks';
import { SelectionCard } from '../chrome/floating/SelectionCard';
import { AnnotationEditor } from '../chrome/floating/AnnotationEditor';
import { ContextMenu } from '../chrome/floating/ContextMenu';
import { DeletePopover } from '../chrome/floating/DeletePopover';
import type { RestoredAutosave } from '../../io/storage/autosave';
import { installEditorSession } from '../../editor/session/install';
import { seconds } from '../design/motion';
import { useUiZoomShortcut } from './use-ui-zoom-shortcut';

export function EditorRoot({ dockRef, onRestoreSession, splashActive, plane, beforeToasts, notices, after, children }: {
  /** The docked panel's reference width the frame and chrome fit beside (`design/scale.tsx:frameFit`). */
  dockRef: number;
  onRestoreSession: (save: RestoredAutosave) => void;
  splashActive?: boolean;
  /** Wraps the shell and its chrome in one plane with this style (`undefined` for a bare plane);
   *  omitted, they stand directly under the providers. */
  plane?: { style: CSSProperties | undefined };
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
  useUiZoomShortcut();
  // The editor's session wiring lives as long as the editor, whichever map view is mounted.
  useEffect(() => installEditorSession({ frameFlashMs: seconds('planet.frame.flash') * 1000 }), []);
  // The Framer/DOM gate takes the effective value useMotionEnabled resolves for every gate.
  const reducedMotion = useMotionEnabled();
  const content = (
    <>
      <Shell onRestoreSession={onRestoreSession} splashActive={splashActive}>{children}</Shell>
      {beforeToasts}
      <ToastContainer />
      <CurveHandles />
      {notices}
      <SelectionMarks />
      <SelectionCard />
      <AnnotationEditor />
      <ContextMenu />
      <DeletePopover />
    </>
  );
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
      <I18nProvider>
        <DockRefProvider value={dockRef}>
          {plane ? <div style={plane.style}>{content}</div> : content}
          {after}
        </DockRefProvider>
      </I18nProvider>
    </MotionConfig>
  );
}
