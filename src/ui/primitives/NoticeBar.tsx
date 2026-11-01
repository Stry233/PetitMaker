/*
 * The card a full-window notice is drawn on: centred on the window, standing off its top or bottom
 * edge on the toast rung, the panel plate with its hairline, and an optional accent stripe that says
 * "this is a warning" without colouring the words. Its actions are `NoticeAction` pills. It draws at
 * the chrome's touch lift for `TOUCH_TARGET` controls (`useChromeLayer`), as the toasts do.
 */
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cursors, font, radii, z } from '../design/styles';
import { roleFont, LINE_HEIGHT } from '../design/text-weight';
import { PANEL_EDGE, PLATE, FRAME_INK, ACCENT, SURFACE_SECONDARY } from '../design/tokens';
import { presence } from '../design/motion';
import { useChromeLayer, useChromeLayerZoom } from './chrome-layer';
import { TOUCH_TARGET } from '../design/scale';

const card: CSSProperties = {
  left: '50%',
  zIndex: z.toast,
  display: 'flex',
  gap: 12,
  padding: '10px 12px 10px 16px',
  borderRadius: radii.lg,
  border: PANEL_EDGE,
  boxShadow: 'none',
  background: PLATE,
  color: FRAME_INK,
  fontFamily: font.family,
  ...roleFont('caption'),
  lineHeight: LINE_HEIGHT.snug,
};

/** The accent stripe at the card's start. */
const stripe: CSSProperties = { flex: '0 0 auto', width: 4, alignSelf: 'stretch', borderRadius: radii.hair, background: ACCENT };

/** The width a notice may take: its content up to the default cap, or a fixed share of the window. */
const NOTICE_WIDTH = { maxWidth: 'min(92vw, 560px)' } as const satisfies CSSProperties;

interface NoticeBarProps extends Omit<HTMLMotionProps<'div'>, 'style' | 'children'> {
  /** Which window edge the card stands off, and how far (the card's own css px, or any CSS length). */
  edge: 'top' | 'bottom';
  offset: number | string;
  /** Draws the accent stripe at the card's start. */
  stripe?: boolean;
  /** How the card's children line up across its height. */
  align?: 'center' | 'stretch';
  /** Width rules; the content-sized default cap when omitted. */
  width?: CSSProperties;
  /** Arrives and leaves sliding this far from its edge, in css px; a static card when omitted. */
  travel?: number;
  /** Publishes the resolved text weights on the card (`useChromeLayer`). */
  weights?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

/** The control height a notice's actions are lifted for in touch mode, in its own css px. The toast
 *  band's tenants lift to it too, so a notice stacked under the band reads the band's rows at its own
 *  zoom. */
export const NOTICE_CONTROL = TOUCH_TARGET;

/** The zoom a notice card and the toast band's tenants draw at: the chrome's, raised in touch mode
 *  until their actions reach a fingertip. A caller placing a card in chrome px converts by it. */
export function useNoticeZoom(): number {
  return useChromeLayerZoom(NOTICE_CONTROL);
}

/** A notice card. Mount it under `AnimatePresence` when it has `travel`. */
export const NoticeBar = forwardRef<HTMLDivElement, NoticeBarProps>(function NoticeBar({
  edge, offset, stripe: striped = false, align = 'center', width = NOTICE_WIDTH, travel, weights = true, style, children, ...rest
}, ref) {
  const layer = useChromeLayer({ weights, control: NOTICE_CONTROL });
  const placed: CSSProperties = { ...layer, ...card, ...width, alignItems: align, [edge]: offset, ...style };
  const body = <>{striped ? <span style={stripe} aria-hidden /> : null}{children}</>;
  if (travel === undefined) return <motion.div ref={ref} {...rest} style={{ ...placed, transform: 'translateX(-50%)' }}>{body}</motion.div>;
  // Centring rides Framer's `x`: Framer owns the transform while it animates `y`.
  const from = edge === 'top' ? -travel : travel;
  return (
    <motion.div ref={ref} {...rest} style={placed}
      {...presence('notice.arrive', { opacity: 0, y: from }, { exit: { opacity: 0, y: from * (2 / 3) }, hold: { x: '-50%' } })}
    >
      {body}
    </motion.div>
  );
});

const action: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  background: SURFACE_SECONDARY,
  color: FRAME_INK,
  fontFamily: font.family,
  ...roleFont('small'),
  padding: '6px 10px',
  borderRadius: radii.pill,
  cursor: cursors.clickable,
};

/** A notice's action pill: its style, for a `TimedButton` or any other element that draws one. */
export const noticeActionStyle = action;

/** A notice action as a button. */
export function NoticeAction(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} style={{ ...action, ...props.style }} />;
}

/** A notice action as a link. */
export function NoticeLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a target="_blank" rel="noopener noreferrer" {...props} style={{ ...action, textDecoration: 'none', whiteSpace: 'nowrap', ...props.style }} />;
}
