import { Suspense, lazy, useCallback } from 'react';
import type { MapTemplate } from '../../../core/model/types';
import type { PlanetEntry } from '../../../io/storage/planet-library';
import { useCanStartPlanetEditing } from '../planet/use-planet-session';
import { startPlanetEditing } from '../../../editor/session/planet-editing';
import { assistantJobRunning, loadHelpModal, loadWhatsThisLayer, useContextHelp } from '../edition-surfaces';
import type { PlanetDraft } from '../../../editor/operations/planet-session';
import { switchPlanet, type PlanetChange } from '../../../editor/session/planet-switch';
import { useEditorStore } from '../../../state/store';
import { ChunkBoundary } from '../../primitives/ChunkBoundary';
import { ChunkNotice } from '../../chrome/guards/ChunkNotice';
import { AboutModal } from '../../chrome/modals/about/AboutModal';
import { KeyboardModal } from '../../chrome/modals/keyboard/KeyboardModal';
import { ChangePlanetModal } from '../../chrome/modals/planet/ChangePlanetModal';
import { SettingsModal } from '../../chrome/modals/settings/SettingsModal';
import { AnnotationDiscardModal } from '../../chrome/modals/AnnotationDiscardModal';
import { ChunkLoadWindow } from '../../chrome/modals/load/ChunkLoadWindow';
import { useLatch } from '../../primitives/use-latch';
import { loadPreview3D } from '../../chrome/loaders';

const Preview3D = lazy(() => loadPreview3D().then(m => ({ default: m.Preview3D })));
const HelpModal = lazy(() => loadHelpModal().then(m => ({ default: m.HelpModal })));
const WhatsThisLayer = lazy(() => loadWhatsThisLayer().then(m => ({ default: m.WhatsThisLayer })));

export type { PlanetChange };

/** Shared window wiring; each host owns its transfer feedback and delivery surfaces. */
export function EditorWindows({ onPlanetChanged }: { onPlanetChanged: (outcome: PlanetChange) => void }) {
  useContextHelp();
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);
  const whatsThis = useEditorStore((s) => s.whatsThis);
  // Keep Help mounted after its first use so closing can finish the card animation.
  const helpMounted = useLatch(modals.help || whatsThis);


  const onSwitchPlanet = useCallback((target: string | MapTemplate, carry: boolean) => {
    const outcome = switchPlanet(target, carry);
    setModal('newProject', false);
    onPlanetChanged(outcome);
  }, [setModal, onPlanetChanged]);

  // A refused entry leaves the window standing.
  const onEditPlanet = useCallback((entry: PlanetEntry | PlanetDraft | null) => {
    if (startPlanetEditing(entry, assistantJobRunning())) setModal('newProject', false);
  }, [setModal]);

  const canEditPlanet = useCanStartPlanetEditing();

  // Leaving or finishing a planet session comes back to Change Planet with that planet chosen.
  const returnChosen = useEditorStore((s) => s.planetReturn?.chosen ?? undefined);

  return (
    <>
      <ChangePlanetModal
        onSwitch={onSwitchPlanet}
        onEditPlanet={onEditPlanet}
        canEditPlanet={canEditPlanet}
        takesHandedFiles
        {...(returnChosen ? { initialChosen: returnChosen } : {})}
      />

      <SettingsModal />

      <KeyboardModal />

      {helpMounted && (
        <ChunkBoundary resetKey={modals.help || whatsThis} fallback={<ChunkNotice />}>
          <Suspense fallback={null}>
            <HelpModal />
            <WhatsThisLayer />
          </Suspense>
        </ChunkBoundary>
      )}

      <AboutModal />

      <ChunkLoadWindow />
      <AnnotationDiscardModal />

      {modals.preview3d && (
        <ChunkBoundary resetKey={modals.preview3d} fallback={<ChunkNotice />}>
          <Suspense fallback={null}>
            <Preview3D onClose={() => setModal('preview3d', false)} />
          </Suspense>
        </ChunkBoundary>
      )}

    </>
  );
}
