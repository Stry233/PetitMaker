import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { Icon } from '../parts/sprite';
import { INSET, MUTED, PANEL_EDGE, PLATE, PLATE_INK } from '../../design/tokens';
import { font, shadows, radii, z, type PwStyle } from '../../design/styles';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../design/focus-source';
import { ActionButton } from '../../primitives/ActionButton';
import { framerMotion } from '../../design/motion';
import { visualRect } from '../../design/visual-rect';
import { routeSurfaceKeyDown, useSurfaceScope } from '../../primitives/surface-scope';
import { roleFont } from '../../design/text-weight';
import { FIELD_LINE, PILL_RADIUS } from './metrics';

/** The well's box as the card reads it, in screen px. */
export interface SeatRect { left: number; top: number; width: number; height: number }

/** keyCode covers IMEs that end composition before dispatching the confirming keydown. */
export function isCompositionKey(event: globalThis.KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/**
 * Floating form of the shared composer field. It morphs from the measured well, preserves the draft
 * on close, uses an explicit reduced-motion gate for box values, and leaves the panel interactive.
 */
export function ExpandedField({
  anchor, open, seat, reduced, value, placeholder, disabled, onChange, onSend, onClose,
}: {
  anchor: MutableRefObject<HTMLDivElement | null>;
  open: boolean;
  seat: { height: number; rect: SeatRect } | null;
  reduced: boolean;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange(next: string): void;
  onSend(): void;
  onClose(): void;
}) {
  const t = useT();
  const [from, setFrom] = useState<SeatRect | null>(seat?.rect ?? null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  // Remeasure the mounted well while resize or scrolling moves the portal's target.
  useLayoutEffect(() => {
    if (!open) return undefined;
    setFrom(seat?.rect ?? null);
    const measure = (): void => {
      const rect = anchor.current ? visualRect(anchor.current) : null;
      if (rect) setFrom({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, open, seat]);

  // Focus the end of the existing draft without scrolling the surrounding panel.
  useEffect(() => {
    const el = fieldRef.current;
    if (!open || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  /** Escape folds the card, keeping its draft, before it can reach the panel's own Escape. */
  const close = useCallback(() => onClose(), [onClose]);
  const cardRef = useRef<HTMLDivElement>(null);
  useSurfaceScope({ open, onClose: close, root: cardRef });

  const morph = from ? cardBox(from) : null;
  return createPortal(
    <AnimatePresence>
      {open && from && morph && (
        <motion.div
          key="composer-card"
          ref={cardRef}
          onKeyDown={routeSurfaceKeyDown}
          data-testid="composer-expanded"
          role="group"
          aria-label={t('agent.composer_expand')}
          initial={reduced ? false : { ...from, borderRadius: PILL_RADIUS }}
          animate={{ ...morph, borderRadius: radii.lg }}
          exit={{ ...from, borderRadius: PILL_RADIUS }}
          transition={framerMotion('panel.composer.unfold', reduced)}
          // The focus ring follows the card's animated radius.
          className={FIELD_WRAP_CLASS}
          style={CARD_STYLE}
        >
          {/* Fade content into the landing box instead of reflowing it through the pill morph. */}
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={framerMotion('panel.composer.unfold', reduced)}
            style={{ ...CARD_BODY_STYLE, width: morph.width, height: morph.height }}
          >
            <textarea
              ref={fieldRef}
              data-testid="composer-expanded-input"
              className={`pw-search-field ${FIELD_INPUT_CLASS}`}
              spellCheck={false}
              disabled={disabled}
              value={value}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={(e) => {
                if (composing.current || isCompositionKey(e.nativeEvent)) {
                  e.stopPropagation();
                  return;
                }
              }}
              style={CARD_FIELD_STYLE}
            />
            <div style={CARD_FOOT_STYLE}>
              <ActionButton
                appearance="secondary"
                data-testid="composer-expanded-done"
                title={t('agent.composer_collapse')}
                aria-label={t('agent.composer_collapse')}
                onClick={close}
              >
                <Icon id="pw-compress" size={14} />
              </ActionButton>
              <ActionButton appearance="primary" data-testid="composer-expanded-send" disabled={disabled} onClick={onSend}>
                {t('agent.action_send')}
              </ActionButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Computes the expanded card above its well within minimum, maximum and viewport bounds. */
function cardBox(seat: SeatRect): SeatRect {
  const height = Math.max(CARD_LEAST, Math.min(CARD_TALL, seat.top - CARD_GAP - CARD_MARGIN));
  return { left: seat.left, width: seat.width, height, top: seat.top - CARD_GAP - height };
}

/** Gap between expanded card and well, in px. */
const CARD_GAP = 8;
/** The margin the card keeps off the top of the window. */
const CARD_MARGIN = 16;
/** Minimum useful expanded-card height, in px. */
const CARD_LEAST = 180;
/** Maximum expanded-card height, in px. */
const CARD_TALL = 320;
/** Static card styles; Framer supplies animated position and size. */
const CARD_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: z.popover,
  boxSizing: 'border-box',
  // Clip contents through the animated corner radius.
  overflow: 'hidden',
  background: PLATE,
  border: PANEL_EDGE,
  boxShadow: shadows.menu,
};

/** Content uses the landing size so the box morph clips it without intermediate reflow. */
const CARD_BODY_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
};

const CARD_FIELD_STYLE: PwStyle = {
  flex: 1,
  minHeight: 96,
  background: INSET,
  border: 'none',
  outline: 'none',
  borderRadius: radii.md,
  padding: 10,
  resize: 'none',
  fontFamily: font.family,
  ...roleFont('field'),
  lineHeight: FIELD_LINE,
  color: PLATE_INK,
  '--pw-placeholder': MUTED,
};

const CARD_FOOT_STYLE: CSSProperties = { display: 'flex', gap: 8, alignItems: 'stretch' };
