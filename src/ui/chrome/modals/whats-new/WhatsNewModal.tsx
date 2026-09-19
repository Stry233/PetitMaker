/** The release notes a returning browser has not read, shown once per version as it arrives. */
import { useMemo, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { parseLegalMarkdown } from '../../../../legal/markdown';
import { LegalMarkdown } from '../../../../legal/LegalMarkdown';
import { APP_VERSION } from '../../../../version';
import { buttonMotion, colors, font, modalTitle } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { windowFooterGhost, windowFooterPrimary } from '../../../design/window-skin';
import { ModalShell } from '../../../primitives/ModalShell';
import { currentNotes, recordSeenVersion } from './current';

const CARD_W = 480;

const card: CSSProperties = {
  padding: '26px 28px 22px', display: 'flex', flexDirection: 'column', gap: 14,
};
const body: CSSProperties = {
  flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
};
const release: CSSProperties = { ...roleFont('chip'), fontFamily: font.family, color: colors.brownText };
const foot: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };

export function WhatsNewModal() {
  const t = useT();
  const open = useEditorStore((s) => s.modals.whatsNew);
  const locale = useEditorStore((s) => s.locale);
  const setModal = useEditorStore((s) => s.setModal);
  const setAboutTarget = useEditorStore((s) => s.setAboutTarget);
  // Read as the window opens: closing records the version, after which a live reading is empty.
  const notes = useMemo(() => (open ? currentNotes(locale) : []), [open, locale]);
  const title = t('whatsnew.title', { version: APP_VERSION });

  const close = () => { recordSeenVersion(); setModal('whatsNew', false); };
  const fullChangelog = () => { close(); setAboutTarget('changelog'); setModal('about', true); };

  return (
    <ModalShell helpTarget={{ page: 'settings', anchor: 'settings-reset' }} open={open} onClose={close} width={CARD_W} maxVwPct={92} maxVh={86} ariaLabel={title} cardStyle={card}>
      <div style={modalTitle}>{title}</div>
      <div style={body} data-testid="whats-new-notes">
        {notes.map((n) => (
          <section key={n.version}>
            {(notes.length > 1 || n.version !== APP_VERSION) && (
              <div style={release}>{n.heading.replace(/[[\]]/g, '')}</div>
            )}
            <LegalMarkdown nodes={parseLegalMarkdown(n.body)} dense />
          </section>
        ))}
      </div>
      <div style={foot}>
        <motion.button type="button" {...buttonMotion} style={windowFooterGhost} onClick={fullChangelog}>
          {t('whatsnew.full_changelog')}
        </motion.button>
        <motion.button type="button" {...buttonMotion} style={windowFooterPrimary} onClick={close}>
          {t('whatsnew.got_it')}
        </motion.button>
      </div>
    </ModalShell>
  );
}
