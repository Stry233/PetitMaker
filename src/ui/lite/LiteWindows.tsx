import { lazy, Suspense, useCallback } from 'react';
import { useT } from '../../i18n/context';
import { RenderBoundary } from '../primitives/RenderBoundary';
import { useLatch } from '../primitives/use-latch';
import { ChunkNotice } from '../chrome/guards/FailureNotice';
import { showToast } from '../../platform/channels/toast-bus';
import { useEditorStore } from '../../state/store';
import { EditorWindows, type PlanetChange } from '../shell/windows/EditorWindows';
import { transferLoss } from '../shell/windows/planet-arrival';
import { LiteShareWindow } from './LiteShareWindow';

const ImportModal = lazy(() => import('../chrome/modals/import/ImportModal').then(m => ({ default: m.ImportModal })));

export function LiteWindows() {
  const t = useT();
  const importOpen = useEditorStore(s => s.modals.import);
  const importMounted = useLatch(importOpen);
  // The edition has no arrival card, so a toast says what the carry left behind.
  const reportPlanetChange = useCallback((outcome: PlanetChange) => {
    const loss = outcome ? transferLoss(outcome) : null;
    if (loss) showToast(t(loss.key, loss.params));
  }, [t]);
  return <>
    <EditorWindows onPlanetChanged={reportPlanetChange} />
    {/* Preserve the import card through its closing animation. */}
    {importMounted && <RenderBoundary resetKey={importOpen} fallback={<ChunkNotice />}>
      <Suspense fallback={null}><ImportModal /></Suspense>
    </RenderBoundary>}
    <LiteShareWindow />
  </>;
}
