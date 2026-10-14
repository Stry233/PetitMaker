/** The release notes a returning browser has not read, shown once per version as it arrives. */
import { useWindow } from '../use-window';
import { useMemo, type CSSProperties } from 'react';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { parseLegalMarkdown } from '../../../../legal/markdown';
import { LegalMarkdown } from '../../../primitives/LegalMarkdown';
import { APP_VERSION } from '../../../../platform/build/build-info';
import { font } from '../../../design/styles';
import { isDenseScript, roleFont } from '../../../design/text-weight';
import { ModalShell } from '../../../primitives/ModalShell';
import { WindowFooter, WindowHeader, windowFrame } from '../../../primitives/Window';
import { ActionButton } from '../../../primitives/ActionButton';
import { ScrollArea } from '../../../primitives/ScrollArea';
import { MUTED } from '../../../design/tokens';
import { skin } from '../../../design/window-skin';
import { currentNotes, notesLanguage } from './current';
import { localeTag } from '../../../../i18n/locale-info';
import { recordSeenVersion } from '../../../../io/storage/seen-version-facts';

const card: CSSProperties = { ...windowFrame, gap: 14 };
const body: CSSProperties = { flex: '1 1 auto', minHeight: 0 };
const sections: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const release: CSSProperties = { ...roleFont('chip'), fontFamily: font.family, color: MUTED };

export function WhatsNewModal() {
  const t = useT();
  const { open, close: closeWindow } = useWindow('whatsNew');
  const locale = useLocale();
  const openAbout = useEditorStore((s) => s.openAbout);
  // Read as the window opens: closing records the version, after which a live reading is empty.
  const notes = useMemo(() => (open ? currentNotes(locale) : []), [open, locale]);
  const title = t('whatsnew.title', { version: APP_VERSION });
  const lang = notesLanguage(locale);

  const close = () => { recordSeenVersion(); closeWindow(); };
  const fullChangelog = () => { close(); openAbout('changelog'); };

  return (
    <ModalShell helpTarget={{ page: 'settings', anchor: 'settings-about' }} open={open} onClose={close} size="document" ariaLabel={title} cardStyle={card}>
      <WindowHeader title={title} reserve close={{ label: t('hint.close'), onPress: close }} />
      <ScrollArea gutter="stable" surface={skin.plate} tabIndex={0} role="region" aria-label={title} style={body}
        contentStyle={sections} lang={localeTag(lang)} data-testid="whats-new-notes">
        {notes.map((n) => (
          <section key={n.version}>
            {(notes.length > 1 || n.version !== APP_VERSION) && (
              <div style={release}>{n.heading.replace(/[[\]]/g, '')}</div>
            )}
            <LegalMarkdown nodes={parseLegalMarkdown(n.body)} dense={isDenseScript(lang)} />
          </section>
        ))}
      </ScrollArea>
      <WindowFooter
        tertiary={<ActionButton appearance="secondary" onClick={fullChangelog}>{t('whatsnew.full_changelog')}</ActionButton>}
        primary={<ActionButton appearance="primary" onClick={close}>{t('whatsnew.got_it')}</ActionButton>}
      />
    </ModalShell>
  );
}
