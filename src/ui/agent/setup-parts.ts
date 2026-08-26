/*
 * setup-parts.ts — what the two connection screens SHARE: the key's own grammar, the roster, and the
 * handful of boxes both of them stand controls in.
 *
 * `SetupScreen` (no key yet) and `ManageScreen` (the gear's one door) are two views of one subject,
 * and the parts they hold in common are the ones a divergence would be invisible in — a field that
 * sits 1px differently, a roster that omits a provider on one screen, two spellings of "is this
 * string a key at all". They are here rather than in either file so neither owns the other.
 *
 * THE SHAPE READING IS PURE AND EXPORTED, because it is the whole of what the field decides and it
 * is decided on every keystroke. `detectProviderFromKey` answers "whose is this" for the formats
 * that are distinct; this adds the three NON-ANSWERS the screen has to tell apart, which is what
 * makes the row's face and the idle gate's destination two readings of one fact:
 *
 *   'partial'   — could still become one, so the field keeps collecting and says so
 *   'ambiguous' — a shape two platforms share, worth probing
 *   'unknown'   — nobody claims it, so the honest route is to ask
 */
import type { CSSProperties } from 'react';
import type { Transition } from 'framer-motion';
import type { Oversight } from '../../agent/core/gates';
import { classify, type RawFailure } from '../../agent/core/errors';
import { detectProviderFromKey } from '../../agent/providers/detect';
import { PROVIDER_IDS, type ProviderId } from '../../agent/providers/defaults';
import { colors, cursors, font, radii } from '../design/styles';
import { INSET, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { framerMotion } from './motion';

/** The translator, as the two screens spell it. `i18n/context` keeps its own `TFunction` private, so
 *  a component taking one as a parameter names the shape (`DeskHeader` does the same). */
export type T = (key: string, params?: Record<string, string | number>) => string;

/** The manual chooser's roster: every provider but `custom`, which is its own entry underneath
 *  since it needs an endpoint before it needs a key. */
export const PROVIDER_ROSTER: readonly ProviderId[] = PROVIDER_IDS.filter((id) => id !== 'custom');

/**
 * WHERE THE CONNECTION SCREEN HAS GOT TO, as one fact the DESK can read.
 *
 * The dock above the job zone says what the session is doing, and a session that has no key has no
 * phase worth saying — so while setup owns the zone the screen reports its own step up instead, and
 * the dock's table turns that into a paper, a word, a meta line and a pose. It is a STEP rather than
 * a face because the two surfaces own different halves: the screen knows where the reading is, and
 * the card knows how a state is said.
 *
 *   awake      — the flow's mouth: the screen is standing and the field is empty
 *   typing     — characters are landing and nothing is claimed yet
 *   shaped     — the format names a provider, and the check is the quiet
 *   ambiguous  — `sk-<hex>`: two platforms share it, so both are being asked
 *   unknown    — nobody claims the shape, so the row is open asking
 *   refused    — the provider turned the key down
 *   no-answer  — nobody answered the probe at all
 *   endpoint   — the custom server's address is being typed
 *   confirmed  — a provider is armed and its model list is out
 *   chosen     — a model is settled and nothing is owed but the press
 *
 * A LISTLESS ENDPOINT HAS NO STEP: no model and no list coming routes the flow to the settings card,
 * whose model row owns that state, so the desk never has a dead end of the flow's to describe.
 */
export type SetupStep =
  | 'awake' | 'typing' | 'shaped' | 'ambiguous' | 'unknown' | 'refused' | 'no-answer'
  | 'endpoint' | 'confirmed' | 'chosen';

/**
 * WHERE THE CONNECTION SCREEN OPENS, for a caller that is answering a named repair rather than
 * starting the flow.
 *
 * A banner's fix pill points at ONE step: "Fix key" at the field, "Change provider" at the manual
 * chooser, "Edit endpoint" at the custom server's address. Walking the user to the mouth and asking
 * them to find it again is the pill not doing what it says. `'key'` is the flow's own mouth and the
 * default, so a caller that is not repairing anything says nothing.
 */
export type SetupEntry = 'key' | 'chooser' | 'endpoint';

export interface SetupFace {
  step: SetupStep;
  /** What the step's words name, where they name anything: the provider, or the endpoint's host. */
  name?: string;
}

export const OVERSIGHTS: readonly Oversight[] = ['strict', 'checkpoint', 'yolo'];

/** Oversight → its segment label and the caption under the row, as DATA: one table drives the manage
 *  card's control, the dock's own reading of the live connection, and the i18n drift detector, which
 *  only sees a key written as a quoted literal. */
export const OVERSIGHT_COPY: Record<Oversight, { label: string; caption: string }> = {
  strict: { label: 'agent3.oversight_strict', caption: 'agent3.oversight_strict_caption' },
  checkpoint: { label: 'agent3.oversight_checkpoint', caption: 'agent3.oversight_checkpoint_caption' },
  yolo: { label: 'agent3.oversight_yolo', caption: 'agent3.oversight_yolo_caption' },
};

/** The shortest string worth reading as a key at all, and the alphabet every provider's keys use.
 *  Below this the field is still being typed into and no verdict is owed. */
const KEY_OK = /^[A-Za-z0-9_.-]{12,}$/;

/** A `sk-` key of 32 or more hex digits: DeepSeek's shape, and every gateway's. */
const SK_HEX = /^sk-[0-9a-f]{32,}$/i;
/** The same shape, still being typed. */
const SK_PARTIAL = /^s(k(-[0-9a-f]{0,31})?)?$/i;

export type KeyShape = ProviderId | 'empty' | 'partial' | 'ambiguous' | 'unknown';

/** Whether the field holds enough to be worth acting on. */
export function keyLooksUsable(raw: string): boolean {
  return KEY_OK.test(raw.trim());
}

/** What the string looks like SO FAR. Recomputed on every keystroke — the key is judged as it
 *  stands now, never as it stood at the twelfth character. */
export function readKeyShape(raw: string): KeyShape {
  const key = raw.trim();
  if (key === '') return 'empty';
  const named = detectProviderFromKey(key);
  if (named) return named;
  if (SK_HEX.test(key)) return 'ambiguous';
  if (SK_PARTIAL.test(key)) return 'partial';
  return 'unknown';
}

/**
 * WHERE A KEY IN THE FIELD IS OWED TO GO, as one table both of the screen's advances read.
 *
 * The idle gate and Enter are the same decision taken at two moments, and written twice they drifted:
 * one branch tested a pin the other could not see, and a shape that was only reachable with a pin
 * left a branch that could never run. So the destination is decided HERE and the screen owns only
 * WHEN to take it (`explicit` is the difference: a press acts on a key too short to read by asking
 * whose it is, the quiet says nothing at all).
 *
 * THE TRAVERSAL, CONDENSED. `shape` is the pin where one stands and the key's own format otherwise,
 * so a pinned provider collapses the readings under it — an ambiguous or unclaimed shape cannot
 * reach these rows while a pick is standing:
 *
 *   shape                     address filed   no address
 *   a named provider          commit          commit
 *   custom (only ever a pin)  commit          endpoint   ← the address is what the key is read against
 *   ambiguous sk-hex          probe           probe      ← a filed address joins the probe set first
 *   unknown                   ask             ask
 *   partial                   null | ask      null | ask ← `explicit` picks
 *   empty                     null            null
 *
 * `commit` files the key and arms the provider; `probe` asks each candidate's `/models`; `ask` opens
 * the manual chooser; `endpoint` sends the user to the address field. `null` is the field still being
 * typed into, which is not a destination.
 */
export type KeyDestination = 'commit' | 'probe' | 'ask' | 'endpoint' | null;

export function keyDestination(a: {
  shape: KeyShape; usable: boolean; endpointFiled: boolean; explicit: boolean;
}): KeyDestination {
  if (a.shape === 'empty') return null;
  // A key too short to be one goes nowhere on its own. A PRESS still gets an answer, and for a shape
  // nobody claims that answer is the question: whose is this?
  if (!a.usable && !a.explicit) return null;
  if (a.shape === 'partial') return a.explicit ? 'ask' : null;
  if (a.shape === 'custom') return a.endpointFiled ? 'commit' : 'endpoint';
  if (a.shape === 'ambiguous') return 'probe';
  if (a.shape === 'unknown') return 'ask';
  return 'commit';
}

/**
 * WHETHER THE ARMED CONNECTION IS THE USER'S OWN SERVER WITH NO ADDRESS BEHIND IT — a question about
 * the STORE, asked before the field is read at all.
 *
 * `custom` is the one provider a key's FORMAT can never answer for: a private gateway issues keys
 * that look like anything, including exactly like a platform's. So while the store says `custom` and
 * no address stands, the address is what the screen asks for whatever is typed, and the shape
 * reading is not consulted.
 *
 * IT IS THE STORE'S `provider` RATHER THAN THE PIN because the pin describes the flow the user is
 * in and is gone by the next page load, while the armed provider is written to disk — and `custom`
 * can only be armed by naming it or by filing a key against it, so it is the user's own standing
 * answer either way. Read the other way round: a session that came back armed on `custom` with the
 * pin lost sent the typed key's shape to whatever platform happened to match it, and the address was
 * never asked for at all.
 */
export function endpointOwed(a: { provider: ProviderId; customBaseUrl: string }): boolean {
  return a.provider === 'custom' && a.customBaseUrl === '';
}

/** Whether an endpoint address is one the app could actually reach: https anywhere, plain http only
 *  at loopback. The full sanitization is `key-storage.ts:sanitizeEndpointUrl`; this is the cheap
 *  reading the gated control dims on, taken before the user has finished typing. */
export function urlLooksUsable(raw: string): boolean {
  return /^https:\/\/\S+/.test(raw.trim()) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(raw.trim());
}

/** An unknown thrown value as the `RawFailure` the harness's own classifier reads, so both
 *  connection screens judge a refusal by the same rules the loop judges one by. Both SDK dialects
 *  carry the HTTP status on `status`; everything else is prose, and `classify` falls back to
 *  reading that. */
export function rawFailure(err: unknown): RawFailure {
  const status = (err as { status?: unknown } | null)?.status;
  return {
    message: err instanceof Error ? err.message : String(err),
    ...(typeof status === 'number' ? { status } : {}),
  };
}

/**
 * WHAT A FAILED MODEL-LIST REQUEST SAYS ABOUT THE ENDPOINT ITSELF, which is the boundary the two
 * connection screens act on: a model may stand unverified over a server that answered, and it may
 * not stand at all over one that did not.
 *
 *   'unreachable' — the check FAILED: nothing answered, or no request could be built. By error
 *                   class: `network` (a fetch that failed, a request the deadline ended), `cors`
 *                   (status 0, an exchange the browser could not complete) and `config` (no address
 *                   to send to). Nothing about the server was learned except that it is not there.
 *   'no-list'     — the endpoint IS reachable and merely serves no readable list: an auth or quota
 *                   refusal, a rate limit, a 5xx, a bare 404 from a gateway with no /models route.
 *                   Every one of those is a server ANSWERING, so a typed model id keeps the same
 *                   trust an empty catalogue earns — a gateway that will not enumerate still runs
 *                   what it is given.
 */
export type EndpointVerdict = 'unreachable' | 'no-list';

export function endpointCheckVerdict(err: unknown): EndpointVerdict {
  const cls = classify(rawFailure(err)).cls;
  return cls === 'network' || cls === 'cors' || cls === 'config' ? 'unreachable' : 'no-list';
}

/* ── the boxes both screens stand controls in ─────────────── */

export const WRAP_STYLE: CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14,
};

