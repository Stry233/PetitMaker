/*
 * Composer.tsx — the composer: four routes in one well, suggestions as ghosts (normative
 * prototype `.comp`).
 *
 * AN ORDER IS AS LONG AS IT NEEDS TO BE, AND ONE FIELD CARRIES IT AT TWO SIZES. The well's field is
 * a TEXTAREA that grows from one line to `FIELD_MAX_LINES` and then scrolls, so a paragraph typed
 * into the pill is readable in the pill; past that the pill is the wrong shape for the job, and the
 * field UNFOLDS into a floating card with room to write and to read back (`ExpandedField` below).
 * The prototype carries neither: a one-line input clipped every
 * order longer than about thirty characters at the exact moment the user was composing the one thing
 * the panel exists for.
 *
 * ONE FIELD, NOT TWO — and that is a geometry rule, not only a data one. The card is the docked
 * field at another size, so it MORPHS out of the well's own box (its corner, its box and its radius
 * tweened from the pill to the card, and back on the way home) and the well stands as an empty SEAT
 * while it is away: no field in it, and the box it held kept, since that box is where the card came
 * from and where it returns. A card that faded in over a well still holding a copy of the text would
 * read as a second field, which is the one thing this must not say.
 *
 * ONE VALUE. The card edits this component's own `value` state — there is no second copy to
 * synchronize and so no direction for a sync to be missed in. Closing the card, by its own press or
 * by Escape, KEEPS what is written: the card is the field at another size, not a dialog with an
 * answer to discard.
 *
 * THE DOOR OPENS WHEN THERE IS SOMETHING BEHIND IT. The expand control renders only while the text
 * has outgrown the well's own lines (`overflows`, read off the same measurement the grow clamp
 * takes), and it unfolds its own width so the send circle beside it travels rather than jumps.
 *
 * ENTER SENDS, SHIFT+ENTER BREAKS THE LINE, at both sizes. Enter is the send key everywhere else in
 * the app and a textarea is not a reason to move it; a newline is what the modifier is for. Ctrl and
 * Cmd read as the modifier too, since a hand reaching for one of those means the same thing.
 *
 * THE STOP SQUARE NEVER MOVES THE SEND CIRCLE. The prototype toggles `.stopb`'s `.hidden` class
 * (`display:none`), which would reflow `send` a stop button's width closer to the input the moment
 * a job ends — exactly the sudden shift the interface's "layout is stable across states" rule bans. This
 * reserves the stop button's slot ALWAYS (native `disabled` + `opacity:0` while idle, never
 * unmounted), so the well's own box and the send circle's box are the SAME two style objects
 * (`WELL_STYLE`/`SEND_STYLE`, module constants never recomputed from `running`) whichever state a
 * job is in.
 *
 * FOUR ROUTES, ONE FIELD: which route a submission takes is `composerRoute`'s call (session/
 * composer-routing.ts) — this component does not re-derive it, only reads the caller's `route` prop
 * for its placeholder copy. It never touches the runner directly (`onSend`/`onStop` are callbacks),
 * so a caller wires it to `createRunner(...).send`/`.stop`, or to a test double alike.
 *
 * THE REGION ATTACHMENT IS SEATED HERE AND OWNED ELSEWHERE (`region-chip.tsx`): the frame button
 * joins the send cluster and the chip docks as the well's LEADING TOKEN, so the pinned composer
 * never moves and nothing above it is covered. Both arrive as nodes, since the chip carries a real
 * photograph of the map and this file reads no store.
 *
 * THE GHOST IS AN OVERLAY, NEVER THE FIELD'S OWN VALUE: `suggestion` rides beside the field's real
 * (locally-owned) text and paints only while that text is empty — typing over it just stops it
 * rendering, it does not clear the standing suggestion. Enter on an empty field sends the ghost
 * itself and drops it; Escape drops it outright; Tab promotes it into real, editable text (still
 * unsent) and drops the standing suggestion, since the field now carries its own copy of it.
 *
 * AND NO GREY LINE DECIDES THE ROW COUNT. A placeholder and a ghost are both drawn in the field's own
 * box, and a wrapped placeholder is part of a textarea's `scrollHeight` in Blink — three rows of it
 * at the docked width — so a field standing EMPTY grew to hold a line nobody typed and snapped back
 * to one row at the first character. The height is arithmetic over the VALUE alone: an empty field is
 * its own single `rows`, and both grey lines are clamped to one line each (the ghost by `nowrap`
 * here, the placeholder by `.pw-search-field::placeholder` in `animations.css`) so what is shown
 * obeys the field's line rules rather than rewriting them.
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

/** `ComposerRoute` → its field's placeholder key, held as DATA (literal quoted strings, so the
 *  i18n drift detector sees every one) rather than a switch — matches `DeskHeader.tsx`'s
 *  `DOCK_SENTENCE_KEY` and `JobTicket.tsx`'s `STAMP_META`. Copy lifted verbatim from the
 *  prototype's own per-mood `ph` field. */
