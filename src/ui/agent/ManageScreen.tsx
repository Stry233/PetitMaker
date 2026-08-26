/*
 * ManageScreen.tsx — the gear's ONE door, and everything behind it.
 *
 * THERE IS EXACTLY ONE SETTINGS SURFACE FOR THE PANEL, reached by exactly one press from every
 * connected face: provider, model, oversight, forget-the-key, clear-past-jobs, and the held job's own
 * verbs. A second place to change the model is a second answer to "what is this panel connected to",
 * and the two drift.
 *
 * THE ENDPOINT ADDRESS IS ONE OF THEM, and only while `custom` is the armed provider. The connection
 * screen owns FIRST entry — the step whose whole business is the server being named before the key
 * can be read against it — and this card owns every change after, which is the difference between two
 * copies of one field and one field with two moments. Without it a filed address was unreachable for
 * the rest of the panel's life: a connection whose gateway had moved could only be repaired by
 * dropping the key.
 *
 * AND THE CHECK RUNS ITSELF: there is no verify button, because the machine already takes that step.
 * A CHANGED address files itself once the hands are still (Enter is the same act, immediately), and
 * the filing asks the new address what it can run under the same deadline the connection screen asks
 * under; the card's mount asks too where the session has no answer yet. So a saved address that
 * answers nothing says so here rather than on the next order, and the readiness gate on Done is the
 * enforcement.
 *
 * WHICH TRIGGER ASKED DECIDES THE CHECK'S AUTHORITY, and `justChecked` is that boundary. An
 * address-CHANGE check is the user changing the connection, so its outright failure is ACTED ON, not
 * merely said: an address nothing answers cannot stand behind a model, so the filed model CLEARS
 * (the row empties and its sub-line says the address must answer first), the dead endpoint's
 * remembered list goes with it, and the endpoint becomes the connection's named gap — Done blocks
 * until the address answers and the user picks a model again. The fetch a mere gear press makes is a
 * GLANCE: its failure says so in the sub-line and clears nothing, since a transient blip under a
 * glance must not empty a pick the user made. The boundary between an outright failure and a server
 * that merely lists nothing is `endpointCheckVerdict`, whichever trigger asked.
 *
 * WHICH ALSO MAKES THIS THE WHOLE OF A CUSTOM CONNECTION'S REVIEW: the address and the model are both
 * here, so the connection screen hands `custom` over rather than confirming it, and this card's Done
 * is that journey's door to idle — gated on the same readiness test as every other door out of setup.
 *
 * IT IS CHROME OVER THE SESSION, NOT A STATE OF IT. Nothing here replaces the log, pauses the loop
 * or moves the phase: the card stands in the job zone for as long as it is open, and Done takes it
 * away, so the session the gear was pressed from is the session that comes back — the exact held
 * job, its gate, its tape, unchanged, because it was never touched (escape invariant 4).
 *
 * OVERSIGHT LIVES HERE AND NOWHERE ELSE. Setup does not ask for it — a visitor pasting their first
 * key has no way to judge the answer, so it defaults quietly to `checkpoint` — and this is where its
 * own words explain the three choices to a user who has come looking for them.
 *
 * AND SO DOES THE MODEL. Setup files a DEFAULT (the first id the endpoint names, or the one already
 * filed for that provider) and never asks; every later choice is this dropdown, and the typed id is
 * the fallback for an endpoint that lists nothing at all. One place to pick, for the panel's whole
 * life.
 *
 * THE ROWS READ TOP-DOWN IN THE ORDER THEY DEPEND ON EACH OTHER: provider, then the address, then the
 * model. The address decides which models exist, so a model row above it would ask the user to choose
 * from a list the row below has not established yet — and a filed model is RE-JUDGED whenever the
 * address changes (`reconcileModel`: kept where the new list names it, replaced and SAID where the
 * list answers without it, kept unverified where the list names nothing).
 *
 * WHAT A CHANGE HERE APPLIES TO is `panel-runner.ts`'s rule, not this card's: a connection fact
 * reaches the NEXT job, oversight reaches the next tool call of the one running. This card's part is
 * to SAY so at the moment of the press, through the house toast — never through a row that appears,
 * which would move the card at the instant it was being used.
 *
 * THE TWO DESTRUCTIVE VERBS BECOME THEIR OWN QUESTION (`SelfConfirm`): one press turns the button's
 * words into the locale's question form and its fill danger, a second press is the answer, and a
 * press anywhere else cancels. NOTHING IN THE CARD MOVES FOR IT — no control appears, each verb owns
 * a line ending in a spacer that absorbs the label's own width, and the held job's verbs are hushed
 * at exactly the rects they already had.
 *
 * THE HELD JOB'S VERBS ARE STOP AND SET-ASIDE, AND DELIBERATELY NOT PAUSE. The loop honours a pause
 * only at a call boundary and a pause WITHHOLDS the gate card, so a pause offered over a job that is
 * waiting on the user's own answer is a deadlock with two locked doors: the gate cannot be answered
 * because the card is gone, and the pause cannot land because the call has not returned. Set-aside is
 * offered only where the job is waiting on a CLOCK (a retry backoff), which is the one hold that
 * parks and replays cleanly; a gate offers stop alone.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../../i18n/context';
import { PROVIDER_META, type ProviderId } from '../../agent/providers/defaults';
import { FloatMenu, type FloatMenuItem } from '../primitives/FloatMenu';
import { HUSHED, InlineConfirm } from '../primitives/InlineConfirm';
import { SegmentedControl } from '../primitives/SegmentedControl';
import { Spinner } from '../primitives/Spinner';
import { colors, cursors, font } from '../design/styles';
import { INK, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';
import { windowFooterPrimary } from '../design/window-skin';
import { useFrameZoom } from '../shell/use-frame-zoom';
import { Icon } from './icons';
import { Pill } from './atoms';
import { CONFIRM_ARM } from './motion';
import { forgetRoster, forgetRosters, rememberedRoster, rememberRoster, rosterKey } from './model-roster';
import { prettyModel } from './pretty-model';
import { defaultListModels, IDLE_MS, type ListModels } from './SetupScreen';
import {
  endpointCheckVerdict, FIELD_STYLE, FOOT_STYLE, GATED, INPUT_STYLE, NOTE_STYLE, OVERSIGHT_COPY,
  OVERSIGHTS, PROVIDER_ROSTER, urlLooksUsable, WRAP_STYLE,
} from './setup-parts';
import { connectionGaps, runnerSettings, useAgentPanelSettings } from './settings';
import type { LiveConnection } from '../../agent/exec/runner';
import { showToast } from '../../core/runtime/toast-bus';

/** Which of the two questions is standing. One at a time: two open confirms in one card is two
 *  destructive answers a stray Enter could give at once. */
