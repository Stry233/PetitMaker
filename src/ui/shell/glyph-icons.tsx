import type { ReactNode } from 'react';

/**
 * Inline SVG glyphs for the controls the design source draws no picture for: the layer plate's two
 * chevrons and the rail's fit-to-view.
 *
 * Stroke icons in `currentColor` at one weight, never text or emoji glyphs (⬆︎ ↶ ⊞ …): those render
 * per platform and font — some flat, some as colour emoji — so a row of buttons drawn with them
 * comes out mismatched on some machines and not on others.
 */
function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconChevronLeft = ({ size }: { size?: number }) => <Svg size={size}><path d="M15 5l-7 7 7 7" /></Svg>;
export const IconChevronRight = ({ size }: { size?: number }) => <Svg size={size}><path d="M9 5l7 7-7 7" /></Svg>;
// Trash can: taking a generation back is a discard, not an erase stroke, so it is not the eraser.
export const IconTrash = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
    <path d="M6.5 7l.9 11.9a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);
// Fit-to-view: four corner brackets framing the map.
export const IconFit = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4" />
    <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
    <path d="M4 15v4a1 1 0 0 0 1 1h4" />
    <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
  </Svg>
);