const PLACEHOLDER_KEY: Record<ComposerRoute, string> = {
  order: 'agent3.composer_order',
  steer: 'agent3.composer_steer',
  'gate-words': 'agent3.composer_gate_words',
  'resume-note': 'agent3.composer_resume_note',
};

/**
 * What the `order` route says while a QUESTION is standing, and it is not a fifth route either: the
 * job has settled, so the submission IS an order and takes exactly that path. What has changed is
 * what the user is most likely typing. "Give an order" over the one card whose whole purpose is a
 * question offered nothing that reads as answering it, and the card carries no quick answers of its
 * own (no producer for them yet), so the field was the only way to reply and did not say so.
 */
const ANSWERING_PLACEHOLDER_KEY = 'agent3.composer_answer_short';

/**
 * What the field says while the MAP holds the pencil. Not a sixth route either: the composer has
 * nowhere to send anything because the gesture the user is mid-way through is a gesture on the map,
 * and the field says which surface is listening rather than staying blank.
 */
const MARKING_PLACEHOLDER_KEY = 'agent3.composer_marking';

/**
 * THE LONG PLACEHOLDERS SHORTEN WHILE THE CHIP IS DOCKED, and the reason is measurement rather than
 * taste: the chip takes ~60px off the field's own width, and a placeholder that no longer fits is
 * clipped mid-word — the one line in the composer whose whole job is to say what the field is for.
 * A key with no short form is already short enough at the docked width.
 *
 * THE ANSWER ROUTE HAS NO LONG FORM AT ALL. Its full sentence ("Answer, or give the next order" and
 * its seven translations, 30-40 characters) does not fit the UNDOCKED field either: it was measured
 * clipped mid-word at en and zoom 1, which is how the artifact's own field comes to read the short
 * sentence. So the short one is the route's placeholder outright.
 */
const SHORT_PLACEHOLDER_KEY: Record<string, string> = {
  'agent3.composer_steer': 'agent3.composer_steer_short',
  'agent3.composer_resume_note': 'agent3.composer_resume_short',
};

/** A placeholder's colour rides in as a custom property (`::placeholder` is a pseudo-element an
 *  inline style cannot reach, `animations.css`'s own note on `.pw-search-field`) rather than a
 *  fresh CSS rule for one more field. */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/* Module-level constants, each one the SAME object reference whatever `running`/`disabled` say —
 * the geometry a stop button's own visibility toggle must never perturb. */
/** The composer's own height, in px: the well is a pill of exactly this, whatever it holds. Exported
 *  because the panel's layout has to account for what stands whatever the record does
 *  (`PanelShell:PINNED_HEIGHT`), and a number typed twice is a number that drifts. */
export const COMPOSER_HEIGHT = 48;

/**
 * THE WELL'S CORNER, AND WHY IT IS A NUMBER RATHER THAN THE PILL TOKEN.
 *
 * A pill radius is half the box's height, so a well that GROWS grows its corners with it: at four
 * lines the arc reached ~23px in from the left edge while the field's lead-in is 16, and the first
 * line's opening characters were drawn outside the rounded shape. Held at half the RESTING height,
 * the docked well is the same pill it always was (48 tall, 24 of radius) and a grown one is that pill
 * with straight sides, which no text can escape at any height the field reaches.
 *
 * It is also the radius the floating card's morph starts and ends on, since that is the box it grows
 * out of, and framer tweens the number.
 */
export const PILL_RADIUS = COMPOSER_HEIGHT / 2;

/** The field's own lead-in from the well's left edge, in px. Named because it is what has to COVER
 *  the corner arc: the topmost text pixel sits `WELL_PAD` down, and the rounded edge is still cutting
 *  inward there (`__tests__/ui/agent/field-ring.test.tsx` holds the arithmetic). */