type Asking = 'forget' | 'clear' | null;

export interface ManageScreenProps {
  /** How many settled records the clear verb would take. 0 disables it. */
  jobCount: number;
  /** Whether a job is in flight at all, which is what a Stop has to have. */
  stoppable?: boolean;
  /** Whether the job is waiting on a CLOCK rather than on the user — the one hold that parks. */
  parkable?: boolean;
  onDone?: () => void;
  onStopJob?: () => void;
  /** Parks a retry backoff: the ticket holds and the request replays later. Never a pause over a
   *  gate — see the file header. */
  onSetAside?: () => void;
  /** Removes every settled record. The map keeps what was built. */
  onClearJobs?: () => void;
  /** Injected for tests; the default reaches an SDK adapter by dynamic import. */
  listModels?: ListModels;
  /**
   * The connection the job in flight is bound to, or undefined where none is running.
   *
   * THE CARD'S ROWS AND A RUNNING JOB CAN DISAGREE, and only this says so. A connection change
   * applies from the NEXT job (`panel-runner.ts` states the rule and why), so the rows show what is
   * armed while the loop goes on using what it launched with; without the launched answer the card
   * would silently claim a model the requests are not using.
   */
  liveConnection?: LiveConnection;
}

export function ManageScreen({
  jobCount, stoppable = false, parkable = false,
  onDone, onStopJob, onSetAside, onClearJobs, listModels = defaultListModels, liveConnection,
}: ManageScreenProps) {
  const t = useT();
  const zoom = useFrameZoom();
  const settings = useAgentPanelSettings();
  const [provOpen, setProvOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<readonly string[]>([]);
  const [asking, setAsking] = useState<Asking>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState(settings.customBaseUrl);
  const [urlBad, setUrlBad] = useState(false);
  /** Bumped by the address check, so pressing it on an UNCHANGED address still re-asks: the store
   *  value is what the roster effect keys on, and re-writing the same string moves nothing. */
  const [checkSeq, setCheckSeq] = useState(0);
  /** Whether the roster request is out, and what the last settled one said. `null` is "nothing has
   *  been asked yet", which is neither a wait nor a verdict. */
  const [listing, setListing] = useState(false);
  const [reached, setReached] = useState<boolean | null>(null);

  /** Whether the standing list came from an address the user has just FILED on this card. Only that
   *  moment re-judges the filed model: a plain gear press must not re-pick one the user typed. */
  const justChecked = useRef(false);
  /** Whether the next-job note has already been said for the job now running. Once per job, not once
   *  per press: a model typed a character at a time is one change, and forty toasts is not a note. */
  const noted = useRef(false);
  useEffect(() => { if (!liveConnection) noted.current = false; }, [liveConnection]);

  /**
   * SAYS THAT A CONNECTION CHANGE LANDS ON THE NEXT JOB, and only while one is running.
   *
   * The house toast rather than a line on the card: the fact is about a MOMENT (the press just made),
   * and a row appearing here would move the card under the pointer that had just used it.
   */
  const noteNextJob = useCallback(() => {
    if (!liveConnection || noted.current) return;
    noted.current = true;
    showToast(t('agent3.setup_manage_next_job'), 'info');
  }, [liveConnection, t]);

  const provider = settings.provider;
  const model = settings.model[provider] ?? '';
  // The key never enters state or a render tree: `runnerSettings` is the sanctioned reader and its
  // answer is handed straight to the request (`settings.ts`'s own rule).
  const armedKey = runnerSettings(settings).apiKey;
  const customBaseUrl = settings.customBaseUrl;

  /**
   * THE ENDPOINT DECIDES WHICH MODELS EXIST, so a newly filed address is asked whether it serves the
   * one on file, and the answer is acted on rather than filed for the next order to discover.
   *
   * FOUR OUTCOMES. A model stands in the first three; the fourth is the one place readiness DROPS:
   *   the list NAMES it        — it is kept, and the arriving list is what confirms it.
   *   the list ANSWERS without it — replaced by the address's own first offer, and the swap is SAID.
   *     Left alone, the connection would point at a model this host refuses and fail on the next
   *     order instead of here, where the row that caused it is under the pointer.
   *   the list NAMES NOTHING but the SERVER ANSWERED — an empty catalogue, or a refusal that proves
   *     the address is there (`endpointCheckVerdict`'s `no-list`) — proof of nothing (a gateway that
   *     will not enumerate still runs what it is given), so the typed id stands and the address row
   *     says it is unverified.
   *   the check FAILS OUTRIGHT (`unreachable`: nothing answered, or no request could be built) — a
   *     model no server stands behind is not a pick, so the row EMPTIES (`recordEndpointCheck`), the
   *     endpoint becomes the named gap and Done blocks until the address answers and the user picks
   *     again. The cleared pick is offered back visibly once a list arrives, never restored silently.
   *
   * ONLY AFTER A CHECK ON THIS CARD. A gear press re-reads the same list, and re-picking (or
   * clearing) a model the user chose deliberately because a fetch failed under a glance at the card
   * would be the card overruling them.
   */
  const reconcileModel = useCallback((ids: readonly string[]) => {
    if (!justChecked.current) return;
    justChecked.current = false;
    if (ids.length === 0) return;
    const state = useAgentPanelSettings.getState();
    const filed = state.model[state.provider] ?? '';
    if (filed === '' || ids.includes(filed)) return;
    const next = ids[0]!;
    state.setModel(next);
    showToast(t('agent3.setup_manage_model_swapped', { was: prettyModel(filed), now: prettyModel(next) }), 'warning');
    noteNextJob();
  }, [t, noteNextJob]);

  // THE LIST IS A CONVENIENCE HERE, NOT A GATE. Setup already proved the key; a manage card whose
  // list will not load still lets the provider, the oversight and both verbs be used, so a failure
  // simply leaves the dropdown holding the model already filed. Cancelled per request rather than
  // per mount: switching provider twice quickly would otherwise let the first answer land last.
  //
  // AND ASKED ONCE PER ENDPOINT PER SESSION (`model-roster.ts`). This is the panel's one settings
  // door, so a request per visit is a request per glance at the oversight caption — and the answer
  // does not change between two presses of the same gear.
  // IT IS ALSO THE ADDRESS CHECK. A `custom` connection's address is edited on this card, and asking
  // the new one what it can run is the only way to find out whether it answers at all — so the one
  // request serves both, and `listing`/`reached` are what the address row reads its face off.
  useEffect(() => {
    if (armedKey === '') { setModels([]); setListing(false); setReached(null); return undefined; }
    const key = rosterKey(provider, customBaseUrl);
    const held = rememberedRoster(key);
    // The cached path reconciles too: a filed address the user comes back to is still an address
    // that decides which models exist, and a list read from memory says exactly what a fresh one did.
    if (held) { setModels(held); setListing(false); setReached(true); reconcileModel(held); return undefined; }
    let cancelled = false;
    setListing(true);
    listModels({ provider, apiKey: armedKey, ...(customBaseUrl ? { customBaseUrl } : {}) })
      .then((ids) => {
        rememberRoster(key, ids);
        if (cancelled) return;
        setModels(ids);
        setListing(false);
        // An endpoint that answers with an empty catalogue HAS answered: the address is reachable and
        // the model is what has to be typed, which is a different repair from an address that is not.
        setReached(true);
        if (provider === 'custom') useAgentPanelSettings.getState().recordEndpointCheck(true);
        reconcileModel(ids);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Consumed here as the success path consumes it in `reconcileModel`: whatever this failure
        // decides, it has answered the check it belongs to.
        const wasChecked = justChecked.current;
        justChecked.current = false;
        setModels([]);
        setListing(false);
        if (endpointCheckVerdict(err) === 'no-list') {
          // The server ANSWERED and merely serves no readable list, which is the same trust an empty
          // catalogue earns: the address row says the model is unverified, and it stands.
          setReached(true);
          if (provider === 'custom') useAgentPanelSettings.getState().recordEndpointCheck(true);
          return;
        }
        setReached(false);
        // THE FAILED VERDICT IS FILED ONLY FOR A CHECK MADE ON THIS CARD. A gear press re-asks the
        // same list, and a transient fault under that glance must not empty a pick the user made.
        if (provider === 'custom' && wasChecked) useAgentPanelSettings.getState().recordEndpointCheck(false);
      });
    return () => { cancelled = true; };
  }, [listModels, provider, armedKey, customBaseUrl, checkSeq, reconcileModel]);

  // The rosters go with the key: what an endpoint can run is an answer about the credential that
  // asked for it, and the next key on this provider deserves to have its own asked.
  const forget = useCallback(() => {
    forgetRosters();
    settings.forgetKey(provider);
  }, [settings, provider]);

  useEffect(() => { setUrlDraft(settings.customBaseUrl); }, [settings.customBaseUrl]);

  /** Files the typed address and re-asks it what it runs. The sanitizer is the one authority on
   *  whether a string is usable (`key-storage.ts:sanitizeEndpointUrl`), so an empty answer is the
   *  refusal and the field says so. */
  const checkEndpoint = useCallback(() => {
    const stored = settings.setCustomBaseUrl(urlDraft);
    if (stored === '') { setUrlBad(true); return; }
    setUrlBad(false);
    forgetRoster(rosterKey('custom', stored));
    justChecked.current = true;
    setCheckSeq((n) => n + 1);
    noteNextJob();
  }, [settings, urlDraft, noteNextJob]);

  /**
   * THE CHECK RUNS ITSELF: a CHANGED address is filed and asked once the hands are still, on the
   * same quiet the key field advances on (`IDLE_MS`). The draft is compared to what is filed, so a
   * glance at the card arms nothing and an unchanged field can sit under the caret forever; a string
   * the app could not reach is refused in place instead of being filed. The keystroke that replaces
   * the draft is this effect's own dependency, which is what restarts the quiet.
   */
  useEffect(() => {
    if (provider !== 'custom') return undefined;
    const draft = urlDraft.trim();
    if (draft === '' || draft === customBaseUrl) return undefined;
    const timer = setTimeout(() => {
      if (urlLooksUsable(draft)) { checkEndpoint(); return; }
      setUrlBad(true);
    }, IDLE_MS);
    return () => clearTimeout(timer);
  }, [provider, urlDraft, customBaseUrl, checkEndpoint]);

  /** WHAT THE CONNECTION IS STILL MISSING. The endpoint gap is the one this card can CREATE (a check
   *  that failed outright), and Done reads the whole answer: the card is the door to idle, and idle
   *  says it can carry an order. */
  const gaps = connectionGaps(settings);
  /** Whether the FILED address is the one whose last completed check failed. The model row stands
   *  empty behind it and offers nothing at all: any list this card could offer came from a server
   *  that is not answering, and a typed id would file a model no request can reach. */
  const down = provider === 'custom' && customBaseUrl !== '' && settings.endpointDown === customBaseUrl;
  const modelItems: FloatMenuItem[] = down
    ? []
    : models.length > 0
      ? models.map((id) => ({
        id,
        label: prettyModel(id),
        // The pick a failed check CLEARED, offered back visibly where the recovered list serves it:
        // it was the user's own, and one press restores it, but the row stands empty until that press.
        ...(id === settings.formerModel ? { sub: t('agent3.setup_model_former') } : {}),
      }))
      // The one KNOWN DEFAULT this card can offer with no list: the model already filed for this
      // provider, from a session that did reach one.
      : model === '' ? [] : [{ id: model, label: prettyModel(model), sub: t('agent3.setup_known_default') }];
  /** No list AND nothing filed: there is nothing to choose from, so the id is typed. A down endpoint
   *  is NOT that case — its repair is the address row above, and the sub-line under the model says so. */
  const typeIt = !down && models.length === 0 && model === '';

  return (
    <div data-testid="manage-screen" style={WRAP_STYLE}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FloatMenu
          data-testid="manage-prov-row"
          aria-label={t('agent3.setup_pick_provider')}
          open={provOpen}
          onOpen={() => setProvOpen(true)}
          onClose={() => setProvOpen(false)}
          onPick={(id) => { settings.pinProvider(id as ProviderId); noteNextJob(); }}
          activeId={provider}
          zoom={zoom}
          items={[
            ...PROVIDER_ROSTER.map((id) => ({ id, label: PROVIDER_META[id].name })),
            { id: 'custom', label: PROVIDER_META.custom.name, separated: true },
          ]}
          row={(
            <span data-testid="manage-prov-face" data-provider={provider} style={ROW_INNER}>
              <span style={{ color: INK, display: 'inline-flex', flex: '0 0 auto' }}>
                <Icon id="pw-check" size={15} />
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>{PROVIDER_META[provider].name}</span>
            </span>
          )}
        />
        {/* THE ADDRESS, AND ONLY WHILE THE USER'S OWN SERVER IS ARMED. It stands directly under the
            provider row that names it, above the model the address decides, because that is the
            order the two facts depend on each other in. The check runs itself (the quiet, or Enter),
            and the note under the field carries the VERDICT alone: an unusable string, an address
            that answered nothing, the unverified case — the house spinner while the check is out,
            and quiet where the address answered, since an endpoint that is fine has nothing to
            explain. The line keeps one line of height either way, so a verdict arriving does not
            move the model row. */}
        {provider === 'custom' && (
          <>
            <div style={LABEL_STYLE}>
              {t('agent3.setup_manage_endpoint')}
            </div>
            <label
              className={FIELD_WRAP_CLASS}
              style={urlBad ? { ...FIELD_STYLE, borderColor: colors.dangerText } : FIELD_STYLE}
            >
              <Icon id="pw-link-out" size={17} />
              <input
                type="text"
                data-testid="manage-endpoint-input"
                className={FIELD_INPUT_CLASS}
                spellCheck={false}
                autoComplete="off"
                placeholder={t('agent3.setup_endpoint_placeholder')}
                value={urlDraft}
                onChange={(e) => { setUrlDraft(e.target.value); setUrlBad(false); }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (urlLooksUsable(urlDraft)) checkEndpoint();
                  else setUrlBad(true);
                }}
                style={{ ...INPUT_STYLE, letterSpacing: 0 }}
              />
              {/* The wait rides the pill itself, trailing the text: the check is about this field,
                  so its sign stands inside it rather than opening a row. It keeps ticking under
                  reduced motion: progress is essential feedback, the Spinner's own `pw-busy`
                  opt-out. */}
              {listing && !urlBad && <Spinner size={13} color={INK} />}
            </label>
            <div
              data-testid="manage-endpoint-note"
              style={{
                ...NOTE_STYLE,
                minHeight: '1.45em',
                ...(urlBad || reached === false ? { color: colors.dangerText } : {}),
              }}
            >
              {urlBad ? t('agent3.setup_endpoint_invalid')
                : reached === false ? t('agent3.setup_manage_endpoint_failed')
                  : reached === true && models.length === 0 && model !== ''
                    ? t('agent3.setup_manage_endpoint_unlisted')
                    : ''}
            </div>
          </>
        )}
        {/* THE ROW SAYS WHAT IT IS. The dropdown's face is a bare model id, which names nothing on
            its own, so the row carries the same small label the endpoint and oversight rows are
            titled by. It stands whatever the row below holds — a pick, an empty seat, a typed id —
            so no state moves it. */}
        <div data-testid="manage-model-label" style={LABEL_STYLE}>
          {t('agent3.setup_manage_model')}
        </div>
        <FloatMenu
          data-testid="manage-model-dd"
          aria-label={t('agent3.setup_model_placeholder')}
          open={modelsOpen}
          onOpen={() => setModelsOpen(true)}
          onClose={() => setModelsOpen(false)}
          onPick={(id) => { settings.setModel(id); noteNextJob(); }}
          activeId={model}
          zoom={zoom}
          items={modelItems}
          row={<span data-testid="manage-model-face">{model === '' ? t('agent3.setup_model_pick') : prettyModel(model)}</span>}
        />
        {/* WHY THE MODEL ROW IS EMPTY, while the failed check stands: the row cannot honestly offer
            anything until the address above it answers, and this is the one line that says so. */}
        {down && (
          <p data-testid="manage-model-blocked" style={NOTE_STYLE}>
            {t('agent3.setup_manage_model_needs_endpoint')}
          </p>
        )}
        {/* THE TYPED ID IS THIS CARD'S BUSINESS, and only where the endpoint named nothing at all. A
            gateway that will not list its models still runs them, and this is the one surface where a
            model is chosen, so the fallback belongs beside the dropdown it replaces rather than in a
            setup flow the user has already left. */}
        {typeIt && (
          <>
            <p data-testid="manage-models-unavailable" style={NOTE_STYLE}>
              {t('agent3.setup_models_unavailable')}
            </p>
            <label className={FIELD_WRAP_CLASS} style={FIELD_STYLE}>
              <input
                type="text"
                data-testid="manage-model-input"
                className={FIELD_INPUT_CLASS}
                spellCheck={false}
                autoComplete="off"
                placeholder={t('agent3.setup_model_placeholder')}
                value={modelDraft}
                onChange={(e) => { setModelDraft(e.target.value); settings.setModel(e.target.value.trim()); noteNextJob(); }}
                style={{ ...INPUT_STYLE, letterSpacing: 0 }}
              />
            </label>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={LABEL_STYLE}>
          {t('agent3.setup_oversight')}
        </div>
        <SegmentedControl
          value={settings.oversight}
          options={OVERSIGHTS}
          onChange={(o) => settings.setOversight(o)}
          render={(o) => t(OVERSIGHT_COPY[o].label)}
          idPrefix="agent3-oversight"
        />
        <p data-testid="manage-oversight-caption" style={NOTE_STYLE}>
          {t(OVERSIGHT_COPY[settings.oversight].caption)}
        </p>
      </div>

      <div data-testid="manage-verbs" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* BOTH VERBS ON ONE ROW, ENDING IN A SPACER. They are two verbs of one kind — things the card
            can throw away — and the row reads as that pair. The spacer is what absorbs the growth: a
            verb becoming its own question widens by the words it gained, and the spacer gives them up
            so nothing on the row moves at the moment a deliberate answer is being asked for. */}
        <div style={VERB_ROW}>
          {/* THE HUSH SITS OUTSIDE THE CONFIRM, on the seat rather than on the trigger: the seat is
              what keeps its rect while the verb is armed, and a hushed seat sends the press that
              lands on it to the document, where it is read as the cancel it is. */}
          <span style={asking === 'clear' ? HUSHED : undefined}>
            <InlineConfirm
              question={t('agent3.setup_manage_forget_q')}
              arm={CONFIRM_ARM}
              open={asking === 'forget'}
              onOpenChange={(open) => setAsking(open ? 'forget' : null)}
              onConfirm={forget}
              onCancel={() => setAsking(null)}
            >
              {(armed) => (
                <Pill data-testid="manage-forget-key" on="plate" variant={armed ? 'danger' : 'quiet'}>
                  <Icon id="pw-key" size={13} />
                  {t(armed ? 'agent3.setup_manage_forget_q' : 'agent3.setup_manage_forget_key')}
                </Pill>
              )}
            </InlineConfirm>
          </span>
          <span style={asking === 'forget' ? HUSHED : undefined}>
            <InlineConfirm
              question={t('agent3.setup_manage_clear_q', { n: jobCount })}
              arm={CONFIRM_ARM}
              open={asking === 'clear'}
              onOpenChange={(open) => setAsking(open ? 'clear' : null)}
              onConfirm={() => onClearJobs?.()}
              onCancel={() => setAsking(null)}
            >
              {(armed) => (
                <Pill
                  data-testid="manage-clear-jobs"
                  on="plate"
                  variant={armed ? 'danger' : 'quiet'}
                  disabled={jobCount === 0}
                >
                  <Icon id="pw-history" size={13} />
                  {t(armed ? 'agent3.setup_manage_clear_q' : 'agent3.setup_manage_clear_jobs', { n: jobCount })}
                </Pill>
              )}
            </InlineConfirm>
          </span>
          <span style={ROW_SPACER} />
        </div>
        {/* The held job's own verbs. A question the card is already asking outranks them, and they
            stand HUSHED for it rather than leaving: withdrawing a row is the card changing height
            under the question it has just been asked. */}
        {(stoppable || parkable) && (
          <div data-testid="manage-held" style={asking === null ? PILL_ROW : { ...PILL_ROW, ...HUSHED }}>
            {parkable && (
              <Pill data-testid="manage-set-aside" on="plate" onClick={() => onSetAside?.()}>
                <Icon id="pw-pause" size={13} />
                {t('agent3.setup_manage_set_aside')}
              </Pill>
            )}
            {stoppable && (
              <Pill data-testid="manage-stop" on="plate" onClick={() => onStopJob?.()}>
                <Icon id="pw-stop" size={13} />
                {t('agent3.setup_manage_stop_job')}
              </Pill>
            )}
          </div>
        )}
      </div>

      <div style={FOOT_STYLE}>
        {/* DONE IS THE DOOR TO IDLE, so it goes through the one readiness test every other door out
            of setup goes through: it blocks while anything is missing (a check that failed makes the
            ENDPOINT that gap), dimmed at the rect it already had, and names the first gap for the
            hand that finds it refusing. */}
        <button
          type="button"
          data-testid="manage-done"
          data-gated={gaps.length > 0 || undefined}
          {...(gaps.length > 0 ? { 'data-gap': gaps[0] } : {})}
          disabled={gaps.length > 0}
          onClick={onDone}
          style={{ ...windowFooterPrimary, cursor: cursors.clickable, ...(gaps.length > 0 ? GATED : {}) }}
        >
          {t('agent3.setup_done')}
        </button>
      </div>
    </div>
  );
}

const ROW_INNER: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 };
/** The small title a row is named by: the one label idiom for everything this card titles. */
const LABEL_STYLE: CSSProperties = { ...roleFont('label'), fontFamily: font.family, color: PLATE_INK, padding: '0 3px' };
const PILL_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' };

/** A destructive verb's own line: the seat, then the room the confirm grows into. NOWRAP, because
 *  the spacer is what gives — a row that may wrap has no stable height to keep. */
const VERB_ROW: CSSProperties = { display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6 };
/** The room the pair takes when it opens, and the verb's own line-end when it is shut. */
const ROW_SPACER: CSSProperties = { flex: '1 1 auto', minWidth: 0 };
