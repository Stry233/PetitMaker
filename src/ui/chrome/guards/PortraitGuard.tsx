import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { useT } from '../../../i18n/context';
import { usePortraitGuard } from './portrait-guard';
import { useEditorStore } from '../../../state/store';
import { Icon } from '../../primitives/icons';
import { font, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { ModalShell } from '../../primitives/ModalShell';
import { FRAME_INK, TEXT_SECONDARY } from '../../design/tokens';

/**
 * Full-screen "please rotate" cover for a phone/tablet held in portrait (see `portrait-guard.ts`
 * for why this can never fire on a desktop). A `ModalShell` that nothing but its own
 * `portrait.continue` button dismisses: no backdrop press and no Escape. It stands on `z.guard`,
 * above every other layer including the context menu, and the shell's overlay lock suppresses the
 * map's keyboard shortcuts while it is shown, so the editor underneath is inert to both pointer
 * and keyboard.
 */
const backdrop: CSSProperties = { zIndex: z.guard };

const panel: CSSProperties = {
  padding: '32px 28px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 14,
};

const title: CSSProperties = {
  ...font.h1,
  color: FRAME_INK,
};

const body: CSSProperties = {
  ...font.body,
  color: TEXT_SECONDARY,
};

const continueBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: '4px 8px',
  marginTop: 4,
  fontFamily: font.family,
  ...roleFont('caption'),
  color: TEXT_SECONDARY,
  opacity: 0.75,
};

/** The design source's own drawing: one phone caught mid-turn between two arrows. */
const ICON_SIZE = 76;

export function PortraitGuard() {
  const t = useT();
  const { blocked, dismiss } = usePortraitGuard();

  // The one writer of the store's mirror: this is the only component holding the live
  // media-query + dismiss state, so anything elsewhere that needs to know (the tour's gate)
  // reads the store instead of running a second, independently-dismissable subscription.
  const setPortraitBlocked = useEditorStore((s) => s.setPortraitBlocked);
  useEffect(() => { setPortraitBlocked(blocked); }, [blocked, setPortraitBlocked]);

  return (
    <ModalShell helpTarget={{ page: 'frame' }} open={blocked} onClose={dismiss} dismissible={false} unzoomed size="confirm" width={380} cap={{ w: 88 }}
      backdropStyle={backdrop} cardStyle={panel} ariaLabelledBy="portrait-guard-title" ariaDescribedBy="portrait-guard-body" testId="portrait-guard">
      <Icon name="portrait-rotate" size={ICON_SIZE} />
      <div id="portrait-guard-title" style={title}>{t('portrait.title')}</div>
      <div id="portrait-guard-body" style={body}>{t('portrait.body')}</div>
      <button type="button" style={continueBtn} onClick={dismiss}>
        {t('portrait.continue')}
      </button>
    </ModalShell>
  );
}
