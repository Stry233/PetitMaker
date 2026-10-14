import { Suspense, lazy } from 'react';
import { announceArrival } from '../../session/arrival-bus';
import { useEditorStore } from '../../../state/store';
import { ChunkBoundary } from '../../primitives/ChunkBoundary';
import { ChunkNotice } from '../../chrome/guards/ChunkNotice';
import { WhatsNewModal } from '../../chrome/modals/whats-new/WhatsNewModal';
import { ImportModal } from '../../chrome/modals/import/ImportModal';
import { DropImportOverlay } from '../../chrome/modals/import/DropImportOverlay';
import { ShareWindow } from '../../chrome/modals/export/ShareWindow';
import { EditorWindows, type PlanetChange } from './EditorWindows';
import { transferArrival } from './planet-arrival';
import { loadStylizeWindow } from '../edition-surfaces';

const StylizeWindow = lazy(() => loadStylizeWindow().then(m => ({ default: m.StylizeWindow })));

function announcePlanetChange(outcome: PlanetChange): void {
  announceArrival(outcome ? transferArrival(outcome) : { kind: 'boot' });
}

export function Windows() {
  const stylize = useEditorStore(s => s.modals.stylize);
  return <>
    <EditorWindows onPlanetChanged={announcePlanetChange} />
    <ImportModal />
    <DropImportOverlay />
    <WhatsNewModal />
    <ShareWindow />
    {stylize && <ChunkBoundary resetKey={stylize} fallback={<ChunkNotice />}>
      <Suspense fallback={null}>
        <StylizeWindow />
      </Suspense>
    </ChunkBoundary>}
  </>;
}
