/*
 * The logo beside the app name, shared by About and the Help Center's opening page, in the readme
 * masthead's geometry (the gap one fifth of the logo's width, both on one line); the name and tagline
 * are a window title and a label. The logo is served from public/ through BASE_URL, so it loads under
 * the dev site's path prefix as the favicon does.
 */
import { FRAME_INK, MUTED } from '../design/tokens';
import type { CSSProperties } from 'react';
import { useT } from '../../i18n/context';
import { font, radii } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { BrandName } from './BrandName';
import { BRAND_LOGO_URL } from '../../assets/brand-logo';

/** 32px of gap per 172px of logo, measured off the 796x228 masthead artboard. */
const GAP_RATIO = 32 / 172;

interface BrandLockupProps {
  /** The logo's edge length in css px. The gap scales from it. */
  size: number;
  /** Show the localized tagline under the name. */
  tagline?: boolean;
  /** Drop the name and show the logo alone, for a page whose own title stands under it (Help's
   *  opening page): the picture carries the name. The name then moves onto the image's `alt`, so it
   *  is still what a screen reader announces. */
  logoOnly?: boolean;
}

export function BrandLockup({ size, tagline, logoOnly }: BrandLockupProps) {
  const t = useT();

  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: Math.round(size * GAP_RATIO),
  };
  const logo: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radii.lg,
    objectFit: 'contain',
    flex: '0 0 auto',
  };
  const names: CSSProperties = { display: 'flex', flexDirection: 'column', gap: Math.round(size * 0.04) };
  const name: CSSProperties = {
    fontFamily: font.family,
    ...roleFont('title'),
    color: FRAME_INK,
    lineHeight: 1.05,
  };
  // brownText, not textSecondary: the tagline is normal-size text, and textSecondary measures
  // below the 4.5:1 AA floor (see legal/a11y.test.tsx).
  const sub: CSSProperties = {
    fontFamily: font.family,
    ...roleFont('label'),
    color: MUTED,
    lineHeight: 1.2,
  };

  return (
    <div style={row}>
      {logoOnly
        ? <img src={BRAND_LOGO_URL} alt={t('app.name')} style={logo} />
        : <img src={BRAND_LOGO_URL} alt="" role="presentation" style={logo} />}
      {!logoOnly && (
        <div style={names}>
          <div style={name}><BrandName /></div>
          {tagline && <div style={sub}>{t('app.tagline')}</div>}
        </div>
      )}
    </div>
  );
}
