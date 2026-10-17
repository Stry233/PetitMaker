import { brandName } from '../../i18n/terms/brand';
import { useEffect } from 'react';
import { localeTag } from '../../i18n/locale-info';
import { useEditorStore } from '../../state/store';
import { PixiCanvas } from '../../view/map2d/PixiCanvas';
import { Editor3DCanvas } from '../../view/map3d/Editor3DCanvas';
import { useEditorSession } from '../app/use-editor-session';
import { EditorRoot } from '../app/EditorRoot';
import { fadeVisibilityCss } from '../design/motion';
import { useLocale } from '../../i18n/context';

export default function LiteApp() {
  const locale = useLocale();
  useEffect(() => { document.title = brandName(locale); document.documentElement.lang = localeTag(locale); }, [locale]);
  const view = useEditorStore(s => s.viewMode);
  const restore = useEditorSession();
  return (
    <EditorRoot dockRef={0} onRestoreSession={restore}>
      <div style={{ visibility: view === '3d' ? 'hidden' : 'visible' }}><PixiCanvas /></div>
      <Editor3DCanvas fade={(visible) => fadeVisibilityCss('map.view.crossfade', visible)} />
    </EditorRoot>
  );
}
