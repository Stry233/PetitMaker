/*
 * DeskHeader.tsx — the desk: the character's slot and THE ONE DOCK CARD, as one group (normative
 * prototype `.desk`/`.headSlot`/`.dock`).
 *
 * ONE CARD, ONE GEOMETRY, EVERY STATE. The dock is a constant `DOCK_HEIGHT` card, top-anchored in
 * the desk, so the character's slot rect never moves as the session changes and no face can push the
 * record below it. Inside that constant box every face is the same four seats:
 *
 *   the GLYPH SLOT — 28px, carrying exactly one 20px state glyph (`dockGlyph`)
 *   the WORD DECK  — the state's own sentence, with the face's datum at its end
 *   the META DECK  — one line of the state's own fact; an EMPTY-META face FOLDS to a single
 *                    vertically centred line and the elapsed clock steps up beside the word
 *   the RIGHT COLUMN — the state's one seat control above (`dockSeat`), the gear constant below
 *
 * THREE OF ITS FACTS LIVE NEXT DOOR, in `dock-face.ts`: which phases are RUNNING, the phase → word
 * table, and the `M:SS` clock. The chip at the parked character's shoulder says the same sentence
 * while this panel is shut, and one job must not be described two ways — so the sentence is a leaf
 * both surfaces read, rather than this file's private table copied into a layer that is eager while
 * the whole dock is lazy.
 *
 * THE STATE IS THE PAPER (`tokens.ts:statePaper`, via `dockPaper`) and the words are the state's own
 * facts. Nothing on the card is an invented widget: what the session owns right now is said as words,
 * as the one glyph, or as a house control. The model name lives behind the gear, progress lives on
 * the build ticket.
 *
 * THE SEAT TABLE IS FOUR ROWS AND NO MORE (`dockSeat`): a running job offers PAUSE, and only where
 * pausing will actually answer (there is a ticket to pause); an ask, a retry and a PAUSE THAT HAS
 * NOT LANDED offer STOP; a hold offers RESUME; every standing face offers nothing. A running dock
 * therefore carries no stop square — a stop is destructive, so it asks first, and the asking is the
 * card itself (see the confirm face below). The composer keeps its own stop for the run in flight.
 *
 * AND ONE ROW THE PHASE ALONE DOES NOT DECIDE: a job the loop still has, with the key gone from
 * under it, keeps a STOP. Every derivation here asks the PHASE before it answers "not connected"
 * (`IN_FLIGHT`): a job mid-build that reads as disconnected is invisible and unstoppable while it
 * goes on editing the map. The keyless face is for a session at rest.
 *
 * THE CONNECTION IS A FAMILY OF FACES OF ITS OWN, and its states come from the JOB ZONE rather than
 * from the projection: the setup screen reports which step it has reached (`ctx.setup`) and the
 * manage card reports that it is open (`ctx.managing`). Neither is a phase and neither could be —
 * the session has not begun, or is standing untouched behind a card — so both arrive as context
 * facts, and `SETUP_FACE` below is where a step becomes a paper, a word, a meta line and a pose.
 * The setup family also owns the three poses the phase mapping cannot reach (see `dockPose`).
 *
 * THE GEAR IS CONSTANT ON EVERY CONNECTED FACE, running included: there is always one press back to
 * the connection surface. THE GEARLESS FACES ARE THE THREE WHERE THAT SURFACE IS ALREADY WHAT THE
 * PANEL IS SHOWING — the setup steps, the keyless sleep, and the MANAGE card itself, whose own Done
 * is the way out. A door drawn on the room it opens into is a second exit for one act. The card still
 * says what the open card is about (`ctx.managing`), a fact of the CHROME rather than of the session,
 * whose job is untouched underneath and comes straight back. The seat above is empty there too: the
 * held job's stop is a worded pill on the card, and the same act offered twice is two controls for
 * one thing.
 *
 * THE PLATE POLICY: a PRESSABLE glyph sits on the ink-wash square (`inkTint.chip`), a REPORTING glyph
 * (the state glyph in its slot) is bare, and the house yellow is the PRESS rather than a resting
 * state.
 *
 * A PRESSED STOP TURNS THE CARD INTO ITS OWN CONFIRM FACE — the question takes the word seat whole,
 * the two answers stand as house pills near the foot, the gear stays and the paper stays the paper it
 * interrupted. Stable geometry by FACE SWAP rather than by a pair of pills squeezed into a standing
 * row: the card is already the one place the session's state is said, so the question belongs on it.
 * A confirm nobody answers retracts itself (`STOP_CONFIRM_MS`), and a state change takes it with it.
 *
 * THE RETRACT FOLLOWS THE HOUSE COUNTDOWN DOCTRINE even though it draws no ring: a POINTER RESTING
 * ON THE CARD HOLDS IT, resuming on leave, so reading the question for four seconds cannot lose it.
 * And the seat it vacates is NUMB for one beat afterwards (`SEAT_NUMB_MS`) — the face underneath
 * puts a different verb in the same box, so without the numb beat a second stop press lands on it.
 *
 * THE VERTICAL CARD FLIP (`panel.dock.flip`) is the one between-state transition: the card leaves
 * edge-on and the new face lands weighted, past flat before it settles. IT KEYS ON STATE IDENTITY
 * (`dockFaceKey`), never on the repaint — a clock tick, a countdown digit or a word said mid-state
 * updates the standing face in place, and only a state change turns the card. The perspective sits on
 * the DESK, the card's own parent: a wrapper in between flattens 3D and the turn renders as a
 * vertical squash. Perspective also makes an element a containing block for fixed descendants, which
 * is safe here and only here — the desk holds the character's MEASURED slot box, while the character
 * itself is one `fixed` element mounted outside this tree (`character/seat.ts`).
 *
 * THE ELAPSED CLOCK IS DERIVED, NEVER ACCUMULATED. A running face counts from the current job's own
 * order (`now - orderAt`, `now` being a render input); a hold and a stop receipt read `lastEventAt`
 * instead, so the number FREEZES at the last thing the log actually recorded rather than counting on
 * through a job that is not proceeding.
 *
 * THE COUNTDOWN IS THE LOOP'S CLOCK, NOT THE BUTTON'S. The retry pill is a `TimedButton` in external
 * mode: the fraction spent comes from `retry.since + retry.delayMs`, so a pointer resting on it
 * cannot pause a backoff the runner is keeping, and an empty ring means the attempt has FIRED.
 * `retry.since` is stamped once, when the marker is logged, and is not refreshed if the marker
 * resurfaces after a gate holds it (see project-view.ts's reconciliation note) — so `remaining` is
 * computed fresh every render and never carried.
 *
 * THE DIGIT-ONLY-TICKS RULE: the seconds count sits in its own leaf node (`data-testid=
 * "retry-seconds"`), split out of the translated sentence by hand around its `{s}` token
 * (`t('agent3.dock_retrying')` called with NO params returns the raw template, since `translateFor`
 * only substitutes a placeholder when a params object is given) — so a re-render that only changes
 * `now` only ever touches that one node's text, and every sibling keeps its DOM identity across the
 * tick.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotionConfig, AnimatePresence } from 'framer-motion';
import type { ErrorClass } from '../../agent/core/types';
import { MAX_TURN_RETRIES } from '../../agent/core/retry';
import type { AskRecord, JobView, PanelView, SessionPhase } from '../../agent/core/project-view';
import { useT } from '../../i18n/context';
import { IconButton, Pill } from './atoms';
import { Character } from './character/Character';
import { poseForPhase, type PoseName } from './character/poses';
import { setSurfacePose } from './character/surface-pose';
import { fmtClock, readCount, RUNNING, STALL_MS, useLastActivity, WORD_FOR_PHASE } from './dock-face';
import type { SetupFace, SetupStep } from './setup-parts';
import { Icon, type IconId } from './icons';
import { metaInk, statePaper, type PaperState } from './tokens';
import { CHARACTER_SEAT } from '../shell/panel-frame';
import { amplitude, cssMotion, flipProfile, framerMotion, outMotion, turnSeconds } from './motion';
import { TimedButton } from '../primitives/TimedButton';
import { INK } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';

/** The card's constant height, in px. Every face stands at exactly this one. */
export const DOCK_HEIGHT = 74;

/**
 * THE SEAT IS RESERVED HERE AND FILLED FROM OUTSIDE. The one live character stands in her own layer
 * (`character/CharacterHost`), placed `fixed` from this box's measured rect, so the desk's business is
 * to leave the box empty and put the card beside it. It carries no offset of its own: the row is
 * top-aligned, so the seat stands on the dock card's own top edge at the plate's padding, and she
 * steps into it when the panel opens.
 */
const DESK_GAP = 10;

/** How far the flip's vanishing point stands from the card. At a 74px card 520px foreshortens
 *  honestly; much more reads as a flat squash, much less as a fisheye. */
const PERSPECTIVE = 520;

/** How far past flat the arriving face settles, in degrees: the landing's weight, as
 *  `panel.dock.flip`'s own entry describes it. Geometry stays at the call site, the way the ticket's
 *  own turn keeps its 180; the registry owns the length and the curve. */
const FLIP_OVERSHOOT = 7;

/** How long a turning card is neither the face that left nor the face that arrived, in ms: the
 *  whole turn, read off the declaration rather than timed here (`turnSeconds`). */
const TURN_MS = turnSeconds('panel.dock.flip') * 1000;

/** How long an unanswered stop confirm stands before it retracts itself, in ms. A question the user
 *  walked away from must not be waiting on the card when they come back to it. */
const STOP_CONFIRM_MS = 4000;

/** How long the vacated seat refuses a press after a confirm has retracted itself, in ms.
 *
 *  The confirm forces the seat to a Ghost, and the face underneath puts a DIFFERENT verb back in the
 *  same 28px box the stop was pressed in — so a hand still going for Stop landed on Pause, silently.
 *  One beat of nothing is what makes that second press MISS rather than mean something else. */
const SEAT_NUMB_MS = 250;

/**
 * The phases in which the LOOP still has the job, which is a wider question than `RUNNING`: an ask,
 * a backoff and a pause that has not landed yet are all a job in flight with the model not
 * streaming.
 *
 * IT IS WHAT THE KEYLESS FACE ASKS FIRST. A key going away does not stop a job — `settings.ts`'s
 * `forgetKey` aborts the runner, but nothing may depend on that being the only path there — and
 * every derivation below asks the phase before it answers "not connected": a job mid-build that
 * reads as disconnected is invisible and unstoppable while it goes on editing the map. The
 * disconnected face is right for a session at REST and wrong for one in flight.
 */
const IN_FLIGHT: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing',
]);

