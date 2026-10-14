/*
 * What Save and share opens: the save file, the share picture and the build checklist in one window, the
 * first two being `ExportJsonPanel` and `ExportPanel`. The `share` modal opens at the store's `shareTarget`
 * (set by `openShare`), or at the first section. A section mounts
 * when first reached and stays mounted, its `open` being the window's, so nothing typed is lost and no
 * section's capture runs before it is asked for.
 */
import { useWindow } from '../use-window';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '../../../../i18n/context';
import { useEditorStore, type ShareSection } from '../../../../state/store';
import { BuildChecklist } from './BuildChecklist';
import { ExportJsonPanel } from './ExportJsonModal';
import { ExportPanel } from './ExportModal';
import { ModalShell, useModalEntered } from '../../../primitives/ModalShell';
import { SegmentedControl } from '../../../primitives/SegmentedControl';
import { useScrollFade } from '../../../primitives/scroll-fade';
import { WindowHeader, windowFrame } from '../../../primitives/Window';
import type { I18nKey } from '../../../../i18n/keys';

export type { ShareSection };
type Section = ShareSection;

const SECTIONS: readonly Section[] = ['keep', 'friend', 'game'];

const LABEL: Record<Section, I18nKey> = {
  keep: 'share.tab_keep',
  friend: 'share.tab_friend',
  game: 'share.tab_game',
};

/** The window's own head, title over the three purpose tabs: the live window turns its pages with
 *  it, and a Help figure poses the same head over the same panels. */
export function ShareWindowHead({ section, onPick, onClose }: { section: ShareSection; onPick: (s: ShareSection) => void; onClose: () => void }) {
  const t = useT();
  return (
    <>
      <WindowHeader title={t('share.title')} reserve close={{ label: t('hint.close'), onPress: onClose }} style={{ marginBottom: 12, flex: '0 0 auto' }} />
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

/** `open` and `section` picture the window for a Help figure in place of the store's flag and target. */
export function ShareWindow({ open: posedOpen, section: posedSection }: { open?: boolean; section?: ShareSection } = {}) {
  const t = useT();
  const { open, close } = useWindow('share', { open: posedOpen });
  const target = useEditorStore((s) => s.shareTarget);
  const setShareTarget = useEditorStore((s) => s.setShareTarget);
  const [section, setSection] = useState<Section>('keep');
  const [visited, setVisited] = useState<readonly Section[]>([]);

  // Chosen during the render that opens, so the card takes the section's size at its first frame.
  const [openEdge, setOpenEdge] = useState(false);
  if (open !== openEdge) {
    setOpenEdge(open);
    if (open) {
      const first: Section = posedSection ?? target ?? 'keep';
      setSection(first);
      setVisited([first]);
    }
  }
  useEffect(() => { if (open && target) setShareTarget(null); }, [open, target, setShareTarget]);

  const show = useCallback((next: Section) => {
    setSection(next);
    setVisited((seen) => (seen.includes(next) ? seen : [...seen, next]));
  }, []);


  const gameRef = useRef<HTMLDivElement>(null);
  const gameFade = useScrollFade(gameRef, 'y');

  const { onEntered, hasSettled } = useModalEntered(open, section);

  return (
    <ModalShell helpTarget={{ page: section === 'keep' ? 'json' : section === 'game' ? 'checklist' : 'share' }}
      open={open}
      onClose={close}
      onEntered={onEntered}
      motionSize={SIZE[section]}
      size="panel"
      cardStyle={{ ...windowFrame, position: 'relative', overflow: 'hidden' }}
      ariaLabel={t('share.title')}
    >
      <ShareWindowHead section={section} onPick={show} onClose={close} />

      {visited.includes('keep') && (
        <div style={slot(section === 'keep')}>
          <ExportJsonPanel open={open} onDone={close} />
        </div>
      )}
      {visited.includes('friend') && (
        <div style={slot(section === 'friend')}>
          <ExportPanel open={open} entered={hasSettled('friend')} onDone={close} />
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
