/**
 * A speech bubble hung from a shell control, its tail on the control. The line is the action; the
 * round button closes it and carries the five-second clock; a press anywhere else closes it too,
 * and with `anchorPresses` a press on the control itself acts rather than only closing it.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { timedHint } from '../timed-hint';
import { cursors, font, z, radii } from '../../design/styles';
import { presence } from '../../design/motion';
import { roleFont } from '../../design/text-weight';
import { INSET, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE, PLATE_INK } from '../../design/tokens';
import { TOUCH_TARGET } from '../../design/scale';
import { TimedButton } from '../../primitives/TimedButton';
import { TouchReach } from '../../primitives/TouchReach';
import { useReveal } from '../../primitives/use-reveal';
import { useChromeLayer, useChromeLayerZoom } from '../../primitives/chrome-layer';
import { useFloatingPosition } from '../../primitives/use-floating-position';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { tourTargetSelector, type TourTargetId } from '../tour/steps';

/** Air between the anchor and the bubble, as a share of the anchor's height so it scales with the control. */
const BUBBLE_GAP_SHARE = 0.45;
/** Seconds the bubble stands before its clock closes it; the clock holds while a pointer is on it. */
const BUBBLE_SECONDS = 5;
const TAIL = 16;
const CLOSE = 28;

const card: CSSProperties = {
  position: 'fixed',
  zIndex: z.notice,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 'min(88vw, 360px)',
  padding: '12px 18px 12px 12px',
  borderRadius: radii.card,
  border: PANEL_EDGE,
  background: PLATE,
  color: PLATE_INK,
  fontFamily: font.family,
  ...roleFont('body'),
  lineHeight: 1.4,
};

const tail: CSSProperties = {
  position: 'absolute',
  width: TAIL,
  height: TAIL,
  background: PLATE,
  transform: 'rotate(45deg)',
};
/** The tail on the bubble's top edge, for a bubble under its control. */
const tailUp: CSSProperties = { top: -TAIL / 2, borderLeft: PANEL_EDGE, borderTop: PANEL_EDGE, borderRadius: `${radii.sm}px 0 0 0` };
/** The tail on the bubble's bottom edge, for a bubble over its control. */
const tailDown: CSSProperties = { bottom: -TAIL / 2, borderRight: PANEL_EDGE, borderBottom: PANEL_EDGE, borderRadius: `0 0 ${radii.sm}px 0` };

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
  position: 'relative',
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
function emphasize(text: string): ReactNode[] {
  return text.split('**').map((run, i) => (i % 2 ? <b key={i}>{run}</b> : run));
}

interface SpeechBubbleProps {
  anchor: TourTargetId;
  text: string;
  onAct: () => void;
  onClose: () => void;
  /** The side it opens on while that side holds it; a control at the window's foot asks for above. */
  prefer?: 'above' | 'below';
  /** A press on the anchor goes on to the anchor, as the bubble's own line would. */
  anchorPresses?: boolean;
}

export function SpeechBubble({ anchor, text, onAct, onClose, prefer = 'below', anchorPresses = false }: SpeechBubbleProps) {
  const t = useT();
  // Touch mode draws the bubble at least at its own size: its words at their role's size, and its
  // close a fingertip's reach through `TouchReach`.
  const layer = useChromeLayer({ control: TOUCH_TARGET });
  const zoom = useChromeLayerZoom(TOUCH_TARGET);
  // A hold pauses the countdown; the press still lands.
  const { shown: reading, bind: readingBind } = useReveal({ keepsClick: true });
  // The anchor is the tour target, looked up afresh at every read: the corner may redraw it.
  const target = useMemo(() => ({ get current() { return document.querySelector<HTMLElement>(tourTargetSelector(anchor)); } }), [anchor]);
  // Right-aligned under the anchor with the tail on its centre, followed every frame while up: the
  // frame moves its corner as fonts, notices and layout settle, and the bubble lives five seconds.
  const floating = useFloatingPosition({ open: true, anchor: target, zoom, align: 'end', prefer, gap: (r) => r.height * BUBBLE_GAP_SHARE / zoom });
  // The tail stands on the anchor's centre even where the window's edge held the bubble off its
  // aligned place; left is measured inside the bubble's edge.
  const tailLeft = floating.placement
    ? floating.placement.anchorX - floating.placement.anchorWidth / 2 - TAIL / 2 - PANEL_EDGE_WIDTH : 0;

  // A press anywhere else means the visitor is working: it puts the bubble away, and in touch mode
  // still lands where it was aimed.
  useSurfaceScope({ open: !!floating.placement, root: floating.ref, onClose, outside: 'notice', ...(anchorPresses ? { trigger: target } : {}) });

  // The root stands from the first render, hidden until placed: a motion child that first appears
  // under a presence already departed never animates out.
  return (
    <motion.div
      ref={floating.ref}
      {...floating.piece}
      role="status"
      data-testid="speech-bubble"
      style={{ ...layer, ...floating.style, ...card, boxSizing: 'content-box', maxHeight: 'none', overflowY: 'visible', visibility: floating.placement ? 'visible' : 'hidden' }}
      {...presence('surface.arrive', { opacity: 0, y: -8 }, { exit: { opacity: 0, y: -6 } })}
      {...readingBind}
    >
      <span data-testid="speech-bubble-tail" aria-hidden style={{ ...tail, ...(floating.placement?.above ? tailDown : tailUp), left: tailLeft }} />
      <TimedButton after={BUBBLE_SECONDS} hint={timedHint(t, BUBBLE_SECONDS)} paused={reading} style={close} onPress={onClose} aria-label={t('hint.close')} pressMotion={false}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 1.5 8.5 8.5 M8.5 1.5 1.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {/* The close and the line stand side by side, so each grows away from the other. */}
        <TouchReach w={CLOSE} h={CLOSE} zoom={zoom} sides={{ right: false }} />
      </TimedButton>
      <button type="button" style={line} onClick={() => { onAct(); onClose(); }}>
        {emphasize(text)}
        <TouchReach zoom={zoom} sides={{ left: false }} />
      </button>
    </motion.div>
  );
}
