import { brandName } from '../../version';
import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../i18n/context';
import { localeTag } from '../../i18n/translations';
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
import { SelectionMarks } from '../chrome/floating/SelectionMarks';
import { SelectionCard } from '../chrome/floating/SelectionCard';
import { AnnotationEditor } from '../chrome/floating/AnnotationEditor';
import { ContextMenu } from '../chrome/floating/ContextMenu';
import { DeletePopover } from '../chrome/floating/DeletePopover';
import { fadeVisibilityCss } from '../design/motion';

export default function LiteApp() {
  useEffect(() => { useEditorStore.getState().setPortraitBlocked(false); }, []);
  useCursorVars();
  const reducedMotion = useMotionEnabled();
  const locale = useEditorStore(s => s.locale);
  useEffect(() => { document.title = brandName(locale); document.documentElement.lang = localeTag(locale); }, [locale]);
  const view = useEditorStore(s => s.viewMode);
  const restore = useEditorSession();
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
      <I18nProvider>
        <DockRefProvider value={0}>
          <Shell onRestoreSession={restore}>
            <div style={{ visibility: view === '3d' ? 'hidden' : 'visible' }}><PixiCanvas /></div>
            <Editor3DCanvas fade={(visible) => fadeVisibilityCss('map.view.crossfade', visible)} />
          </Shell>
          <ToastContainer />
          <CurveHandles />
          <SelectionMarks />
          <SelectionCard />
          <AnnotationEditor />
          <ContextMenu />
          <DeletePopover />
        </DockRefProvider>
      </I18nProvider>
    </MotionConfig>
  );
}
