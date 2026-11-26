import { lazy } from 'react';
import { useEditorStore } from '../../../state/store';
import { useOpenCount } from '../../primitives/use-open-count';
import { WhatsNewModal } from '../../chrome/modals/whats-new/WhatsNewModal';
import { ImportModal } from '../../chrome/modals/import/ImportModal';
import { DropImportOverlay } from '../../chrome/modals/import/DropImportOverlay';
import { ShareWindow } from '../../chrome/modals/export/ShareWindow';
import { EditorWindows } from './EditorWindows';
import { LazyWindow } from './LazyWindow';
import { loadStylizeWindow } from '../edition-surfaces';
import { StylizeEntry } from '../../chrome/modals/export/stylize/StylizeEntry';

const StylizeWindow = lazy(() => loadStylizeWindow().then(m => ({ default: m.StylizeWindow })));

export function Windows() {
  const stylize = useEditorStore(s => s.modals.stylize);
  // Each opening is a fresh window, even one landing while the last close is still leaving.
  const stylizeSession = useOpenCount(stylize);
  return <>
    <EditorWindows />
    <ImportModal />
    <DropImportOverlay />
    <WhatsNewModal />
    <ShareWindow artStyle={<StylizeEntry />} />
    <LazyWindow open={stylize} keep>
      <StylizeWindow key={stylizeSession} open={stylize} />
    </LazyWindow>
  </>;
}