/** The line above the field. `margin: 0` because these two are the only PARAGRAPHS in the panel and a
 *  browser gives a `<p>` a block margin of its own em: at the field's size that is another 14px over
 *  the column's own 14px gap, above the line and below it, so every group on the screen stood half
 *  again as far apart as the layout says and the foot's own room went with it. */
export const SAY_STYLE: CSSProperties = {
  ...roleFont('label'), fontFamily: font.family, color: PLATE_INK, lineHeight: 1.5, margin: 0,
};

/** The field's box. LONGHAND border, because the danger state overrides `borderColor` alone and
 *  React warns (rightly) that mixing the two spellings of one value can drop the override. Worn with
 *  `design/focus-source.ts`'s `FIELD_WRAP_CLASS`, over an input wearing its `FIELD_INPUT_CLASS`: the
 *  radius is here and the focus is on the input, so the ring has to be moved up to this box. */
export const FIELD_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9,
  background: INSET, borderRadius: radii.md, padding: '11px 12px',
  borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent',
};

export const INPUT_STYLE: CSSProperties = {
  flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
  ...roleFont('field'), fontFamily: font.family, color: PLATE_INK, letterSpacing: '.05em',
  cursor: cursors.text,
};

export const NOTE_STYLE: CSSProperties = {
  ...roleFont('note'), fontFamily: font.family, color: colors.brownText,
  lineHeight: 1.45, padding: '0 3px', margin: 0,
};