/**
 * Whether the keyless face applies: no key AND nothing in flight to say instead.
 *
 * A TROUBLE FACE IS NOT A SLEEP EITHER. An `incident` outranks the keyless sleep for the same
 * reason a job in flight does: the session has something to say about why it stopped, and "Not
 * connected / a key wakes me" says nothing about it. It is also what makes the auth face's own act
 * land somewhere honest: dropping a refused key must not put the card on the sleeping face, which
 * is neither of the two sentences the trouble family owns (see `keyGone`).
 */
function keylessSleep(view: PanelView, ctx: DockContext): boolean {
  return ctx.connected === false && !IN_FLIGHT.has(view.phase) && view.phase !== 'incident';
}

/**
 * Whether a keyless session has a job it still owes the user a word about, rather than a key that
 * was merely refused.
 *
 * EXPORTED because two surfaces read it and a second reading would drift: the dock words its face
 * from it, and `PanelShell` decides from it whether a keyless panel shows the dreaming office or the
 * job that stopped when the key went away.
 *
 * THERE ARE THREE ENTRANCES, AND ONLY ONE OF THEM IS THE LOOP'S. `phase === 'incident' && cls ===
 * 'auth'` is the LOOP reporting the credential. The other two are the ones a user reaches by
 * revoking a key themselves: `forgetKey` aborts the runner, so a job that was RUNNING settles
 * `aborted`, and a job that was PAUSED has no loop to abort at all. Unnamed, both fall through to
 * the dreaming office, which is the panel telling a user with half a village on the map and an
 * unreachable rewind that it has never had an order. The in-flight phases are in for the same reason: an abort lands at the loop's
 * next await, a whole streaming response or tool call away, and the office over a job still editing
 * the map is the worst of the three faces.
 */
export function keyGone(view: PanelView, connected: boolean, cls: ErrorClass | undefined): boolean {
  if (connected) return false;
  if (view.phase === 'incident') return cls === 'auth';
  return IN_FLIGHT.has(view.phase) || view.phase === 'paused' || view.phase === 'aborted';
}

/**
 * THE SETUP SCREEN'S OWN STEP, WHERE THE DESK HAS NOTHING LOUDER TO SAY.
 *
 * Without its own step the card reads "Not connected / a key wakes me" throughout the whole
 * connection flow — over a confirmed provider, over a chosen model, and on the two dead ends a
 * failed check lands on, where the calm idle paper carries the danger nowhere. The step is not in the
 * projection and cannot be: the session has not begun, so there is no phase to fold. It arrives as a
 * context fact from the surface that knows it, exactly like `managing`.
 *
 * IT TAKES THE SLEEP'S PLACE AND NOT AN INCH MORE, which is why the test is `keylessSleep`'s own: a
 * job the loop still has and a trouble face with its own repair both outrank it, for the reasons
 * those two branches already give. A desk with no step reported keeps the sleep.
 */
function setupFaceOf(view: PanelView, ctx: DockContext): SetupFace | null {
  return ctx.setup && keylessSleep(view, ctx) ? ctx.setup : null;
}

/**
 * A setup step's card, as data (artifact `STATES`' own `mood` rows for the setup group).
 *
 * ONE GLYPH FOR THE WHOLE FAMILY, the key, since every step is the same errand; the manage face is
 * the one connection state that carries the gear instead. A row with no `meta` of its own SAYS ITS
 * NAME — the endpoint's host, the model step's provider — which is what keeps the two rows that have
 * a datum rather than a sentence from needing a template each.
 */
const SETUP_FACE: Record<SetupStep, {
  paper: PaperState; pose: PoseName; word: string; meta?: string;
}> = {
  awake: { paper: 'idle', pose: 'idle', word: 'agent3.dock_setup_awake', meta: 'agent3.dock_setup_show_key' },
  typing: { paper: 'idle', pose: 'keylean', word: 'agent3.dock_setup_reading', meta: 'agent3.dock_setup_watching' },
  shaped: { paper: 'work', pose: 'keylean', word: 'agent3.dock_setup_reading', meta: 'agent3.dock_setup_shaped' },
  ambiguous: { paper: 'work', pose: 'keylean', word: 'agent3.dock_setup_asking_both', meta: 'agent3.setup_row_two' },
  unknown: { paper: 'ask', pose: 'asking', word: 'agent3.dock_setup_new_one', meta: 'agent3.setup_row_whose' },
  refused: { paper: 'danger', pose: 'trouble', word: 'agent3.dock_setup_refused', meta: 'agent3.dock_setup_paste_again' },
  'no-answer': { paper: 'danger', pose: 'trouble', word: 'agent3.dock_setup_no_provider', meta: 'agent3.setup_row_no_answer' },
  endpoint: { paper: 'idle', pose: 'idle', word: 'agent3.dock_setup_point_me' },
  confirmed: { paper: 'work', pose: 'pleased', word: 'agent3.dock_setup_confirmed', meta: 'agent3.dock_setup_confirmed_sub' },
  // The name here is the MODEL rather than the platform: it is the thing that has just been settled,
  // and the platform is already lit on the row under the card.
  chosen: { paper: 'work', pose: 'pleased', word: 'agent3.dock_setup_confirmed', meta: 'agent3.dock_setup_chosen_sub' },
};

/**
 * `SessionPhase` → the dock paper it paints (prototype `.p-idle`/`.p-think`/`.p-work`/`.p-ask`/
 * `.p-wait`/`.p-stop`/`.p-danger`), lifted state by state from the prototype's own mood table.
 *
 * TWO OF THESE ROWS SAY SOMETHING THE PHASE NAME ALONE DOES NOT. `streaming` is the reasoning paper
 * and not the working one: a model streaming TEXT is still working out what to say, and the work
 * paper is for a tool actually landing on the map. And `aborted` wears the STOP tone rather than the
 * wait one — an abort is not a wait, and taupe alone would say the work may yet continue.
 *
 * A `Record`, not a `switch`: a `SessionPhase` this omits fails `tsc` before it can fail silently at
 * runtime (matches atoms.tsx's own `TICK_SPEC` note).
 */
const PAPER_FOR_PHASE: Record<SessionPhase, PaperState> = {
  idle: 'idle',
  thinking: 'think',
  streaming: 'think',
  executing: 'work',
  gated: 'ask',
  retrying: 'wait',
  pausing: 'work',
  paused: 'wait',
  aborted: 'stop',
  incident: 'danger',
};

/** The three transient classes: a ladder that ran out of them is a WAIT that gave up, not a fault
 *  the user can fix, so its face stands on the waiting paper and says so in waiting terms. */
const EXHAUSTED: ReadonlySet<ErrorClass> = new Set<ErrorClass>(['network', 'overloaded', 'rate-limit']);

/** The retry cause's own glyph, by `ErrorClass` (prototype: `pw-cloud-off` for the offline wait,
 *  `pw-retry-clock` for a plain rate-limit, `pw-warning` for everything else it shows waiting). */
const RETRY_ICON: Record<ErrorClass, IconId> = {
  auth: 'pw-warning',
  quota: 'pw-warning',
  'rate-limit': 'pw-retry-clock',
  overloaded: 'pw-warning',
  network: 'pw-cloud-off',
  cors: 'pw-warning',
  overflow: 'pw-warning',
  abort: 'pw-warning',
  config: 'pw-warning',
  model: 'pw-warning',
  unknown: 'pw-warning',
};

/** The retry sentence's HEAD, by cause: the word is the state, the rest of the clause is the act. */
const RETRY_WORD: Record<ErrorClass, string> = {
  auth: 'agent3.dock_retry_again',
  quota: 'agent3.dock_retry_again',
  'rate-limit': 'agent3.dock_retry_busy',
  overloaded: 'agent3.dock_retry_busy',
  network: 'agent3.dock_retry_offline',
  cors: 'agent3.dock_retry_again',
  overflow: 'agent3.dock_retry_again',
  abort: 'agent3.dock_retry_again',
  config: 'agent3.dock_retry_again',
  model: 'agent3.dock_retry_again',
  unknown: 'agent3.dock_retry_again',
};

/**
 * The word a terminal error's face leads with.
 *
 * `auth` IS TWO FACES AND THIS TABLE HOLDS ONE OF THEM: a key the provider REFUSED and a key that
 * is no longer there are the same `ErrorClass` and different sentences ('Key refused.' against
 * 'Key missing.'), and the second is where the first one's own act lands — pressing "Enter a key"
 * drops the refused key, which is the whole point of the press. `keyGone` below picks between them.
 */
const ERROR_WORD: Record<ErrorClass, string> = {
  auth: 'agent3.dock_err_auth',
  quota: 'agent3.dock_err_quota',
  cors: 'agent3.dock_err_cors',
  overflow: 'agent3.dock_err_overflow',
  network: 'agent3.dock_err_no_answer',
  overloaded: 'agent3.dock_err_no_answer',
  'rate-limit': 'agent3.dock_err_no_answer',
  abort: 'agent3.dock_incident',
  config: 'agent3.dock_err_config',
  model: 'agent3.dock_err_model',
  unknown: 'agent3.dock_incident',
};

/** What a press on the card would ACT on, per act face. */
export type DockActId = 'try-again' | 'new-order' | 'fix-key' | 'edit-endpoint' | 'edit-model';

/**
 * The one worded act each terminal face carries: the PRECONDITION where a bare retry would lie.
 *
 * A refused key and a blocked endpoint are not "try again" situations — trying again does the same
 * thing again — so those faces name the repair instead, and only the classes where another attempt
 * genuinely could succeed offer one.
 */
