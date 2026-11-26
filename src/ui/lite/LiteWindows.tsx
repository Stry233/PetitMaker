import { lazy, Suspense, useEffect } from 'react';
import { useT } from '../../i18n/context';
import { RenderBoundary } from '../primitives/RenderBoundary';
import { useLatch } from '../primitives/use-latch';
import { ChunkNotice } from '../chrome/guards/FailureNotice';
import { showToast } from '../../platform/channels/toast-bus';
import { useEditorStore } from '../../state/store';
import { arrivalLoss, subscribeArrival } from '../../editor/session/arrival';
import { EditorWindows } from '../shell/windows/EditorWindows';
import { LiteShareWindow } from './LiteShareWindow';
import { LinkImport } from './LinkImport';
import { SUPPORTS_PICTURE_IMPORT } from '../../platform/build/edition';

const ImportModal = lazy(() => import('../chrome/modals/import/ImportModal').then(m => ({ default: m.ImportModal })));

export function LiteWindows() {
  const t = useT();
  const importOpen = useEditorStore(s => s.modals.import);
  const importMounted = useLatch(importOpen);
  // The edition has no arrival card, so a toast says what a carry left behind.
  useEffect(() => subscribeArrival((arrival) => {
    const loss = arrivalLoss(arrival);
    if (loss) showToast(t(loss.key, loss.params));
  }), [t]);
  return <>
    <EditorWindows />
    {/* Preserve the import card through its closing animation. */}
    {SUPPORTS_PICTURE_IMPORT && importMounted && <RenderBoundary resetKey={importOpen} fallback={<ChunkNotice />}>
      <Suspense fallback={null}><ImportModal /></Suspense>
    </RenderBoundary>}
    <LiteShareWindow />
    <LinkImport />
  </>;
}
