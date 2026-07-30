/**
 * Small inline SVG icons — one per legal `DocId` — for the About modal's legal
 * grid rows. Pure inline SVG (no external refs / no new deps, so the strict CSP
 * is satisfied), a single cozy rounded line style: `currentColor` stroke so the
 * design tokens drive the colour, ~1.75px stroke, round caps/joins, ~17px.
 * `aria-hidden` — the row's text label carries the meaning.
 *
 * Keep the set visually consistent (same weight, same 24×24 authoring grid). To
 * add a doc, add its `DocId` case here so `DocIcon` stays total.
 */
import type { DocId } from './registry';

interface IconProps {
  size?: number;
}

// Shared wrapper: fixed authoring grid, no fill, round joints, currentColor.
function Svg({ size = 17, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block' }}
    >
      {children}
    </svg>
  );
}

// privacy — shield with a check
export const PrivacyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.2 7 8.5 4.1-1.3 7-4.3 7-8.5V6l-7-3Z" />
    <path d="m9.2 11.7 2 2 3.6-3.8" />
  </Svg>
);

// terms — a document with text lines
export const TermsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z" />
    <path d="M13.5 3v4A1.5 1.5 0 0 0 15 8.5h3.5" />
    <path d="M9 12.5h6M9 16h6" />
  </Svg>
);

// license — a balance / scales
export const LicenseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v16M7 20h10" />
    <path d="M5 7h14M8 5.5 5 7l7-1.5L19 7l-3-1.5" />
    <path d="M5 7 2.8 11.5a2.2 2.2 0 0 0 4.4 0L5 7ZM19 7l-2.2 4.5a2.2 2.2 0 0 0 4.4 0L19 7Z" />
  </Svg>
);

// third-party — a package / box
export const ThirdPartyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.2 4.5 7.1v9.8L12 20.8l7.5-3.9V7.1L12 3.2Z" />
    <path d="M4.7 7.2 12 11l7.3-3.8M12 11v9.6" />
    <path d="m8.2 5.1 7.4 3.9" />
  </Svg>
);

// asset-licenses — a painter's palette
export const AssetLicensesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5c-4.7 0-8.5 3.5-8.5 8s3.8 6.7 6 6.7c1.4 0 1.8-1 1.4-1.9-.5-1 .2-2.1 1.4-2.1H15c3 0 5.5-2.1 5.5-5.2 0-3.4-3.8-5.5-8.5-5.5Z" />
    <circle cx="7.5" cy="10.5" r="1" />
    <circle cx="11" cy="7.5" r="1" />
    <circle cx="15" cy="8.5" r="1" />
  </Svg>
);

// about — info circle (used for the "open the About page" grid row)
export const AboutIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

// security — a padlock
export const SecurityIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2.5" />
  </Svg>
);

// contact — an envelope
export const ContactIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
    <path d="m4.5 7 6.4 5a1.8 1.8 0 0 0 2.2 0l6.4-5" />
  </Svg>
);

// changelog — a clock
export const ChangelogIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

const ICONS: Record<DocId, (p: IconProps) => JSX.Element> = {
  privacy: PrivacyIcon,
  terms: TermsIcon,
  license: LicenseIcon,
  'third-party': ThirdPartyIcon,
  'asset-licenses': AssetLicensesIcon,
  about: AboutIcon,
  security: SecurityIcon,
  contact: ContactIcon,
  changelog: ChangelogIcon,
};

/** The icon component for a `DocId` (total over every id). */
export function DocIcon({ id, size }: { id: DocId; size?: number }) {
  const Icon = ICONS[id];
  return <Icon size={size} />;
}
