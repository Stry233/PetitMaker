/** The About view's styles: the brand band, the panes, the roster cards, the document grid and the footer. */
import type { CSSProperties } from 'react';
import { font, radii, modalRow, btnReset, cursors } from '../../../design/styles';
import { skin } from '../../../design/window-skin';
import { MUTED } from '../../../design/tokens';
import { roleFont } from '../../../design/text-weight';

// Brand at the left, version and source link at the right.
export const brandBand: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 18,
};

export const bandRight: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  minWidth: 0,
};

export const hairline: CSSProperties = { height: 1, background: skin.line };

// Two equal panes: people on the left, documents and support on the right.
export const panes: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 28,
  alignItems: 'start',
};

export const pane: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  minWidth: 0,
};

export const paneDivider: CSSProperties = {
  ...pane,
  borderLeft: `1px solid ${skin.line}`,
  paddingLeft: 28,
};

export const brandBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
};

// Muted text in this view is `MUTED`: the secondary text colour fails WCAG AA at these sizes.
const versionLine: CSSProperties = {
  fontFamily: font.family,
  ...roleFont('caption'),
  color: MUTED,
  textAlign: 'center',
  marginTop: 2,
  opacity: 0.85,
  letterSpacing: '0.01em',
};

// The one outbound link in the brand block reads as a link: heavier than the version line, underlined.
export const repositoryLink: CSSProperties = {
  ...versionLine,
  ...roleFont('small'),
  marginTop: 0,
  opacity: 1,
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

export const versionButton: CSSProperties = {
  ...btnReset,
  ...versionLine,
  display: 'inline-block',
};

// The build-copy confirmation is anchored to the version row.
export const versionButtonWrap: CSSProperties = {
  position: 'relative',
  display: 'inline-block',
};

// A quiet sentence-case label, never a bold uppercase header.
export const sectionLabel: CSSProperties = {
  ...roleFont('caption'),
  color: MUTED,
  fontFamily: font.family,
  letterSpacing: '0.04em',
  marginBottom: 10,
  opacity: 0.9,
};

export const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
};

export const gridRow: CSSProperties = {
  ...modalRow,
  boxSizing: 'border-box',
  justifyContent: 'flex-start',
  gap: 8,
  padding: '10px 10px',
  borderRadius: radii.md,
  background: skin.inset,
  border: 'none',
  cursor: cursors.clickable,
  textDecoration: 'none',
  textAlign: 'left',
  width: '100%',
  minWidth: 0,
  color: skin.ink,
};

export const gridIcon: CSSProperties = {
  color: MUTED,
  display: 'flex',
  flexShrink: 0,
};

// A document's name wraps (several are longer than a column in Russian and Thai); the window grows to it.
export const gridLabel: CSSProperties = {
  flex: 1,
  ...roleFont('chip'),
  lineHeight: 1.3,
  color: skin.ink,
  fontFamily: font.family,
  minWidth: 0,
};

export const chevron: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: skin.muted,
  flexShrink: 0,
};

export const teamNote: CSSProperties = {
  fontFamily: font.family,
  ...roleFont('caption'),
  color: MUTED,
  lineHeight: 1.4,
  marginTop: -4,
  marginBottom: 8,
};

// One row of four cards; a long name wraps to a second line.
export const teamGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
};

// The whole card is the link.
export const memberCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '10px 4px 8px',
  borderRadius: radii.md,
  textDecoration: 'none',
  color: skin.ink,
  minWidth: 0,
};

// The image clips itself to the circle, so the corner badge can sit on the rim unclipped.
export const avatarRing: CSSProperties = {
  position: 'relative',
  width: 52,
  height: 52,
  borderRadius: '50%',
  border: `1px solid ${skin.line}`,
  background: skin.inset,
  flexShrink: 0,
};

export const avatarImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
  borderRadius: '50%',
};

// The opens-externally mark sits on the avatar, so a wrapping name never orphans it.
export const avatarBadge: CSSProperties = {
  position: 'absolute',
  right: -1,
  bottom: -1,
  width: 17,
  height: 17,
  borderRadius: '50%',
  background: skin.plate,
  border: `1px solid ${skin.line}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...roleFont('caption'),
  lineHeight: 1,
  color: MUTED,
};

export const memberName: CSSProperties = {
  ...roleFont('caption'),
  color: skin.ink,
  fontFamily: font.family,
  textAlign: 'center',
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
  maxWidth: '100%',
};

// The wide layout's cards: four equal columns in both rows so team and acknowledgement cards share one width.
export const wideCard: CSSProperties = { ...memberCard, padding: '8px 0 6px' };
export const wideGrid: CSSProperties = { ...teamGrid, gap: 4 };

export const filingRow: CSSProperties = {
  ...modalRow,
  padding: '4px 0',
};

export const filingLabel: CSSProperties = {
  ...roleFont('caption'),
  color: skin.ink,
  fontFamily: font.family,
};

// The ICP and PSB filing numbers.
export const filingLink: CSSProperties = {
  ...roleFont('caption'),
  color: MUTED,
  fontFamily: font.family,
  textDecoration: 'none',
};

export const disclaimerStyle: CSSProperties = {
  ...roleFont('caption'),
  color: MUTED,
  fontFamily: font.family,
  lineHeight: 1.5,
  textAlign: 'center',
};

export const footerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  ...roleFont('caption'),
  color: MUTED,
  fontFamily: font.family,
  flexWrap: 'wrap',
};

