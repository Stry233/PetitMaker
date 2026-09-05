/*
 * One textarea serves all composer routes and expands from the docked well into a floating editor
 * when its value exceeds the inline capacity. Both forms share one value; closing the expanded form
 * keeps the draft. Enter sends, while Shift/Ctrl/Cmd+Enter inserts a line break.
 *
 * The stop slot remains mounted while idle so the send button does not move. Region controls arrive
 * as caller-owned nodes. Suggestions are visual overlays: Enter accepts and sends one, Escape drops
 * it, and Tab copies it into the editable value. Row count is derived from the value because Blink
 * includes wrapped placeholder text in `scrollHeight`.
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type MutableRefObject, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { ComposerRoute } from '../../agent/session/composer-routing';
import { useT } from '../../i18n/context';
import { Icon } from './icons';
import { INK, INSET, PLATE, PLATE_INK, TRACK } from '../design/tokens';
import { colors, cursors, font, shadows, radii, z } from '../design/styles';
import { PANEL_EDGE } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';
import { windowFooterGhost, windowFooterPrimary } from '../design/window-skin';
import { cssMotion, framerMotion, NO_MOTION } from './motion';

/** Placeholder key for each routing mode, kept as literals for the i18n drift check. */
const PLACEHOLDER_KEY: Record<ComposerRoute, string> = {
  order: 'agent3.composer_order',
  steer: 'agent3.composer_steer',
  'gate-words': 'agent3.composer_gate_words',
  'resume-note': 'agent3.composer_resume_note',
};

/** Order-route placeholder while a settled question is awaiting a reply. */
const ANSWERING_PLACEHOLDER_KEY = 'agent3.composer_answer_short';

/** Placeholder while the region brush owns input. */
const MARKING_PLACEHOLDER_KEY = 'agent3.composer_marking';

/** Shorter placeholders used when the region chip reduces field width. */
const SHORT_PLACEHOLDER_KEY: Record<string, string> = {
  'agent3.composer_steer': 'agent3.composer_steer_short',
  'agent3.composer_resume_note': 'agent3.composer_resume_short',
};

/** Allows inline styles to pass values to pseudo-element CSS. */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/** Resting composer height in px, shared with panel layout calculations. */
export const COMPOSER_HEIGHT = 48;

/** Fixed resting radius keeps multiline text clear of the well's corners. */
export const PILL_RADIUS = COMPOSER_HEIGHT / 2;

/** Field inset from the well's left edge, in px. */
export const WELL_LEAD_IN = 16;

/** Maximum inline field height before it scrolls and offers the expanded editor, in lines. */
export const FIELD_MAX_LINES = 4;

/** Explicit field line-height ratio used by the line-count clamp. */
const FIELD_LINE = 1.35;

/** Well padding and fixed cluster-control size in px. */
export const WELL_PAD = 6;
export const CLUSTER_SIZE = 36;

/** Gap between field and controls, also canceled by the folded expansion door. */
const WELL_GAP = 8;

/** The door's own width, and the same box the region frame beside it wears. */
const DOOR_SIZE = 30;

const WELL_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: WELL_GAP,
  background: INSET,
  borderRadius: PILL_RADIUS,
  padding: `${WELL_PAD}px ${WELL_PAD}px ${WELL_PAD}px ${WELL_LEAD_IN}px`,
  minHeight: COMPOSER_HEIGHT,
  boxSizing: 'border-box',
  boxShadow: 'none',
};

/** Disabled well surface keeps its explanatory placeholder at full opacity. */
const OFF_WELL_STYLE: CSSProperties = { ...WELL_STYLE, background: TRACK };

const FIELD_WRAP_STYLE: CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
};

const INPUT_STYLE: PwStyle = {
  flex: 1,
  minWidth: 0,
  background: 'none',
  border: 'none',
  outline: 'none',
  fontFamily: font.family,
  ...roleFont('field'),
  lineHeight: FIELD_LINE,
  color: PLATE_INK,
  '--pw-placeholder': colors.brownText,
  // Remove textarea resize, baseline and empty-scrollbar defaults from the pill layout.
  resize: 'none',
  display: 'block',
  padding: 0,
  margin: 0,
};

