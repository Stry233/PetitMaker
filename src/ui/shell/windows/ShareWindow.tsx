/*
 * ShareWindow.tsx — what the 保存与分享 button opens: one home, three purposes.
 *
 * 自己继续 is the save file, 给朋友 the share picture, 搬进游戏 the build checklist. The first two
 * are `ExportJsonPanel` and `ExportPanel`, the same components an opener that names a section
 * reaches, carried here rather than copied so each has one implementation.
 *
 * OPENING IS THREE FLAGS, NOT ONE. `share` opens the window at its first section; `export` and
 * `exportJson` open it at theirs. Those two exist because an opener outside this shell names a
 * SECTION and knows nothing about the window around it: the agent's export tool asks for an image
 * or a file, and the new-map warning offers to save first. Closing puts all three down.
 *
 * A section MOUNTS when it is first reached and stays mounted until the window closes, so a tab
 * switch never throws away a typed title or a chosen shot. Its `open` prop is therefore the
 * WINDOW's own open state, not "this tab is showing": both panels reset themselves on that prop's
 * rising edge, and gating it per tab would wipe the save section's choices on every trip away.
 * What visiting buys is that the expensive work (the provenance scan, the share-code build, the
 * map and 3D captures) never starts for a section the user did not ask for.
 */
import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { BuildChecklist } from '../../chrome/modals/export/BuildChecklist';
import { ExportJsonPanel } from '../../chrome/modals/export/ExportJsonModal';
import { ExportPanel } from '../../chrome/modals/export/ExportModal';
import { ModalShell } from '../../primitives/ModalShell';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { useScrollFade } from '../../primitives/scroll-fade';
import { windowCard, windowTitle } from '../../design/window-skin';

export type ShareSection = 'keep' | 'friend' | 'game';
type Section = ShareSection;

const SECTIONS: readonly Section[] = ['keep', 'friend', 'game'];

const LABEL: Record<Section, string> = {
  keep: 'share.tab_keep',
  friend: 'share.tab_friend',
  game: 'share.tab_game',
};

/** The window's own head, title over the three purpose tabs: the live window turns its pages with
 *  it, and a Help figure poses the same head over the same panels. */
export function ShareWindowHead({ section, onPick }: { section: ShareSection; onPick: (s: ShareSection) => void }) {
  const t = useT();
  return (
    <>
      <div style={{ ...windowTitle, marginBottom: 12, flex: '0 0 auto' }}>{t('share.title')}</div>
      <div style={{ marginBottom: 14, flex: '0 0 auto' }}>
        <SegmentedControl<ShareSection>
          idPrefix="share-section"
          value={section}
          options={SECTIONS}
          render={(s) => t(LABEL[s])}
          onChange={onPick}
        />
      </div>
    </>
  );
}

/** Each section's own card size. The share picture needs its preview column; the other two are
 *  reading width. The card morphs between them, the same motion the About window's drill-in uses. */
const SIZE: Record<Section, { width: number; height: number }> = {
  keep: { width: 560, height: 700 },
  friend: { width: 980, height: 848 },
  game: { width: 620, height: 760 },
};

/** A section's slot. Hidden rather than unmounted, since unmounting is what would cost its state. */
function slot(showing: boolean): CSSProperties {
  return showing
    ? { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }
    : { display: 'none' };
}

export function ShareWindow() {
  const t = useT();
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);

  const open = modals.share || modals.export || modals.exportJson;
  const [section, setSection] = useState<Section>('keep');
  const [visited, setVisited] = useState<readonly Section[]>([]);

  // The section is chosen on the closed-to-open edge only: after that the tabs own it, so an
  // opener's flag still standing must not drag the user back to its section. Chosen DURING the
  // render that opens, not in an effect after it: the card takes the section's size at its first
  // frame, and an effect would have it mount at the last section's size and morph to this one
  // while the entrance is still in flight.
  const [openEdge, setOpenEdge] = useState(open);
  if (open !== openEdge) {
    setOpenEdge(open);
    if (open) {
      const first: Section = modals.export ? 'friend' : 'keep';
      setSection(first);
      setVisited([first]);
    }
  }

  const show = useCallback((next: Section) => {
    setSection(next);
    setVisited((seen) => (seen.includes(next) ? seen : [...seen, next]));
  }, []);

  const close = useCallback(() => {
    setModal('share', false);
    setModal('export', false);
    setModal('exportJson', false);
  }, [setModal]);

  const gameRef = useRef<HTMLDivElement>(null);
  const gameFade = useScrollFade(gameRef, 'y');

  return (
    <ModalShell
      open={open}
      onClose={close}
      motionSize={SIZE[section]}
      maxVw={94}
      maxVh={92}
      cardStyle={{ ...windowCard, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '24px 26px 20px' }}
      ariaLabel={t('share.title')}
    >
      <ShareWindowHead section={section} onPick={show} />

      {visited.includes('keep') && (
        <div style={slot(section === 'keep')}>
          <ExportJsonPanel open={open} onDone={close} />
        </div>
      )}
      {visited.includes('friend') && (
        <div style={slot(section === 'friend')}>
          <ExportPanel open={open} onDone={close} />
        </div>
      )}
      {visited.includes('game') && (
        <div ref={gameRef} style={{ ...slot(section === 'game'), overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable', paddingRight: 4, ...gameFade }}>
          <BuildChecklist />
        </div>
      )}
    </ModalShell>
  );
}