export const WELL_LEAD_IN = 16;

/**
 * How tall the FIELD may grow before it scrolls, in lines.
 *
 * Four, and the number is the panel's rather than a taste: the well is pinned to the panel's foot and
 * every line it takes is a line off the record above it, so the field grows to about a third of the
 * shortest panel and then hands the rest to its own scroller. Past that the floating card is the
 * surface with the room.
 */
export const FIELD_MAX_LINES = 4;

/** The field's own line box, as a multiple of its font size. Named because the grow clamp is
 *  arithmetic over it: a line height left to the UA would make the cap a different number of lines on
 *  every platform. */
const FIELD_LINE = 1.35;

/**
 * The well's own vertical padding, and the tallest control in the send cluster, in px.
 *
 * Exported because the cluster's CENTRING is arithmetic over exactly these two and the well's
 * minimum: the row is centred, so a control of `CLUSTER_SIZE` in a well of `h` sits `(h -
 * CLUSTER_SIZE) / 2` from either edge, which is never nearer than `WELL_PAD` at any height the field
 * can reach. A layout the DOM cannot be asked about in a test is a layout stated in numbers instead.
 */
export const WELL_PAD = 6;
export const CLUSTER_SIZE = 36;

/** The air between the field and each control beside it. Named because the door's own unfold cancels
 *  exactly one of these while it is folded (see `DOOR_FOLDED`). */
const WELL_GAP = 8;

/** The door's own width, and the same box the region frame beside it wears. */
const DOOR_SIZE = 30;

const WELL_STYLE: CSSProperties = {
  display: 'flex',
  // CENTRED, the prototype's own `.comp`: the cluster is one row of round controls beside a field
  // that changes height, and a row seated on its last line puts them 26px below the middle of a
  // four-line well — off centre, and against the well's bottom edge rather than in it.
  alignItems: 'center',
  gap: WELL_GAP,
  background: INSET,
  borderRadius: PILL_RADIUS,
  // The field's own lead-in, and the cluster's ring of air.
  padding: `${WELL_PAD}px ${WELL_PAD}px ${WELL_PAD}px ${WELL_LEAD_IN}px`,
  minHeight: COMPOSER_HEIGHT,
  boxSizing: 'border-box',
  boxShadow: 'none',
};

/**
 * THE WELL WITH NOWHERE TO SEND, and the reason it is a SURFACE rather than a fade.
 *
 * The artifact's own off composer (`.comp.off`) keeps full opacity and steps the well down to the
 * empty-groove tone: the field is off, and the one line it is still carrying — which repair to make,
 * which surface holds the pencil, what to close first — is the whole point of leaving it standing.
 * A group fade takes that line down with the box, and the panel then says nothing at all about why
 * the field refuses. The 0.35 UNAVAILABLE dim stays where the house puts it, on a GATED PILL whose
 * own label is a word the reader has already read.
 */
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
  // A TEXTAREA BROUGHT THREE DEFAULTS THE PILL CANNOT HAVE: a resize grabber in the corner, its own
  // scrollbar showing before there is anything to scroll, and the inline-block baseline gap that put
  // a phantom line under the field.
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

/** The send that cannot send: the house `primary:disabled` idiom (the artifact's `.send:disabled`),
 *  which is a FILL rather than a fade — a filled control carries its own glyph, and fading it to a
 *  third is how a control comes to read as an artefact of the paint rather than as a refusal. */
const SEND_OFF_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: TRACK, color: colors.brownText };

const STOP_BASE_STYLE: CSSProperties = { ...ROUND_BUTTON_BASE, background: colors.dangerBg, color: colors.dangerText };

