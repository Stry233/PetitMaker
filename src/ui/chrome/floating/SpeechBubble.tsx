/**
 * A speech bubble hung from a shell control, its tail on the control. The line is the action; the
 * round button closes it and carries the five-second clock; a press anywhere else closes it too.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { cursors, font, springs, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { INSET, PANEL_EDGE, PLATE, PLATE_INK } from '../../design/tokens';
import { useChromeScale } from '../../design/scale';
import { visualRect } from '../../design/visual-rect';
import { TimedButton } from '../../primitives/TimedButton';
import { tourTargetSelector, type TourTargetId } from '../tour/steps';

/** Air between the anchor and the bubble, as a share of the anchor's height so it scales with the control. */
export const BUBBLE_GAP_SHARE = 0.45;
/** Seconds the bubble stands before its clock closes it; the clock holds while a pointer is on it. */
export const BUBBLE_SECONDS = 5;
const TAIL = 16;
const CLOSE = 28;

const card: CSSProperties = {
  position: 'fixed',
  zIndex: z.toast,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 'min(88vw, 360px)',
  padding: '12px 18px 12px 12px',
  borderRadius: 20,
  border: PANEL_EDGE,
  background: PLATE,
  color: PLATE_INK,
  fontFamily: font.family,
  ...roleFont('body'),
  lineHeight: 1.4,
};

const tail: CSSProperties = {
  position: 'absolute',
  top: -TAIL / 2,
  width: TAIL,
  height: TAIL,
  background: PLATE,
  borderLeft: PANEL_EDGE,
  borderTop: PANEL_EDGE,
  borderRadius: '3px 0 0 0',
  transform: 'rotate(45deg)',
};

const close: CSSProperties = {
  flex: '0 0 auto',
  width: CLOSE,
  height: CLOSE,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: INSET,
  color: PLATE_INK,
  display: 'grid',
  placeItems: 'center',
  cursor: cursors.clickable,
};

const line: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  textAlign: 'left',
  color: 'inherit',
  font: 'inherit',
  lineHeight: 'inherit',
  cursor: cursors.clickable,
};

/** `**word**` runs render in bold, so each locale marks its own key word. */
export function emphasize(text: string): ReactNode[] {
  return text.split('**').map((run, i) => (i % 2 ? <b key={i}>{run}</b> : run));
}

export interface SpeechBubbleProps {
  anchor: TourTargetId;
  text: string;
  onAct: () => void;
  onClose: () => void;
}

export function SpeechBubble({ anchor, text, onAct, onClose }: SpeechBubbleProps) {
  const t = useT();
  const chrome = useChromeScale();
  const ref = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number; tailRight: number } | null>(null);

  // Right-aligned under the anchor with the tail on its centre, re-read every frame while up: the
  // frame moves its corner as fonts, notices and layout settle, and the bubble lives five seconds.
  useLayoutEffect(() => {
    let frame = 0;
    let last = '';
    const follow = () => {
      const el = document.querySelector(tourTargetSelector(anchor));
      if (!el) {
        if (last !== 'none') { last = 'none'; setAt(null); }
      } else {
        const r = visualRect(el);
        const key = `${r.right},${r.bottom},${r.width}`;
        if (key !== last) {
          last = key;
          setAt({
            top: (r.bottom + r.height * BUBBLE_GAP_SHARE) / chrome,
            right: (window.innerWidth - r.right) / chrome,
            tailRight: r.width / 2 / chrome - TAIL / 2,
          });
        }
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchor, chrome]);

  // A press anywhere else means the visitor is working.
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [onClose]);

  // The root stands from the first render, hidden until measured: a motion child that first
  // appears under a presence already departed never animates out.
  return (
    <motion.div
      ref={ref}
      role="status"
      data-testid="speech-bubble"
      style={{ ...card, top: at?.top ?? 0, right: at?.right ?? 0, zoom: chrome, visibility: at ? 'visible' : 'hidden' }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={springs.stiff}
      onPointerEnter={() => setReading(true)}
      onPointerLeave={() => setReading(false)}
    >
      <span data-testid="speech-bubble-tail" aria-hidden style={{ ...tail, right: at?.tailRight ?? 0 }} />
      <TimedButton after={BUBBLE_SECONDS} paused={reading} style={close} onPress={onClose} aria-label={t('hint.close')} pressMotion={false}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 1.5 8.5 8.5 M8.5 1.5 1.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </TimedButton>
      <button type="button" style={line} onClick={() => { onAct(); onClose(); }}>{emphasize(text)}</button>
    </motion.div>
  );
}
