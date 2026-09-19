import { useContextHelp } from '../../chrome/modals/help/use-context-help';
import { Suspense, lazy, useCallback, useRef } from 'react';
import { currentKit } from '../../../kit/context';
import { newMap, transferMap } from '../../../kit/operations';
import { useEditorStore } from '../../../state/store';
import { ChunkBoundary } from '../../primitives/ChunkBoundary';
import { AboutModal } from '../../chrome/modals/AboutModal';
import { KeyboardModal } from '../../chrome/modals/keyboard/KeyboardModal';
import { ChangePlanetModal } from '../../chrome/modals/ChangePlanetModal';
import { SettingsModal } from '../../chrome/modals/SettingsModal';
import { ChunkLoadWindow } from './ChunkLoadWindow';

const Preview3D = lazy(() => import('../../chrome/modals/export/Preview3D').then(m => ({ default: m.Preview3D })));
const HelpModal = lazy(() => import('../../chrome/modals/help/HelpModal').then(m => ({ default: m.HelpModal })));
const WhatsThisLayer = lazy(() => import('../../chrome/modals/help/WhatsThisLayer').then(m => ({ default: m.WhatsThisLayer })));

export type PlanetChange = ReturnType<typeof transferMap> | null;

/** Shared window wiring; each host owns its transfer feedback and delivery surfaces. */
export function EditorWindows({ onPlanetChanged }: { onPlanetChanged: (outcome: PlanetChange) => void }) {
  useContextHelp();
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const whatsThis = useEditorStore((s) => s.whatsThis);
  // Keep Help mounted after its first use so closing can finish the card animation.
  const helpEver = useRef(false);
  if (modals.help || whatsThis) helpEver.current = true;
  const helpMounted = helpEver.current;

  const locale = useEditorStore((s) => s.locale);
  const setLocale = useEditorStore((s) => s.setLocale);
  const showGrid = useEditorStore((s) => s.showGrid);
  const setShowGrid = useEditorStore((s) => s.setShowGrid);
  const showChunkBounds = useEditorStore((s) => s.showChunkBounds);
  const setShowChunkBounds = useEditorStore((s) => s.setShowChunkBounds);
  const motionPref = useEditorStore((s) => s.motionPref);
  const setMotionPref = useEditorStore((s) => s.setMotionPref);
  const systemCursors = useEditorStore((s) => s.systemCursors);
  const setSystemCursors = useEditorStore((s) => s.setSystemCursors);
  const quality3d = useEditorStore((s) => s.quality3d);
  const setQuality3d = useEditorStore((s) => s.setQuality3d);

  const onSwitchPlanet = useCallback((templateId: string, carry: boolean) => {
    const kit = carry ? currentKit() : null;
    const outcome = kit ? transferMap(kit, { target: templateId, carry: true }) : null;
    if (!outcome) newMap(templateId);
    setEditMode({ mode: null });
    setModal('newProject', false);
    onPlanetChanged(outcome);
  }, [setEditMode, setModal, onPlanetChanged]);

  return (
    <>
      <ChangePlanetModal
        open={modals.newProject}
        onSwitch={onSwitchPlanet}
        onClose={() => setModal('newProject', false)}
      />

      <SettingsModal
        open={modals.settings}
        locale={locale}
        showGrid={showGrid}
        showChunks={showChunkBounds}
        motionPref={motionPref}
        systemCursors={systemCursors}
        quality3d={quality3d}
        onLocaleChange={setLocale}
        onShowGridChange={setShowGrid}
        onShowChunksChange={setShowChunkBounds}
        onMotionPrefChange={setMotionPref}
        onSystemCursorsChange={setSystemCursors}
        onQuality3dChange={setQuality3d}
        onAbout={() => setModal('about', true)}
        onClose={() => setModal('settings', false)}
      />

      <KeyboardModal open={modals.keyboard} onClose={() => setModal('keyboard', false)} />

      {helpMounted && (
        <ChunkBoundary resetKey={modals.help || whatsThis}>
          <Suspense fallback={null}>
            <HelpModal open={modals.help} onClose={() => setModal('help', false)} />
            <WhatsThisLayer />
          </Suspense>
        </ChunkBoundary>
      )}

      <AboutModal open={modals.about} onClose={() => setModal('about', false)} />

      <ChunkLoadWindow />

      {modals.preview3d && (
        <ChunkBoundary resetKey={modals.preview3d}>
          <Suspense fallback={null}>
            <Preview3D onClose={() => setModal('preview3d', false)} />
          </Suspense>
        </ChunkBoundary>
      )}

    </>
  );
}
