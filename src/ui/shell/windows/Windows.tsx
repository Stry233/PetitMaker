/*
 * Windows.tsx — every window this shell can open, mounted and wired.
 *
 * Five of them are the menu's own rows (About, Import, Keyboard, New project, Settings) and are
 * general chrome (`ui/chrome/modals/`), reached from anywhere; Share and the chunk-load reading are
 * this shell's and sit beside this file. Each one places itself, so this file is only wiring — which
 * store field it reads and writes. Every one of them stays MOUNTED and is driven by `open`, because
 * `ModalShell` animates the card's enter and exit as one unit and a wholesale unmount would cut the
 * exit.
 *
 * `DropImportOverlay` rides along with the Import window: it is the same import, reached by dropping
 * a file on the app instead of opening the window first, and it no-ops while the window is open.
 */
import { Suspense, lazy, useCallback } from 'react';
import { newMap } from '../../../kit/operations';
import { useEditorStore } from '../../../state/store';
import { AboutModal } from '../../chrome/modals/AboutModal';
import { ChunkLoadWindow } from './ChunkLoadWindow';
import { ShareWindow } from './ShareWindow';
import { ImportModal } from '../../chrome/modals/import/ImportModal';
import { DropImportOverlay } from '../../chrome/modals/import/DropImportOverlay';
import { KeyboardModal } from '../../chrome/modals/keyboard/KeyboardModal';
import { NewProjectModal } from '../../chrome/modals/NewProjectModal';
import { SettingsModal } from '../../chrome/modals/SettingsModal';

// The shots editor is the three.js scene, so it stays out of the main bundle and is mounted only
// while it is open — unlike its five siblings, it has no card exit of its own to protect.
const Preview3D = lazy(() => import('../../chrome/modals/export/Preview3D').then((m) => ({ default: m.Preview3D })));

export function Windows() {
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);
  const setEditMode = useEditorStore((s) => s.setEditMode);

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

  const onNewProject = useCallback((templateId: string) => {
    newMap(templateId);
    setEditMode({ mode: null });
    setModal('newProject', false);
  }, [setEditMode, setModal]);

  return (
    <>
      <NewProjectModal
        open={modals.newProject}
        onSelect={onNewProject}
        onClose={() => setModal('newProject', false)}
      />

      <ImportModal />
      <DropImportOverlay />

      <SettingsModal
        open={modals.settings}
        locale={locale}
        showGrid={showGrid}
        showChunks={showChunkBounds}
        motionPref={motionPref}
        systemCursors={systemCursors}
        onLocaleChange={setLocale}
        onShowGridChange={setShowGrid}
        onShowChunksChange={setShowChunkBounds}
        onMotionPrefChange={setMotionPref}
        onSystemCursorsChange={setSystemCursors}
        onAbout={() => setModal('about', true)}
        onClose={() => setModal('settings', false)}
      />

      <KeyboardModal open={modals.help} onClose={() => setModal('help', false)} />

      <AboutModal open={modals.about} onClose={() => setModal('about', false)} />

      <ShareWindow />

      <ChunkLoadWindow />

      {modals.preview3d && (
        <Suspense fallback={null}>
          <Preview3D onClose={() => setModal('preview3d', false)} />
        </Suspense>
      )}
    </>
  );
}