export const GROUP_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

/** Every group that can GROW is pinned here, so it grows upward off the panel's floor and the
 *  control that produced it does not move. */
export const FOOT_STYLE: CSSProperties = { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };

/** What an advancing control wears while its precondition is missing: dimmed and refusing, at
 *  exactly the size and place it already had. */
export const GATED: CSSProperties = { opacity: 0.4, cursor: cursors.blocked };

/** What a `motion` group takes to TRAVEL when a step changes what stands above it, rather than being
 *  redrawn somewhere else (`panel.setup.step`).
 *
 *  `position` only: none of these boxes changes size on a step, and animating the size would stretch
 *  a field and its border radius with it. `transformTemplate` divides the frame's zoom back out of
 *  the travel, which Framer measures in page px and applies as a transform read in the frame's own
 *  (`shell/use-frame-zoom.ts:useZoomedLayoutTransform`). EMPTY under reduced motion, where the step
 *  is said by what the groups hold — the plate's own height move is cut there too.
 */
export interface StepSlide {
  layout?: 'position';
  transition?: Transition;
  transformTemplate?: (values: object, generated: string) => string;
}

export function stepSlide(
  reduced: boolean, transformTemplate: (values: object, generated: string) => string,
): StepSlide {
  if (reduced) return {};
  return { layout: 'position', transition: framerMotion('panel.setup.step'), transformTemplate };
}
