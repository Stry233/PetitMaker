import { lazy, Suspense, useRef } from 'react';
import { useT } from '../../i18n/context';
import { ChunkBoundary } from '../primitives/ChunkBoundary';
import { showToast } from '../../core/runtime/toast-bus';
import { currentKit } from '../../kit/context';
import { newMap, transferMap } from '../../kit/operations';
import { useEditorStore } from '../../state/store';
import { ChangePlanetModal } from '../chrome/modals/ChangePlanetModal';
import { SettingsModal } from '../chrome/modals/SettingsModal';
import { KeyboardModal } from '../chrome/modals/keyboard/KeyboardModal';
import { ChunkLoadWindow } from '../shell/windows/ChunkLoadWindow';
import { LiteShareWindow } from './LiteShareWindow';
import { AboutModal } from '../chrome/modals/AboutModal';

const ImportModal = lazy(() => import('../chrome/modals/import/ImportModal').then(m => ({ default: m.ImportModal })));
const Preview3D = lazy(() => import('../chrome/modals/export/Preview3D').then(m => ({ default: m.Preview3D })));
const HelpModal = lazy(() => import('../chrome/modals/help/HelpModal').then(m => ({ default: m.HelpModal })));
const WhatsThisLayer = lazy(() => import('../chrome/modals/help/WhatsThisLayer').then(m => ({ default: m.WhatsThisLayer })));

export function LiteWindows() {
  const t = useT();
  const s = useEditorStore();
  const helpSeen = useRef(false);
  if (s.modals.help || s.whatsThis) helpSeen.current = true;
  return <>
    <ChangePlanetModal open={s.modals.newProject} onClose={() => s.setModal('newProject', false)} onSwitch={(id, carry) => {
      const kit = carry ? currentKit() : null;
      if (kit) {
        const { moved, dropped } = transferMap(kit, { target: id, carry: true });
        if (moved.cells + moved.objects === 0 && dropped.cells + dropped.objects > 0) showToast(t('arrival.transferred_lost'));
        else if (dropped.cells > 0 && dropped.objects > 0) showToast(t('arrival.transferred_both', { ...dropped }));
        else if (dropped.cells > 0) showToast(t('arrival.transferred_ground', { ...dropped }));
        else if (dropped.objects > 0) showToast(t('arrival.transferred_pieces', { ...dropped }));
      }
      else newMap(id);
      s.setEditMode({ mode: null });
      s.setModal('newProject', false);
    }} />
    <SettingsModal open={s.modals.settings} locale={s.locale} showGrid={s.showGrid} showChunks={s.showChunkBounds}
      motionPref={s.motionPref} systemCursors={s.systemCursors} quality3d={s.quality3d}
      onLocaleChange={s.setLocale} onShowGridChange={s.setShowGrid} onShowChunksChange={s.setShowChunkBounds}
      onMotionPrefChange={s.setMotionPref} onSystemCursorsChange={s.setSystemCursors} onQuality3dChange={s.setQuality3d}
      onAbout={() => s.setModal('about', true)} onClose={() => s.setModal('settings', false)} />
    <KeyboardModal open={s.modals.keyboard} onClose={() => s.setModal('keyboard', false)} />
    <ChunkLoadWindow />
    {s.modals.import && <ChunkBoundary resetKey={s.modals.import}><Suspense fallback={null}><ImportModal /></Suspense></ChunkBoundary>}
    <LiteShareWindow />
    <AboutModal open={s.modals.about} onClose={() => s.setModal('about', false)} />
    {helpSeen.current && <ChunkBoundary resetKey={s.modals.help || s.whatsThis}>
      <Suspense fallback={null}>
        <HelpModal open={s.modals.help} onClose={() => s.setModal('help', false)} />
        <WhatsThisLayer />
      </Suspense>
    </ChunkBoundary>}
    {s.modals.preview3d && <ChunkBoundary resetKey={s.modals.preview3d}>
      <Suspense fallback={null}><Preview3D onClose={() => s.setModal('preview3d', false)} /></Suspense>
    </ChunkBoundary>}
  </>;
}
