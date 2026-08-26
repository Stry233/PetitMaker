/*
 * Windows.tsx — every window this shell can open, mounted and wired.
 *
 * Five of them are the menu's own rows (About, Change a planet, Import, Keyboard, Settings) and are
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
import type { Arrival, ArrivalLine } from '../../../core/runtime/arrival-bus';
import { announceArrival } from '../../../core/runtime/arrival-bus';
import { currentKit } from '../../../kit/context';
import type { TransferCounts } from '../../../kit/operations';
import { newMap, transferMap } from '../../../kit/operations';
import { useEditorStore } from '../../../state/store';
import { AboutModal } from '../../chrome/modals/AboutModal';
import { ChunkLoadWindow } from './ChunkLoadWindow';
import { ShareWindow } from './ShareWindow';
import { ImportModal } from '../../chrome/modals/import/ImportModal';
import { DropImportOverlay } from '../../chrome/modals/import/DropImportOverlay';
import { KeyboardModal } from '../../chrome/modals/keyboard/KeyboardModal';
import { ChangePlanetModal } from '../../chrome/modals/ChangePlanetModal';
import { SettingsModal } from '../../chrome/modals/SettingsModal';

// The shots editor is the three.js scene, so it stays out of the main bundle and is mounted only
// while it is open — unlike its five siblings, it has no card exit of its own to protect.
const Preview3D = lazy(() => import('../../chrome/modals/export/Preview3D').then((m) => ({ default: m.Preview3D })));

/** The line that says the build travelled. Stands ALONE: what came along and what did not are two
 *  facts, and a row of the notice says one thing. */
const CAME_ALONG: ArrivalLine = { key: 'arrival.transferred' };

/**
 * What the arrival notice says about a transfer, as the lines it says in turn.
 *
 * ONE FACT PER LINE. The build came along; then, only if something did not, what was left behind.
 * Chained into one row those became a sentence read over a map, which is a sentence not read at all.
 *
 * GROUND AND PIECES ARE COUNTED APART and named apart, inside the loss line. They are not the same
 * noun and not the same scale: a moved coastline routinely costs a couple of hundred terrain cells
 * while every object arrives, and one number over both would report that as "we removed 174" against
 * a card that counts pieces. Only what was actually lost is named, and a transfer that lost nothing
 * says the first line and stops.
 */
export function transferLines(dropped: TransferCounts): readonly ArrivalLine[] {
  const { cells, objects } = dropped;
  if (cells > 0 && objects > 0) return [CAME_ALONG, { key: 'arrival.transferred_both', params: { cells, objects } }];
  if (cells > 0) return [CAME_ALONG, { key: 'arrival.transferred_ground', params: { cells } }];
  if (objects > 0) return [CAME_ALONG, { key: 'arrival.transferred_pieces', params: { objects } }];
  return [CAME_ALONG];
}

/** A build that went and did not land, in two lines: what the coast did, and what became of the
 *  build. The fact stands on its own row LAST, where it is what the notice is left saying. */
const NOTHING_ARRIVED: readonly ArrivalLine[] = [
  { key: 'arrival.transferred_lost' },
  { key: 'arrival.transferred_lost_none' },
];

/**
 * Which arrival a finished transfer is.
 *
 * "YOUR BUILD CAME ALONG" IS ABOUT WHAT TRAVELLED, NOT ABOUT WHICH BUTTON WAS PRESSED, and nothing
 * travelling has two very different causes. An island with nothing on it is an ordinary arrival on
 * a new planet and says so. A build that went and did not land is the moment the report exists for,
 * and it gets a line that says what happened rather than the greeting for a journey nothing made.
 */
export function transferArrival(outcome: { moved: TransferCounts; dropped: TransferCounts }): Arrival {
  const { moved, dropped } = outcome;
  if (moved.cells + moved.objects > 0) return { kind: 'transferred', detail: transferLines(dropped) };
  if (dropped.cells + dropped.objects > 0) return { kind: 'transferred', detail: NOTHING_ARRIVED };
  return { kind: 'boot' };
}

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
  const quality3d = useEditorStore((s) => s.quality3d);
  const setQuality3d = useEditorStore((s) => s.setQuality3d);

  // A planet chosen here is an arrival: the notice says which one it was, and what became of the
  // build if it came along. The announcement is made from the window rather than from a watcher over
  // the live map, because a template replaced by another of the same shape is not a change anything
  // downstream can see.
  const onSwitchPlanet = useCallback((templateId: string, carry: boolean) => {
    const kit = carry ? currentKit() : null;
    if (kit) {
      const outcome = transferMap(kit, { target: templateId, carry: true });
      setEditMode({ mode: null });
      setModal('newProject', false);
      announceArrival(transferArrival(outcome));
      return;
    }
    newMap(templateId);
    setEditMode({ mode: null });
    setModal('newProject', false);
    announceArrival({ kind: 'boot' });
  }, [setEditMode, setModal]);

  return (
    <>
      <ChangePlanetModal
        open={modals.newProject}
        onSwitch={onSwitchPlanet}
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