export interface ComposerProps {
  route: ComposerRoute;
  running: boolean;
  /** The standing `suggest_reply` ghost, or `null`/`undefined` for none. It is a PROJECTION
   *  (`PanelView.suggestion`, folded off the newest such call in the log) rather than a store field,
   *  so nothing has to push it here or clear it: a fresh order nulls it in the fold. */
  suggestion?: string | null;
  onSend(text: string): void;
  onStop(): void;
  onDropSuggestion(): void;
  /** Continue a paused job with NO note. Reached by submitting an empty field on the `resume-note`
   *  route: a paused job most often wants nothing said to it, and without this the only way back
   *  into it is to invent a sentence. Absent, an empty submit stays a no-op. */
  onResume?(): void;
  /**
   * THE ONE INSTRUCTION A TERMINAL FAULT LEAVES, and whether the field is off while it stands.
   *
   * A fault the user must repair FIRST turns the well off and says the repair where the invitation
   * would be ("Change the provider first"), because an order given into an out-of-credit account is
   * an invitation the panel cannot honour. A fault whose repair IS the next order (a job too big to
   * hold) keeps the field live and only rewords it.
   *
   * IT DIMS PER CONTROL RATHER THAN FADING THE GROUP. The region frame beside the send is still a
   * live verb here — marking a region is not something a spent quota stops — and a fade over the
   * whole well would say otherwise. Same rule the marking state already follows.
   */
  blocked?: { key: string; off: boolean };
  /** The map holds the pencil. The field says which surface is listening and takes nothing; the
   *  frame button beside it stays live, since a second press is what ends the gesture. */
  marking?: boolean;
  /**
   * The region attachment, as two nodes this file only SEATS: the frame button in the send cluster
   * and the chip docked as the well's leading token (`region-chip.tsx`).
   *
   * Nodes rather than the region itself, for the reason every picture in this panel is one: the chip
   * carries a real photograph of the live map, and the composer reads no store. Absent, the
   * attachment is unwired — which is a fact about the caller, not a state the layout has to hold
   * room for.
   */
  regionButton?: ReactNode;
  regionChip?: ReactNode;
  /** A settled job left a QUESTION standing, so the `order` route's placeholder says the reply is
   *  welcome here too. Read on that route only: the other three already name what they carry. */
  answering?: boolean;
  /**
   * Whether the field HOLDS WORDS, reported as it changes.
   *
   * The gate family reads it: typed words at any gate cancel the call and become guidance, so the
   * ask card's Approve steps down to the neutral fill the moment there is a sentence to send. The
   * caller is told the FACT rather than the text — nothing above needs the draft itself, and handing
   * it up would re-render the whole panel on every keystroke.
   */
  onDraftChange?(hasWords: boolean): void;
  /**
   * WORDS HANDED IN FROM OUTSIDE THE FIELD (the idle sketch card's press): the field takes them and
   * focuses, and sends nothing — the suggestion is the card's, the decision is the user's.
   *
   * Keyed by `seq` rather than by the text, so pressing the same sketch twice lands twice; the field
   * keeps owning its own value the rest of the time, which is what keeps a keystroke from
   * re-rendering the record above it.
   */
  fill?: { text: string; seq: number };
  /**
   * A SLOT THE COMPOSER PUTS ITS OWN FOCUS VERB IN, for the one caller that has to reach the field
   * without touching what is in it: a terminal banner's "New order" points at this composer, and
   * the press is answered by putting the caret here rather than by handing words in.
   *
   * A ref rather than a seq prop, because there is nothing to render from it — the panel is not
   * holding a value, it is performing an act at the moment of a press.
   */
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
  /** Whether the field is standing as the floating card. The TEXT is not the card's own: it edits
   *  `value`, so there is one value and, while this is true, one field — the card's. */
  const [expanded, setExpanded] = useState(false);
  /**
   * The well's box at the moment the door was pressed: the rect the card morphs out of and back into,
   * and the height the empty seat holds while it is away.
   *
   * TWO READINGS OF ONE BOX, AND THEY ARE IN DIFFERENT UNITS. `height` is the seat's own, in CSS px
   * (`offsetHeight`), because it is written back as a style inside the frame's `zoom` subtree; `rect`
   * is in SCREEN px, because the card is a fixed-position portal on the body and stands outside that
   * subtree. Reading one for the other puts the card at 1.25x of where it belongs.
   */
  const [seat, setSeat] = useState<{ height: number; rect: SeatRect } | null>(null);
  /** Whether what is typed has outgrown the well's own lines: the door's whole condition, and the
   *  same measurement the grow clamp took to decide the height. */
  const [overflows, setOverflows] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  /** The caret goes back to the docked field when the card folds home, since the field it was in is
   *  the field it is returning to. A ref, because it is an act at a moment rather than a value. */
  const returning = useRef(false);
  const showGhost = value === '' && !!suggestion;
  // A fault's own instruction outranks the route's invitation, and stands down to the one state that
  // is about the FIELD itself rather than about the session: the pencil being elsewhere.
  const routeKey = marking ? MARKING_PLACEHOLDER_KEY
    : blocked ? blocked.key
      : answering && route === 'order' ? ANSWERING_PLACEHOLDER_KEY
        : PLACEHOLDER_KEY[route];
  /** The field and the send are off; every other control in the well is not. */
  const off = marking || blocked?.off === true;
  const placeholderKey = regionChip ? SHORT_PLACEHOLDER_KEY[routeKey] ?? routeKey : routeKey;

