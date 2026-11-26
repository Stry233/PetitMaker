import { lazy } from 'react';
import { useCanStartPlanetEditing } from '../planet/use-planet-session';
import { loadHelpModal, loadWhatsThisLayer, useContextHelp } from '../edition-surfaces';
import { useEditorStore } from '../../../state/store';
import { AboutModal } from '../../chrome/modals/about/AboutModal';
import { KeyboardModal } from '../../chrome/modals/keyboard/KeyboardModal';
import { ChangePlanetModal } from '../../chrome/modals/planet/ChangePlanetModal';
import { SettingsModal } from '../../chrome/modals/settings/SettingsModal';
import { AnnotationDiscardModal } from '../../chrome/modals/AnnotationDiscardModal';
import { ChunkLoadWindow } from '../../chrome/modals/load/ChunkLoadWindow';
import { LandmarkRepairWindow } from '../../chrome/modals/repair/LandmarkRepairWindow';
import { loadPreview3D } from '../../chrome/loaders';
import { LazyWindow } from './LazyWindow';

const Preview3D = lazy(() => loadPreview3D().then(m => ({ default: m.Preview3D })));
const HelpModal = lazy(() => loadHelpModal().then(m => ({ default: m.HelpModal })));
const WhatsThisLayer = lazy(() => loadWhatsThisLayer().then(m => ({ default: m.WhatsThisLayer })));

/** Shared window wiring; each host owns its delivery surfaces, and says a planet switch's arrival as
 *  its edition does (`editor/session/arrival.ts`). */
export function EditorWindows() {
  useContextHelp();
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);
  const whatsThis = useEditorStore((s) => s.whatsThis);
  const canEditPlanet = useCanStartPlanetEditing();

  // Leaving or finishing a planet session comes back to Change Planet with that planet chosen.
  const returnChosen = useEditorStore((s) => s.planetReturn?.chosen ?? undefined);

  return (
    <>
      <ChangePlanetModal
        canEditPlanet={canEditPlanet}
        takesHandedFiles
        {...(returnChosen ? { initialChosen: returnChosen } : {})}
      />

      <SettingsModal />

      <KeyboardModal />

      <LazyWindow open={modals.help || whatsThis} keep>
        <HelpModal />
        <WhatsThisLayer />
      </LazyWindow>

      <AboutModal />

      <ChunkLoadWindow />
      <LandmarkRepairWindow />
      <AnnotationDiscardModal />

      <LazyWindow open={modals.preview3d}>
        <Preview3D onClose={() => setModal('preview3d', false)} />
      </LazyWindow>

    </>
  );
}
