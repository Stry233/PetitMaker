// The main map's filing links yield their space to the active bottom panel.
import type { CSSProperties } from 'react';
import { useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { useChromeScale } from '../design/scale';
import { font, radii, shadows, z } from '../design/styles';
import { MUTED, PLATE } from '../design/tokens';
import { TEXT_ROLES } from '../design/text-weight';
import { LEGAL } from '../../legal/config';

const barStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 4,
  transform: 'translateX(-50%)',
  zIndex: z.filing,
  fontFamily: font.family,
  fontSize: TEXT_ROLES.caption.px,
  // brownText clears 4.5:1 against panelCream (pinned in legal-bar.test.tsx).
  color: MUTED,
  background: PLATE,
  borderRadius: radii.pill,
  padding: '3px 12px',
  boxShadow: shadows.s1,
  whiteSpace: 'normal',
  // Wrapping (not ellipsis) because the filing number must remain fully readable
  maxWidth: 'calc(100vw - 16px)',
  textAlign: 'center',
  lineHeight: 1.4,
  // The pill itself is non-interactive; only its links accept pointer events.
  pointerEvents: 'none',
};

const linkStyle: CSSProperties = {
  color: MUTED,
  pointerEvents: 'auto',
};

export function LegalBar() {
  const t = useT();
  const chrome = useChromeScale();
  const bottomPanelOpen = useEditorStore((s) => s.editMode.mode !== null || s.selectingRegion);

  const hasIcp = !!(LEGAL.icpNumber && LEGAL.icpUrl);
  const hasPsb = !!(LEGAL.psbNumber && LEGAL.psbUrl);

  if (bottomPanelOpen || (!hasIcp && !hasPsb)) return null;

  return (
    <nav style={{ ...barStyle, zoom: chrome }} aria-label={t('legal.section_title')}>
      {hasIcp && (
        // The two filings stand apart on space, not on a mark between them: the row is running
        // text so it can wrap a long number, and the margin travels with the first link.
        <a href={LEGAL.icpUrl!} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, marginRight: hasPsb ? 12 : 0 }}>
          {LEGAL.icpNumber}
        </a>
      )}
      {hasPsb && (
        <a href={LEGAL.psbUrl!} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          {LEGAL.psbNumber}
        </a>
      )}
    </nav>
  );
}