const GHOST_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  pointerEvents: 'none',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  fontFamily: font.family,
  ...roleFont('field'),
  color: colors.brownText,
};

const ROUND_BUTTON_BASE: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 999,
  flex: '0 0 auto',
  border: 'none',
  boxShadow: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const SEND_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: INK, color: PLATE };

/** Disabled send uses the house filled-control treatment. */
const SEND_OFF_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: TRACK, color: colors.brownText };

const STOP_BASE_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: colors.dangerBg, color: colors.dangerText };

export interface ComposerProps {
  route: ComposerRoute;
  running: boolean;
  /** Current suggested reply projected from the session log. */
  suggestion?: string | null;
  onSend(text: string): void;
  onStop(): void;
  onDropSuggestion(): void;
  /** Continues a paused job when the resume-note field is submitted empty. */
  onResume?(): void;
  /** Terminal-fault instruction and whether it disables text submission. */
  blocked?: { key: string; off: boolean };
  /** Whether the map's region brush currently owns text input. */
  marking?: boolean;
  /** Caller-rendered region control and attached-region chip. */
  regionButton?: ReactNode;
  regionChip?: ReactNode;
  /** Whether the order-route placeholder should invite an answer to a settled question. */
  answering?: boolean;
  /** Reports only whether a draft has words, without lifting the draft text into panel state. */
  onDraftChange?(hasWords: boolean): void;
  /** External draft fill; sequence identity lets identical text be applied more than once. */
  fill?: { text: string; seq: number };
  /** Imperative focus handle for actions that leave the current draft unchanged. */
  focusRef?: MutableRefObject<(() => void) | null>;
}

