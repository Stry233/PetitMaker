/*
 * One textarea serves every composer route and expands into a floating editor past the inline
 * capacity; both forms share one value. Inline Enter sends; modified Enter and expanded Enter insert
 * line breaks. Suggestions are overlays: Enter accepts and sends one, Escape drops it, Tab copies it
 * into the value. Row count is derived from the value because Blink counts wrapped placeholder text
 * in `scrollHeight`.
 */
import { type ComposerRoute, displayAgentText } from '../../../agent/panel';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { Icon } from '../parts/sprite';
import { zoneEnter } from '../parts/panel-parts';
import { PANEL_PAD } from '../panel-skin';
import { DANGER_INK, DANGER_SURFACE, INK, INSET, MUTED, PLATE, PLATE_INK, TEXT_SECONDARY, TRACK } from '../../design/tokens';
import { cursors, font, radii, type PwStyle } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../design/focus-source';
import { ActionButton } from '../../primitives/ActionButton';
import { cssMotion, framerMotion } from '../../design/motion';
import { visualRect } from '../../design/visual-rect';
import { useObservedSize } from '../../primitives/use-observed-size';
import { ExpandedField, isCompositionKey, type SeatRect } from './ExpandedField';
import { CLUSTER_SIZE, COMPOSER_HEIGHT, FIELD_LINE, FIELD_MAX_LINES, PILL_RADIUS, WELL_LEAD_IN, WELL_PAD } from './metrics';
import type { I18nKey } from '../../../i18n/keys';
import { useEffectEvent } from '../../primitives/use-effect-event';

export { CLUSTER_SIZE, COMPOSER_HEIGHT, FIELD_MAX_LINES, PILL_RADIUS, WELL_LEAD_IN, WELL_PAD } from './metrics';

/** Placeholder key for each routing mode, kept as literals for the i18n drift check. */
const PLACEHOLDER_KEY: Record<ComposerRoute, I18nKey> = {
  order: 'agent.composer_order',
  steer: 'agent.composer_steer',
  'gate-words': 'agent.composer_gate_words',
  'resume-note': 'agent.composer_resume_note',
};

/** Order-route placeholder while a settled question is awaiting a reply. */
const ANSWERING_PLACEHOLDER_KEY = 'agent.composer_answer_short';

/** Placeholder while the region brush owns input. */
const MARKING_PLACEHOLDER_KEY = 'agent.composer_marking';

/** Shorter placeholders used when the region chip reduces field width. */
const SHORT_PLACEHOLDER_KEY: Record<string, I18nKey> = {
  'agent.composer_steer': 'agent.composer_steer_short',
  'agent.composer_resume_note': 'agent.composer_resume_short',
};

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
  '--pw-placeholder': MUTED,
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
  color: MUTED,
};

const ROUND_BUTTON_BASE: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: radii.pill,
  flex: '0 0 auto',
  border: 'none',
  boxShadow: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const CAVEAT_STYLE: CSSProperties = {
  ...roleFont('caption'), fontFamily: font.family, color: TEXT_SECONDARY,
  lineHeight: 1.4, margin: `${PANEL_PAD}px 4px 0`, textAlign: 'center',
};

const SEND_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: INK, color: PLATE };

/** An off send says so in the track fill and muted ink, never with a fade, like the well beside it. */
const SEND_OFF_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: TRACK, color: MUTED, opacity: 1 };

const STOP_BASE_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: DANGER_SURFACE, color: DANGER_INK };

interface ComposerProps {
  route: ComposerRoute;
  running: boolean;
  /** Current suggested reply projected from the session log. */
  suggestion?: string | null;
  onSend(text: string): void;
  /** Stop was pressed; the caller confirms from that control. */
  onStop(from: RefObject<HTMLElement | null>): void;
  onDropSuggestion(): void;
  /** Continues a paused job when the resume-note field is submitted empty. */
  onResume?(): void;
  /** Terminal-fault instruction and whether it disables text submission. */
  blocked?: { key: I18nKey; off: boolean };
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
  /** Standing reminder under the well while the assistant waits for an order. */
  caveat?: string;
}

