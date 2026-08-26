/*
 * SetupScreen.tsx — the panel with no key in it: paste one, find out whose it is, and go.
 *
 * B-BELOW, AND THE ROW IS THE CONTROL. One key field on top, the PROVIDER ROW under it. Typing
 * walks that row's face live — dim "Any provider", then a name "so far", then the name with a
 * spinner while the reading is checked, then a cross where nothing claimed it — and PRESSING the row
 * is the manual chooser. So the answer's slot exists before the answer does, the verdict lands where
 * the user is already looking, and the override is the same control rather than a second one hidden
 * behind "more options". There is no Connect button: the field IS the action.
 *
 * THE ADVANCE IS IDLE-GATED, WHICH IS THE ONE TIMING RULE HERE. A key's format names its provider on
 * every keystroke (`detectProviderFromKey`), but the SCREEN never moves while characters are still
 * arriving: `IDLE_MS` of quiet, or Enter, releases it. Without that gate a paste-then-type, or a key
 * whose 12th character happens to complete a prefix, swapped the screen out from under the hands —
 * and the bail replaced the field node mid-typing, which truncated the key at whatever had landed.
 * A shape no provider claims is the same gate with a different destination: the field keeps the
 * WHOLE key and the quiet opens the row for a manual pick. The clock is one timer inside an effect
 * whose deps carry the draft, which is what makes a keystroke restart it (see the gate itself).
 *
 * A STEP CHANGE MOVES THE GROUPS, AND THE MOVE IS ANIMATED (`panel.setup.step`). The first character
 * typed retires the line above the field, so the field, the row and the note stand ~57px higher for
 * it while the plate's own edge comes up by the same distance (`panel.height`): the two are one
 * movement, and jump-cutting the inside of it read as a different screen arriving under the hands
 * with the caret in it. Framer measures a layout move in PAGE px and applies it as a transform read
 * in the frame's own, so the travel needs the frame's zoom divided back out
 * (`shell/use-frame-zoom.ts:useZoomedLayoutTransform`).
 *
 * THE SCREEN REPORTS ITS STEP UPWARD (`onFace`), because the card above it has no other way to know:
 * the desk says what the session is doing and this session has not begun. `DeskHeader` owns what a
 * step looks like; this file owns which one the reading has reached.
 *
 * A PIN OUTRANKS A READING. An explicit pick writes `settings.providerPinned`, and the shape is only
 * consulted while no choice stands — otherwise an OpenAI pick followed by an OpenAI-shaped key
 * bounced straight back to the chooser it came from.
 *
 * STEPPING OFF A READING DISARMS THE GATE UNTIL THE KEY CHANGES (`heldBack`), and it also RETIRES
 * THE CHECK IN FLIGHT (`reading`). Back means "I am still editing" and opening the chooser by hand
 * means "not this one"; a gate that re-fired 900ms later, or a probe that came back and committed,
 * would walk the user forward out of the step they had just chosen to be on. WHAT RE-ARMS IT is a
 * keystroke, a pick, or an endpoint filed: each of those is an answer to the question the hold was
 * put there over, and a hold outliving its answer is a screen that reads a key nothing will read.
 *
 * A BARE `sk-<hex>` NAMES NOBODY — DeepSeek, a legacy OpenAI key, Qwen, Moonshot and every
 * self-hosted gateway share the shape — so that one case is settled by asking each candidate's
 * `/models` (`probeAmbiguousKey`), and, if none of them answers, by asking the user. The two
 * candidates are named on their own entries INSIDE the row's list, so the ambiguity is resolved
 * where the ambiguity is displayed.
 *
 * NOTHING HERE HANDS THE KEY BACK. The draft is local state and `connectKey` files it in
 * `settings.ts`, whose keyring is deliberately not store state; the one further use this screen has
 * for it (asking the provider to list its models) reads the copy it just typed, never the store.
 *
 * AND THAT REQUEST IS ALSO THE KEY'S FIRST TEST. Nothing before it proves a key is live — the
 * format only says whose it is, and the probe only says which endpoint answers to it — so a refusal
 * arrives at the model list. A refusal is therefore NOT a list that failed to load: the key is
 * un-filed and the field takes it back in danger, because carrying on to Done would leave a panel
 * claiming a connection it does not have.
 *
 * SETUP IS KEY, READING, DONE. A MODEL IS NOT ASKED FOR HERE: the list this screen fetches to test
 * the key also names a default (the first id it answers with, or the model already filed for that
 * provider from a past session), and the settings card owns the CHOICE for the rest of the panel's
 * life. Two places to pick a model is two answers to what the panel is connected to. Where no list
 * arrives and nothing is filed, the flow ROUTES to that card by itself: a listless endpoint is not a
 * step of this screen, and the card's model row already owns the state (the typed id, standing
 * unverified where the server will not enumerate).
 *
 * AND NOTHING ON ANY STEP OF THIS SCREEN MAY READ AS PICKING A MODEL. The confirmation is a plain
 * statement — the provider as a fact line, the model as a sentence, one Done and the flow's own Back
 * — because a control offered beside a reported model is read as the control that chose it, whatever
 * it actually does.
 *
 * THE USER'S OWN SERVER IS NOT CONFIRMED HERE AT ALL. Its two facts, the address and the model, are
 * both the settings card's, so once the key and the address are filed and a model stands, this
 * screen hands the panel to that card and the card's Done is the door to idle. The whole custom
 * journey is therefore key, address, review, done, with no step in it that reports a model beside a
 * provider name.
 *
 * AND NOTHING LEAVES THIS SCREEN INTO AN IDLE PANEL THAT CANNOT CARRY AN ORDER. `connectionGaps`
 * (`settings.ts`) is the one test — a key filed, an address where the provider is the user's own
 * server, a model id standing — and every door out of here is read off it: Done exits only when it is
 * clear, the foot otherwise carries the door to the address where that is what is missing, the flow
 * hands a missing model to the settings card itself, and Back is drawn only where leaving is honest,
 * which is a connection that is ready or one that was never made. A key half-filed is the state this
 * screen exists to finish, so walking out of the middle of it is what put a panel on "Ready for
 * orders" over no endpoint and no model.
 *
 * A PIN IS NOT AN ADDRESS, which is the same rule read from the other end. `custom` can be the
 * standing pick with no server named yet (the settings card's provider row names it, and no address
 * is typed there), and the key's own reading cannot fill that in: the field is read AGAINST an
 * endpoint, so with none filed the key step's verb is the address rather than a check nothing can
 * make. The idle gate never takes that step by itself — an advance the user did not ask for, into a
 * step whose Back returns here, is a screen that will not let them rest on it.
 *
 * AND THAT QUESTION OUTLIVES THE PIN, which is what `endpointOwed` is for: an armed `custom` with no
 * address is the same standing answer read off the store rather than off this flow's own pick, so a
 * session that comes back to it asks for the address instead of reading the typed key's shape and
 * filing it against whatever platform happens to match.
 *
 * ONE LEAVE VERB PER SCREEN, AND EVERY STEP OF THIS ONE SAYS BACK, IN THE SAME CONTROL. The form is
 * walked into from the keyless rest, so a prior step always exists, and the verb is the foot's own
 * ghost button on every step of it: the waiting step's Back and the mouth's are the one idiom, since
 * the steps of this flow are as closely joined as two screens get. The two dead ends a failed check
 * lands on carry their own pills instead and both stay inside setup (a third pill would spill the
 * 336px row). The confirmation is walked out of by Done.
 *
 * OVERSIGHT IS NOT ASKED HERE. It defaults quietly and lives on the manage card (`ManageScreen`),
 * where its own words can explain it to a user who came looking for it.
 *
 * THE NETWORK IS INJECTED (`probe`, `listModels`), so a test drives the whole screen with no fetch
 * and no SDK, and the default model list reaches an adapter by DYNAMIC import, one provider's
 * dialect at a time: those modules carry the LLM SDKs, and a visitor who never connects must not
 * pay for either of them.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { AMBIGUOUS_CANDIDATES, PROBE_DEADLINE_MS, probeAmbiguousKey } from '../../agent/providers/detect';
import { baseUrlFor, PROVIDER_META, QUIRKS, type ProviderId } from '../../agent/providers/defaults';
import { classify } from '../../agent/core/errors';
import { Spinner } from '../primitives/Spinner';
import { FloatMenu, type FloatMenuItem } from '../primitives/FloatMenu';
import { colors, cursors, font, radii } from '../design/styles';
import { INK, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';
import { windowFooterGhost, windowFooterPrimary } from '../design/window-skin';
import { useFrameZoom, useZoomedLayoutTransform } from '../shell/use-frame-zoom';
import { Icon } from './icons';
import { amplitude, framerMotion } from './motion';
import { prettyModel } from './pretty-model';
import { connectionGaps, runnerSettings, useAgentPanelSettings } from './settings';
import {
  endpointCheckVerdict, endpointOwed, FIELD_STYLE, FOOT_STYLE, GATED, GROUP_STYLE, INPUT_STYLE,
  keyDestination, keyLooksUsable, NOTE_STYLE, PROVIDER_ROSTER, rawFailure, readKeyShape, SAY_STYLE,
  stepSlide, urlLooksUsable, WRAP_STYLE,
  type KeyDestination, type KeyShape, type SetupEntry, type SetupFace, type T,
} from './setup-parts';

/** How long the hands must be still before the screen moves itself on, in ms. */
export const IDLE_MS = 900;