const ERROR_ACT: Record<ErrorClass, { id: DockActId; labelKey: string }> = {
  auth: { id: 'fix-key', labelKey: 'agent3.dock_act_fix_key' },
  quota: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  cors: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  overflow: { id: 'new-order', labelKey: 'agent3.dock_act_new_order' },
  network: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  overloaded: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  'rate-limit': { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  abort: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
  // Nothing was sent, so another attempt would send nothing again: the act is the address itself.
  config: { id: 'edit-endpoint', labelKey: 'agent3.banner_action_edit_endpoint' },
  // Same argument, one field along: the endpoint answered, so the address is not what to change.
  model: { id: 'edit-model', labelKey: 'agent3.banner_action_edit_model' },
  unknown: { id: 'try-again', labelKey: 'agent3.dock_act_try_again' },
};

/** What the newest settled job left on the desk, for the faces the phase alone cannot tell apart: a
 *  built job, an answer, a silent giveup, a run that hit the turn cap, and a closing question that
 *  leaves the session waiting on the user rather than finished. */
type Settled = 'none' | 'build' | 'answer' | 'quiet' | 'capped' | 'question';

function settledKind(view: PanelView): { job?: JobView; kind: Settled } {
  const job = view.jobs[view.jobs.length - 1];
  if (!job) return { kind: 'none' };
  if (job.question === true) return { job, kind: 'question' };
  if (job.outcome === 'capped') return { job, kind: 'capped' };
  if (job.outcome !== 'done') return { job, kind: 'none' };
  return { job, kind: job.kind === 'answer' ? 'answer' : job.kind === 'quiet' ? 'quiet' : 'build' };
}

/**
 * What the dock knows besides the projection: whether a key is held at all, which map the session
 * is standing on (the meta's fallback where the map IS the context), and which provider is armed.
 *
 * THE PROVIDER IS A SETTINGS FACT, which is why it arrives here and not on `PanelView`: the
 * projection is a fold of the session LOG, and who the panel is pointed at is not in it. The one
 * face that says it is the refused key's — "Key refused." on a nine-provider BYOK panel does not
 * say who refused, on the exact face whose act is "go and fix that".
 */
export interface DockContext {
  connected?: boolean;
  mapName?: string;
  providerName?: string;
  /** The armed model, already prettified. A SETTINGS fact for the same reason `providerName` is, and
   *  the datum the unserved-model face needs: "Model unavailable." says nothing about which one. */
  modelName?: string;
  /**
   * THE MAP HOLDS THE PENCIL: the user is painting the region the next order will be confined to.
   *
   * A context fact for the same reason `managing` is — the session underneath is untouched, and a
   * job may well be running through it — but it OUTRANKS every other one, because it is the only
   * state in which the panel is not the surface being used. Whatever the record was showing, what
   * the desk owes is the sentence that says where to look.
   */
  marking?: 'blank' | 'painted';
  /**
   * The manage card is standing in the job zone, so the card above it says what that card is ABOUT.
   *
   * IT IS CHROME OVER THE SESSION, which is why this is a context fact rather than a phase: the job
   * underneath is untouched and comes back the moment the card is dismissed. What the dock owes
   * meanwhile is the subject the user just opened, not the job they are not looking at.
   */
  managing?: boolean;
  /** The live connection as one line, for the manage face's meta: the model and the oversight, in
   *  the caller's own words. A SETTINGS fact, like `providerName` beside it. */
  connectionMeta?: string;
  /**
   * A PAST RECORD IS OPEN over the job zone, and this is its provenance (when it was made, in the
   * caller's own words; empty where the caller offers none).
   *
   * THE DOCK MAY NOT SAY "Ready for orders." OVER AN OPEN RECORD. What the panel is showing is a job
   * from some time ago, and a card claiming the desk is at rest is the panel disagreeing with
   * itself about what the user is looking at. Like `managing`, it is a context fact rather than a
   * phase: the session underneath is untouched and comes back the moment Back is pressed.
   */
  reading?: string;
  /** Which step the setup screen standing in the job zone has reached, where one is. */
  setup?: SetupFace | null;
  /** A DELEGATE IS AT WORK: `store.childLive` is standing, which is a live fact outside the log and
   *  so cannot be read off the view. The dock says only THAT one is, never the child's own task —
   *  that string is model-authored and the meta line is one narrow row that already has to fit
   *  seven locales. */
  helper?: boolean;
  /**
   * THE SETTLED RECORD HAS BEEN PUT AWAY, so the zone is showing the past-jobs row and nothing else.
   *
   * The dock reports a finished job while its RECEIPT is standing — that card and this one are one
   * piece of news — and a desk with the record filed is a desk at rest. Without this the panel said
   * "All done." over a zone whose receipt the user had already dismissed, which is the card
   * disagreeing with the room it stands in.
   */
  recordFiled?: boolean;
  /**
   * THE HOLD IS AN OFFER, not a pause anybody in this page asked for: a session found mid-job at
   * boot (`session/store.ts:restored`). "Paused" describes an act the user does not remember making,
   * and the elapsed clock would be measured across a reload, so the face says where the work stopped
   * and shows no clock at all.
   */
  heldOffer?: boolean;
  /**
   * HOW MANY CELLS THE CALL AT THE OPEN GATE WOULD TOUCH, where its arguments name a place at all.
   *
   * MEASURED BY THE CALLER, because measuring it needs the tool surface's own cell resolver and the
   * live grid, and neither is in the projection. Absent for a one-cell call and for every call that
   * names no place (a rotate by id, a generator recipe): a size the user cannot act on is noise on
   * the one line this card has.
   */
  gateCells?: number;
  /**
   * THIS SESSION IS NO LONGER BEING SAVED (`session/store.ts:storageNotice === 'lost'`): local
   * storage is full, so nothing from here on survives a reload.
   *
   * A running sub-line the artifact draws, and one of the few that may STAND rather than clear: it
   * is not a past event being remembered, it is a condition that is still true. The banner under the
   * card says it in full; this is the line that keeps saying it while the user is watching the dock.
   */
  unsaved?: boolean;
  /** A saved session came back unreadable and was set aside on load (`session/store.ts`'s
   *  `storageNotice === 'corrupt'`): the banner under the card says so in full, and the rest at
   *  idle with nothing behind it, so the dock's own meta names the same fact rather than the map
   *  it is standing on, which the user did not ask to leave. */
  setAside?: boolean;
}

/** The settled readings that OUTLIVE the card being put away: an unfinished job and an unanswered
 *  question are both something still owed, and filing the record does not settle either. */
const OWED_AFTER_FILING: ReadonlySet<Settled> = new Set<Settled>(['capped', 'question']);

/** The paper the dock paints for this view. */
export function dockPaper(view: PanelView, ctx: DockContext = {}): PaperState {
  if (ctx.marking !== undefined) return 'think';
  if (ctx.managing === true) return 'idle';
  if (ctx.reading !== undefined) return 'idle';
  const step = setupFaceOf(view, ctx);
  if (step) return SETUP_FACE[step.step].paper;
  if (keylessSleep(view, ctx)) return 'idle';
  if (view.phase === 'incident') {
    return EXHAUSTED.has(settledKind(view).job?.errorCls ?? 'unknown') ? 'wait' : 'danger';
  }
  if (view.phase === 'idle' && settledKind(view).kind === 'question') return 'ask';
  return PAPER_FOR_PHASE[view.phase];
}

/**
 * The uniform-law glyph, derived per state FAMILY: a retry face names its own cause, the keyless
 * sleep the unplugged mark, a hold the pause, a trouble the warning, a stop receipt the stop, an ask
 * the question, a settled build the check, an answer the reply bubble, a silent end the record, a
 * running job the resume arrow, and a desk with nothing owed the flag.
 */
export function dockGlyph(view: PanelView, ctx: DockContext = {}): IconId {
  if (ctx.marking !== undefined) return 'pw-region-frame';
  if (ctx.managing === true) return 'pw-settings';
  if (ctx.reading !== undefined) return 'pw-history';
  if (view.phase === 'retrying' && view.retry) return RETRY_ICON[view.retry.cls];
  if (setupFaceOf(view, ctx)) return 'pw-key';
  if (keylessSleep(view, ctx)) return 'pw-disconnected';
  if (view.phase === 'pausing' || view.phase === 'paused') return 'pw-pause';
  if (view.phase === 'incident') return 'pw-warning';
  if (view.phase === 'aborted') return 'pw-stop';
  if (view.phase === 'gated') return 'pw-question';
  if (view.phase === 'idle') {
    switch (settledKind(view).kind) {
      case 'question': return 'pw-question';
      case 'answer': return 'pw-reply-bubble';
      case 'quiet': return 'pw-history';
      case 'build': return 'pw-check';
      // A CAP IS NOT A COMPLETION, and the flag is the mark the running face already wears for it:
      // the check would say the job finished, which is the one thing that face is there to deny.
      case 'capped': return 'pw-flag';
      default: return 'pw-flag';
    }
  }
  return 'pw-resume';
}

/** The one seat above the gear: which control it holds, what pressing it does, and how it reads. */
export interface DockSeat {
  id: 'pause' | 'stop' | 'resume';
  /** The verb the press calls, or null for a seat that only reports (a numbed seat, see the
   *  confirm's own beat below). */
  act: 'pause' | 'stop' | 'resume' | null;
  icon: IconId;
  labelKey: string;
}

const SEATS = {
  pause: { id: 'pause', act: 'pause', icon: 'pw-pause', labelKey: 'agent3.dock_pause_at_step' },
  stop: { id: 'stop', act: 'stop', icon: 'pw-stop', labelKey: 'agent3.action_stop' },
  resume: { id: 'resume', act: 'resume', icon: 'pw-resume', labelKey: 'agent3.action_resume' },
} as const satisfies Record<string, DockSeat>;

/**
 * ONE PAUSE PREDICATE, read by the seat table and by nothing else: the dock draws a pause only where
 * pausing will actually answer, which is a job with a ticket standing under it.
 */
function canPause(view: PanelView): boolean {
  return view.current !== undefined;
}

/** The four-row seat table (see the file header). */
export function dockSeat(view: PanelView, ctx: DockContext = {}): DockSeat | null {
  // A MARKED REGION IS NOT A JOB CONTROL. The gesture the user is mid-way through is on the map,
  // and the seat's verbs all aim at a run: offering one here would be a control whose press lands
  // somewhere the user is not looking.
  if (ctx.marking !== undefined) return null;
  // THE MANAGE CARD CARRIES THE HELD JOB'S OWN VERBS, so the seat above it stands empty: the same
  // stop offered twice, once as a square and once as a worded pill, is two controls for one act, and
  // the worded one is the one the card can explain.
  if (ctx.managing === true) return null;
  // AN OPEN RECORD HAS NOTHING TO HOLD EITHER: the job it describes finished some time ago, and the
  // card's own Back is the way out of it.
  if (ctx.reading !== undefined) return null;
  // A setup step's verbs are all on the screen under the card, and it has no job to hold.
  if (setupFaceOf(view, ctx)) return null;
  if (keylessSleep(view, ctx)) return null;
  // A JOB IN FLIGHT WITH NO KEY GETS THE STOP, whatever its phase would otherwise offer: pausing a
  // job that cannot be resumed without a key is not the control the user needs, and `null` here is
  // the one state this predicate exists to forbid — the loop editing the map with nothing to press.
  // A SETTLED trouble face is not in flight and has nothing to stop, key or no key.
  if (ctx.connected === false && IN_FLIGHT.has(view.phase)) return SEATS.stop;
  if (view.phase === 'retrying' || view.phase === 'gated') return SEATS.stop;
  if (RUNNING.has(view.phase)) return canPause(view) ? SEATS.pause : null;
  // PAUSING IS THE STATE A USER MOST WANTS OUT OF, and the pause itself is the thing they cannot
  // hurry: the loop honours a request only at a step boundary, so a pause asked for inside one long
  // call (a `delegate_task`, a `run_generator`) stands for as long as that call takes. The word deck
  // already says "Pausing" and the meta line carries what a dimmed resume seat would report, so the
  // seat is free to be the escape.
  if (view.phase === 'pausing') return SEATS.stop;
  if (view.phase === 'paused') return SEATS.resume;
  return null;
}

/**
 * The card's STATE IDENTITY: what the flip keys on.
 *
 * Two views that differ only in their clock, their meta or a word said mid-state answer the same
 * key, so the standing face repaints in place; a genuine state change answers a different one and
 * turns the card.
 */
export function dockFaceKey(view: PanelView, ctx: DockContext = {}): string {
  if (ctx.marking !== undefined) return `marking:${ctx.marking}`;
  if (ctx.managing === true) return 'manage';
  if (ctx.reading !== undefined) return 'reading';
  const step = setupFaceOf(view, ctx);
  if (step) return `setup:${step.step}`;
  if (keylessSleep(view, ctx)) return 'disconnected';
  if (view.phase === 'retrying') return `retrying:${view.retry?.cls ?? 'unknown'}`;
  if (view.phase === 'incident') {
    const cls = settledKind(view).job?.errorCls ?? 'unknown';
    return `incident:${cls}${keyGone(view, ctx.connected !== false, cls) ? ':gone' : ''}`;
  }
  if (view.phase === 'idle') return `idle:${settledKind(view).kind}`;
  return view.phase;
}

/**
 * The pose the DESK calls for, or null where the phase's own mapping answers.
 *
 * `poseForPhase` cannot reach the setup pair (`keylean`/`pleased`): they portray a screen rather than
 * a session, and a keyless desk reads `sleeping` from the phase. This is their one producer, which is
 * the same channel the card's own words come down.
 *
 * AND IT CANNOT REACH A JOB THAT ENDED ON A QUESTION EITHER, for the same shape of reason: that
 * session's phase is `idle`, which is also where a finished job and an hour of nothing leave it. The
 * card already says "Waiting on you" on the ask paper there, and a character resting beside it would
 * be the desk disagreeing with itself about who is owed something.
 */
export function dockPose(view: PanelView, ctx: DockContext = {}): PoseName | null {
  // She turns to the map and waits: the pencil is not hers for as long as this state stands.
  if (ctx.marking !== undefined) return 'watching';
  // Reading a past job is not a session state, so the phase's own pose stands: the desk is at rest
  // whatever record is being read over it.
  if (ctx.reading !== undefined) return null;
  const step = setupFaceOf(view, ctx);
  if (step) return SETUP_FACE[step.step].pose;
  if (view.phase === 'idle' && settledKind(view).kind === 'question') return 'asking';
  return null;
}

/* ── the face, as data ────────────────────────────────────── */

type FaceKind = 'plain' | 'retry' | 'act' | 'confirm';

/** The card's four seats, resolved to the text and the controls this face stands. */
interface Face {
  kind: FaceKind;
  paper: PaperState;
  glyph: IconId;
  word: string;
  datum?: string;
  meta?: string;
  /** The elapsed reading, absent on a face that carries no clock. */
  clock?: string;
  act?: { id: DockActId; label: string };
  retry?: { secs: number; spent: number; spanMs: number; timed: boolean };
  /** The silence reading, split around its own token so the seconds are one leaf (see the
   *  digit-only-ticks rule). Set only on the stall face, where `meta` is the whole sentence. */
  stall?: { prefix: string; suffix: string; clock: string };
}

/** What a job actually changed on the map, as its own ops recorded it. */
function editCount(job: JobView): number {
  return job.ops.reduce((sum, op) => sum + (op.detail?.cells ?? 0) + (op.detail?.objects ?? 0), 0);
}

export interface DeskHeaderProps {
  view: PanelView;
  /** Feeds `poseForPhase` and the two keyless faces; defaults connected, since a disconnected desk
   *  is a fact its caller (the provider/session layer, above this pure view) must name explicitly. */
  connected?: boolean;
  /** The map the session is standing on, for the meta's fallback. */
  mapName?: string;
  /** The armed provider's display name, which the key faces say as their datum (`DockContext`). */
  providerName?: string;
  /** The armed model's display name, the unserved-model face's own datum (`DockContext`). */
  modelName?: string;
  /** Overrides `poseForPhase` outright. The phase answers what the session IS, which cannot express
   *  a one-shot: celebrating is a MOMENT, and only a caller watching for its edge
   *  (`character/use-celebrate-edge.ts`) knows when that moment is. Unset, the phase decides. */
  pose?: PoseName;
  /** Injected clock for the elapsed reading and the retry countdown, `Date.now()` by default. Tests
   *  pass a fixed value so the derivation (and the digit-only-ticks identity check) is exact. */
  now?: number;
  onPause?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onRetryNow?: () => void;
  /** The gear: one press back to the connection surface. */
  onManage?: () => void;
  /** Whether that surface is what the panel is showing right now, which lights the gear AND turns
   *  the card into the connection's own face. */
  managing?: boolean;
  /** The live connection as one line, said on the manage face's meta deck. */
  connectionMeta?: string;
  /** A past record is open over the job zone, and this is its provenance (`DockContext.reading`). */
  readingRecord?: string;
  /** A delegate is at work (`DockContext.helper`). */
  helper?: boolean;
  /** Which step the setup screen in the job zone has reached, which is the card's whole face while
   *  it stands: the pose, the paper, the words. Absent, the keyless sleep is what a keyless desk
   *  says. */
  setupFace?: SetupFace | null;
  /** A saved session came back unreadable and was set aside on load (`DockContext.setAside`). */
  storageSetAside?: boolean;
  /** The map holds the pencil, and whether a stroke has landed yet (`DockContext.marking`). */
  marking?: 'blank' | 'painted';
  /** How many cells the call at the open gate would touch (`DockContext.gateCells`). */
  gateCells?: number;
  /** The settled record has been put away (`DockContext.recordFiled`). */
  recordFiled?: boolean;
  /** The hold is a restored OFFER rather than a live pause (`DockContext.heldOffer`). */
  heldOffer?: boolean;
  /** Local storage is full, so this session is no longer being saved (`DockContext.unsaved`). */
  unsaved?: boolean;
  /**
   * A STOP PRESSED SOMEWHERE ELSE IN THE PANEL, as a nonce: every new value raises THIS card's stop
   * question, and the question, its retract and its two answers stay here.
   *
   * The take-back law binds every destructive press, so the composer's square asks the same thing the
   * card's own stop asks — and it asks it in the same place, because two confirms for one verb is two
   * chances to word it differently. The composer reports the press and this card holds the question.
   */
  askStop?: number;
  /** A terminal face's worded act, reported by its own id (the verbs live with the caller). */
  onDockAct?: (act: DockActId) => void;
  /** Escape hatch for the single-node character morph: supplying this replaces the `Character` this
   *  component renders by default, without this component needing to know about the morph itself. */
  characterSlot?: ReactNode;
}

export function DeskHeader({
  view,
  connected = true,
  mapName,
  providerName,
  modelName,
  pose,
  now = Date.now(),
  onPause,
  onStop,
  onResume,
  onRetryNow,
  onManage,
  managing = false,
  connectionMeta,
  readingRecord,
  helper = false,
  setupFace,
  askStop,
  onDockAct,
  characterSlot,
  storageSetAside = false,
  marking,
  gateCells,
  recordFiled = false,
  heldOffer = false,
  unsaved = false,
}: DeskHeaderProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  // WHEN THE SESSION WAS LAST SEEN TO MOVE, which is what the stall face is measured against. A
  // hook rather than a prop: the live dribble that keeps a long think from reading as a dead socket
  // is not in the projection, and only a component watching the view arrive can see it.
  const activeAt = useLastActivity(view, now);
  const ctx: DockContext = {
    connected,
    managing,
    ...(mapName !== undefined ? { mapName } : {}),
    ...(providerName !== undefined ? { providerName } : {}),
    ...(modelName !== undefined ? { modelName } : {}),
    ...(connectionMeta !== undefined ? { connectionMeta } : {}),
    ...(readingRecord !== undefined ? { reading: readingRecord } : {}),
    ...(helper ? { helper } : {}),
    ...(setupFace ? { setup: setupFace } : {}),
    ...(storageSetAside ? { setAside: true } : {}),
    ...(marking ? { marking } : {}),
    ...(gateCells !== undefined ? { gateCells } : {}),
    ...(recordFiled ? { recordFiled: true } : {}),
    ...(heldOffer ? { heldOffer: true } : {}),
    ...(unsaved ? { unsaved: true } : {}),
  };
  const key = dockFaceKey(view, ctx);

  // THE LIVE CHARACTER IS NOT IN THIS TREE. In the app her slot here is an empty box and she stands
  // in a layer of her own (`character/CharacterHost`), so a pose derived from the setup step has to
  // be PUBLISHED rather than passed down (`character/surface-pose.ts`). The cleanup hands her back
  // to the phase, which is what a folded panel and a finished setup both want.
  const surfacePose = dockPose(view, ctx);
  useEffect(() => {
    setSurfacePose(surfacePose);
    return () => setSurfacePose(null);
  }, [surfacePose]);

  // A pressed stop turns THIS card into the question. It is the card's own state rather than the
  // session's: nothing is stopped yet, and a state change (or a silence) takes the question away.
  const [asking, setAsking] = useState(false);
  // A POINTER RESTING ON THE DESK IS SOMEBODY READING THE QUESTION, which is the house rule for
  // every self-firing control (`TimedButton`'s own header): the retract holds while the pointer is
  // over it and resumes on leave. Four seconds is long enough to read the question and short enough
  // to lose it, and the retract draws nothing, so a hold is the only defence the reader has.
  //
  // ON THE DESK, NOT ON THE CARD, because the confirm is a FACE and the card turns into it: the
  // turning card is a fresh element, and a browser does not re-dispatch `pointerenter` for a node
  // mounted under a cursor that has not moved, so a hold read at the card would be lost by the very
  // press that opens the question. The desk is the group the card belongs to, and it stands still.
  const [reading, setReading] = useState(false);
  /** The seat's dead beat after a retract: see `SEAT_NUMB_MS`. */
  const [numb, setNumb] = useState(false);
  /** What is left of the retract, in ms. Held across a pause, which is what makes the pause a pause
   *  rather than a restart. */
  const confirmLeft = useRef(STOP_CONFIRM_MS);

  // A state change takes the question with it, and the hover with the question: the flip UNMOUNTS
  // the card, so the pointerleave that would have cleared `reading` may never arrive, and a hover
  // left standing would hold the NEXT confirm open forever.
  useEffect(() => { setAsking(false); setReading(false); }, [key]);
  // A STOP FROM ELSEWHERE RAISES THE SAME QUESTION, and this effect stands AFTER the state watch
  // above on purpose: a press that also moved the session must leave the question standing rather
  // than have it cleared by the move it caused.
  const askedAt = useRef(askStop);
  useEffect(() => {
    if (askStop === undefined || askStop === askedAt.current) return;
    askedAt.current = askStop;
    setAsking(true);
  }, [askStop]);
  useEffect(() => { if (!asking) confirmLeft.current = STOP_CONFIRM_MS; }, [asking]);
  useEffect(() => {
    if (!asking || reading) return undefined;
    const from = Date.now();
    const timer = setTimeout(() => { setAsking(false); setNumb(true); }, confirmLeft.current);
    return () => {
      clearTimeout(timer);
      confirmLeft.current = Math.max(0, confirmLeft.current - (Date.now() - from));
    };
  }, [asking, reading]);
  useEffect(() => {
    if (!numb) return undefined;
    const timer = setTimeout(() => setNumb(false), SEAT_NUMB_MS);
    return () => clearTimeout(timer);
  }, [numb]);

  const seat = dockSeat(view, ctx);
  const face = buildFace(view, ctx, now, activeAt, t);
  const showing: Face = asking
    ? { kind: 'confirm', paper: face.paper, glyph: 'pw-stop', word: t('agent3.dock_stop_question') }
    : face;
  /**
   * WHAT THE CARD TURNS FOR. The confirm is a face of its own, not a control that appears on the
   * standing one, so the card turns INTO the question and turns back out of it — the same move a
   * session state change gets. It carries the paper it interrupted, so the key does too.
   *
   * `key` stays the STATE's identity and is what the retract watches: a session that moves while the
   * question stands takes the question with it, which a key including `asking` could not express.
   */
  const faceKey = asking ? `confirm|${face.paper}` : key;
  // A FLIPPED-IN CONTROL MUST NOT LAND UNDER A STATIONARY CURSOR. The turn puts a different verb in
  // the same box, so for the length of it the card takes no pointer events at all — a second press
  // of a double-click, or a hand already on its way down, would otherwise answer a face it never
  // saw. Timed by the wall clock rather than by the animation's own end, so a turn the engine drops
  // (a hidden tab, a dropped animation) cannot leave the card permanently numb.
  const [turning, setTurning] = useState(false);
  const firstFace = useRef(true);
  useEffect(() => {
    if (firstFace.current) { firstFace.current = false; return undefined; }
    if (reduced) return undefined;
    setTurning(true);
    const timer = setTimeout(() => setTurning(false), TURN_MS);
    return () => clearTimeout(timer);
  }, [faceKey, reduced]);
  // A numbed seat STANDS and only reports, rather than vanishing: the column must not move under
  // the hand that is still reaching for it.
  const shown: DockSeat | null = showing.kind === 'confirm'
    ? null
    : numb && seat ? { ...seat, act: null } : seat;
  // A SESSION FACT IS SAID ON A FACE THAT HAS A SESSION. The keyless sleep is the panel's own setup
  // surface standing in the card's place, and "asks off for this session" over it claims an
  // oversight answer for a session that has not begun — reachable in one press, since the auth
  // face's act clears the key while the log keeps the allow-always answer.
  const showAllow = view.allowAll === true && showing.kind === 'plain' && !keylessSleep(view, ctx);

  const card = (
    <DockCard
      face={showing}
      seat={shown}
      gear={connected && !managing}
      allowAll={showAllow}
      reduced={reduced}
      t={t}
      onSeat={(act) => {
        if (act === 'pause') onPause?.();
        // A stop ASKS first, on the card itself.
        else if (act === 'stop') setAsking(true);
        else if (act === 'resume') onResume?.();
      }}
      onManage={onManage}
      onConfirmStop={() => { setAsking(false); onStop?.(); }}
      onCancelStop={() => setAsking(false)}
      onRetryNow={onRetryNow}
      onDockAct={onDockAct}
    />
  );

  return (
    <div
      data-testid="desk-header"
      onPointerEnter={() => setReading(true)}
      onPointerLeave={() => setReading(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: DESK_GAP,
        flex: '0 0 auto',
        // The flip's vanishing point, on the card's own parent. See the file header for why this is
        // safe above the character's slot.
        perspective: `${PERSPECTIVE}px`,
      }}
    >
      <div
        data-testid="desk-header-char-slot"
        // No radius: the box has no fill and no outline, so a corner on it rounds nothing.
        style={{
          width: CHARACTER_SEAT.w,
          height: CHARACTER_SEAT.h,
          flex: '0 0 auto',
          position: 'relative',
        }}
      >
        {characterSlot
          ?? <Character pose={pose ?? dockPose(view, ctx) ?? poseForPhase(view.phase, { connected })} size={56} />}
      </div>
      {/* THE FLIP, and the whole of it: the departing face leaves edge-on, then the arriving one is
          mounted and lands past flat. `mode="wait"` is what makes those two halves sequential rather
          than a crossfade of two cards. Under reduced motion the card is rendered outright — the
          state is already said by the paper, the glyph and the word, and a turn that cut instantly
          would only delay the swap. */}
      {reduced ? card : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={faceKey}
            style={{
              display: 'flex', flex: 1, minWidth: 0,
              // A card turning on `rotateX` shows its OWN BACK past ninety degrees, which is the
              // same paint mirrored — the words upside down on the paper. Today's curves are all
              // monotone inside the quarter turn, so nothing reaches it; the hide is what keeps a
              // future overshoot from turning a face swap into a mirrored one.
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              ...(turning ? { pointerEvents: 'none' as const } : {}),
            }}
            initial={{ rotateX: 90 }}
            animate={{ rotateX: [90, -FLIP_OVERSHOOT, 0] }}
            exit={{ rotateX: -90, transition: outMotion('panel.dock.flip') }}
            transition={flipProfile('panel.dock.flip')}
          >
            {card}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

/* ── the faces ────────────────────────────────────────────── */

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * WHAT ELSE IS TRUE OF A RUNNING JOB, above the step count.
 *
 * The step count is what a run says when nothing else is happening, and for a long time it was what
 * a run said when anything was: a region refusing an edit, a note waiting to be delivered and a
 * helper working all read as "step 2 of 4". These three are the ones a LIVE carrier can answer, and
 * each clears itself — an op landing, a delivery, the child finishing — so none of them can stick to
 * a face it has stopped describing. Ordered by how much the user needs to know it: something was
 * refused, then something of theirs is waiting, then somebody else is at work.
 *
 * The artifact's other sub-lines wait on carriers that do not exist (the turn budget) or that would
 * stick for the rest of the job if read as live (a plan revision, a compaction stamp): a dock saying
 * "the plan changed" for four more minutes is not the state the artifact draws.
 */
function runningSub(view: PanelView, ctx: DockContext, t: T): string | undefined {
  if (!RUNNING.has(view.phase)) return undefined;
  // The NEWEST SETTLED op, not the newest one: a call in flight says nothing about what the last
  // one did, and the live row is almost always in flight while this face is up.
  const settledOp = [...(view.current?.ops ?? [])].reverse()
    .find((op) => op.status !== 'run' && op.status !== 'pending-gate');
  if (settledOp?.status === 'blocked') return t('agent3.dock_region_held');
  const queued = view.queuedSteers.length;
  if (queued === 1) return t('agent3.dock_steer_next');
  if (queued > 1) return t('agent3.dock_steers_queued', { n: queued });
  if (ctx.helper === true) return t('agent3.dock_helper');
  const playbook = dockSkill(view.current);
  if (playbook !== undefined) return t('agent3.dock_playbook', { title: playbook });
  // Last of the five, because the other three are about the work in front of the user and this one is
  // about the session underneath it — and the banner below the card is already saying it in full.
  if (ctx.unsaved === true) return t('agent3.dock_unsaved');
  return undefined;
}

/**
 * WHAT A GATE ADDS ON ITS SECOND LINE, WHICH IS A SIZE AND NEVER THE QUESTION.
 *
 * The ask card stands directly under this one holding the sentence in full, so a truncated copy of
 * it here would be the same words twice with the shorter one unreadable. What that card does not say
 * is how big the thing is: a plan's step count, and how many cells a write would touch — the summary
 * the loop writes is `describeCall`'s, which carries the call's COORDINATES rather than its extent.
 * Undefined where neither is knowable, and the face then folds to one line as it always did.
 */
function gateSize(view: PanelView, ctx: DockContext, t: T): string | undefined {
  const open = view.gate;
  if (!open) return undefined;
  const ask = openAsk(view);
  const options = ask?.options?.length ?? 0;
  if (options > 0) return t(options === 1 ? 'agent3.dock_options_one' : 'agent3.dock_options', { n: options });
  if (open.scope === 'plan') {
    const stages = ask?.stages?.length;
    return stages !== undefined && stages > 0
      ? t(stages === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: stages })
      : undefined;
  }
  // The caller withholds a count of one, so the plural reading is the only one this can produce.
  return ctx.gateCells === undefined ? undefined : t('agent3.ticket_stage_cells', { n: ctx.gateCells });
}

/** The ask the open gate belongs to: the gate is the QUESTION that can still be answered, and the
 *  record of what it offered (its stages, its options) rides on the ask itself. */
function openAsk(view: PanelView): AskRecord | undefined {
  const gate = view.gate;
  return gate === undefined ? undefined : view.current?.asks.find((ask) => ask.gateId === gate.gateId);
}

/**
 * THE ONE SKILL A RUNNING DOCK NAMES, and the rule is the projection's own (`JobView.skills` is
 * built deduped and in load order for this reading): the newest STYLE, which is a set piece the
 * whole build is following, else the newest method. A job that has loaded three techniques is not
 * three sub-lines, and the one the user can act on is the one shaping what they are watching.
 */
function dockSkill(job: JobView | undefined): string | undefined {
  const skills = job?.skills ?? [];
  const styles = skills.filter((skill) => skill.kind === 'style');
  return (styles.length > 0 ? styles[styles.length - 1] : skills[skills.length - 1])?.title;
}

/**
 * The phases in which the session is WAITING ON THE PROVIDER, which is the only wait a silence
 * reading is about. `executing` is not one of them: a tool call is the app's own work, and a long
 * one is the app being busy rather than the model having gone quiet.
 */
const AWAITING_STREAM: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['thinking', 'streaming']);

/** The state's own card, as data: what the four seats hold. */
function buildFace(view: PanelView, ctx: DockContext, now: number, activeAt: number, t: T): Face {
  const paper = dockPaper(view, ctx);
  const glyph = dockGlyph(view, ctx);
  /**
   * A FILED RECORD IS NOT NEWS — UNLESS THE JOB LEFT SOMETHING OWED.
   *
   * The receipt and this card are one piece of news, so putting the card away takes the dock's
   * reading of it with it. A job that did NOT finish is the exception, and the artifact draws both:
   * a done receipt filed leaves "Ready for orders.", while a CAPPED one filed still says the cap and
   * what is left of the plan, because the work is genuinely unfinished and the record is where the
   * user goes back to it. A standing QUESTION is the same fact in the other direction: an answer is
   * owed whether or not the card that asked is on screen.
   */
  const settledNow = settledKind(view);
  const settled = ctx.recordFiled === true && !OWED_AFTER_FILING.has(settledNow.kind)
    ? { kind: 'none' as const }
    : settledNow;

  if (ctx.marking !== undefined) {
    // The sub-line follows the GESTURE rather than the state: the invitation until a stroke lands,
    // and what happened once one has. Standing on the invitation over a region already painted
    // would be the card asking for something the user has just done.
    return {
      kind: 'plain', paper, glyph, word: t('agent3.dock_marking'),
      meta: t(ctx.marking === 'painted' ? 'agent3.dock_marking_down' : 'agent3.dock_marking_sub'),
    };
  }

  if (ctx.managing === true) {
    return {
      kind: 'plain', paper, glyph, word: t('agent3.dock_connection'),
      ...(ctx.connectionMeta ? { meta: ctx.connectionMeta } : {}),
    };
  }

  if (ctx.reading !== undefined) {
    return {
      kind: 'plain', paper, glyph, word: t('agent3.dock_reading_record'),
      ...(ctx.reading === '' ? {} : { meta: ctx.reading }),
    };
  }

  const setupStep = setupFaceOf(view, ctx);
  if (setupStep) {
    const row = SETUP_FACE[setupStep.step];
    const params = { name: setupStep.name ?? '' };
    // A row with no meta of its own says the NAME: the endpoint's host, the model step's provider.
    const meta = row.meta ? t(row.meta, params) : setupStep.name;
    return { kind: 'plain', paper, glyph, word: t(row.word, params), ...(meta ? { meta } : {}) };
  }

  if (keylessSleep(view, ctx)) {
    return { kind: 'plain', paper, glyph, word: t('agent3.dock_disconnected'), meta: t('agent3.dock_no_key') };
  }

  // The retry family: the word is the sentence's head, the try counter rides the word line as the
  // datum, and the act line is the countdown itself.
  //
  // THE PILL'S BRANCH IS THE CAUSE'S, NOT THE CLOCK'S. A ladder always computes a delay, so a
  // branch on `delayMs > 0` can never take the untimed side and the offline face counted down to an
  // attempt that would fail again, then counted again. A retry waiting on the NETWORK is waiting on
  // the connection coming back rather than on a clock — the fuse would draw something that is not
  // happening — so that one face carries the plain press instead.
  if (view.phase === 'retrying' && view.retry) {
    const { attempt, cls, delayMs, since } = view.retry;
    const remaining = Math.max(0, since + delayMs - now);
    return {
      kind: 'retry',
      paper,
      glyph,
      word: t(RETRY_WORD[cls]),
      datum: t('agent3.dock_try_of', { n: attempt, m: MAX_TURN_RETRIES }),
      retry: {
        secs: Math.ceil(remaining / 1000),
        spent: delayMs > 0 ? Math.min(1, Math.max(0, 1 - remaining / delayMs)) : 1,
        spanMs: delayMs,
        timed: cls !== 'network' && delayMs > 0,
      },
    };
  }

  // A terminal fault: the worded act owns the second line, and the state's own fact is the datum —
  // the ladder's count where it ran out, the provider on either key face. A blocked ENDPOINT
  // carries none: the host does not fit beside the word, and the banner right under the card names
  // it with the repair one press away.
  if (view.phase === 'incident') {
    const cls = settled.job?.errorCls ?? 'unknown';
    // A KEYLESS INCIDENT'S ACT IS ALWAYS THE KEY, whatever the class. `try-again` files the same
    // order again, and with nothing in the vault the one thing another attempt can produce is a
    // fresh auth failure — so a quota or network incident that arrived with no key offered a press
    // that could only make things worse. The repair is the setup form already standing under this
    // card, and the act puts the caret in its field.
    const act = ctx.connected === false ? ERROR_ACT.auth : ERROR_ACT[cls];
    // A key face names its PROVIDER either way: refused or gone, "whose key" is the fact the act
    // needs, and it is the same provider in both.
    const datum = cls === 'auth'
      ? ctx.providerName
      // WHICH MODEL, on the one face whose act is "go and change it". The endpoint's own name is
      // withheld here (it does not fit beside the word) and a model id does, so this face carries
      // the fact the act needs rather than sending the reader to the banner for it.
      : cls === 'model' ? ctx.modelName
        : EXHAUSTED.has(cls) ? t('agent3.dock_after_tries', { n: MAX_TURN_RETRIES }) : undefined;
    return {
      kind: 'act',
      paper,
      glyph,
      word: keyGone(view, ctx.connected !== false, cls) ? t('agent3.dock_err_key_missing') : t(ERROR_WORD[cls]),
      ...(datum ? { datum } : {}),
      act: { id: act.id, label: t(act.labelKey) },
    };
  }

  // A PAUSED JOB READS THE BANKED COUNT, not the running "step N+1" reading: a hold has no step in
  // progress, which is the same argument `pausedWhere` rests on for the ticket's own pausemark. But
  // the dock does NOT read `pausedWhere` itself: its chip two rows below already says the long
  // sentence ("paused after step 2 of 4"), so the dock's own line stays the bare figure — the same
  // terse form the retry face uses, IN ITS OWN KEY. It borrowed `dock_try_of`, which is authored for
  // "attempt n of MAX_TURN_RETRIES" and carries the counter word inside the string in zh and ja
  // (次 / 回): the card read as a retry ladder over a hold while the chip below it counted stages,
  // one fact in two units.
  const step = view.current?.plan
    ? view.phase === 'paused'
      ? t('agent3.dock_stage_of', { n: view.current.plan.doneCount, m: view.current.plan.stages.length })
      : t('agent3.dock_step_of', { n: view.current.plan.doneCount + 1, m: view.current.plan.stages.length })
    : undefined;
  /**
   * WHAT A CAP LEFT UNDONE, which is a different sentence from where a running job has got to.
   *
   * THE PLAN OUTLIVES THE RUN, so this reads the SETTLED job's own: a plan taken from `view.current`
   * is always absent exactly where this face needs it. And it counts what REMAINS rather than
   * naming the stage the run stopped under, because "step 4 of 4" over a job that has ended reads
   * as a step still in progress.
   */
  const cappedPlan = settled.job?.plan;
  const left = cappedPlan ? Math.max(0, cappedPlan.stages.length - cappedPlan.doneCount) : 0;
  const stagesLeft = left > 0
    ? t(left === 1 ? 'agent3.dock_stage_left_one' : 'agent3.dock_stages_left', { n: left })
    : undefined;
  const onMap = ctx.mapName ? t('agent3.dock_on_map', { name: ctx.mapName }) : undefined;

  /** The clock rides through running and asking (a gate is part of the job's time) and stands FROZEN
   *  on a hold or a stop receipt: a running face counts from the order, a settled one reads the last
   *  event the log recorded. */
  const running = RUNNING.has(view.phase) || view.phase === 'gated' || view.phase === 'pausing';
  const anchor = view.phase === 'aborted' ? settled.job : view.current;
  // A RESTORED OFFER HAS NO CLOCK OF ITS OWN: the job ran in a previous page, so every reading here
  // is a span measured across a reload — and the stamps a rehydrated log carries put the two ends at
  // the same moment, which drew a job that had genuinely run for minutes as 0:00.
  const clock = anchor && ctx.heldOffer !== true
    ? fmtClock(((running ? now : view.lastEventAt) - anchor.orderAt) / 1000) ?? undefined
    : undefined;

  if (view.phase === 'idle') {
    const face: Face = { kind: 'plain', paper, glyph, word: t('agent3.dock_idle') };
    switch (settled.kind) {
      case 'build': {
        const edits = editCount(settled.job!);
        return {
          ...face,
          word: t('agent3.dock_done'),
          // A BUILD CAN LAND NOTHING, and the commonest way is the user's own refusal: `writeIssued`
          // is set by the ASK (`project-view.ts`), so a gate they skipped — or a write the rules
          // reverted — still reads as a build here. "0 edits" is then a report of a build that never
          // happened; what the line owes them is that the map is as they left it, which is the same
          // sentence the answer face below already uses for a count of an absence. (`celebrate` reads
          // `writeApplied`, so the character was right about this while the dock was not.)
          meta: edits === 0
            ? t('agent3.dock_no_edits')
            : t(edits === 1 ? 'agent3.history_edits_one' : 'agent3.history_edits', { n: edits }),
        };
      }
      case 'answer': {
        // A REFUSAL READ NOTHING, and "0 reads" is a count of an absence. What that face owes the
        // user is the fact behind the count: the map is exactly as they left it.
        const n = readCount(settled.job!);
        return {
          ...face,
          word: t('agent3.dock_answered'),
          meta: n === 0
            ? t('agent3.dock_no_edits')
            : t(n === 1 ? 'agent3.dock_reads_one' : 'agent3.dock_reads', { n }),
        };
      }
      case 'quiet':
        return { ...face, word: t('agent3.dock_ended'), meta: t('agent3.dock_nothing_said') };
      case 'capped':
        return {
          ...face,
          word: t('agent3.dock_capped'),
          ...(stagesLeft ? { meta: stagesLeft } : onMap ? { meta: onMap } : {}),
        };
      case 'question':
        // The job ended on a question, so the session is waiting on the user rather than resting.
        return { ...face, word: t('agent3.dock_gated') };
      default:
        // A SESSION SET ASIDE ON LOAD OUTRANKS THE MAP: the banner below already names the map (it
        // is the surface the notice stands over), and a dock that answered "on Tafa" instead of the
        // fact that a saved session could not be read told the user something true but not the
        // thing they needed, right over a card whose whole job is that one fact.
        return { ...face, ...(ctx.setAside ? { meta: t('agent3.dock_set_aside') } : onMap ? { meta: onMap } : {}) };
    }
  }

  /**
   * NOTHING HAS BEEN RECEIVED FOR A WHILE, and past `STALL_MS` the card says so instead of going on
   * reassuring. It is measured from the last thing OBSERVED (`useLastActivity`), not from the last
   * thing LOGGED: a reasoning stream dribbles for minutes without appending an event, and reading
   * the log alone would call every long think a dead socket.
   *
   * IT REPAINTS THE STANDING FACE RATHER THAN TURNING THE CARD. The session has not changed state —
   * it is still thinking, and this is what the panel knows about that — so `dockFaceKey` is
   * deliberately blind to it, and the word and the meta line swap in place the way a clock tick and
   * a mid-state sub-line already do.
   */
  const silence = AWAITING_STREAM.has(view.phase) ? now - activeAt : 0;
  const stalled = silence >= STALL_MS;
  const stallClock = stalled ? fmtClock(silence / 1000) : null;
  /**
   * A HOLD THAT BEGAN AT A DECLINE, which is not the same state as a hold the user asked for: the
   * job stopped at a call they said no to, and "Paused" says nothing about why it is standing there.
   * Read off the newest op rather than off the ask, since an ask answered turns ago has calls after
   * it — the decline is only what the job is HELD at while its own row is the last thing that
   * happened.
   */
  const heldAtSkip = view.phase === 'paused'
    && view.current?.ops[view.current.ops.length - 1]?.status === 'skipped';
  /** AN ASK THAT OFFERS CARDS IS A PICK, and "Waiting on you" describes every gate there is: what
   *  this one wants is a choice, so the card says so and counts what is on offer. */
  const picking = view.phase === 'gated' && (openAsk(view)?.options?.length ?? 0) > 0;
  const word = stalled
    ? t('agent3.dock_still_thinking')
    : picking ? t('agent3.dock_pick_one')
    // A hold nobody in this page asked for says where the work stopped, not that it was paused.
    : ctx.heldOffer === true && view.phase === 'paused' ? t('agent3.dock_stopped_partway')
      : heldAtSkip ? t('agent3.dock_holding') : t(WORD_FOR_PHASE[view.phase]);
  const thought = view.current?.thought;
  /** A paused job whose question is still standing (the shape a reload mid-approval comes back in).
   *  The projection withholds `view.gate` outside `gated`, so the ask itself is where this is read. */
  const heldQuestion = view.phase === 'paused'
    && view.current?.asks.some((ask) => ask.verdict === undefined) === true;
  // A GATE SAYS THE SIZE AND NEVER THE QUESTION (see `gateSize`), so the card adds what the ask
  // below it cannot: how many steps, how many cells. Where it knows neither the face folds to one
  // line with the job's clock beside it, which is what a gate has to add.
  const meta = view.phase === 'gated'
    ? gateSize(view, ctx, t)
    : view.phase === 'aborted'
      ? (settled.job && editCount(settled.job) > 0 ? t('agent3.dock_edits_kept') : onMap)
      // The pause is settling, and the meta line says so in place of a dimmed resume seat: the
      // seat itself is the way OUT of a pause that will not land (see `dockSeat`).
      : view.phase === 'pausing'
        ? t('agent3.dock_resume_pending')
        // A HELD QUESTION OUTRANKS THE STEP COUNT. A job paused with an unanswered ask is not
        // "step 2 of 4" waiting to go on: it is waiting on the user, and the dock is the first thing
        // a reload lands on. The ask card below carries the question itself.
        : heldQuestion
          ? t('agent3.dock_question_held')
          // The decline the hold is standing at, which is what the word above it has just named.
          : heldAtSkip
            ? t('agent3.dock_skipped')
            // THE SILENCE OUTRANKS EVERY OTHER RUNNING SUB-LINE. What the last op did, how many
            // notes are queued and how much has been thought are all facts about work that has
            // ALREADY arrived; the one thing the user needs at this point is that nothing has since.
            : stallClock !== null
              ? t('agent3.dock_stall', { t: stallClock })
              : runningSub(view, ctx, t)
                ?? (thought && (view.phase === 'thinking' || view.phase === 'streaming')
                  // A CHARACTER COUNT IS NOT A COUNT OF THOUGHTS: `chars` grows mid-turn as the
                  // stream arrives, so labelling it "thoughts" claimed a discrete count a byte
                  // total never was. `turns` is the honest one — how many turns actually thought,
                  // the same figure the settled record reads (`thoughts_total`).
                  ? t(thought.turns === 1 ? 'agent3.dock_thoughts_one' : 'agent3.dock_thoughts', { n: thought.turns })
                  : step);

  // Split around its own `{t}`, so the ticking reading is one leaf and its two static halves keep
  // their DOM identity across every second (`t` with no params returns the raw template).
  const [stallHead, stallTail] = splitOnToken(t('agent3.dock_stall'), '{t}');
  const stall = stallClock !== null
    ? { prefix: stallHead, suffix: stallTail, clock: stallClock }
    : undefined;

  return {
    kind: 'plain', paper, glyph, word,
    ...(meta ? { meta } : {}),
    ...(stall ? { stall } : {}),
    ...(clock ? { clock } : {}),
  };
}

/* ── the card ─────────────────────────────────────────────── */

const GLYPH_SLOT: CSSProperties = {
  width: 28, height: 28, flex: '0 0 auto', display: 'flex',
  alignItems: 'center', justifyContent: 'center', color: 'inherit', opacity: 0.9,
};

/** Out of flow at the card's top-right corner, so it moves nothing and stands on every face; it
 *  inherits the face's own ink so every paper colour carries it. The offsets keep an even optical
 *  margin against the card's 12px corner radius. */
const BETA_TAG: CSSProperties = {
  ...roleFont('small'),
  position: 'absolute', top: 8, right: 10,
  lineHeight: 1, letterSpacing: 0.5,
  color: 'inherit', opacity: 0.45,
  pointerEvents: 'none', userSelect: 'none',
};

/** The card's strongest line, so `menu`'s 800 rather than `label`'s 700 at the same size. */
const WORD_STYLE: CSSProperties = {
  ...roleFont('menu'),
  fontFamily: font.family,
  color: 'inherit',
  lineHeight: 1.25,
  marginRight: 'auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * A word that may be cut short so a figure beside it is not.
 *
 * `pre`, NOT `nowrap`: splitting a sentence around its placeholder puts each half in its own flex
 * item, and a flex item is its own formatting context — so the space the sentence had before its
 * number is trailing whitespace and is collapsed away. Measured at ru and th, where the meta line
 * read "нет ответа,4:38". `pre` keeps the space and still ellipsizes.
 */
const CLIPPED: CSSProperties = {
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre',
};

const META_STYLE: CSSProperties = {
  ...roleFont('caption'),
  fontFamily: font.family,
  lineHeight: 1.25,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

/**
 * The figure at the word's end.
 *
 * IT KEEPS ITS WIDTH, and a starved word is answered by the STRING rather than by the flex. At the
 * same 74px card that fits "Provider busy" exactly, the Russian and French retry faces read
 * "Провай…" and "Fournis…" — the whole of what the card has to say, lost to a try counter that gives
 * up no pixel. A high shrink factor is measured WORSE (`--locale fr`, the rig): the fr datum is only
 * about 45px, so spending it whole buys the sentence a single character
 * and leaves "2 s…" where a count was. What the sentence actually wanted was the noun the prototype
 * has never had in its own datum, dropped now from all seven locales ("2 of 5", not "try 2 of 5").
 *
 * So the flex is the prototype's, and the ellipsis here is the last resort rather than the policy: a
 * datum longer than the whole deck ellipsizes instead of overflowing a card that clips.
 */
const DATUM_STYLE: CSSProperties = {
  ...roleFont('caption'),
  fontFamily: font.family,
  color: metaInk.figure,
  flex: '0 0 auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginLeft: 6,
  fontVariantNumeric: 'tabular-nums',
};

/** The two pill fills the card's own acts wear, taken from the house helper so a dock pill and a
 *  window pill cannot drift. `inset` names the plate fill, which is what stands out on a coloured
 *  paper. */
const ACT_PILL: CSSProperties = { ...windowPill('quiet', false, 'inset'), boxShadow: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 };

/** The same pill, bounded by the deck it stands in: a control whose LABEL is a translated sentence
 *  cannot be allowed to size the row. See `RetryPill` for why the cap is structural rather than a
 *  budget kept by shortening seven strings. */
const BOUND_PILL: CSSProperties = { ...ACT_PILL, maxWidth: '100%', minWidth: 0 };

/** How far a fresh countdown digit rises from, per its declaration. */
const DIGIT_RISE = amplitude('panel.retry.digit') ?? 0;

/** Splits a raw (un-interpolated) translation template on its first placeholder, so the caller can
 *  place the live number in its own node between the two static halves. A template missing the token
 *  altogether (should not happen — `parity.test.ts` holds every locale's placeholders equal to en's)
 *  still renders legibly: the whole string stands as the prefix, no number node, nothing throws. */
function splitOnToken(template: string, token: string): [string, string] {
  const i = template.indexOf(token);
  return i < 0 ? [template, ''] : [template.slice(0, i), template.slice(i + token.length)];
}

interface DockCardProps {
  face: Face;
  seat: DockSeat | null;
  gear: boolean;
  allowAll: boolean;
  reduced: boolean;
  t: T;
  onSeat(act: 'pause' | 'stop' | 'resume'): void;
  onManage?: () => void;
  onConfirmStop(): void;
  onCancelStop(): void;
  onRetryNow?: () => void;
  onDockAct?: (act: DockActId) => void;
}

function DockCard({
  face, seat, gear, allowAll, reduced, t,
  onSeat, onManage, onConfirmStop, onCancelStop, onRetryNow, onDockAct,
}: DockCardProps) {
  const ink = face.paper === 'danger' ? colors.dangerDeep : INK;
  const factInk = face.paper === 'danger' ? metaInk.danger : metaInk.fact;
  // A face whose second line is an ACT (the retry pill, the worded repair, the two answers) keeps no
  // meta: the act is what that line is for, and the state's own fact rides the word line as a datum.
  const acting = face.kind !== 'plain';
  const solo = !acting && face.meta === undefined && !allowAll;

  return (
    <div
      data-testid="dock"
      data-paper={face.paper}
      data-face={face.kind}
      data-solo={String(solo)}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        height: DOCK_HEIGHT,
        boxSizing: 'border-box',
        borderRadius: 12,
        padding: '0 8px 0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflow: 'hidden',
        color: ink,
        background: statePaper[face.paper],
        // The paper CROSSFADES from one session state's colour to the next (`panel.dock.paper`):
        // a dock that cut between two creams read as a redraw rather than as a change. A plain
        // inline transition, not a Framer animation — it is one property on an element that is
        // already there, and `animations.css` collapses every inline `transition:` under the
        // reduced-motion attribute, which a hand-driven keyframe would not be.
        transition: cssMotion('panel.dock.paper', ['background-color'], reduced),
      }}
    >
      <span data-testid="dock-beta" aria-hidden="true" style={BETA_TAG}>{t('agent3.beta_tag')}</span>

      <span data-testid="dock-glyph" data-icon={face.glyph} style={GLYPH_SLOT}>
        <Icon id={face.glyph} size={20} />
      </span>

      <div
        data-testid="dock-col-words"
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          // THE PADDING IS INSIDE THE CARD'S OWN 74, which `border-box` is what says so. Left at the
          // default `content-box` this column's box came out `height` PLUS its padding — 84 px in a
          // 74 px card — and the row's `align-items: center` then shaved 5 px off the top of the word
          // line and 5 off the bottom of the act pill on every two-row face. The card is right and
          // the content fits it: 10 of padding, an 18 px word line, 7 of air and a 32 px pill is 67.
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: acting ? 'flex-start' : 'center',
          // A QUESTION SITS LOWER THAN AN ACT BY TWO PIXELS, and they are the retry ring's: it hangs
          // outside its pill, the card clips, and the act deck has only about 7px of room under it.
          // The confirm's two answers are shorter than the ring and can afford the deeper rhythm.
          paddingTop: face.kind === 'confirm' ? 12 : acting ? 10 : 0,
        }}
      >
        <div data-testid="dock-deck-word" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <span data-testid="dock-sentence" style={WORD_STYLE}>{face.word}</span>
          {face.datum !== undefined && (
            <span data-testid="dock-datum" style={DATUM_STYLE}>{face.datum}</span>
          )}
          {/* On a solo face the clock steps up beside the word, where the meta line would have been. */}
          {solo && face.clock !== undefined && <Elapsed text={face.clock} />}
        </div>

        {!solo && (
          <div
            data-testid="dock-deck-meta"
            style={{
              display: 'flex', alignItems: 'center', minWidth: 0,
              // A QUESTION GETS ONE MORE PIXEL OF AIR than a fact does: the confirm's two pills read
              // as an answer to the line above them, and the act faces' single pill as part of the
              // same statement.
              marginTop: face.kind === 'confirm' ? 8 : acting ? 7 : 2,
              color: factInk, ...META_STYLE,
            }}
          >
            {face.kind === 'retry' && face.retry && (
              <RetryPill retry={face.retry} t={t} reduced={reduced} {...(onRetryNow ? { onRetryNow } : {})} />
            )}
            {face.kind === 'act' && face.act && (
              <Pill
                variant="quiet"
                on="inset"
                data-testid="dock-act"
                onClick={() => onDockAct?.(face.act!.id)}
              >
                {face.act.label}
              </Pill>
            )}
            {face.kind === 'confirm' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Pill variant="danger" data-testid="dock-confirm-stop" onClick={onConfirmStop}>
                  {t('agent3.action_stop')}
                </Pill>
                <Pill variant="quiet" on="inset" data-testid="dock-confirm-cancel" onClick={onCancelStop}>
                  {t('agent3.action_cancel')}
                </Pill>
              </span>
            )}
            {face.kind === 'plain' && (
              <>
                {/* THE SILENCE READING IS ITS OWN LEAF (the digit-only-ticks rule): a second
                    passing must touch that one text node, so the sentence is rendered as its two
                    static halves around it rather than as one interpolated string.
                    AND THE READING IS THE PART THAT MAY NOT BE LOST. In one ellipsizing span the
                    Russian face read "ничего не приходит,…" at the frame's own 1.25 — the words
                    survived and the number, which is the whole content of the sentence, did not. So
                    the figure stands `0 0 auto` and the WORDS give way around it. */}
                {face.stall ? (
                  <span
                    data-testid="dock-meta"
                    style={{ display: 'flex', minWidth: 0, marginRight: 'auto' }}
                  >
                    <span style={CLIPPED}>{face.stall.prefix}</span>
                    <span data-testid="dock-stall-clock" style={{ flex: '0 0 auto' }}>
                      {face.stall.clock}
                    </span>
                    <span style={CLIPPED}>{face.stall.suffix}</span>
                  </span>
                ) : face.meta !== undefined && (
                  <span
                    data-testid="dock-meta"
                    style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', marginRight: 'auto' }}
                  >
                    {face.meta}
                  </span>
                )}
                {/* An allow-always is SESSION information rather than the state's own, so it stands
                    beside the state's fact rather than being folded into one sentence with it.
                    IT MUST BE ABLE TO GIVE WAY. Held at its natural width beside a state that also
                    has a fact to report, the line overran the deck and the mark was drawn over the
                    clock (the stall face, whose reading is long, is where it showed). Both halves
                    ellipsize now, so a crowded line loses characters rather than legibility. */}
                {allowAll && (
                  <span
                    data-testid="dock-allow-mark"
                    style={{
                      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginLeft: face.meta !== undefined || face.stall !== undefined ? 6 : 0,
                      marginRight: 'auto', opacity: 0.75,
                    }}
                  >
                    {t('agent3.dock_asks_off')}
                  </span>
                )}
                {face.clock !== undefined && <Elapsed text={face.clock} />}
              </>
            )}
          </div>
        )}
      </div>

      <span
        data-testid="dock-col"
        style={{
          alignSelf: 'stretch', flex: '0 0 auto', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {seat ? (
          <IconButton
            testId="dock-seat"
            icon={seat.icon}
            label={t(seat.labelKey)}
            data-act={seat.act ?? undefined}
            disabled={seat.act === null}
            {...(seat.act ? { onClick: () => onSeat(seat.act!) } : {})}
          />
        ) : (
          <Ghost />
        )}
        {gear ? (
          <IconButton
            testId="dock-gear"
            icon="pw-settings"
            label={t('agent3.dock_manage')}
            data-act="manage"
            door
            // A GEAR WITH NOTHING BEHIND IT IS DIMMED RATHER THAN DRAWN LIVE: a headless mount (a
            // test, the artifact rig) wires no verb, and a control that is titled, focusable and
            // hover-lit while doing nothing on press is the defect this reads as absent. The
            // treatment is the numbed seat's — dimmed, the platform cursor, no blocked badge — not a
            // refusal, because the state does not forbid it; there is simply no door here.
            disabled={onManage === undefined}
            {...(onManage ? { onClick: onManage } : {})}
          />
        ) : (
          <Ghost />
        )}
      </span>
    </div>
  );
}

/** The elapsed reading. Its own component so the number is one leaf: a tick replaces this text and
 *  nothing else on the card. */
function Elapsed({ text }: { text: string }) {
  return (
    <span
      data-testid="dock-elapsed"
      style={{ ...roleFont('caption'), fontFamily: font.family, color: metaInk.figure, flex: '0 0 auto', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}
    >
      {text}
    </span>
  );
}

/** The seat that is empty, holding its own space so the column's other control never moves. */
function Ghost() {
  return <span aria-hidden style={{ width: 28, height: 28, flex: '0 0 auto', visibility: 'hidden' }} />;
}


/**
 * The countdown, drawn as the primitive draws it: the pill's own outline IS the backoff, whole and
 * spent to nothing. The clock is the LOOP's — a pointer does not pause it and focus does not cancel
 * it — so the button is handed the fraction rather than a duration, and an EMPTY ring means the
 * attempt has already fired.
 *
 * The offline face has nothing to count down (the retry waits on the connection coming back), so it
 * carries a plain press instead of a fuse that would never move.
 */
function RetryPill(
  { retry, t, reduced, onRetryNow }:
  { retry: NonNullable<Face['retry']>; t: T; reduced: boolean; onRetryNow?: () => void },
) {
  if (!retry.timed) {
    return (
      <Pill variant="quiet" on="inset" data-testid="dock-retry-pill" onClick={() => onRetryNow?.()}>
        {t('agent3.action_retry_now')}
      </Pill>
    );
  }
  const [prefix, suffix] = splitOnToken(t('agent3.dock_retrying'), '{s}');
  // EMPTY MEANS FIRED, so it also means there is nothing left to hurry. The primitive lights the
  // pill at that last frame (its own acknowledgement) and goes on delivering a click, since in
  // `external` mode a press is always a hand's — so the fired pill stops taking one at all rather
  // than looking live at the one moment it can do nothing. `retryNow` is a safe no-op either way
  // (the sleeper's `skip` resolves only a sleep genuinely pending); what it is not is feedback.
  const fired = retry.spent >= 1;
  return (
    <TimedButton
      after={retry.secs}
      // BOUNDED, SO NO FUTURE TRANSLATION CAN REACH THE GEAR. `TimedButton` sets `position: relative`
      // (it anchors its own ring), and a positioned sibling paints ABOVE the un-positioned seat/gear
      // column whatever the DOM order — so a sentence wider than the deck does not merely clip, it
      // draws the countdown over the controls (French is the widest face). The cap is the deck's own
      // width and the shrink is `minWidth: 0`, which the default `min-width: auto` of a flex item
      // would otherwise hold open at the label's min-content.
      // `spanMs` IS WHAT MAKES THE FUSE RUN rather than step: the fraction is sampled once a second
      // by the panel's own tick, and the primitive walks the outline between two samples. Without it
      // the full-motion ring is a nine-step staircase, which is the drawing reduced motion is
      // supposed to be the only one to get.
      external={{ fraction: retry.spent, spanMs: retry.spanMs }}
      onPress={() => { if (!fired) onRetryNow?.(); }}
      data-testid="dock-retry-pill"
      style={fired ? { ...BOUND_PILL, pointerEvents: 'none' } : BOUND_PILL}
    >
      {/* THE DIGITS ARE THE CONTENT, so they never give way: the two static halves of the sentence
          ellipsize around a figure held at its natural width, the stall face's rule applied to the
          one other sub-line that carries a live number. */}
      <span style={{ display: 'flex', minWidth: 0 }}>
        <span style={CLIPPED}>{prefix}</span>
        <b style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', display: 'inline-block', flex: '0 0 auto' }}>
          {/* One digit REPLACING the one before it, rolling up from under (`panel.retry.digit`).
              Keyed on the value, so framer mounts a fresh node per second and the old one is gone
              the instant the new one lands — a countdown crossfading two numbers reads as a display
              fault. `overflow: hidden` on the wrapper is what makes it a roll rather than a number
              sliding past the sentence. */}
          <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}>
            <motion.span
              key={retry.secs}
              data-testid="retry-seconds"
              style={{ display: 'inline-block' }}
              initial={reduced ? false : { y: DIGIT_RISE, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={framerMotion('panel.retry.digit')}
            >
              {retry.secs}
            </motion.span>
          </span>
        </b>
        <span style={CLIPPED}>{suffix}</span>
      </span>
    </TimedButton>
  );
}
