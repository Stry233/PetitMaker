/*
 * The logo beside the app name, shared by the About modal and the tour's welcome step.
 *
 * The arrangement comes from the README masthead (docs/media/banner-*.svg): the logo, then the name
 * one fifth of the logo's width further along, both centred on the same line. That file is a
 * rendering rather than a component (outlined paths for the wordmark, a base64 PNG for the logo),
 * so what carries over is the geometry, not the asset.
 *
 * The logo is served from public/ through BASE_URL, the same path the favicon resolves, so one file
 * backs both and it still loads under the dev site's /Apollonius/ prefix.
 */
import type { CSSProperties } from 'react';
import { useT } from '../../i18n/context';
import { colors, font, radii } from '../design/styles';
import { useReadableWeight } from '../design/scale';

/** 32px of gap per 172px of logo, measured off the 796x228 masthead artboard. */
const GAP_RATIO = 32 / 172;

export interface BrandLockupProps {
  /** The logo's edge length in css px. The name and gap scale from it. */
  size: number;
  /** Show the localized tagline under the name. */
  tagline?: boolean;
  /** Drop the name and show the logo alone. The tour's welcome step already carries a step title
   *  and a body, so the name would be a third piece of text competing in one small card, and it is
   *  the one the picture carries anyway. The name then moves onto the image's `alt`, so it is still
   *  what a screen reader announces. */
  logoOnly?: boolean;
}

export function BrandLockup({ size, tagline, logoOnly }: BrandLockupProps) {
  const t = useT();
  const weightAt = useReadableWeight();

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
    fontWeight: weightAt(900, Math.round(size * 0.42)),
    fontSize: Math.round(size * 0.42),
    color: colors.frameDark,
    lineHeight: 1.05,
  };
  // brownText, not textSecondary: the tagline is normal-size text, and textSecondary measures
  // below the 4.5:1 AA floor (see legal/a11y.test.tsx).
  const sub: CSSProperties = {
    fontFamily: font.family,
    fontWeight: weightAt(700, Math.round(size * 0.2)),
    fontSize: Math.round(size * 0.2),
    color: colors.brownText,
    lineHeight: 1.2,
  };

  return (
    <div style={row}>
      {logoOnly
        ? <img src={`${import.meta.env.BASE_URL}logo-256.png`} alt={t('app.name')} style={logo} />
        : <img src={`${import.meta.env.BASE_URL}logo-256.png`} alt="" role="presentation" style={logo} />}
      {!logoOnly && (
        <div style={names}>
          <div style={name}>{t('app.name')}</div>
          {tagline && <div style={sub}>{t('app.tagline')}</div>}
        </div>
      )}
    </div>
  );
}