export function Composer({
  caveat,
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
  const composing = useRef(false);
  const wellRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
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
  const takeFill = useEffectEvent(() => {
    if (!fill) return;
    setValue(fill.text);
    inputRef.current?.focus({ preventScroll: true });
  });
  useEffect(() => { takeFill(); }, [handed]);

  useEffect(() => {
    if (!focusRef) return undefined;
    focusRef.current = () => inputRef.current?.focus({ preventScroll: true });
    return () => { focusRef.current = null; };
  }, [focusRef]);

  // Measure without changing the live field's height or introducing a temporary scrollbar; a width
  // change (docking, arriving controls) reflows the draft, while the height this sets is ignored.
  const measured = useRef<{ width: number; value: string; expanded: boolean } | null>(null);
  useObservedSize(() => (inputRef.current?.parentElement ? [inputRef.current.parentElement] : null), ([wrap]) => {
    const el = inputRef.current;
    if (!el || !wrap) return;
    const width = wrap.getBoundingClientRect().width;
    const last = measured.current;
    if (last && last.width === width && last.value === value && last.expanded === expanded) return;
    measured.current = { width, value, expanded };
    const line = lineBox(el);
    const wanted = value === '' ? Math.ceil(line) : draftHeight(el);
    const cap = Math.ceil(line * FIELD_MAX_LINES);
    el.style.height = `${cap > 0 ? Math.min(wanted, cap) : wanted}px`;
    const overflow = cap > 0 && wanted > cap;
    el.style.overflowY = overflow ? 'auto' : 'hidden';
    setOverflows(overflow);
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
      const r = visualRect(el);
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
    if (composing.current || isCompositionKey(e.nativeEvent)) {
      e.stopPropagation();
      return;
    }
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
    <motion.div
      {...zoneEnter(reduced)}
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
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              onKeyDown={onKeyDown}
              style={{
                ...INPUT_STYLE,
                // Field growth shares the panel height transition.
                transition: cssMotion('panel.height', ['height'], reduced),
                // Empty placeholder text never shows a scrollbar.
                overflowY: overflows ? 'auto' : 'hidden',
              }}
            />
            {showGhost && (
              <span data-testid="composer-ghost" aria-hidden="true" style={GHOST_STYLE}>
                {displayAgentText(suggestion ?? '', t)}
              </span>
            )}
          </div>
          <ActionButton
            ref={stopRef}
            data-testid="composer-stop"
            title={t('agent.action_stop')}
            aria-label={t('agent.action_stop')}
            aria-hidden={!running}
            tabIndex={running ? 0 : -1}
            disabled={!running}
            onClick={() => onStop(stopRef)}
            style={{
              ...STOP_BASE_STYLE,
              width: running ? CLUSTER_SIZE : 0,
              marginLeft: running ? 0 : -WELL_GAP,
              padding: 0,
              overflow: 'hidden',
              opacity: running ? 1 : 0,
              transition: cssMotion('panel.composer.unfold', ['width', 'margin-left', 'opacity'], reduced),
            }}
          >
            <Icon id="pw-stop" size={19} />
          </ActionButton>
          {/* Offer the expanded editor only after the draft exceeds the inline line limit. */}
          <AnimatePresence initial={false}>
            {overflows && (
              <ActionButton
                key="door"
                data-testid="composer-expand"
                title={t('agent.composer_expand')}
                aria-label={t('agent.composer_expand')}
                onClick={unfold}
                initial={reduced ? false : DOOR_FOLDED}
                animate={DOOR_OPEN}
                exit={DOOR_FOLDED}
                transition={framerMotion('panel.composer.unfold', reduced)}
                style={DOOR_STYLE}
              >
                <Icon id="pw-note" size={17} />
              </ActionButton>
            )}
          </AnimatePresence>
          {regionButton}
          <ActionButton
            data-testid="composer-send"
            title={t('agent.action_send')}
            aria-label={t('agent.action_send')}
            disabled={off}
            onClick={submit}
            style={off ? SEND_OFF_STYLE : SEND_STYLE}
          >
            <Icon id="pw-send" size={16} />
          </ActionButton>
        </div>
      )}
      {caveat !== undefined && <p data-testid="agent-caveat" style={CAVEAT_STYLE}>{caveat}</p>}
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
    </motion.div>
  );
}

/** Resolves a browser pixel line-height or expands a layout-free unitless ratio. */
function lineBox(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const raw = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(raw)) return 0;
  return style.lineHeight.trimEnd().endsWith('px') ? raw : raw * (Number.parseFloat(style.fontSize) || 0);
}

/** Measure at the full text width; the live field may still be animating or scrolling. */
function draftHeight(el: HTMLTextAreaElement): number {
  const probe = document.createElement('textarea');
  probe.className = el.className;
  probe.value = el.value;
  probe.tabIndex = -1;
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = el.style.cssText;
  Object.assign(probe.style, {
    position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
    width: getComputedStyle(el).width, height: '0px', minHeight: '0px',
    overflow: 'hidden', transition: 'none', top: '0px', left: '0px',
  });
  el.parentElement!.appendChild(probe);
  const measured = probe.scrollHeight;
  probe.remove();
  const line = lineBox(el);
  return line > 0 ? Math.ceil(Math.max(1, Math.round(measured / line)) * line) : measured;
}

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