  // Reported from an effect rather than from the change handler, so every path that empties the
  // field (a submit, Escape, the ghost being promoted) says so through the one line.
  const hasWords = value.trim() !== '';
  useEffect(() => { onDraftChange?.(hasWords); }, [hasWords, onDraftChange]);

  // The hand-in, on its own seq. `preventScroll` because the panel's zone is a scroller and the
  // field is already in view: focusing it must not move the record the user is looking at.
  const handed = fill?.seq;
  useEffect(() => {
    if (!fill) return;
    setValue(fill.text);
    inputRef.current?.focus({ preventScroll: true });
    // The TEXT is not a dependency: the same words handed in again are a new hand-in, and a
    // re-render carrying the same seq is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed]);

  useEffect(() => {
    if (!focusRef) return undefined;
    focusRef.current = () => inputRef.current?.focus({ preventScroll: true });
    return () => { focusRef.current = null; };
  }, [focusRef]);

  /*
   * THE FIELD IS AS TALL AS WHAT IS TYPED IN IT, up to its cap.
   *
   * Measured rather than counted: a line is whatever the field's own width and the writer's own
   * language make it, so the height comes from `scrollHeight` with the element first collapsed to one
   * line — read it while the element is still at its old height and a field that has just SHRUNK
   * reports the taller box it is standing in and never comes back down.
   *
   * AN EMPTY FIELD IS NOT MEASURED AT ALL, and that is the whole of the grey-line rule in one branch:
   * a wrapped placeholder is part of a textarea's `scrollHeight` in Blink, so measuring an empty
   * field reads a line nobody typed. With no height of its own the element is exactly its `rows`,
   * which is one.
   *
   * A LAYOUT effect, because the answer is a size the same paint has to carry: read after paint, the
   * well visibly steps a line late on every keystroke that crosses a boundary.
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

  // The caret comes home with the text. `preventScroll` for the reason every focus here has it: the
  // panel's zone is a scroller and the field is already in view.
  useEffect(() => {
    if (expanded || !returning.current) return;
    returning.current = false;
    inputRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  /** The door: measure the box the card is to come out of, then hand the field over to it. */
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
    // Nothing typed and nothing suggested: the press means "carry on" where there is a job to carry
    // on, and nothing anywhere else.
    if (route === 'resume-note') onResume?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter') {
      // A MODIFIER MEANS "A LINE, NOT A SEND". Enter is the send key everywhere in the app and a
      // textarea is no reason to move it, so the newline is what the modifier buys — and all three
      // modifiers read the same way, since a hand reaching for any of them means the same thing.
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      // TWO RUNGS OF THE ESCAPE LADDER, and each press takes exactly one: the ghost first, then
      // whatever is typed. The press is STOPPED where it lands, which is what leaves the last rung
      // (the panel folding, `PanelShell`'s own handler) to the NEXT press — one key, one answer.
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
      // PINNED: the composer is the panel's bottom zone and never gives way, whatever the record
      // above it is doing (the job zone is the one thing that scrolls).
      // NEVER A GROUP FADE, and the box keeps its full opacity in every state: whatever is off here,
      // the placeholder is still a sentence the reader needs (which repair to make, which surface
      // holds the pencil), and it is the FIRST thing a fade over the group takes away. The refusal
      // is said by the well's own surface and by the send's disabled fill instead. Every control in
      // the well but the field and the send stays LIVE: the frame button is what started a marking
      // gesture and a second press is what ends it.
      style={{ flex: '0 0 auto' }}
    >
      {/* THE SEAT: while the field stands as the card, the well is the pill it left, at the height it
          had. Not a second field, and not a gap either — the box the card morphs back into. */}
      {expanded ? (
        <div
          ref={wellRef}
          data-testid="composer-well"
          data-seat="1"
          style={{ ...(off ? OFF_WELL_STYLE : WELL_STYLE), height: seat?.height }}
        />
      ) : (
        // THE RING IS THE WELL'S, because the well is the shape a reader sees: an outline follows its
        // own element's radius, so drawn on the field it was a rectangle inside the pill
        // (`design/focus-source.ts:FIELD_WRAP_CLASS` carries the whole rule). The other controls in
        // the well keep their own rings — the rule reads the FIELD's focus and nothing else's.
        <div
          ref={wellRef}
          data-testid="composer-well"
          className={FIELD_WRAP_CLASS}
          style={off ? OFF_WELL_STYLE : WELL_STYLE}
        >
          {/* THE CHIP DOCKS INSIDE THE WELL, as its leading token: the composer is pinned to the
              panel's bottom edge, so a chip standing above it would either move the composer or
              cover the record. Here it costs the field width and moves nothing. */}
          {regionChip}
          {/* THE ONE CLIP IN THE PANEL GETS A WAY TO BE READ. The ghost is `nowrap` + ellipsis, so a
              suggestion past the field's ~30 Latin characters is LOST — every other model-authored
              string either wraps or expands on a tap. The title goes on the WRAP rather than on the
              ghost itself: the ghost takes no pointer events (a caret has to reach the field through
              it), and a tooltip resolves against the nearest ancestor that carries one, so the whole
              field answers with the full sentence. Pressing Enter on the empty field still sends the
              suggestion in full — what was clipped was only ever the reading of it. */}
          {/* THE FIELD IS NOT DIMMED WHEN IT IS OFF, only made unreachable: it is carrying the one
              line that explains the refusal, and the whole of `OFF_WELL_STYLE`'s argument is about not
              taking that line down with the control. */}
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
              // THE PLACEHOLDER YIELDS TO THE GHOST. Both paint in the same box on an empty field —
              // the ghost as an overlay over the input's own placeholder — so the two stood one on top
              // of the other and neither could be read. The ghost is the more specific of the two (a
              // sentence to send, against an invitation to write one), so it takes the line.
              placeholder={showGhost ? '' : t(placeholderKey)}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              style={{
                ...INPUT_STYLE,
                // THE GROWTH IS A TWEEN, on the PANEL'S own height declaration: the well's foot and the
                // panel's box are one movement of the same distance, so the field travels on the clock
                // the plate travels on (`panel.setup.step`'s argument, from inside the composer).
                transition: cssMotion('panel.height', ['height'], reduced),
                // Nothing scrolls in a field with nothing in it, and a grey line clamped to one row
                // must not put a scrollbar beside itself.
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
          {/* THE DOOR, WHILE THERE IS SOMETHING BEHIND IT: the well holds four lines, and the card is
              only the better surface once the text has outgrown them. It stands whatever else the well
              is doing — an order too long for the pill is exactly the order a blocked or marking well
              still has in it. */}
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

/**
 * The field's own line box in px.
 *
 * `line-height` is a USED value in a browser, so a declared ratio comes back resolved; a DOM
 * implementation with no layout answers with the ratio itself, and multiplying the font size by it
 * there is what keeps the cap four LINES rather than four ratios.
 */
function lineBox(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const raw = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(raw)) return 0;
  return style.lineHeight.trimEnd().endsWith('px') ? raw : raw * (Number.parseFloat(style.fontSize) || 0);
}

/**
 * THE FIELD AT THE SIZE A PARAGRAPH NEEDS: the docked well's own box, grown.
 *
 * IT IS THE SAME FIELD, NOT A DIALOG OVER ONE. There is no draft of its own and no answer to discard
 * — closing it, by its own press or by Escape, leaves exactly what is written in the well it folds
 * back into. So the card carries two verbs and no cancel: Send, which is the composer's own submit,
 * and the fold, which is the field going home.
 *
 * IT MORPHS OUT OF THE SEAT AND BACK INTO IT. The well's rect is measured at the PRESS (the caller's
 * `unfold`, so the card's first painted frame is already the pill it came from — measured in an
 * effect instead, the card shows one frame at its landing box and the morph reads as a pop), and the
 * four numbers plus the corner radius are what the motion tweens. Width is the well's, so the card
 * reads as the field opened out rather than as a card that happens to be near it; the height is
 * whatever is left above the well, capped, and the card's own textarea takes the rest.
 *
 * MOUNTED ALWAYS, STANDING ONLY WHILE OPEN, so `AnimatePresence` has the pair of states it needs to
 * animate the fold home as well as the unfold. Reduced motion cuts to each box outright: the corner,
 * the box and the radius are values rather than transforms, which framer's own reduced-motion pass
 * does not reach, so the gate is explicit here.
 *
 * NO BACKDROP AND NO OVERLAY LOCK. The panel behind it is not disabled by writing an order — the
 * record is still worth reading while composing one — so this is a POPOVER rung, not a modal.
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

  // The seat's rect as the press read it, and again whenever the window moves it under the standing
  // card: the well is still mounted as the seat, so it can be asked.
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

  // The caret goes into the big field on arrival, at the END of what is already written: the press
  // means "carry on writing", and a caret at the head would have the next character land first.
  useEffect(() => {
    const el = fieldRef.current;
    if (!open || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  /** Escape folds the card home and KEEPS the text, and stops there: the panel folds on Escape
   *  itself, and one key answers one thing. Captured at the window, which is earlier than every
   *  keydown listener the app registers (`FloatMenu` takes the same route for the same reason). */
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
          // The card IS the field here, and the ring belongs to the box that has the radius.
          className={FIELD_WRAP_CLASS}
          style={CARD_STYLE}
        >
          {/* The card's own contents do not travel with the box, they arrive in it: a paragraph
              squeezed into a pill's 48px on the way up would read as text being crushed. */}
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

/** The card's landing box: the well's width and left edge, standing above it in whatever room the
 *  window leaves, and never less than the room a bigger field is worth having. The box it comes out
 *  of and folds back into is the seat's own rect, with the pill's corner. */
function cardBox(seat: SeatRect): SeatRect {
  const height = Math.max(CARD_LEAST, Math.min(CARD_TALL, seat.top - CARD_GAP - CARD_MARGIN));
  return { left: seat.left, width: seat.width, height, top: seat.top - CARD_GAP - height };
}

/** The air between the card and the well it opens out of, in px: the same gap a floating menu keeps
 *  from the row it hangs off. */
const CARD_GAP = 8;
/** The margin the card keeps off the top of the window. */
const CARD_MARGIN = 16;
/** The least room the card takes even in a window with none to spare: below this it is not a bigger
 *  field, and the well's own four lines were the better surface. */
const CARD_LEAST = 180;
/** And the most it takes in a window with room to spare: past this the card is a page rather than a
 *  field, and the record it is written about is covered by it. */
const CARD_TALL = 320;
/** The card's box, less the four numbers the morph animates: those arrive as motion values, so a
 *  static `left`/`top`/`width`/`height` here would fight them. */
const CARD_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: z.popover,
  boxSizing: 'border-box',
  // The pill it grows out of cannot show its contents past its own corners on the way.
  overflow: 'hidden',
  background: PLATE,
  border: PANEL_EDGE,
  boxShadow: shadows.menu,
};

/** The card's contents, laid out at the LANDING size whatever the box is doing: measured against the
 *  box that is arriving rather than the pill it arrives from, so the text is clipped by the growing
 *  corner instead of reflowed at every width the morph passes through. */
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

/** A round button in the send cluster that is not the send: the frame button's own shape, filled with
 *  nothing (`region-chip.tsx` draws the same box, lit). */
const ROUND_QUIET_STYLE: CSSProperties = {
  ...ROUND_BUTTON_BASE,
  width: DOOR_SIZE,
  height: DOOR_SIZE,
  background: 'transparent',
  color: INK,
  cursor: cursors.clickable,
};

/** It unfolds its own width rather than appearing, so the send circle beside it travels the 38px it
 *  gains instead of jumping it. `padding: 0` because a UA button's own side padding is what the
 *  narrowing box would otherwise refuse to give up. */
const DOOR_STYLE: CSSProperties = { ...ROUND_QUIET_STYLE, overflow: 'hidden', padding: 0 };

/**
 * FOLDED IS NOT MERELY NARROW, IT IS ABSENT, and the negative margin is the arithmetic that makes it
 * so: the well spaces its row with `gap`, so an item of no width still costs the two gaps around it.
 * Cancelling exactly one of them leaves the folded door taking nothing at all, and the cluster stands
 * where it stands on a short order.
 */
const DOOR_FOLDED = { width: 0, marginLeft: -WELL_GAP, opacity: 0 } as const;
const DOOR_OPEN = { width: DOOR_SIZE, marginLeft: 0, opacity: 1 } as const;
