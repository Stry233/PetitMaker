import { Suspense, lazy, useEffect } from 'react';
import { announceArrival } from '../../../core/runtime/arrival-bus';
import { useEditorStore } from '../../../state/store';
import { ChunkBoundary } from '../../primitives/ChunkBoundary';
import { WhatsNewModal } from '../../chrome/modals/whats-new/WhatsNewModal';
import { ImportModal } from '../../chrome/modals/import/ImportModal';
import { DropImportOverlay } from '../../chrome/modals/import/DropImportOverlay';
import { ShareWindow } from './ShareWindow';
import { EditorWindows, type PlanetChange } from './EditorWindows';
import { transferArrival } from './planet-arrival';

const StylizeWindow = lazy(() => import('../../chrome/modals/export/stylize/StylizeWindow').then(m => ({ default: m.StylizeWindow })));

function announcePlanetChange(outcome: PlanetChange): void {
  announceArrival(outcome ? transferArrival(outcome) : { kind: 'boot' });
}

function useWarmHelpChunk(): void {
  useEffect(() => {
    // A warm-up that fails is not the visitor's problem; opening Help reports its own failure.
    const warm = () => { void import('../../chrome/modals/help/HelpModal').catch(() => {}); };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm, { timeout: 6000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 2500);
    return () => clearTimeout(t);
  }, []);
}

export function Windows() {
  useWarmHelpChunk();
  const stylize = useEditorStore(s => s.modals.stylize);
  const setModal = useEditorStore(s => s.setModal);
  return <>
    <EditorWindows onPlanetChanged={announcePlanetChange} />
    <ImportModal />
    <DropImportOverlay />
    <WhatsNewModal />
    <ShareWindow />
    {stylize && <ChunkBoundary resetKey={stylize}>
      <Suspense fallback={null}>
        <StylizeWindow onClose={() => setModal('stylize', false)} />
      </Suspense>
    </ChunkBoundary>}
  </>;
}
