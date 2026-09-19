import { lazy, Suspense, useCallback, useRef } from 'react';
import { useT } from '../../i18n/context';
import { ChunkBoundary } from '../primitives/ChunkBoundary';
import { showToast } from '../../core/runtime/toast-bus';
import { useEditorStore } from '../../state/store';
import { EditorWindows, type PlanetChange } from '../shell/windows/EditorWindows';
import { LiteShareWindow } from './LiteShareWindow';

const ImportModal = lazy(() => import('../chrome/modals/import/ImportModal').then(m => ({ default: m.ImportModal })));

export function LiteWindows() {
  const t = useT();
  const importOpen = useEditorStore(s => s.modals.import);
  const importSeen = useRef(false);
  if (importOpen) importSeen.current = true;
  const reportPlanetChange = useCallback((outcome: PlanetChange) => {
    if (!outcome) return;
    const { moved, dropped } = outcome;
    if (moved.cells + moved.objects === 0 && dropped.cells + dropped.objects > 0) showToast(t('arrival.transferred_lost'));
    else if (dropped.cells > 0 && dropped.objects > 0) showToast(t('arrival.transferred_both', { ...dropped }));
    else if (dropped.cells > 0) showToast(t('arrival.transferred_ground', { ...dropped }));
    else if (dropped.objects > 0) showToast(t('arrival.transferred_pieces', { ...dropped }));
  }, [t]);
  return <>
    <EditorWindows onPlanetChanged={reportPlanetChange} />
    {/* Preserve the import card through its closing animation. */}
    {importSeen.current && <ChunkBoundary resetKey={importOpen}>
      <Suspense fallback={null}><ImportModal /></Suspense>
    </ChunkBoundary>}
    <LiteShareWindow />
  </>;
}