/** How far the refused field shakes, per its own declaration. */
const SHAKE = amplitude('panel.setup.refuse') ?? 0;

/** The mark the field and the provider row carry together: the reading's own state. */
type Mark = 'spin' | 'cross' | null;

/**
 * A MODEL-LIST REQUEST THAT CANNOT WAIT FOREVER, which is the wrapper every caller here goes
 * through rather than a rule any one of them remembers.
 *
 * An endpoint that accepts the connection and then says nothing — a gateway behind a proxy that
 * holds the socket open, a self-hosted server that is up but not serving — leaves this request
 * pending with no error and no end, and the SDKs' own ceiling is minutes. The screen this answers
 * has one word for a request in flight ("Reading the key") and no verb on that step, so the wait
 * ending by itself is the difference between a face the user can act on and a panel that never
 * moves again. Bound by `PROBE_DEADLINE_MS`, the same ceiling the key probe asks `/models` under.
 *
 * The wording lands in `errors.ts`'s timeout family, so a silent endpoint is classified `network`
 * like every other connection that stopped carrying anything (`core/stream-idle.ts` bounds a stalled
 * STREAM by the same idiom). The request is aborted as the wait ends, so a late answer costs nothing.
 */
export function withModelsDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>, deadlineMs: number = PROBE_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`The endpoint answered nothing in ${Math.round(deadlineMs / 1000)}s; the request timed out.`));
    }, deadlineMs);
  });
  // The losing request is left dangling on purpose: it may never settle, and `Promise.race` has
  // already attached handlers to it, so a late rejection cannot surface as unhandled.
  return Promise.race([run(controller.signal), deadline]).finally(() => { clearTimeout(timer); });
}

/**
 * The default model list: one adapter, built from the dialect the chosen provider speaks, reached by
 * dynamic import so neither SDK is in the panel's own chunk. Every provider but Anthropic speaks
 * the OpenAI dialect, and `baseUrlFor` answers which host to ask.
 */
export function defaultListModels(cfg: {
  provider: ProviderId; apiKey: string; customBaseUrl?: string;
}): Promise<string[]> {
  return withModelsDeadline(async (signal) => {
    if (cfg.provider === 'claude') {
      const { createAnthropicAdapter } = await import('../../agent/providers/anthropic');
      return createAnthropicAdapter({ apiKey: cfg.apiKey }).listModels(signal);
    }
    const { createOpenAIAdapter } = await import('../../agent/providers/openai');
    const baseUrl = baseUrlFor(cfg.provider, { ...(cfg.customBaseUrl ? { customBaseUrl: cfg.customBaseUrl } : {}) });
    return createOpenAIAdapter({
      apiKey: cfg.apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      quirks: QUIRKS[cfg.provider],
    }).listModels(signal);
  });
}

export type ListModels = (cfg: {
  provider: ProviderId; apiKey: string; customBaseUrl?: string;
}) => Promise<string[]>;

export interface SetupScreenProps {
  /** Called once a key, a provider and a model are all settled. The shell leaves setup on it. */
  onDone?: () => void;
  /** Injected for tests; defaults to the real `/models` probe. */
  probe?: typeof probeAmbiguousKey;
  /** Injected for tests; the default reaches an SDK adapter by dynamic import. */
  listModels?: ListModels;
  /** Which bare-`sk-` candidates the probe asks. Defaults to the four platforms that share the
   *  shape; a test narrows it so its own assertions stay exact. */
  candidates?: readonly ProviderId[];
  /** Steps back out of the form to the rest it was walked into from. Absent, no line is drawn: a
   *  leave verb that leaves nothing is worse than none. */
  onLeave?: () => void;
  /** Reports which step the screen is on, for the DESK above it (`DeskHeader`'s `setupFace`): the
   *  card cannot read it off the session, which has not begun. Every step reports, the mouth
   *  included; `null` is what the CALLER holds while no screen is standing. */
  onFace?: (face: SetupFace | null) => void;
  /** WHICH STEP THE SCREEN OPENS ON, for a caller answering a named repair (a banner's fix pill).
   *  Read once, at mount: it is where the flow STARTS, not a state to be driven from outside — a
   *  caller that wants a different step mounts a fresh screen. */
  entry?: SetupEntry;
  /** Opens the settings card, which is where a model id is chosen or typed. The flow hands a
   *  connection whose endpoint named no model there by itself, since setup does not ask for one.
   *  Absent, the confirmation stands on its own Back. */
  onManage?: () => void;
}

