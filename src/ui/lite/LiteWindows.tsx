import { lazy, Suspense, useCallback, useRef } from 'react';
import { useT } from '../../i18n/context';
import { ChunkBoundary } from '../primitives/ChunkBoundary';
import { ChunkNotice } from '../chrome/guards/ChunkNotice';
import { showToast } from '../../platform/channels/toast-bus';
import { useEditorStore } from '../../state/store';
import { EditorWindows, type PlanetChange } from '../shell/windows/EditorWindows';
import { transferLoss } from '../shell/windows/planet-arrival';
import { LiteShareWindow } from './LiteShareWindow';

const ImportModal = lazy(() => import('../chrome/modals/import/ImportModal').then(m => ({ default: m.ImportModal })));

export function LiteWindows() {
  const t = useT();
  const importOpen = useEditorStore(s => s.modals.import);
  const importSeen = useRef(false);
  if (importOpen) importSeen.current = true;
  // The edition has no arrival card, so a toast says what the carry left behind.
  const reportPlanetChange = useCallback((outcome: PlanetChange) => {
    const loss = outcome ? transferLoss(outcome) : null;
    if (loss) showToast(t(loss.key, loss.params));
  }, [t]);
  return <>
    <EditorWindows onPlanetChanged={reportPlanetChange} />
    {/* Preserve the import card through its closing animation. */}
    {importSeen.current && <ChunkBoundary resetKey={importOpen} fallback={<ChunkNotice />}>
      <Suspense fallback={null}><ImportModal /></Suspense>
    </ChunkBoundary>}
    <LiteShareWindow />
  </>;
}
