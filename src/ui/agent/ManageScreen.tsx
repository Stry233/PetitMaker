/*
 * The panel's post-setup settings surface. It edits provider, custom endpoint, model and oversight
 * without changing the current session phase.
 *
 * Custom endpoint checks are debounced, with Enter checking immediately. A check triggered by an
 * address edit may invalidate the saved model; a background refresh only reports its result. The
 * dependency order is provider, endpoint, then model.
 *
 * Connection changes apply to the next job, while oversight changes apply at the next tool call.
 * Destructive actions use inline two-step confirmation. Stop is available for any running job;
 * set-aside is limited to retry backoff, the hold state that can be resumed safely.
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
import { Pill, zoneEnter } from './atoms';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { CONFIRM_ARM, framerMotion } from './motion';
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

/** The destructive action awaiting its second confirmation. */
type Asking = 'forget' | 'clear' | null;

export interface ManageScreenProps {
  /** How many settled records the clear verb would take. 0 disables it. */
  jobCount: number;
  /** Whether a job is in flight at all, which is what a Stop has to have. */
  stoppable?: boolean;
  /** Whether the job is in a retry backoff that can be set aside. */
  parkable?: boolean;
  onDone?: () => void;
  onStopJob?: () => void;
  /** Parks a retry backoff so the request can be resumed later. */
  onSetAside?: () => void;
  /** Removes every settled record. The map keeps what was built. */
  onClearJobs?: () => void;
  /** Injected for tests; the default reaches an SDK adapter by dynamic import. */
  listModels?: ListModels;
  /** The immutable connection captured by the running job, if any. */
  liveConnection?: LiveConnection;
}

export function ManageScreen({
  jobCount, stoppable = false, parkable = false,
  onDone, onStopJob, onSetAside, onClearJobs, listModels = defaultListModels, liveConnection,
}: ManageScreenProps) {
  const t = useT();
  const zoom = useFrameZoom();
  const settings = useAgentPanelSettings();
  const reduced = useReducedMotionConfig() === true;
  const [provOpen, setProvOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<readonly string[]>([]);
  const [asking, setAsking] = useState<Asking>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState(settings.customBaseUrl);
  const [urlBad, setUrlBad] = useState(false);
  /** Forces the roster effect to rerun when the stored address itself did not change. */
  const [checkSeq, setCheckSeq] = useState(0);
  /** `null` means no endpoint result has settled in this mount. */
  const [listing, setListing] = useState(false);
  const [reached, setReached] = useState<boolean | null>(null);

  /** Marks checks caused by an address edit, which may reconcile the saved model. */
  const justChecked = useRef(false);
  /** Limits the next-job notification to once per running job. */
  const noted = useRef(false);
  useEffect(() => { if (!liveConnection) noted.current = false; }, [liveConnection]);

  /** Reports that a connection change will not affect the running job. */
  const noteNextJob = useCallback(() => {
    if (!liveConnection || noted.current) return;
    noted.current = true;
    showToast(t('agent3.setup_manage_next_job'), 'info');
  }, [liveConnection, t]);

  const provider = settings.provider;
  const model = settings.model[provider] ?? '';
  // Read the credential only for the request that needs it; never put it in component state.
  const armedKey = runnerSettings(settings).apiKey;
  const customBaseUrl = settings.customBaseUrl;

  /**
   * Reconciles a filed model only after this screen checks the endpoint. A listed model remains; a
   * missing one switches visibly to the first offered model. An answered but unavailable catalogue
   * keeps a typed id unverified. An unreachable endpoint clears readiness through the check recorder.
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
  // simply leaves the dropdown holding the model already filed. Cancellation follows each request
  // so rapidly switching providers cannot let an older answer land last.
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
   *  whether a string is usable (`core/runtime/endpoint-url.ts:sanitizeEndpointUrl`), so an empty answer is the
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
  /** The verdict under the address field; empty where the address answered. */
  const endpointNote = urlBad ? t('agent3.setup_endpoint_invalid')
    : reached === false ? t('agent3.setup_manage_endpoint_failed')
      : reached === true && models.length === 0 && model !== ''
        ? t('agent3.setup_manage_endpoint_unlisted')
        : '';

  return (
    <motion.div {...zoneEnter(reduced)} data-testid="manage-screen" style={WRAP_STYLE}>
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
            {/* The field and its verdict note are one flex child: an empty note has no height, so
                the model row stands the column's own 8px below the field, and a verdict opens its
                line under the field when it arrives. */}
            <div>
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
            {/* The verdict line opens on the shared unfold beat rather than pushing the model row
                down in one frame; the node stays mounted either way (the quiet IS a verdict). */}
            <motion.div
              initial={false}
              animate={{ height: endpointNote === '' ? 0 : 'auto' }}
              transition={framerMotion('panel.detail.unfold')}
              style={{ overflow: 'hidden' }}
            >
            <div
              data-testid="manage-endpoint-note"
              style={{
                ...NOTE_STYLE,
                ...(endpointNote !== '' ? { marginTop: 3 } : {}),
                ...(urlBad || reached === false ? { color: colors.dangerText } : {}),
              }}
            >
              {endpointNote}
            </div>
            </motion.div>
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
    </motion.div>
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
