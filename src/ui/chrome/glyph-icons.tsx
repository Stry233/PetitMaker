import type { ReactNode } from 'react';

/**
 * Inline SVG glyphs for the floating corner clusters (zoom / tilt / fit / undo / redo).
 * Text/emoji glyphs (⬆︎ ↶ ⊞ …) render differently per platform + font — some as flat text, some as
 * colour emoji — so the buttons looked mismatched. These are stroke icons in `currentColor`, one weight,
 * so every button matches on every OS. Sized to sit inside the 46px `floatingBtn`.
 */
function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconPlus = () => <Svg><path d="M12 5v14" /><path d="M5 12h14" /></Svg>;
export const IconMinus = () => <Svg><path d="M5 12h14" /></Svg>;
export const IconChevronUp = () => <Svg><path d="M5 15l7-7 7 7" /></Svg>;
export const IconChevronDown = () => <Svg><path d="M5 9l7 7 7-7" /></Svg>;
// Fit-to-view: four corner brackets framing the map.
export const IconFit = () => (
  <Svg>
    <path d="M4 9V5a1 1 0 0 1 1-1h4" />
    <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
    <path d="M4 15v4a1 1 0 0 0 1 1h4" />
    <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
  </Svg>
);
// Undo / redo: curved arrows (Lucide undo-2 / redo-2).
export const IconUndo = () => <Svg><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H10" /></Svg>;
export const IconRedo = () => <Svg><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H14" /></Svg>;
