import { brandName } from '../../version';
import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { PixiCanvas } from '../../canvas/map2d/PixiCanvas';
import { Editor3DCanvas } from '../../canvas/map3d/Editor3DCanvas';
import { Shell } from '../shell/Shell';
import { DockRefProvider } from '../design/scale';
import { useCursorVars } from '../design/cursors/cursor-vars';
import { useMotionEnabled } from '../hooks/useMotionEnabled';
import { useEditorSession } from '../hooks/use-editor-session';
import { ToastContainer } from '../chrome/floating/Toast';
import { CurveHandles } from '../chrome/floating/CurveHandles';
import { SelectionHandles } from '../chrome/floating/SelectionHandles';
import { AnnotationEditor } from '../chrome/floating/AnnotationEditor';
import { ContextMenu } from '../chrome/floating/ContextMenu';
import { DeletePopover } from '../chrome/floating/DeletePopover';

export default function LiteApp() {
  useEffect(() => { useEditorStore.getState().setPortraitBlocked(false); }, []);
  useCursorVars();
  useMotionEnabled();
  const locale = useEditorStore(s => s.locale);
  useEffect(() => { document.title = brandName(locale); document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale; }, [locale]);
  const motion = useEditorStore(s => s.motionPref);
  const view = useEditorStore(s => s.viewMode);
  const restore = useEditorSession();
  return (
    <MotionConfig reducedMotion={motion === 'reduced' ? 'always' : motion === 'full' ? 'never' : 'user'}>
      <I18nProvider>
        <DockRefProvider value={0}>
          <Shell onRestoreSession={restore}>
            <div style={{ visibility: view === '3d' ? 'hidden' : 'visible' }}><PixiCanvas /></div>
            <Editor3DCanvas />
          </Shell>
          <ToastContainer />
          <CurveHandles />
          <SelectionHandles />
          <AnnotationEditor />
          <ContextMenu />
          <DeletePopover />
        </DockRefProvider>
      </I18nProvider>
    </MotionConfig>
  );
}
