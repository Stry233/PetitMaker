/*
 * Guides key entry, provider detection and connection completion. Automatic advance waits for an
 * idle interval or Enter so typing never loses focus. Explicit provider choices override key-shape
 * detection, and leaving a reading cancels its pending request. Ambiguous keys probe candidate
 * providers; custom endpoints require an address. Model choice and oversight remain in management.
 * Network functions are injected, and default adapters load dynamically by provider dialect.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useUiPreview } from '../primitives/ui-preview';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { zoneEnter } from './atoms';
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
export type Mark = 'spin' | 'cross' | null;

/** Bounds model discovery with the provider-probe deadline and aborts a silent endpoint. */
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
  // Promise.race attaches handlers to the request, so a late rejection cannot become unhandled.
  return Promise.race([run(controller.signal), deadline]).finally(() => { clearTimeout(timer); });
}

/** Loads the selected provider adapter dynamically and lists models through its native dialect. */
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

/** Stateless key input shared by key and endpoint steps; the caller owns value, masking and refusal state. */
export function SetupKeyField({
  value, masked = false, refused, shakeSeq, inputRef, onChange, onFocus, onBlur, onEnter,
}: {
  value: string;
  /** Whether the resting key field uses `type="password"`. */
  masked?: boolean;
  refused: boolean;
  /** Bumped on every refusal, so a second refusal of the same key shakes again (see the caller). */
  shakeSeq: number;
  inputRef?: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: (value: string) => void;
  /** Enter, read as the same advance the foot's own press fires. */
  onEnter?: () => void;
}) {
  const t = useT();
  return (
    <motion.label
      data-testid="setup-key-field"
      className={FIELD_WRAP_CLASS}
      data-danger={refused || undefined}
      // Alternating targets replay repeated refusals without remounting the focused field.
      animate={refused
        ? { x: shakeSeq % 2 === 0 ? [0, -SHAKE, SHAKE, 0] : [0, SHAKE, -SHAKE, 0] }
        : { x: 0 }}
      transition={framerMotion('panel.setup.refuse')}
      style={refused ? { ...FIELD_STYLE, borderColor: colors.dangerText } : FIELD_STYLE}
    >
      <Icon id="pw-key" size={17} />
      <input
        ref={inputRef}
        type={masked ? 'password' : 'text'}
        data-testid="setup-key-input"
        className={FIELD_INPUT_CLASS}
        spellCheck={false}
        autoComplete="off"
        placeholder={t('agent3.setup_key_placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}
        onFocus={() => onFocus?.()}
        onBlur={(e) => onBlur?.(e.target.value)}
        style={INPUT_STYLE}
      />
    </motion.label>
  );
}

export interface SetupScreenProps {
  /** Called once a key, a provider and a model are all settled. The shell leaves setup on it. */
  onDone?: () => void;
  /** Injected for tests; defaults to the real `/models` probe. */
  probe?: typeof probeAmbiguousKey;
  /** Injected for tests; the default reaches an SDK adapter by dynamic import. */
  listModels?: ListModels;
  /** Candidate providers for ambiguous bare-sk keys. */
  candidates?: readonly ProviderId[];
  /** Returns to the surface that opened setup. */
  onLeave?: () => void;
  /** Reports the active setup face to the desk above it. */
  onFace?: (face: SetupFace | null) => void;
  /** Initial setup step, read once at mount. */
  entry?: SetupEntry;
  /** Opens connection management for model entry or custom-endpoint review. */
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
  // Help previews render the full screen without issuing provider requests.
  const pictured = useUiPreview();
  const settings = useAgentPanelSettings();

  /** Named repair steps take priority; otherwise an existing partial connection opens at confirmation. */
  const [phase, setPhase] = useState<'key' | 'custom' | 'confirm'>(() => {
    if (entry === 'endpoint') return 'custom';
    if (entry === 'chooser') return 'key';
    const gaps = connectionGaps(useAgentPanelSettings.getState());
    return gaps.length > 0 && !gaps.includes('key') ? 'confirm' : 'key';
  });
  const [keyDraft, setKeyDraft] = useState('');
  /** The key masks while unfocused and remains visible while editing. */
  const [keyMasked, setKeyMasked] = useState(false);
  /** Tracks field focus for password-manager fills that arrive without focus events. */
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
  /** Provider and key currently used by model discovery; the store remains authoritative for rendering. */
  const armed = useRef<ProviderId | null>(null);
  const armedKey = useRef('');
  /** Key value whose automatic advance is suspended until the field changes. */
  const [heldBack, setHeldBack] = useState<string | null>(null);
  /** Generation counter that discards model or provider results from superseded readings. */
  const reading = useRef(0);

  const provider = armed.current ?? settings.provider;
  const model = settings.model[provider] ?? '';
  /** Explicit provider choice, including a custom provider still awaiting its endpoint. */
  const pinned = settings.providerPinned || endpointOwed(settings) ? settings.provider : null;
  const customBaseUrl = settings.customBaseUrl;
  const forgetKey = settings.forgetKey;
  const connectKey = settings.connectKey;
  const setModel = settings.setModel;

  const shape: KeyShape = pinned ?? readKeyShape(keyDraft);
  const accepted = keyLooksUsable(keyDraft);
  const typing = keyDraft.length > 0;
  /** Outstanding requirements for the provider currently being configured. */
  const gaps = connectionGaps(settings, provider);
  /** Whether a custom provider still needs an endpoint before its key can be checked. */
  const needsEndpoint = shape === 'custom' && customBaseUrl === '';

  /** Tests the connection through model discovery and files the first result only when no model is set. */
  const loadModels = useCallback((id: ProviderId, apiKey: string) => {
    setModelsFailed(false);
    // Never send a custom-provider key until its endpoint is explicit.
    if (apiKey === '' || (id === 'custom' && customBaseUrl === '')) return;
    // Capture the reading generation so superseded results cannot mutate current setup.
    const mine = reading.current;
    listModels({ provider: id, apiKey, ...(customBaseUrl ? { customBaseUrl } : {}) })
      .then((ids) => {
        if (mine !== reading.current) return;
        // Any custom-provider response proves the endpoint reachable.
        if (id === 'custom') useAgentPanelSettings.getState().recordEndpointCheck(true);
        // An empty list provides no default model.
        const first = ids[0];
        if (first === undefined) { setModelsFailed(true); return; }
        if ((useAgentPanelSettings.getState().model[id] ?? '') === '') setModel(first);
      })
      .catch((err: unknown) => {
        if (mine !== reading.current) return;
        // Store custom-endpoint reachability using the same verdict shared with management.
        if (id === 'custom') {
          useAgentPanelSettings.getState().recordEndpointCheck(endpointCheckVerdict(err) !== 'unreachable');
        }
        // Authentication failure removes the key and returns focus to key entry.
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

  /** Files the key and provider, enters confirmation and starts model discovery. */
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
    // Ignore a probe if any subsequent action advances the reading generation.
    const mine = reading.current;
    setProbing(true);
    setProbeFailed(false);
    probe(key, { candidates: [...candidates] })
      .then((winner) => {
        if (mine !== reading.current) return;
        setProbing(false);
        if (winner) { commit(winner, key); return; }
        // With no responding candidate, leave provider choice to the user.
        setProbeFailed(true);
      })
      .catch(() => {
        if (mine !== reading.current) return;
        setProbing(false);
        setProbeFailed(true);
      });
  }, [probe, candidates, commit]);

  /** Automatic destination after the key remains idle, excluding the user-initiated endpoint step. */
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
    commit(shape as ProviderId, key);
  }, [keyDraft, shape, runProbe, commit]);

  // Draft-dependent callback identity restarts the idle timer after each value change.
  useEffect(() => {
    if (!gate || pictured) return undefined;
    const timer = setTimeout(() => fire(gate), IDLE_MS);
    return () => clearTimeout(timer);
  }, [gate, fire, pictured]);

  useEffect(() => { setUrlDraft(customBaseUrl); }, [customBaseUrl]);

  // Confirmation returns to key entry if its stored key disappears.
  const keyMissing = gaps.includes('key');
  useEffect(() => { if (phase === 'confirm' && keyMissing) setPhase('key'); }, [phase, keyMissing]);

  /** Hands custom review or listless model entry to management once per setup mount. */
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
    if (pictured || askedOnMount.current || phase !== 'confirm' || armed.current !== null) return;
    askedOnMount.current = true;
    const held = runnerSettings(useAgentPanelSettings.getState()).apiKey;
    armedKey.current = held;
    loadModels(provider, held);
  }, [phase, provider, loadModels]);

  // Select a refused key so the next input replaces it.
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!refused) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [refused, shakeSeq]);

  /** Immediately follows the same destination table used by idle advance. */
  function confirmNow(): void {
    const dest = keyDestination({ shape, usable: accepted, endpointFiled: !needsEndpoint, explicit: true });
    if (!dest) return;
    reading.current += 1;
    setHeldBack(null);
    fire(dest);
  }

  /** Returns to key entry while retaining the draft and suspending its automatic advance. */
  function reenter(): void {
    reading.current += 1;
    setProbing(false);
    setProbeFailed(false);
    setRefused(false);
    setRowOpen(false);
    setHeldBack(keyDraft);
  }

  /** Opens an explicit provider override and invalidates automatic detection for the current draft. */
  function chooseByHand(): void {
    reading.current += 1;
    setProbing(false);
    setHeldBack(keyDraft);
    setRowOpen(true);
  }

  function pickProvider(id: ProviderId): void {
    // An explicit pick clears status from the reading it supersedes.
    setProbeFailed(false);
    setRefused(false);
    if (id === 'custom') { setRowOpen(false); setPhase('custom'); return; }
    settings.pinProvider(id);
    setRowOpen(false);
    // Invalidate any provider probe still in flight.
    reading.current += 1;
    const key = keyDraft.trim() || armedKey.current;
    if (key !== '') { commit(id, key); return; }
    setHeldBack(null);
    /** A provider with an existing key can finish immediately or resume through the shared commit path. */
    const held = runnerSettings({ ...settings, provider: id }).apiKey;
    if (held === '') return;
    // Use the same readiness test as the confirmation action.
    if (connectionGaps(settings, id).length === 0) { onDone?.(); return; }
    commit(id, held);
  }

  const mark: Mark = refused || probeFailed ? 'cross' : probing || (gate !== null && gate !== 'ask') ? 'spin' : null;
  /** Whether idle advance or an active probe is currently checking the key. */
  const checking = accepted && !needsEndpoint && (gate !== null || probing);
  /** Whether the open chooser is asking the user to identify an unknown key shape. */
  const asking = rowOpen && !pinned && (shape === 'unknown' || shape === 'empty') && !refused && !probeFailed;
  const row = phase === 'custom'
    // The endpoint step gives the provider row its custom-provider identity.
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
  /** Leaving is available only before configuration starts or after the connection is complete. */
  const canLeave = gaps.length === 0 || gaps.includes('key');
  /** Confirmation exits, waits, requests an address or routes to model management based on gaps. */
  const exit: 'done' | 'wait' | 'address' | 'route' = gaps.length === 0
    ? 'done'
    : gaps.includes('endpoint') ? 'address' : modelsFailed ? 'route' : 'wait';

  /** Derives the desk face from the same facts used by this screen's row, note and footer. */
  const step: SetupFace = (() => {
    // The active screen step takes priority over status retained from an earlier step.
    if (phase === 'custom') {
      const host = urlHost(urlDraft);
      return host ? { step: 'endpoint', name: host } : { step: 'endpoint' };
    }
    if (phase === 'confirm') {
      // Missing endpoint status takes priority over provider confirmation.
      if (gaps.includes('endpoint')) return { step: 'endpoint' };
      // A settled model identifies the final confirmation face.
      if (model !== '') return { step: 'chosen', name: prettyModel(model) };
      // While model discovery is pending, report the confirmed provider.
      return { step: 'confirmed', name: PROVIDER_META[provider].name };
    }
    if (refused) return row.id ? { step: 'refused', name: row.name } : { step: 'refused' };
    if (probeFailed) return { step: 'no-answer' };
    // A missing custom endpoint takes priority over key-shape status.
    if (needsEndpoint) return { step: 'endpoint' };
    if (asking) return { step: 'unknown' };
    // Ambiguous status changes from typing to asking only after the probe starts.
    if (shape === 'ambiguous') return probing ? { step: 'ambiguous' } : { step: 'typing' };
    if (row.id && accepted) return { step: 'shaped', name: row.name };
    return { step: typing ? 'typing' : 'awake' };
  })();
  // Depend on scalar face fields because the derived object is rebuilt every render.
  const stepId = step.step;
  const stepName = step.name ?? '';
  useEffect(() => {
    onFace?.({ step: stepId, ...(stepName ? { name: stepName } : {}) });
  }, [onFace, stepId, stepName]);

  const slides = stepSlide(reduced, zoomedLayout);

  const keyField = (
    <SetupKeyField
      value={keyDraft}
      masked={keyMasked}
      refused={refused}
      shakeSeq={shakeSeq}
      inputRef={fieldRef}
      onChange={(next) => {
        // A changed key invalidates pending results and re-enables idle advance.
        reading.current += 1;
        setHeldBack(null);
        setKeyDraft(next);
        setRefused(false);
        setProbeFailed(false);
        // Mask password-manager or extension fills that arrive while the field is unfocused.
        if (!keyFocused.current) setKeyMasked(next.length > 0);
      }}
      onFocus={() => { keyFocused.current = true; setKeyMasked(false); }}
      onBlur={(next) => { keyFocused.current = false; setKeyMasked(next.length > 0); }}
      onEnter={confirmNow}
    />
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
      row={<SetupProviderFace row={row} mark={mark} />}
    />
  );

  return (
    <motion.div {...zoneEnter(reduced)} data-testid="setup-screen" data-phase={phase} style={WRAP_STYLE}>
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
                    {/* Refused keys offer deliberate reuse; unanswered probes offer another attempt. */}
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
                // Keep the disabled action in layout until the endpoint becomes usable.
                data-gated={!urlLooksUsable(urlDraft) || undefined}
                disabled={!urlLooksUsable(urlDraft)}
                onClick={() => {
                  if (settings.setCustomBaseUrl(urlDraft) === '') { setUrlBad(true); return; }
                  settings.pinProvider('custom');
                  // Filing the endpoint invalidates older readings and re-enables advance for the current key.
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
            {/* Confirmation reports the armed provider without adding a second chooser. */}
            <div data-testid="setup-armed-provider" data-provider={provider} style={LIT_ROW}>
              <Icon id="pw-check" size={15} />
              <span style={{ marginRight: 'auto' }}>{PROVIDER_META[provider].name}</span>
            </div>
            {/* Confirmation reports the model; management owns model choice. */}
            {exit === 'address' ? (
              <p data-testid="setup-endpoint-missing" style={NOTE_STYLE}>{t('agent3.setup_say_custom')}</p>
            ) : model !== '' ? (
              <p data-testid="setup-model-note" style={NOTE_STYLE}>
                {t('agent3.setup_note_model_default', { name: prettyModel(model) })}
              </p>
            ) : null}
          </div>

          <div style={FOOT_STYLE}>
            {/* Confirmation keeps one context-sensitive primary action beside Back. */}
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
    </motion.div>
  );
}

/** Returns the endpoint host for desk metadata, or an empty string while the address is incomplete. */
function urlHost(raw: string): string {
  try { return new URL(raw.trim()).host; } catch { return ''; }
}

/* ── the row's face, the note and the foot, as three small derivations ────── */

export interface RowFace { id: ProviderId | null; name: string; sub: string; dim: boolean }

/** Derives the provider row's identity, status copy and emphasis from setup state. */
export function rowFace(a: {
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
  // An explicit provider choice takes priority over automatic reading status.
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
      // Report asking only after the ambiguous-provider request begins.
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

/** Pure provider-row rendering for both live setup and static previews. */
export function SetupProviderFace({ row, mark }: { row: RowFace; mark: Mark }) {
  return (
    <span
      data-testid="setup-prov-face"
      data-provider={row.id ?? undefined}
      data-dim={row.dim || undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}
    >
      {/* Provider verdict marks remain fully opaque while row text can recede. */}
      {mark === 'cross' ? (
        <span data-testid="setup-row-cross" style={{ color: colors.dangerText, display: 'inline-flex', flex: '0 0 auto' }}>
          <Icon id="pw-cross" size={15} />
        </span>
      ) : null}
      {/* Provider name and status share constrained width and ellipsize independently. */}
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
  );
}

/** The sentence under the row, or none. `danger` is the refusal's own ink. */
function noteLine(a: {
  t: T; shape: KeyShape; pinned: ProviderId | null; typing: boolean; checking: boolean;
  probeFailed: boolean; refused: boolean; needsEndpoint: boolean; probing: boolean; held: boolean;
}): { text: string; danger: boolean } | null {
  const { t, shape, pinned, typing, checking, probeFailed, refused, needsEndpoint, probing, held } = a;
  if (refused) return { text: t('agent3.setup_key_refused'), danger: true };
  if (probeFailed) return { text: t('agent3.setup_note_probe_failed'), danger: true };
  // A missing endpoint prevents every key check and takes priority in the note.
  if (needsEndpoint) return { text: t('agent3.setup_say_custom'), danger: false };
  // Ambiguous-key copy distinguishes idle detection from an active probe.
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

/** Returns recovery actions for failures, missing endpoints and pending checks. */
function footVerbs(a: {
  probeFailed: boolean; refused: boolean; needsEndpoint: boolean; probing: boolean; waiting: boolean;
}): FootVerb[] {
  if (a.refused || a.probeFailed) return ['recheck', 'manual'];
  if (a.needsEndpoint) return ['address'];
  if (a.probing || a.waiting) return ['reenter'];
  return [];
}

/** Provider-menu items, with compatibility hints for ambiguous keys. */
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

/** Optional footer action that returns from setup to its originating surface. */
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

/** Recovery actions remain single-line and wrap as complete controls when translated copy is wider. */
const FOOT_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const FOOT_PRIMARY: CSSProperties = { ...windowFooterPrimary, flex: '2 1 auto', whiteSpace: 'nowrap', padding: '12px 14px', cursor: cursors.clickable };
const FOOT_GHOST: CSSProperties = { ...windowFooterGhost, flex: '1 1 auto', whiteSpace: 'nowrap', padding: '12px 13px', cursor: cursors.clickable };

/** Confirmed-provider row constrained to the job-zone width. */
const LIT_ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%', boxSizing: 'border-box',
  background: colors.tileYellow, color: INK, borderRadius: radii.md, padding: '10px 12px',
  // Match the closed provider dropdown's typography.
  ...roleFont('menu'), fontFamily: font.family, textAlign: 'left', border: 'none',
};
