// LegalBar — persistent bottom filing bar. Mainland-China filing rules expect
// the ICP/PSB registration numbers visible at the bottom of every page; this is
// that surface for the SPA. It renders NOTHING until LEGAL
// (src/legal/config.ts) carries at least one COMPLETE pair (number + URL both
// set), and each pair is checked complete before it draws, so a partial pair
// renders no row rather than a broken one.
import type { CSSProperties } from 'react';
import { useT } from '../i18n/context';
import { useChromeScale } from '../ui/design/scale';
import { colors, font, radii, shadows } from '../ui/design/styles';
import { LEGAL } from './config';

// Below every modal overlay (cozyOverlay in ui/design/styles.ts is zIndex 200) and
// below the floating zoom/undo cluster (100) so it never competes with real
// chrome, but still above the base canvas.
const BAR_Z_INDEX = 90;

const barStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 4,
  transform: 'translateX(-50%)',
  zIndex: BAR_Z_INDEX,
  fontFamily: font.family,
  fontSize: 11,
  // brownText clears 4.5:1 against panelCream (pinned in legal-bar.test.tsx).
  color: colors.brownText,
  background: colors.panelCream,
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
  color: colors.brownText,
  pointerEvents: 'auto',
};

export function LegalBar() {
  const t = useT();
  const chrome = useChromeScale();

  const hasIcp = !!(LEGAL.icpNumber && LEGAL.icpUrl);
  const hasPsb = !!(LEGAL.psbNumber && LEGAL.psbUrl);

  if (!hasIcp && !hasPsb) return null;

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