export function SetupScreen({
  onDone,
  probe = probeAmbiguousKey,
  listModels = defaultListModels,
  candidates = AMBIGUOUS_CANDIDATES,
  onLeave,
  onFace,
  entry = 'key',
  onManage,
}: SetupScreenProps) {
  const t = useT();
  const zoom = useFrameZoom();
  const zoomedLayout = useZoomedLayoutTransform();
  const reduced = useReducedMotionConfig() === true;
  const settings = useAgentPanelSettings();

  /**
   * WHERE THE SCREEN OPENS. The named repair the caller asked for outranks everything; otherwise a
   * connection that already HOLDS a key opens at its own confirmation, because what is missing there
   * is not a key and a field asking for one would be the screen's first sentence being wrong. That is
   * the state a reload lands in mid-flow: the key is sealed in the vault and the model never got
   * filed, so the panel comes back holding half a connection.
   */
  const [phase, setPhase] = useState<'key' | 'custom' | 'confirm'>(() => {
    if (entry === 'endpoint') return 'custom';
    if (entry === 'chooser') return 'key';
    const gaps = connectionGaps(useAgentPanelSettings.getState());
    return gaps.length > 0 && !gaps.includes('key') ? 'confirm' : 'key';
  });
  const [keyDraft, setKeyDraft] = useState('');
  /** THE KEY IS A SECRET: it masks when the field rests, and focusing reveals it (the artifact's own
   *  documented policy). Typing and pasting are untouched, since the switch fires on focus and blur
   *  rather than on the value, and an empty field is never masked: there is nothing in it to hide. */
  const [keyMasked, setKeyMasked] = useState(false);
  /** WHETHER THE CARET IS IN THE KEY FIELD, so a value arriving with no focus cycle of its own can be
   *  told from typing. A ref rather than state: nothing renders from it, and the mask it decides is
   *  set in the same handler that reads it. */
  const keyFocused = useRef(false);
  const [rowOpen, setRowOpen] = useState(entry === 'chooser');
  const [urlDraft, setUrlDraft] = useState(settings.customBaseUrl);
  const [urlBad, setUrlBad] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const [refused, setRefused] = useState(false);
  const [modelsFailed, setModelsFailed] = useState(false);
  /** Bumped on every refusal, so a second refusal of the same key shakes again. */
  const [shakeSeq, setShakeSeq] = useState(0);
  /** The provider and key the model phase is working against, held in refs because they are not
   *  render inputs: the store's armed provider is authoritative and this is only what got it there. */
  const armed = useRef<ProviderId | null>(null);
  const armedKey = useRef('');
  /**
   * The exact key the user STEPPED OFF a reading of. The gate stays disarmed until the field changes:
   * Back means "I am still editing", opening the chooser by hand means "not this one", and either way
   * an advance firing 900ms later would walk the user out of the step they just chose to be on.
   *
   * STATE, NOT A REF, and that distinction is the whole of the fix: the gate is DERIVED at render, so
   * a ref set inside a handler leaves the standing timer's effect with unchanged deps and its
   * already-armed clock ran on to fire the advance Back had just cancelled.
   */
  const [heldBack, setHeldBack] = useState<string | null>(null);
  /**
   * WHICH READING THE ANSWER IN FLIGHT BELONGS TO.
   *
   * A probe is a REQUEST, and a request cannot be recalled: it lands when it lands, and the `.then`
   * it lands in commits a provider. So every act that says "not this reading" — Back, opening the
   * chooser by hand, a pick, a keystroke — bumps this, and a probe that comes back under an older
   * number is dropped. Without it, opening the chooser from a detected key and pressing Back left the
   * old check running and the panel jumped to the model list of the platform being walked away from,
   * over the list of platforms the user was reading.
   *
   * A REF, because nothing renders from it: it is read inside the promise that has to decide whether
   * it still speaks for the screen.
   */
  const reading = useRef(0);

  const provider = armed.current ?? settings.provider;
  const model = settings.model[provider] ?? '';
  /** The provider the user NAMED, as this screen reads it: the pick standing in this flow, or an
   *  armed `custom` with no address, which is the same answer from a past session (`endpointOwed`). */
  const pinned = settings.providerPinned || endpointOwed(settings) ? settings.provider : null;
  const customBaseUrl = settings.customBaseUrl;
  const forgetKey = settings.forgetKey;
  const connectKey = settings.connectKey;
  const setModel = settings.setModel;

  const shape: KeyShape = pinned ?? readKeyShape(keyDraft);
  const accepted = keyLooksUsable(keyDraft);
  const typing = keyDraft.length > 0;
  /** WHAT THIS CONNECTION IS STILL MISSING, about the provider the screen is working on. Every door
   *  out of the screen is read off it, and so is the confirmation's own face. */
  const gaps = connectionGaps(settings, provider);
  /** The user's own server with no address filed: the key in the field has nothing to be read
   *  against, so this is what the step asks for before any check can be made. */
  const needsEndpoint = shape === 'custom' && customBaseUrl === '';

  /**
   * ASKS THE PROVIDER WHAT IT RUNS, AND FILES THE FIRST ANSWER AS THE DEFAULT.
   *
   * The request is here for two reasons and neither of them is a choice being offered: it is the
   * key's first real test (nothing before it proves a key is live), and it is where a model id this
   * screen could not otherwise know comes from. A model ALREADY FILED for the provider outranks it —
   * that is the user's own pick from a past session, and Manage is the one place a pick is made.
   *
   * NOTHING IS HARD-CODED. A table of model ids per platform would be stale within weeks and would
   * name models a given key may not be entitled to, so where no list arrives and nothing is filed the
   * screen says so and points at the settings card rather than guessing.
   */
  const loadModels = useCallback((id: ProviderId, apiKey: string) => {
    setModelsFailed(false);
    // A REQUEST NEEDS A HOST, and the user's own server with no address filed has none: the SDK's
    // own default would carry this key to a platform it was never issued for. The step asks for the
    // address instead, which is what `connectionGaps` already says is missing.
    if (apiKey === '' || (id === 'custom' && customBaseUrl === '')) return;
    listModels({ provider: id, apiKey, ...(customBaseUrl ? { customBaseUrl } : {}) })
      .then((ids) => {
        // A list arriving, however empty, is the user's own server ANSWERING: the verdict is filed
        // so a standing failed-check gap does not outlive the evidence against it.
        if (id === 'custom') useAgentPanelSettings.getState().recordEndpointCheck(true);
        // An empty list is the same dead end as a refusal: there is nothing to default to.
        const first = ids[0];
        if (first === undefined) { setModelsFailed(true); return; }
        if ((useAgentPanelSettings.getState().model[id] ?? '') === '') setModel(first);
      })
      .catch((err: unknown) => {
        // THE USER'S OWN SERVER IS JUDGED BY THE SAME BOUNDARY THE MANAGE CARD USES
        // (`endpointCheckVerdict`): a check nothing answered files the failed verdict — the model
        // clears and the endpoint is the named gap — while a server that answered without a list
        // keeps the typed-id trust the empty catalogue earns.
        if (id === 'custom') {
          useAgentPanelSettings.getState().recordEndpointCheck(endpointCheckVerdict(err) !== 'unreachable');
        }
        // A REFUSED KEY IS NOT AN UNAVAILABLE LIST. The first request a key makes is this one, so a
        // dead key arrives here — and carrying on to Done would leave a panel that says it is
        // connected and fails on the first order. The key is un-filed and the field takes it back,
        // in danger, saying what happened.
        if (classify(rawFailure(err)).cls === 'auth') {
          forgetKey(id);
          armed.current = null;
          setRefused(true);
          setProbing(false);
          setShakeSeq((n) => n + 1);
          setPhase('key');
          return;
        }
        setModelsFailed(true);
      });
  }, [listModels, customBaseUrl, forgetKey, setModel]);

  /** Files the key, arms the provider and moves to the confirmation — the one path from a key to a
   *  connection, whichever reading or pick named the provider. */
  const commit = useCallback((id: ProviderId, key: string) => {
    armed.current = id;
    armedKey.current = key;
    connectKey(id, key);
    setRowOpen(false);
    setProbing(false);
    setProbeFailed(false);
    setRefused(false);
    setPhase('confirm');
    loadModels(id, key);
  }, [connectKey, loadModels]);

  const runProbe = useCallback((key: string) => {
    // WHOSE QUESTION THIS ANSWERS. Anything the user does meanwhile moves the counter, and an answer
    // to a question they have already left says nothing about the screen they are on now.
    const mine = reading.current;
    setProbing(true);
    setProbeFailed(false);
    probe(key, { candidates: [...candidates], ...(customBaseUrl ? { customBaseUrl } : {}) })
      .then((winner) => {
        if (mine !== reading.current) return;
        setProbing(false);
        if (winner) { commit(winner, key); return; }
        // Nobody answered: offline, CORS-blocked, or a key none of them holds. The row keeps the two
        // names, crossed, and the screen asks rather than guessing.
        setProbeFailed(true);
      })
      .catch(() => {
        if (mine !== reading.current) return;
        setProbing(false);
        setProbeFailed(true);
      });
  }, [probe, candidates, customBaseUrl, commit]);

  /**
   * What the quiet is waiting to do, or null where nothing is owed.
   *
   * THE DESTINATION IS THE SHARED TABLE'S (`keyDestination`) and this is only the TIMING: a check in
   * flight, a dead end standing, or a reading the user has stepped off all mean the clock is not
   * running. The address step is the one destination the quiet never takes — see the file header.
   */
  const gate: Exclude<KeyDestination, 'endpoint'> = (() => {
    if (phase !== 'key' || probing || probeFailed || refused) return null;
    if (heldBack === keyDraft) return null;
    const dest = keyDestination({ shape, usable: accepted, endpointFiled: !needsEndpoint, explicit: false });
    return dest === 'endpoint' ? null : dest;
  })();

  const fire = useCallback((what: Exclude<KeyDestination, null>) => {
    const key = keyDraft.trim();
    if (what === 'endpoint') { setPhase('custom'); return; }
    if (key === '') return;
    if (what === 'ask') { setRowOpen(true); return; }
    if (what === 'probe') { runProbe(key); return; }
    // `shape` is a ProviderId on this branch, which is what makes the destination 'commit'.
    commit(shape as ProviderId, key);
  }, [keyDraft, shape, runProbe, commit]);

  // THE GATE, AND THE KEYSTROKE THAT RESETS IT IS THE EFFECT'S OWN DEPENDENCY. `fire` closes over
  // the draft, so a character landing mid-wait replaces the callback, this effect's cleanup clears
  // the pending timer and the quiet starts over from that keystroke. A `lastTyped` stamp re-read on
  // a tick would be one mechanism too many: React drops an input event that does not move the
  // value, so there is no keystroke the deps miss and a stamp could catch.
  useEffect(() => {
    if (!gate) return undefined;
    const timer = setTimeout(() => fire(gate), IDLE_MS);
    return () => clearTimeout(timer);
  }, [gate, fire]);

  useEffect(() => { setUrlDraft(customBaseUrl); }, [customBaseUrl]);

  /**
   * A CONNECTION THIS SCREEN DID NOT MAKE STILL GETS ITS MODEL ASKED FOR, once, on the mount that
   * opened over it. The key is in the vault and the list request was never made (a reload mid-flow,
   * a session that ended at the model step), so the one thing standing between the panel and a
   * default is a question nobody has asked. Where it answers, the gap closes and the screen goes by
   * itself; where it does not, the step's own door to the settings card is what stands.
   */
  // A CONFIRMATION WITH NO KEY BEHIND IT IS THE KEY STEP. The refusal path takes the field back
  // itself; this is every other way a key can leave while the screen stands over it, and the step
  // that asks for one is the honest face of it.
  const keyMissing = gaps.includes('key');
  useEffect(() => { if (phase === 'confirm' && keyMissing) setPhase('key'); }, [phase, keyMissing]);

  /**
   * A CONNECTION TO THE USER'S OWN SERVER IS REVIEWED ON THE MANAGE CARD, NEVER CONFIRMED HERE.
   *
   * That card owns both of the facts such a connection is made of — the address and the model — and a
   * step that REPORTS a defaulted model beside a provider name reads as a step that chose one. So
   * once the key, the address and a model all stand for `custom`, the screen hands the panel over
   * instead of standing a confirmation: the user reads the two together, and the card's own Done is
   * the door to idle.
   *
   * A LISTLESS ENDPOINT IS THE OTHER HAND-OFF, for any provider: no model stands and no list is
   * coming, so the card whose model row takes a typed id is the flow's next step rather than a door
   * this screen asks the user to find. What a hand-off may leave owed is AT MOST THE MODEL — the one
   * gap the card exists to repair — which is what keeps the two screens from passing the panel back
   * and forth: the card's Done gates on the same readiness test, so it releases only a connection
   * this screen has no reason to stand up over again.
   *
   * IT HANDS OVER ONCE, and the ref is what makes that true rather than a hope. The verb it calls is
   * a TOGGLE on the caller's side (one press of the gear opens the card, the next puts it away), and
   * the prop carrying it is rebuilt on every render of the panel above — so an effect that merely
   * depended on it fired again on the next render and turned the card straight back off. The screen
   * unmounts on the hand-off, so once per mount is once.
   */
  const owed = gaps.join(',');
  const handedOff = useRef(false);
  useEffect(() => {
    if (handedOff.current || phase !== 'confirm' || !onManage) return;
    const review = provider === 'custom' && owed === '';
    const listless = modelsFailed && owed === 'model';
    if (!review && !listless) return;
    handedOff.current = true;
    onManage();
  }, [phase, provider, owed, modelsFailed, onManage]);

  const askedOnMount = useRef(false);
  useEffect(() => {
    if (askedOnMount.current || phase !== 'confirm' || armed.current !== null) return;
    askedOnMount.current = true;
    const held = runnerSettings(useAgentPanelSettings.getState()).apiKey;
    armedKey.current = held;
    loadModels(provider, held);
  }, [phase, provider, loadModels]);

  // A refused key hands the caret back, selected: on that step the field is the action, and the next
  // thing the user does is replace what is in it.
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!refused) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [refused, shakeSeq]);

  /** Enter, and the foot's own press: the same advance, now, off the same table the quiet reads. A key
   *  with no reading behind it opens the chooser rather than refusing, since asking is the honest next
   *  step for a shape nobody claims. */
  function confirmNow(): void {
    const dest = keyDestination({ shape, usable: accepted, endpointFiled: !needsEndpoint, explicit: true });
    if (!dest) return;
    reading.current += 1;
    setHeldBack(null);
    fire(dest);
  }

  /** Back out to plain key entry: the verdict goes, the key stays, the check in flight stops speaking
   *  for the screen, and the gate stays down until the field changes. */
  function reenter(): void {
    reading.current += 1;
    setProbing(false);
    setProbeFailed(false);
    setRefused(false);
    setRowOpen(false);
    setHeldBack(keyDraft);
  }

  /**
   * OPENING THE CHOOSER BY HAND, which is an explicit "not this one" and outranks whatever the key's
   * shape or a running check has to say. So it stops the check in flight and puts the idle gate down
   * for the key in the field: a keystroke or a pick is what re-arms it.
   *
   * The gate's OWN `ask` opens the same list for a shape nobody claims, and it goes through
   * `setRowOpen` rather than this: that list is the reading's own next step, not an override of it.
   */
  function chooseByHand(): void {
    reading.current += 1;
    setProbing(false);
    setHeldBack(keyDraft);
    setRowOpen(true);
  }

  function pickProvider(id: ProviderId): void {
    // A PICK RETIRES THE READING IT OVERRULES, whichever entry was pressed. The custom endpoint's
    // own row left `probeFailed` standing, so the desk said "No provider answered" over the ENDPOINT
    // step the user had just chosen, the row wore the cross of a probe that was about a different
    // question, and the note asked them to check a key for a typo. A pin outranks a reading; a pick
    // on its way to becoming one outranks it too.
    setProbeFailed(false);
    setRefused(false);
    if (id === 'custom') { setRowOpen(false); setPhase('custom'); return; }
    settings.pinProvider(id);
    setRowOpen(false);
    // A PICK IS A NEW READING, and it retires the one the chooser was opened over: a probe still in
    // flight for the shape must not land on top of the platform the user has just named.
    reading.current += 1;
    const key = keyDraft.trim() || armedKey.current;
    if (key !== '') { commit(id, key); return; }
    setHeldBack(null);
    /**
     * NO KEY IN HAND, AND THE PICK MAY ALREADY BE CONNECTED — which is a way OUT of setup rather
     * than into it. A user connected on one provider who picks a keyless one from the manage row
     * drops to this screen; picking the first one BACK commits nothing (there is no draft), so
     * without this the screen stands over a live key with the gear deliberately hidden and the only
     * door left is pasting the key again. What is owed decides: nothing filed against that provider
     * and setup is done; otherwise the held key goes through the one commit path, which reads the
     * list and defaults the model without asking.
     */
    const held = runnerSettings({ ...settings, provider: id }).apiKey;
    if (held === '') return;
    // AND WHAT IS OWED IS THE READINESS TEST ITSELF, the same one Done takes: a pick that leaves
    // nothing missing is the end of setup, and anything else goes through the one commit path.
    if (connectionGaps(settings, id).length === 0) { onDone?.(); return; }
    commit(id, held);
  }

  const mark: Mark = refused || probeFailed ? 'cross' : probing || (gate !== null && gate !== 'ask') ? 'spin' : null;
  /**
   * WHETHER THE SCREEN IS ACTUALLY READING THE KEY, which is what the row's sub and the note under it
   * claim when they say "checking". A key long enough to be one is not enough: the quiet has to be
   * running or a request has to be out. Back puts the gate down and leaves the key in the field, and
   * a face still promising a check would be describing a request nothing will ever send; the same
   * goes for a pinned server with no address, where no request can be built at all.
   */
  const checking = accepted && !needsEndpoint && (gate !== null || probing);
  /** An OPEN chooser over a shape nobody claims: the row is asking its own question, so its face
   *  stops describing a reading it does not have and says what the list is for. */
  const asking = rowOpen && !pinned && (shape === 'unknown' || shape === 'empty') && !refused && !probeFailed;
  const row = phase === 'custom'
    // On the endpoint step the row says what the step IS: the URL field below belongs to the entry
    // that opened it, and a row still reading "Any provider" would disown its own field.
    ? { id: 'custom' as ProviderId, name: t('agent3.setup_custom_endpoint'), sub: t('agent3.setup_row_openai_compat'), dim: false }
    : asking
      ? {
        id: null,
        name: t('agent3.setup_row_whose'),
        sub: t(typing ? 'agent3.setup_row_key_stays' : 'agent3.setup_row_pick_one'),
        dim: false,
      }
      : rowFace({ t, shape, pinned, checking, probeFailed, refused, probing });
  const note = asking && typing
    ? { text: t('agent3.setup_note_unknown_pick'), danger: false }
    : noteLine({
      t, shape, pinned, typing, probeFailed, refused, needsEndpoint, checking, probing,
      held: settings.keyed.length > 0,
    });
  const foot = footVerbs({ probeFailed, refused, needsEndpoint, probing, waiting: gate !== null });
  /**
   * WHETHER WALKING OUT OF HERE IS HONEST.
   *
   * Back leaves the panel on the rest it was walked into from, and that rest says one of two true
   * things: a connection stands, or none does. A connection MID-WAY is neither — a key filed with no
   * address behind it, or no model to name in the request — and a panel that took an order on one
   * would fail on the first call while saying it was ready. So the leave verb stands where the
   * connection is complete or has not begun, and where it is half-made the foot's own door to the
   * missing piece is what the step offers instead.
   */
  const canLeave = gaps.length === 0 || gaps.includes('key');
  /**
   * THE CONFIRMATION'S ONE FOOT CONTROL, chosen by what the connection is still missing.
   *
   *   done    — nothing owed: the press leaves setup
   *   wait    — the model list is out, so the same button stands dimmed until it lands or gives up
   *   address — the provider is the user's own server and no address is filed
   *   route   — no model stands and no list is coming: the flow is handing the panel to the settings
   *             card, so the foot keeps Back alone rather than a Done that could never enable
   */
  const exit: 'done' | 'wait' | 'address' | 'route' = gaps.length === 0
    ? 'done'
    : gaps.includes('endpoint') ? 'address' : modelsFailed ? 'route' : 'wait';

  /**
   * WHICH STEP THE DESK SHOULD BE SAYING, read off the same facts the row and the note are read off,
   * so the card above the field cannot describe a different screen.
   *
   * THE MOUTH IS A STEP LIKE THE REST OF THEM, and reporting nothing there leaves the keyless sleep
   * standing over an open connection screen, saying "Not connected / a key wakes me" about a
   * character who is plainly up and asking for one. The sleep is what a desk with no screen under it
   * says (the parked character wears it too); a screen STANDING is awake by definition.
   */
  const step: SetupFace = (() => {
    // THE STEP THE SCREEN IS STANDING ON COMES FIRST, before any reading it may still be carrying:
    // a probe nobody answered is a fact about the key step, and the desk said it over the endpoint
    // field the user had walked to next.
    if (phase === 'custom') {
      const host = urlHost(urlDraft);
      return host ? { step: 'endpoint', name: host } : { step: 'endpoint' };
    }
    if (phase === 'confirm') {
      // WHAT IS MISSING OUTRANKS WHAT ARRIVED. An armed provider whose address was never filed has
      // nothing to ask, so the card says the step the user is being sent to rather than reporting a
      // list that cannot be fetched. A list that failed has no step of its own: the flow is handing
      // the panel to the settings card, and the confirmed provider is what the desk keeps saying.
      if (gaps.includes('endpoint')) return { step: 'endpoint' };
      // A MODEL IS SETTLED AND NOTHING IS OWED but the press, which is what the card names.
      if (model !== '') return { step: 'chosen', name: prettyModel(model) };
      // The provider is armed and the list is still out: the one moment of this flow that is a small
      // success rather than a question, which is the pose the card wears for it.
      return { step: 'confirmed', name: PROVIDER_META[provider].name };
    }
    if (refused) return row.id ? { step: 'refused', name: row.name } : { step: 'refused' };
    if (probeFailed) return { step: 'no-answer' };
    // THE ADDRESS IS THE STEP, standing on the key field or not: nothing here can be read until the
    // server is named, and the dock's own word for that is the one the endpoint step wears.
    if (needsEndpoint) return { step: 'endpoint' };
    if (asking) return { step: 'unknown' };
    // "Asking both" is the request being out, and during the idle gate it is not: the key is still
    // being read, which is what the card says until the probe actually leaves.
    if (shape === 'ambiguous') return probing ? { step: 'ambiguous' } : { step: 'typing' };
    if (row.id && accepted) return { step: 'shaped', name: row.name };
    return { step: typing ? 'typing' : 'awake' };
  })();
  // Reported BY VALUE: the object above is rebuilt every render, so an identity dependency would
  // report every keystroke as a step change.
  const stepId = step.step;
  const stepName = step.name ?? '';
  useEffect(() => {
    onFace?.({ step: stepId, ...(stepName ? { name: stepName } : {}) });
  }, [onFace, stepId, stepName]);

  const slides = stepSlide(reduced, zoomedLayout);

  const keyField = (
    <motion.label
      data-testid="setup-key-field"
      className={FIELD_WRAP_CLASS}
      data-danger={refused || undefined}
      // The shake is the refusal landing ON the control the press was made with. It ALTERNATES
      // DIRECTION per refusal, which is what makes a second refusal of the same key shake again:
      // framer replays a keyframe array only when the target changes, and the element cannot be
      // re-keyed to force it (remounting the label would take the caret out of the field the refusal
      // is about). Framer drops the whole travel under reduced motion, `x` being a positional key —
      // which is why the declaration is `ambient` and why the refusal's carriers are the border, the
      // crossed row and the note rather than this.
      animate={refused
        ? { x: shakeSeq % 2 === 0 ? [0, -SHAKE, SHAKE, 0] : [0, SHAKE, -SHAKE, 0] }
        : { x: 0 }}
      transition={framerMotion('panel.setup.refuse')}
      style={refused ? { ...FIELD_STYLE, borderColor: colors.dangerText } : FIELD_STYLE}
    >
      <Icon id="pw-key" size={17} />
      <input
        ref={fieldRef}
        type={keyMasked ? 'password' : 'text'}
        data-testid="setup-key-input"
        className={FIELD_INPUT_CLASS}
        spellCheck={false}
        autoComplete="off"
        placeholder={t('agent3.setup_key_placeholder')}
        value={keyDraft}
        onChange={(e) => {
          // A KEYSTROKE RE-ARMS THE GATE AND RETIRES THE CHECK IN FLIGHT: whatever is coming back is
          // about a key that is no longer the one in the field.
          reading.current += 1;
          setHeldBack(null);
          setKeyDraft(e.target.value);
          setRefused(false);
          setProbeFailed(false);
          // A VALUE CAN ARRIVE WITH NO FOCUS CYCLE: a password manager or an extension filling an
          // unfocused field reaches this handler and neither `onFocus` nor `onBlur`, so the key stood
          // on screen in plain text, unattended. Same rule those two state, asked here as well.
          if (!keyFocused.current) setKeyMasked(e.target.value.length > 0);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmNow(); } }}
        onFocus={() => { keyFocused.current = true; setKeyMasked(false); }}
        onBlur={(e) => { keyFocused.current = false; setKeyMasked(e.target.value.length > 0); }}
        style={INPUT_STYLE}
      />
    </motion.label>
  );

  const providerRow = (
    <FloatMenu
      data-testid="setup-prov-row"
      aria-label={t('agent3.setup_pick_provider')}
      open={rowOpen}
      onOpen={chooseByHand}
      onClose={() => setRowOpen(false)}
      onPick={(id) => pickProvider(id as ProviderId)}
      {...(pinned ? { activeId: pinned } : {})}
      zoom={zoom}
      items={rosterItems(t, shape)}
      row={(
        <span
          data-testid="setup-prov-face"
          data-provider={row.id ?? undefined}
          data-dim={row.dim || undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}
        >
          {/* THE VERDICT RIDES THE ROW, not the field: the row is where the answer belongs, and a
              second mark on the field would say the same thing twice. A crossed row FADES ITS WORDS
              and never its mark — group opacity would multiply into the one glyph that says which
              candidate failed. */}
          {mark === 'cross' ? (
            <span data-testid="setup-row-cross" style={{ color: colors.dangerText, display: 'inline-flex', flex: '0 0 auto' }}>
              <Icon id="pw-cross" size={15} />
            </span>
          ) : null}
          {/* THE ROW'S TWO HALVES SHARE THE SQUEEZE, which is the dock's own ruling for the same
              shape (`DeskHeader`'s note on the allow-always mark). Held at its natural width, the
              NAME left the sub as the only thing that could give — and on the custom-endpoint face
              in French the sub was cut from 112px to 54, losing more than half its label. Both
              ellipsize now, so a crowded line loses characters rather than legibility, and the name
              still leads because it is the identity. */}
          <span
            style={{
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: row.dim ? colors.brownText : PLATE_INK,
            }}
          >
            {row.name}
          </span>
          <span
            data-testid="setup-prov-sub"
            style={{
              marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', ...roleFont('caption'), color: colors.brownText,
            }}
          >
            {row.sub}
          </span>
          {mark === 'spin' ? (
            <span data-testid="setup-row-spin" style={{ display: 'inline-flex', flex: '0 0 auto' }}>
              <Spinner size={13} color={INK} />
            </span>
          ) : null}
        </span>
      )}
    />
  );

  return (
    <div data-testid="setup-screen" data-phase={phase} style={WRAP_STYLE}>
      {phase === 'key' && (
        <>
          {!typing && <p style={SAY_STYLE}>{t('agent3.setup_say_key')}</p>}
          <motion.div {...slides} style={GROUP_STYLE}>{keyField}</motion.div>
          <motion.div {...slides} style={GROUP_STYLE}>{providerRow}</motion.div>
          {note && (
            <motion.p
              {...slides}
              data-testid="setup-note"
              style={note.danger ? { ...NOTE_STYLE, color: colors.dangerText } : NOTE_STYLE}
            >
              {note.text}
            </motion.p>
          )}
          <div style={FOOT_STYLE}>
            {foot.length > 0 && (
              <div style={FOOT_ROW}>
                {foot.map((verb) => (
                  <button
                    key={verb}
                    type="button"
                    data-testid={`setup-act-${verb}`}
                    onClick={() => {
                      if (verb === 'reenter') { reenter(); return; }
                      if (verb === 'manual') { chooseByHand(); return; }
                      if (verb === 'address') { setPhase('custom'); return; }
                      confirmNow();
                    }}
                    style={verb === 'recheck' || verb === 'address' ? FOOT_PRIMARY : FOOT_GHOST}
                  >
                    {/* THE SAME PRESS, TWO SENTENCES, and the difference is what the last attempt
                        proved: a key the provider REFUSED is offered again as a deliberate "use it
                        anyway", while a probe nobody answered is simply worth another go. The second
                        borrows the dock's own word for the act rather than keeping a second copy of
                        it. */}
                    {verb === 'recheck'
                      ? t(refused ? 'agent3.setup_use_this_key' : 'agent3.dock_act_try_again')
                      : t(FOOT_LABEL[verb])}
                  </button>
                ))}
              </div>
            )}
            {!foot.includes('reenter') && canLeave && <LeaveRow t={t} {...(onLeave ? { onLeave } : {})} />}
          </div>
        </>
      )}

      {phase === 'custom' && (
        <>
          <p style={SAY_STYLE}>{t('agent3.setup_say_custom')}</p>
          <div style={GROUP_STYLE}>{keyField}</div>
          {providerRow}
          <div style={GROUP_STYLE}>
            <label
              className={FIELD_WRAP_CLASS}
              style={urlBad ? { ...FIELD_STYLE, borderColor: colors.dangerText } : FIELD_STYLE}
            >
              <Icon id="pw-link-out" size={17} />
              <input
                type="text"
                data-testid="setup-endpoint-input"
                className={FIELD_INPUT_CLASS}
                spellCheck={false}
                autoComplete="off"
                placeholder={t('agent3.setup_endpoint_placeholder')}
                value={urlDraft}
                onChange={(e) => { setUrlDraft(e.target.value); setUrlBad(false); }}
                style={{ ...INPUT_STYLE, letterSpacing: 0 }}
              />
            </label>
            <p
              data-testid="setup-endpoint-note"
              style={urlBad ? { ...NOTE_STYLE, color: colors.dangerText } : NOTE_STYLE}
            >
              {t(urlBad ? 'agent3.setup_endpoint_invalid' : 'agent3.setup_note_custom')}
            </p>
          </div>
          <div style={FOOT_STYLE}>
            <div style={FOOT_ROW}>
              <button
                type="button"
                data-testid="setup-endpoint-save"
                // GATED until the address is one the app could actually reach: the advancing control
                // dims rather than vanishing, so the row does not move as the field fills.
                data-gated={!urlLooksUsable(urlDraft) || undefined}
                disabled={!urlLooksUsable(urlDraft)}
                onClick={() => {
                  if (settings.setCustomBaseUrl(urlDraft) === '') { setUrlBad(true); return; }
                  settings.pinProvider('custom');
                  // FILING THE ADDRESS ANSWERS THE READING THE PICKING PUT ON HOLD, so the key
                  // already in the field is read against this endpoint. The row is opened BY HAND to
                  // reach the custom entry, which disarms the gate for the key in the field — and a
                  // hold that outlived the pick left the screen over a pinned endpoint saying it was
                  // reading a key nothing would ever read: no advance, no verb, and the field the
                  // only way on. Any check still in flight for the shape stops speaking here too.
                  reading.current += 1;
                  setHeldBack(null);
                  setPhase('key');
                }}
                style={urlLooksUsable(urlDraft) ? FOOT_PRIMARY : { ...FOOT_PRIMARY, ...GATED }}
              >
                {t('agent3.setup_endpoint_check')}
              </button>
              <button
                type="button"
                data-testid="setup-act-reenter"
                onClick={() => { setUrlBad(false); setPhase('key'); }}
                style={FOOT_GHOST}
              >
                {t('agent3.setup_back')}
              </button>
            </div>
          </div>
        </>
      )}

      {phase === 'confirm' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* THE ARMED PROVIDER IS A FACT LINE AND NOTHING ELSE. It carried a re-pick pill, and a
                pill reading "not right? choose" beside a reported model was read as the model being
                chosen here — which is the one thing no screen in this panel may look like. The way
                back off this step is the foot's own Back, the same control every other step of the
                flow uses. */}
            <div data-testid="setup-armed-provider" data-provider={provider} style={LIT_ROW}>
              <Icon id="pw-check" size={15} />
              <span style={{ marginRight: 'auto' }}>{PROVIDER_META[provider].name}</span>
            </div>
            {/* THE MODEL IS REPORTED, NOT ASKED. It is a fact of the connection by the time this step
                stands, and there is exactly one place a model is CHOSEN (the settings card), so a
                second chooser here would be a second answer to what the panel is connected to. */}
            {exit === 'address' ? (
              <p data-testid="setup-endpoint-missing" style={NOTE_STYLE}>{t('agent3.setup_say_custom')}</p>
            ) : model !== '' ? (
              <p data-testid="setup-model-note" style={NOTE_STYLE}>
                {t('agent3.setup_note_model_default', { name: prettyModel(model) })}
              </p>
            ) : null}
          </div>

          <div style={FOOT_STYLE}>
            {/* WHAT THE STEP IS FOR, AS ONE CONTROL, WITH THE FLOW'S OWN BACK BESIDE IT. Done leaves,
                and it leaves only when the connection can carry an order — a key filed, the server
                named where it is the user's own, a model standing. While the list is still out it is
                the same button, dimmed at the same rect. Where the address is what is missing the
                control becomes the door to it; where the MODEL is missing and no list is coming the
                flow is already handing the panel to the settings card, so the foot keeps Back alone
                rather than a Done that could never enable.

                BACK IS WHAT KEEPS THE WAIT FROM BEING A DEAD END, and it is the same ghost button
                every other step of this flow carries. It stands on this step alone rather than
                through `LeaveRow`, because the step behind the confirmation is the key field and not
                the rest the form was walked into from. */}
            <div style={FOOT_ROW}>
              {exit === 'address' ? (
                <button
                  type="button"
                  data-testid="setup-need-address"
                  onClick={() => setPhase('custom')}
                  style={FOOT_PRIMARY}
                >
                  {t('agent3.setup_give_address')}
                </button>
              ) : exit === 'route' ? null : (
                <button
                  type="button"
                  data-testid="setup-done"
                  data-gated={exit === 'wait' || undefined}
                  disabled={exit === 'wait'}
                  onClick={onDone}
                  style={{
                    ...FOOT_PRIMARY,
                    ...(exit === 'wait' ? GATED : {}),
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                  }}
                >
                  <Icon id="pw-check" size={15} />
                  {t('agent3.setup_done')}
                </button>
              )}
              <button
                type="button"
                data-testid="setup-confirm-back"
                onClick={() => { setPhase('key'); reenter(); }}
                style={FOOT_GHOST}
              >
                {t('agent3.setup_back')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The host an endpoint address points at, for the desk's own meta line, or '' where the field does
 *  not hold a parseable address yet (it is typed into character by character). */
function urlHost(raw: string): string {
  try { return new URL(raw.trim()).host; } catch { return ''; }
}

/* ── the row's face, the note and the foot, as three small derivations ────── */

interface RowFace { id: ProviderId | null; name: string; sub: string; dim: boolean }

/** What the provider row SAYS, given everything the screen knows. One function, so the four states
 *  a reading passes through cannot be written twice with two different sets of words. */
function rowFace(a: {
  t: T; shape: KeyShape; pinned: ProviderId | null; checking: boolean;
  probeFailed: boolean; refused: boolean; probing: boolean;
}): RowFace {
  const { t, shape, pinned, checking, probeFailed, refused, probing } = a;
  if (refused) {
    const id = pinned ?? (typeof shape === 'string' && shape !== 'ambiguous' && shape !== 'partial'
      && shape !== 'unknown' && shape !== 'empty' ? shape : null);
    return {
      id,
      name: id ? PROVIDER_META[id].name : t('agent3.setup_row_provider'),
      sub: t('agent3.setup_row_refused'),
      dim: false,
    };
  }
  // A PIN OUTRANKS A READING, and that is why it is tested BEFORE the two readings below it: a
  // probe only ever runs while nothing is pinned (`gate` reads the pin as the shape), so a cross
  // standing over a pinned provider is always about a question that has since been answered.
  if (pinned) {
    return {
      id: pinned,
      name: PROVIDER_META[pinned].name,
      sub: t(checking ? 'agent3.setup_row_pinned_checking' : 'agent3.setup_row_pinned'),
      dim: false,
    };
  }
  if (probeFailed) {
    return { id: null, name: t('agent3.setup_row_two'), sub: t('agent3.setup_row_no_answer'), dim: false };
  }
  if (shape === 'ambiguous') {
    return {
      id: null,
      name: t('agent3.setup_row_two'),
      // THE ASKING IS THE REQUEST, not the quiet before it: during the idle gate nothing has left
      // the page, and the row says only what the shape says.
      sub: t(probing ? 'agent3.setup_row_asking' : 'agent3.setup_row_sofar'),
      dim: false,
    };
  }
  if (shape === 'empty' || shape === 'partial' || shape === 'unknown') {
    return { id: null, name: t('agent3.setup_row_any'), sub: t('agent3.setup_row_any_sub'), dim: true };
  }
  return {
    id: shape,
    name: PROVIDER_META[shape].name,
    sub: t(checking ? 'agent3.setup_row_checking' : 'agent3.setup_row_sofar'),
    dim: false,
  };
}

/** The sentence under the row, or none. `danger` is the refusal's own ink. */
function noteLine(a: {
  t: T; shape: KeyShape; pinned: ProviderId | null; typing: boolean; checking: boolean;
  probeFailed: boolean; refused: boolean; needsEndpoint: boolean; probing: boolean; held: boolean;
}): { text: string; danger: boolean } | null {
  const { t, shape, pinned, typing, checking, probeFailed, refused, needsEndpoint, probing, held } = a;
  if (refused) return { text: t('agent3.setup_key_refused'), danger: true };
  if (probeFailed) return { text: t('agent3.setup_note_probe_failed'), danger: true };
  // THE ADDRESS FIRST. A key is read against an endpoint, so with none filed the line says what the
  // step is waiting for rather than describing a check that cannot be made.
  if (needsEndpoint) return { text: t('agent3.setup_say_custom'), danger: false };
  // The two halves of the same sentence: what the shape fits, and whether the asking has begun.
  // The quiet's own line is written the way the unknown shape's is, in what it is ABOUT to do.
  if (shape === 'ambiguous') {
    return { text: t(probing ? 'agent3.setup_note_ambiguous' : 'agent3.setup_note_ambiguous_wait'), danger: false };
  }
  if (pinned && checking) return { text: t('agent3.setup_note_pinned_checking', { name: PROVIDER_META[pinned].name }), danger: false };
  if (shape !== 'empty' && shape !== 'partial' && shape !== 'unknown' && checking) {
    return { text: t('agent3.setup_note_shaped', { name: PROVIDER_META[shape].name }), danger: false };
  }
  if (!typing) return held ? { text: t('agent3.setup_note_replaces'), danger: false } : null;
  if (shape === 'partial') return { text: t('agent3.setup_note_partial'), danger: false };
  if (shape === 'unknown' && checking) return { text: t('agent3.setup_note_unknown'), danger: false };
  return null;
}

type FootVerb = 'recheck' | 'manual' | 'address' | 'reenter';

/** The foot's words. `recheck` carries two, chosen at the call site by what failed. */
const FOOT_LABEL: Record<FootVerb, string> = {
  recheck: 'agent3.setup_use_this_key',
  manual: 'agent3.setup_pick_provider',
  address: 'agent3.setup_give_address',
  reenter: 'agent3.setup_back',
};

/**
 * The foot, which is a RECOVERY foot or nothing at all.
 *
 * The flow's mouth carries no button: the field is the action and the gate is the advance, so a
 * Connect pill there would be a second way to do the one thing that already happens. Only the two
 * dead ends offer verbs, and a step merely WAITING offers Back.
 *
 * THE THIRD VERB IS AN ADVANCE THE QUIET WILL NOT MAKE. A pinned `custom` with no address filed has
 * nothing the field can be read against, and walking the user there on a timer would be a step whose
 * own Back returns to a step that walks them back into it. So the press is theirs.
 */
function footVerbs(a: {
  probeFailed: boolean; refused: boolean; needsEndpoint: boolean; probing: boolean; waiting: boolean;
}): FootVerb[] {
  if (a.refused || a.probeFailed) return ['recheck', 'manual'];
  if (a.needsEndpoint) return ['address'];
  if (a.probing || a.waiting) return ['reenter'];
  return [];
}

/** The roster inside the row's own list. An ambiguous key names its two candidates on their own
 *  entries, which is what resolves the ambiguity where it is shown. */
function rosterItems(t: T, shape: KeyShape): FloatMenuItem[] {
  const amb = shape === 'ambiguous';
  const items: FloatMenuItem[] = PROVIDER_ROSTER.map((id) => ({
    id,
    label: PROVIDER_META[id].name,
    ...(amb && id === 'deepseek' ? { sub: t('agent3.setup_fits_this_key') } : {}),
  }));
  items.push({
    id: 'custom',
    label: t('agent3.setup_custom_endpoint'),
    separated: true,
    ...(amb ? { sub: t('agent3.setup_gateway_fits') } : {}),
  });
  return items;
}

/**
 * The leave verb, on the step nothing else walks out of.
 *
 * IT IS THE FOOT'S OWN GHOST BUTTON, not an underlined line, and that is the family rule rather than
 * this step's taste: the setup steps are one screen-to-screen connection, and the house has two back
 * idioms — the quiet underlined text where space is genuinely tight, and the BUTTON everywhere the
 * connection between two steps is close. So Back is the same control on every step of this flow,
 * drawn exactly like the waiting step's own (`FOOT_GHOST`, the house `windowFooterGhost`).
 *
 * IT SAYS BACK, because there is a step behind it: the form is walked into from the keyless rest
 * (`PanelShell`'s office and its Connect), so no step of this screen is a mouth and "Not now" would
 * decline something nobody offered.
 */
function LeaveRow({ t, onLeave }: { t: T; onLeave?: () => void }) {
  if (!onLeave) return null;
  return (
    <div style={FOOT_ROW}>
      <button type="button" data-testid="setup-leave" onClick={onLeave} style={FOOT_GHOST}>
        {t('agent3.setup_back')}
      </button>
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────── */

/**
 * A RECOVERY FOOT'S VERBS READ ON ONE LINE EACH, and the row WRAPS rather than the labels.
 *
 * The two dead ends carry two verbs, and the 336px row measures 2px of slack with the English pair.
 * In Russian and French it measures none: the rig caught the pair standing 67px outside the panel at
 * ru/1.25, which is a control the user cannot press. Letting the labels wrap instead would put
 * "Выбрать поставщика самому" on two lines inside a pill and make the two verbs different heights,
 * so the ROW is what gives: each verb keeps its one line and the second one takes a line of its own
 * where the width is not there. `flex-basis: auto` is what makes that decision by content rather
 * than by a breakpoint.
 */
const FOOT_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const FOOT_PRIMARY: CSSProperties = { ...windowFooterPrimary, flex: '2 1 auto', whiteSpace: 'nowrap', padding: '12px 14px', cursor: cursors.clickable };
const FOOT_GHOST: CSSProperties = { ...windowFooterGhost, flex: '1 1 auto', whiteSpace: 'nowrap', padding: '12px 13px', cursor: cursors.clickable };

/** The confirmed provider's row. BORDER-BOX, because `width: 100%` plus its own side padding
 *  overflowed the job zone by exactly that padding and the row's two edges stood outside every other
 *  control on the screen (the rig catches it as a sideways spill). */
const LIT_ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', boxSizing: 'border-box',
  background: colors.tileYellow, color: INK, borderRadius: radii.md, padding: '10px 12px',
  // The `menu` rung, because this row IS the provider dropdown's chosen row with the list put away:
  // the two stand in the same seat one step apart in the flow, and at `chip` this one was a rung
  // lighter and half a pixel smaller than the row it replaces.
  ...roleFont('menu'), fontFamily: font.family, textAlign: 'left', border: 'none',
};
