import { Pill } from '../../primitives/Pill';
import { providerName } from '../../../i18n/terms/providers';
/*
 * The post-setup connection surface: provider, custom endpoint, model and oversight, in that
 * dependency order, without changing the session phase. Connection changes apply to the next job;
 * oversight changes apply at the next tool call.
 */
import { EffortControl } from './EffortControl';
import { ModelPicker } from './ModelPicker';
import {
  ensureModelCatalog, IDLE_MS, OVERSIGHTS, QUIRKS, type LiveConnection, type ProviderId, defaultListModels, fileEndpoint, forgetKeyAndRosters, type ListModels,
} from '../../../agent/panel';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../../../i18n/context';
import { FloatMenu, type FloatMenuItem } from '../../primitives/FloatMenu';
import { ConfirmPill } from '../parts/ConfirmPill';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { Spinner } from '../../primitives/Spinner';
import { font } from '../../design/styles';
import { DANGER_INK, INK, PLATE_INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { ActionButton } from '../../primitives/ActionButton';
import { useFrameZoom } from '../../shell/use-frame-zoom';
import { Icon } from '../parts/sprite';
import { motion } from 'framer-motion';
import { framerMotion } from '../../design/motion';
import {
  connectionGaps, isConnected, runnerSettings, useAgentConnection,
} from '../../../agent/boot';
import { useEndpointDraft } from '../hooks/use-endpoint-draft';
import { useModelRoster } from '../hooks/use-model-roster';
import { EndpointField } from '../parts/EndpointField';
import { prettyModel } from './pretty-model';
import {
  FOOT_STYLE, NOTE_STYLE, OVERSIGHT_COPY,
  PROVIDER_ROSTER, WRAP_STYLE,
} from './setup-parts';
import { endpointUrlLooksUsable } from '../../../platform/remote/endpoint-url';
import { showToast } from '../../../platform/channels/toast-bus';
import { useEffectEvent } from '../../primitives/use-effect-event';

interface ManageScreenProps {
  /** How many settled records the clear verb would take. 0 disables it. */
  jobCount: number;
  /** Whether a job is in flight at all, which is what a Stop has to have. */
  stoppable?: boolean;
  /** Whether the job is in a retry backoff that can be set aside. */
  parkable?: boolean;
  onDone?: () => void;
  /** Opens key entry directly when the selected provider has no saved credential. */
  onNeedKey?: () => void;
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
  onDone, onNeedKey, onStopJob, onSetAside, onClearJobs, listModels = defaultListModels, liveConnection,
}: ManageScreenProps) {
  const t = useT();
  const zoom = useFrameZoom();
  const settings = useAgentConnection();
  const [provOpen, setProvOpen] = useState(false);
  const url = useEndpointDraft(settings.customBaseUrl);

  /** The running job's connection the next-job notice was given for; a later job earns its own. */
  const noted = useRef<LiveConnection | null>(null);

  /** Reports that a connection change will not affect the running job. */
  const noteNextJob = useCallback(() => {
    if (!liveConnection || noted.current === liveConnection) return;
    noted.current = liveConnection;
    showToast(t('agent.setup_manage_next_job'), 'info');
  }, [liveConnection, t]);

  useEffect(() => { if (listModels === defaultListModels) void ensureModelCatalog(); }, [listModels]);

  const provider = settings.provider;
  const model = settings.model[provider] ?? '';
  // Read the credential only for the request that needs it; never put it in component state.
  const armedKey = runnerSettings(settings).apiKey;
  const customBaseUrl = settings.customBaseUrl;
  const connected = isConnected(settings);

  const roster = useModelRoster({
    provider, customBaseUrl, apiKey: armedKey, region: runnerSettings(settings).region, connected, listModels,
  });
  const { models } = roster;
  const listing = roster.status === 'loading';

  // The rosters go with the key: what an endpoint can run is an answer about the credential that
  // asked for it, and the next key on this provider deserves to have its own asked.
  const forget = useCallback(() => forgetKeyAndRosters(provider), [provider]);

  /** Files the typed address and re-asks it what it runs. The sanitizer is the one authority on
   *  whether a string is usable (`platform/remote/endpoint-url.ts:sanitizeEndpointUrl`), so an empty answer is the
   *  refusal and the field says so. */
  const checkEndpoint = useCallback(() => {
    const { stored, same } = fileEndpoint(url.value);
    if (stored === '') { url.refuse(); return; }
    url.settle();
    // A changed address loads afresh through the roster's own inputs; the same one is asked again.
    if (same) roster.refresh();
    noteNextJob();
  }, [url, roster, noteNextJob]);

  /** A changed address is filed and checked after the idle interval; an unchanged draft arms nothing, and an unusable one is refused in place. */
  const refuseDraft = useEffectEvent(() => url.refuse());
  useEffect(() => {
    if (provider !== 'custom') return undefined;
    const draft = url.value.trim();
    if (draft === '' || draft === customBaseUrl) return undefined;
    const timer = setTimeout(() => {
      if (endpointUrlLooksUsable(draft)) { checkEndpoint(); return; }
      refuseDraft();
    }, IDLE_MS);
    return () => clearTimeout(timer);
  }, [provider, url.value, customBaseUrl, checkEndpoint]);

  /** What the connection is still missing. The endpoint gap is the one this card can create (a check
   *  that failed outright), and Done reads the whole answer: the card is the door to idle, and idle
   *  says it can carry an order. */
  const gaps = connectionGaps(settings);
  /** Custom model selection requires an explicit server address. */
  const down = provider === 'custom' && customBaseUrl === '';
  const modelItems: FloatMenuItem[] = down
    ? []
    : models.map((id, index) => ({
      id,
      label: index === 0 ? t('agent.setup_default_model_entry', { name: prettyModel(id) }) : prettyModel(id),
    }));
  const allowManual = !down && (models.length === 0 || provider === 'custom' || QUIRKS[provider].listsModels === false);
  /** The verdict under the address field; empty where the address answered. */
  const endpointNote = url.bad ? t('agent.setup_endpoint_invalid')
    : roster.status === 'failed' ? t('agent.setup_list_unavailable') : '';

  const clearQuestion = stoppable ? 'agent.setup_manage_clear_pause_q' : 'agent.setup_manage_clear_q';
  const anonymous = provider === 'custom' && settings.customAuth === 'none';
  const forgetLabel = anonymous ? 'agent.setup_manage_disconnect' : 'agent.setup_manage_forget_key';
  const forgetQuestion = anonymous ? 'agent.setup_manage_disconnect_q' : 'agent.setup_manage_forget_q';

  return (
    <div data-testid="manage-screen" style={WRAP_STYLE}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FloatMenu
          data-testid="manage-prov-row"
          aria-label={t('agent.setup_pick_provider')}
          open={provOpen}
          onOpen={() => setProvOpen(true)}
          onClose={() => setProvOpen(false)}
          onPick={(id) => {
            if (settings.chooseProvider(id as ProviderId) === 'needs-key') onNeedKey?.();
            noteNextJob();
          }}
          activeId={provider}
          zoom={zoom}
          items={[
            ...PROVIDER_ROSTER.map((id) => ({ id, label: providerName(id, t) })),
            { id: 'custom', label: providerName('custom', t), separated: true },
          ]}
          row={(
            <span data-testid="manage-prov-face" data-provider={provider} style={ROW_INNER}>
              <span style={{ color: INK, display: 'inline-flex', flex: '0 0 auto' }}>
                <Icon id="pw-check" size={15} />
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>{providerName(provider, t)}</span>
            </span>
          )}
        />
        {provider === 'custom' && (
          <>
            <div style={LABEL_STYLE}>
              {t('agent.setup_manage_endpoint')}
            </div>
            {/* The field and its verdict note are one flex child: an empty note has no height, so
                the model row stands the column's own 8px below the field, and a verdict opens its
                line under the field when it arrives. */}
            <div>
            <EndpointField
              testId="manage-endpoint-input"
              value={url.value}
              bad={url.bad}
              onChange={url.edit}
              onEnter={() => { if (endpointUrlLooksUsable(url.value)) checkEndpoint(); else url.refuse(); }}
              // The check's wait stands inside the field it is about.
              trailing={listing && !url.bad ? <Spinner size={13} color={INK} /> : null}
            />
            {/* The verdict line opens on the shared unfold beat rather than pushing the model row
                down in one frame; the node stays mounted either way (the quiet is a verdict). */}
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
                ...(endpointNote !== '' ? { marginTop: 2 } : {}),
                ...(url.bad || roster.status === 'failed' ? { color: DANGER_INK } : {}),
              }}
            >
              {endpointNote}
            </div>
            </motion.div>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div data-testid="manage-model-label" style={LABEL_STYLE}>{t('agent.setup_manage_model')}</div>
          <Pill on="plate" variant="quiet" data-testid="manage-refresh-models" disabled={listing}
            onClick={() => { if (listModels === defaultListModels) void ensureModelCatalog(true); roster.refresh(); }}>
            {t('agent.setup_refresh_models')}
          </Pill>
        </div>
        <ModelPicker
          key={`${provider}|${customBaseUrl}`}
          model={model}
          items={modelItems}
          allowManual={allowManual}
          listing={listing}
          // A custom endpoint's address field carries the one listing spinner.
          loader={provider !== 'custom'}
          hint={QUIRKS[provider].modelHintKey !== undefined ? t(QUIRKS[provider].modelHintKey) : undefined}
          onPick={(id) => { settings.setModel(id); noteNextJob(); }}
          zoom={zoom}
        />
        {down && (
          <p data-testid="manage-model-blocked" style={NOTE_STYLE}>
            {t('agent.setup_manage_model_needs_endpoint')}
          </p>
        )}
      </div>

      <div>
        <EffortControl onChange={noteNextJob} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={LABEL_STYLE}>
            {t('agent.setup_oversight')}
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
      </div>

      <div data-testid="manage-verbs" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={VERB_ROW}>
          <ConfirmPill
            testId="manage-forget-key"
            on="plate"
            title={t(forgetQuestion)}
            actLabel={t(forgetLabel)}
            help="agent-setup"
            onConfirm={forget}
          >
            <Icon id="pw-key" size={13} />
            {t(forgetLabel)}
          </ConfirmPill>
          <ConfirmPill
            testId="manage-clear-jobs"
            on="plate"
            disabled={jobCount === 0}
            title={t(clearQuestion, { n: jobCount })}
            actLabel={t('agent.setup_manage_clear_jobs', { n: jobCount })}
            help="agent-setup"
            onConfirm={() => onClearJobs?.()}
          >
            <Icon id="pw-history" size={13} />
            {t('agent.setup_manage_clear_jobs', { n: jobCount })}
          </ConfirmPill>
        </div>
        {/* The held job's own verbs. */}
        {(stoppable || parkable) && (
          <div data-testid="manage-held" style={PILL_ROW}>
            {parkable && (
              <Pill data-testid="manage-set-aside" on="plate" onClick={() => onSetAside?.()}>
                <Icon id="pw-pause" size={13} />
                {t('agent.setup_manage_set_aside')}
              </Pill>
            )}
            {stoppable && (
              <Pill data-testid="manage-stop" on="plate" onClick={() => onStopJob?.()}>
                <Icon id="pw-stop" size={13} />
                {t('agent.setup_manage_stop_job')}
              </Pill>
            )}
          </div>
        )}
      </div>

      <div style={FOOT_STYLE}>
        {/* Done is the door to idle: it waits while anything is missing and names the first gap. */}
        <ActionButton
          appearance="primary"
          data-testid="manage-done"
          data-gated={gaps.length > 0 || undefined}
          {...(gaps.length > 0 ? { 'data-gap': gaps[0] } : {})}
          disabled={gaps.length > 0}
          onClick={onDone}
        >
          {t('agent.setup_done')}
        </ActionButton>
      </div>
    </div>
  );
}

const ROW_INNER: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
/** The small title a row is named by: the one label idiom for everything this card titles. */
const LABEL_STYLE: CSSProperties = { ...roleFont('label'), fontFamily: font.family, color: PLATE_INK, padding: '0 2px' };
const PILL_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' };

/** The two destructive verbs, side by side. */
const VERB_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 };