export function Composer({
  route,
  running,
  suggestion,
  onSend,
  onStop,
  onDropSuggestion,
  onResume,
  blocked,
  marking = false,
  regionButton,
  regionChip,
  answering = false,
  onDraftChange,
  fill,
  focusRef,
}: ComposerProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [value, setValue] = useState('');
  /** Whether the single shared field is rendered in the floating editor. */
  const [expanded, setExpanded] = useState(false);
  /** Well geometry: CSS-pixel height for its seat and screen-pixel rect for the body portal. */
  const [seat, setSeat] = useState<{ height: number; rect: SeatRect } | null>(null);
  /** Whether the draft exceeds the inline line limit. */
  const [overflows, setOverflows] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  /** Whether focus should return to the docked field after folding. */
  const returning = useRef(false);
  const showGhost = value === '' && !!suggestion;
  // Region marking overrides fault guidance, which overrides the route placeholder.
  const routeKey = marking ? MARKING_PLACEHOLDER_KEY
    : blocked ? blocked.key
      : answering && route === 'order' ? ANSWERING_PLACEHOLDER_KEY
        : PLACEHOLDER_KEY[route];
  /** Only the field and send button are disabled by this state. */
  const off = marking || blocked?.off === true;
  const placeholderKey = regionChip ? SHORT_PLACEHOLDER_KEY[routeKey] ?? routeKey : routeKey;

  // Derive from state so submit, Escape and suggestion promotion all report consistently.
  const hasWords = value.trim() !== '';
  useEffect(() => { onDraftChange?.(hasWords); }, [hasWords, onDraftChange]);

  // Sequence identity accepts repeated text; preventScroll preserves the job-zone reading position.
  const handed = fill?.seq;
  useEffect(() => {
    if (!fill) return;
    setValue(fill.text);
    inputRef.current?.focus({ preventScroll: true });
    // Sequence, not text, defines a new external fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed]);

  useEffect(() => {
    if (!focusRef) return undefined;
    focusRef.current = () => inputRef.current?.focus({ preventScroll: true });
    return () => { focusRef.current = null; };
  }, [focusRef]);

  /*
   * Measure wrapped draft height before paint, after resetting the old height. Empty fields retain
   * their single row because Blink includes wrapped placeholder text in textarea scrollHeight.
   */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (value === '') {
      el.style.height = '';
      setOverflows(false);
      return;
    }
    const cap = lineBox(el) * FIELD_MAX_LINES;
    el.style.height = 'auto';
    const wanted = el.scrollHeight;
    el.style.height = `${cap > 0 ? Math.min(wanted, cap) : wanted}px`;
    setOverflows(cap > 0 && wanted > cap);
  }, [value, expanded]);

  // Restore focus without moving the surrounding job-zone scroller.
  useEffect(() => {
    if (expanded || !returning.current) return;
    returning.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  /** Measures the well and hands the shared field to the floating editor. */
  function unfold(): void {
    const el = wellRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setSeat({
        height: el.offsetHeight,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    }
    returning.current = true;
    setExpanded(true);
  }

  function submit(): void {
    const trimmed = value.trim();
    if (trimmed !== '') {
      onSend(trimmed);
      setValue('');
      return;
    }
    if (suggestion) {
      onSend(suggestion);
      onDropSuggestion();
      return;
    }
    // An empty resume-note submission resumes without adding guidance.
    if (route === 'resume-note') onResume?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter') {
      // A modifier changes Enter from send to newline.
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      // Each Escape consumes one local layer: suggestion first, then draft, then the parent panel.
      if (showGhost) {
        e.preventDefault();
        e.stopPropagation();
        onDropSuggestion();
        return;
      }
      if (value !== '') {
        e.preventDefault();
        e.stopPropagation();
        setValue('');
      }
      return;
    }
    if (e.key === 'Tab' && showGhost && suggestion) {
      e.preventDefault();
      setValue(suggestion);
      onDropSuggestion();
    }
  }

  return (
    <div
      data-testid="composer"
      // The composer stays fixed below the scrollable job zone and keeps guidance fully legible.
      style={{ flex: '0 0 auto' }}
    >
      {/* Preserve the measured well as the floating editor's morph target and layout seat. */}
      {expanded ? (
        <div
          ref={wellRef}
          data-testid="composer-well"
          data-seat="1"
          style={{ ...(off ? OFF_WELL_STYLE : WELL_STYLE), height: seat?.height }}
        />
      ) : (
        // The focus ring follows the visible well radius rather than the inner textarea.
        <div
          ref={wellRef}
          data-testid="composer-well"
          className={FIELD_WRAP_CLASS}
          style={off ? OFF_WELL_STYLE : WELL_STYLE}
        >
          {/* The attached-region chip occupies the well's leading slot. */}
          {regionChip}
          {/* The wrapper title exposes an ellipsized suggestion while preserving textarea pointer input. */}
          <div
            style={{ ...FIELD_WRAP_STYLE, ...(off ? { pointerEvents: 'none' } : null) }}
            {...(showGhost && suggestion ? { title: suggestion } : {})}
          >
            <textarea
              ref={inputRef}
              data-testid="composer-input"
              className={`pw-search-field ${FIELD_INPUT_CLASS}`}
              rows={1}
              autoComplete="off"
              spellCheck={false}
              disabled={off}
              value={value}
              // The suggestion overlay replaces the ordinary placeholder while visible.
              placeholder={showGhost ? '' : t(placeholderKey)}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              style={{
                ...INPUT_STYLE,
                // Field growth shares the panel height transition.
                transition: cssMotion('panel.height', ['height'], reduced),
                // Empty placeholder text never shows a scrollbar.
                overflowY: value === '' ? 'hidden' : 'auto',
              }}
            />
            {showGhost && (
              <span data-testid="composer-ghost" aria-hidden="true" style={GHOST_STYLE}>
                {suggestion}
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="composer-stop"
            title={t('agent3.action_stop')}
            aria-label={t('agent3.action_stop')}
            aria-hidden={!running}
            tabIndex={running ? 0 : -1}
            disabled={!running}
            onClick={onStop}
            style={{ ...STOP_BASE_STYLE, opacity: running ? 1 : 0 }}
          >
            <Icon id="pw-stop" size={19} />
          </button>
          {/* Offer the expanded editor only after the draft exceeds the inline line limit. */}
          <AnimatePresence initial={false}>
            {overflows && (
              <motion.button
                key="door"
                type="button"
                data-testid="composer-expand"
                title={t('agent3.composer_expand')}
                aria-label={t('agent3.composer_expand')}
                onClick={unfold}
                initial={reduced ? false : DOOR_FOLDED}
                animate={DOOR_OPEN}
                exit={DOOR_FOLDED}
                transition={reduced ? NO_MOTION : framerMotion('panel.composer.unfold')}
                style={DOOR_STYLE}
              >
                <Icon id="pw-note" size={17} />
              </motion.button>
            )}
          </AnimatePresence>
          {regionButton}
          <button
            type="button"
            data-testid="composer-send"
            title={t('agent3.action_send')}
            aria-label={t('agent3.action_send')}
            disabled={off}
            onClick={submit}
            style={off ? SEND_OFF_STYLE : SEND_STYLE}
          >
            <Icon id="pw-send" size={16} />
          </button>
        </div>
      )}
      <ExpandedField
        anchor={wellRef}
        open={expanded}
        seat={seat}
        reduced={reduced}
        value={value}
        placeholder={t(placeholderKey)}
        disabled={off}
        onChange={setValue}
        onSend={() => { setExpanded(false); submit(); }}
        onClose={() => setExpanded(false)}
      />
    </div>
  );
}

/** The well's box as the card reads it, in screen px. */
interface SeatRect { left: number; top: number; width: number; height: number }

/** Resolves a browser pixel line-height or expands a layout-free unitless ratio. */
function lineBox(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const raw = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(raw)) return 0;
  return style.lineHeight.trimEnd().endsWith('px') ? raw : raw * (Number.parseFloat(style.fontSize) || 0);
}

/**
 * Floating form of the shared composer field. It morphs from the measured well, preserves the draft
 * on close, uses an explicit reduced-motion gate for box values, and leaves the panel interactive.
 */
function ExpandedField({
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

  // Remeasure the mounted well while resize or scrolling moves the portal's target.
  useLayoutEffect(() => {
    if (!open) return undefined;
    setFrom(seat?.rect ?? null);
    const measure = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
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

  /** Captures Escape before panel handlers, folding the card while preserving its draft. */
  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, open]);

  const morph = from ? cardBox(from) : null;
  return createPortal(
    <AnimatePresence>
      {open && from && morph && (
        <motion.div
          key="composer-card"
          data-testid="composer-expanded"
          role="group"
          aria-label={t('agent3.composer_expand')}
          initial={reduced ? false : { ...from, borderRadius: PILL_RADIUS }}
          animate={{ ...morph, borderRadius: radii.lg }}
          exit={{ ...from, borderRadius: PILL_RADIUS }}
          transition={reduced ? NO_MOTION : framerMotion('panel.composer.unfold')}
          // The focus ring follows the card's animated radius.
          className={FIELD_WRAP_CLASS}
          style={CARD_STYLE}
        >
          {/* Fade content into the landing box instead of reflowing it through the pill morph. */}
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? NO_MOTION : framerMotion('panel.composer.unfold')}
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
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                onSend();
              }}
              style={CARD_FIELD_STYLE}
            />
            <div style={CARD_FOOT_STYLE}>
              <button
                type="button"
                data-testid="composer-expanded-done"
                title={t('agent3.composer_collapse')}
                aria-label={t('agent3.composer_collapse')}
                onClick={close}
                style={{ ...windowFooterGhost, cursor: cursors.clickable }}
              >
                <Icon id="pw-compress" size={14} />
              </button>
              <button
                type="button"
                data-testid="composer-expanded-send"
                disabled={disabled}
                onClick={onSend}
                style={{ ...windowFooterPrimary, cursor: cursors.clickable }}
              >
                {t('agent3.action_send')}
              </button>
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
  '--pw-placeholder': colors.brownText,
};

const CARD_FOOT_STYLE: CSSProperties = { display: 'flex', gap: 8, alignItems: 'stretch' };

/** Quiet round control in the send cluster. */
const ROUND_QUIET_STYLE: CSSProperties = {
  ...ROUND_BUTTON_BASE,
  width: DOOR_SIZE,
  height: DOOR_SIZE,
  background: 'transparent',
  color: INK,
  cursor: cursors.clickable,
};

/** Expansion door animates width; zero padding lets it collapse completely. */
const DOOR_STYLE: CSSProperties = { ...ROUND_QUIET_STYLE, overflow: 'hidden', padding: 0 };

/** Folded door cancels its adjacent flex gap so it occupies no horizontal space. */
const DOOR_FOLDED = { width: 0, marginLeft: -WELL_GAP, opacity: 0 } as const;
const DOOR_OPEN = { width: DOOR_SIZE, marginLeft: 0, opacity: 1 } as const;
