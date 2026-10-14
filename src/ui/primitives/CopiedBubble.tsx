import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { font, radii, shadows } from '../design/styles';
import { presence } from '../design/motion';
import { roleFont } from '../design/text-weight';
import { skin } from '../design/window-skin';
import { SUPPORTS_CLIPBOARD } from '../../platform/build/edition';

/** How long the confirmation stands after a copy, in ms; a copy while it stands restarts it. */
const COPIED_HOLD_MS = 1200;

/**
 * Copies text to the clipboard and remembers which `target` was copied for `COPIED_HOLD_MS`.
 * A refused or unavailable clipboard leaves `copied` untouched; an edition without clipboard support
 * (`edition.ts:SUPPORTS_CLIPBOARD`) never attempts it.
 */
export function useCopyFeedback<T extends string = 'copied'>(): {
  copied: T | null;
  copy: (text: string, target?: T) => Promise<void>;
} {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async (text: string, target = 'copied' as T) => {
    if (!SUPPORTS_CLIPBOARD) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(target);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_HOLD_MS);
  };
  return { copied, copy };
}

const bubble: CSSProperties = {
  position: 'absolute', left: '50%',
  background: skin.plate, color: skin.ink, border: `1px solid ${skin.line}`, borderRadius: radii.md,
  padding: '4px 10px', fontFamily: font.family, ...roleFont('caption'), whiteSpace: 'nowrap', boxShadow: shadows.float,
  pointerEvents: 'none',
};

const tail: CSSProperties = {
  position: 'absolute', left: '50%', marginLeft: -4, width: 10, height: 10,
  background: skin.plate, border: `1px solid ${skin.line}`, transform: 'rotate(45deg)',
};

/**
 * The "Copied" confirmation hung from the control that copied: above it (`side="above"`, tail
 * down) or below it. Place it inside a positioned wrapper around the control. Centring rides
 * Framer's `x`, so the element carries no CSS transform of its own.
 */
export function CopiedBubble({ show, side, style, children }: {
  show: boolean;
  side: 'above' | 'below';
  style?: CSSProperties;
  children: ReactNode;
}) {
  const above = side === 'above';
  const travel = above ? 6 : -6;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="copied-bubble"
          role="status"
          aria-live="polite"
          style={{ ...bubble, ...(above ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }), ...style }}
          {...presence('surface.arrive', { opacity: 0, y: travel, scale: 0.9 }, { hold: { x: '-50%' }, leave: 'surface.leave' })}
        >
          {children}
          <span
            style={{ ...tail, ...(above ? { bottom: -5, borderTop: 'none', borderLeft: 'none' } : { top: -5, borderBottom: 'none', borderRight: 'none' }) }}
            aria-hidden
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
