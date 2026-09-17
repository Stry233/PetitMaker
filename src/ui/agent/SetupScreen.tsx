import { providerName } from '../../i18n/providers';
/*
 * Guides key entry, provider detection and connection completion. Automatic advance waits for an
 * idle interval or Enter so typing never loses focus. Explicit provider choices override key-shape
 * suggestions, and leaving a reading cancels its pending request. Ambiguous keys require a provider
 * choice; custom endpoints require an address. Model choice and oversight remain in management.
 * Network functions are injected, and default adapters load dynamically by provider dialect.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useUiPreview } from '../primitives/ui-preview';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { HelpLink, zoneEnter } from './atoms';
import { useT } from '../../i18n/context';
import { QUIRKS, type ProviderId } from '../../agent/providers/defaults';
import { classify } from '../../agent/core/errors';
import { Spinner } from '../primitives/Spinner';
import { FloatMenu, type FloatMenuItem } from '../primitives/FloatMenu';
import { colors, cursors } from '../design/styles';
import { INK, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';
import { windowFooterGhost, windowFooterPrimary } from '../design/window-skin';
import { useFrameZoom, useZoomedLayoutTransform } from '../shell/use-frame-zoom';
import { Icon } from './icons';
import { amplitude, framerMotion } from './motion';
import { ManageScreen } from './ManageScreen';
import { defaultListModels, IDLE_MS, type ListModels } from './model-discovery';
import { rememberRoster, rosterKey } from './model-roster';
import { connectionGaps, runnerSettings, useAgentPanelSettings } from './settings';
import {
  endpointOwed, FIELD_STYLE, FOOT_STYLE, GATED, GROUP_STYLE, INPUT_STYLE,
  keyDestination, keyLooksUsable, NOTE_STYLE, PROVIDER_ROSTER, rawFailure, readKeyShape, SAY_STYLE,
  stepSlide, urlLooksUsable, WRAP_STYLE,
  type KeyDestination, type KeyShape, type SetupEntry, type SetupFace, type T,
} from './setup-parts';

export { defaultListModels, IDLE_MS, withModelsDeadline, type ListModels } from './model-discovery';

/** How far the refused field shakes, per its own declaration. */
const SHAKE = amplitude('panel.setup.refuse') ?? 0;

/** The mark the field and the provider row carry together: the reading's own state. */
export type Mark = 'spin' | 'cross' | null;

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
  /** Injected for tests; the default reaches an SDK adapter by dynamic import. */
  listModels?: ListModels;
  /** Returns to the surface that opened setup. */
  onLeave?: () => void;
  /** Reports the active setup face to the desk above it. */
  onFace?: (face: SetupFace | null) => void;
  /** Initial setup step, read once at mount. */
  entry?: SetupEntry;
  /** Opens connection management after credential checking. */
  onManage?: () => void;
}

export function SetupScreen({
  onDone,
  listModels = defaultListModels,
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

  /** Restore missing addresses directly; existing credentials resume validation. */
  const [phase, setPhase] = useState<'key' | 'custom' | 'checking' | 'manage'>(() => {
    if (entry === 'endpoint') return 'custom';
    if (entry === 'chooser') return 'key';
    const gaps = connectionGaps(useAgentPanelSettings.getState());
    return gaps.includes('key') || gaps.length === 0 ? 'key' : gaps.includes('endpoint') ? 'custom' : 'checking';
  });
  const [keyDraft, setKeyDraft] = useState('');
  /** The key masks while unfocused and remains visible while editing. */
  const [keyMasked, setKeyMasked] = useState(false);
  /** Tracks field focus for password-manager fills that arrive without focus events. */
  const keyFocused = useRef(false);
  const [rowOpen, setRowOpen] = useState(entry === 'chooser');
  const [urlDraft, setUrlDraft] = useState(settings.customBaseUrl);
  const [urlBad, setUrlBad] = useState(false);
  const [refused, setRefused] = useState(false);
  const [modelsSettled, setModelsSettled] = useState(false);
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
  /** Explicit provider choice, including a custom provider still awaiting its endpoint. */
  const pinned = settings.providerPinned || endpointOwed(settings) ? settings.provider : null;
  const customBaseUrl = settings.customBaseUrl;
  const forgetKey = settings.forgetKey;
  const connectKey = settings.connectKey;

  const shape: KeyShape = pinned ?? readKeyShape(keyDraft);
  const accepted = keyLooksUsable(keyDraft);
  const typing = keyDraft.length > 0;
  /** Outstanding requirements for the provider currently being configured. */
  const gaps = connectionGaps(settings, provider);
  /** Whether a custom provider still needs an endpoint before its key can be checked. */
  const needsEndpoint = shape === 'custom' && customBaseUrl === '';

  /** Checks the credential and caches the available models without choosing one. */
  const loadModels = useCallback((id: ProviderId, apiKey: string) => {
    setModelsSettled(false);
    // Never send a custom-provider key until its endpoint is explicit.
    if (apiKey === '' || (id === 'custom' && customBaseUrl === '')) return;
    // Capture the reading generation so superseded results cannot mutate current setup.
    const mine = reading.current;
    const region = runnerSettings(useAgentPanelSettings.getState()).region;
    listModels({ provider: id, apiKey, ...(region === undefined ? {} : { region }), ...(customBaseUrl ? { customBaseUrl } : {}) })
      .then((ids) => {
        if (mine !== reading.current) return;
        rememberRoster(rosterKey(id, customBaseUrl), ids);
        setModelsSettled(true);
        // Discovery cannot establish whether the generation route is reachable.
        if (id === 'custom') useAgentPanelSettings.getState().recordEndpointCheck(true);
      })
      .catch((err: unknown) => {
        if (mine !== reading.current) return;
        // Retire legacy discovery failures without blocking manual model entry.
        if (id === 'custom') {
          useAgentPanelSettings.getState().recordEndpointCheck(true);
        }
        // Authentication failure removes the key and returns focus to key entry.
        if (classify(rawFailure(err)).cls === 'auth') {
          const state = useAgentPanelSettings.getState();
          const explicit = state.providerPinned && state.provider === id;
          forgetKey(id);
          // Authentication failure does not revoke the user's explicit provider choice.
          if (explicit) state.pinProvider(id);
          armed.current = null;
          setRefused(true);
          setShakeSeq((n) => n + 1);
          setPhase('key');
          return;
        }
        setModelsSettled(true);
      });
  }, [listModels, customBaseUrl, forgetKey]);

  /** Files the key and provider while keeping the key field visible during validation. */
  const commit = useCallback((id: ProviderId, key: string) => {
    armed.current = id;
    armedKey.current = key;
    connectKey(id, key);
    setRowOpen(false);
    setRefused(false);
    setPhase('checking');
    loadModels(id, key);
  }, [connectKey, loadModels]);

  /** Automatic destination after the key remains idle, excluding the user-initiated endpoint step. */
  const gate: Exclude<KeyDestination, 'endpoint'> = (() => {
    if (phase !== 'key' || refused) return null;
    if (heldBack === keyDraft) return null;
    const dest = keyDestination({ shape, usable: accepted, endpointFiled: !needsEndpoint, explicit: false });
    if (!pinned && shape === 'zhipu') return 'ask';
    return dest === 'endpoint' ? null : dest;
  })();

  const fire = useCallback((what: Exclude<KeyDestination, null>) => {
    const key = keyDraft.trim();
    if (what === 'endpoint') { setPhase('custom'); return; }
    if (key === '') return;
    if (what === 'ask') { setRowOpen(true); return; }
    commit(shape as ProviderId, key);
  }, [keyDraft, shape, commit]);

  // Draft-dependent callback identity restarts the idle timer after each value change.
  useEffect(() => {
    if (!gate || pictured) return undefined;
    const timer = setTimeout(() => fire(gate), IDLE_MS);
    return () => clearTimeout(timer);
  }, [gate, fire, pictured]);

  useEffect(() => { setUrlDraft(customBaseUrl); }, [customBaseUrl]);

  // Validation returns to key entry if its stored key disappears.
  const keyMissing = gaps.includes('key');
  useEffect(() => { if (phase === 'checking' && keyMissing) setPhase('key'); }, [phase, keyMissing]);

  /** Model selection belongs to management even when no model has been chosen yet. */
  const handedOff = useRef(false);
  useEffect(() => {
    if (phase !== 'checking' || !modelsSettled || gaps.includes('key') || gaps.includes('endpoint')) return;
    setPhase('manage');
  }, [phase, modelsSettled, gaps.join(',')]);
  useLayoutEffect(() => {
    if (phase !== 'manage' || handedOff.current) return;
    handedOff.current = true;
    onManage?.();
  }, [phase, onManage]);

  const askedOnMount = useRef(false);
  useEffect(() => {
    if (pictured || askedOnMount.current || phase !== 'checking' || armed.current !== null) return;
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
    fire(!pinned && shape === 'zhipu' ? 'ask' : dest);
  }

  /** Returns to key entry while retaining the draft and suspending its automatic advance. */
  function reenter(): void {
    reading.current += 1;
    setPhase('key');
    setModelsSettled(false);
    setRefused(false);
    setRowOpen(false);
    setHeldBack(keyDraft);
  }

  /** Opens an explicit provider override and invalidates automatic detection for the current draft. */
  function chooseByHand(): void {
    reading.current += 1;
    if (phase === 'checking') setPhase('key');
    setModelsSettled(false);
    setHeldBack(keyDraft);
    setRowOpen(true);
  }

  function pickProvider(id: ProviderId, region?: 0 | 1): void {
    // An explicit pick clears status from the reading it supersedes.
    setRefused(false);
    if (id === 'custom') { setRowOpen(false); setPhase('custom'); return; }
    if (region !== undefined) settings.setProviderRegion(id, region);
    settings.pinProvider(id);
    setRowOpen(false);
    // Invalidate any previous model discovery.
    reading.current += 1;
    const key = keyDraft.trim() || armedKey.current;
    if (key !== '') { commit(id, key); return; }
    setHeldBack(null);
    /** Existing credentials resume management or credential checking. */
    const held = runnerSettings({ ...settings, provider: id }).apiKey;
    if (held === '') return;
    // Existing selections still open the model-management page.
    if (connectionGaps(settings, id).length === 0) { setPhase('manage'); return; }
    commit(id, held);
  }

  const mark: Mark = refused ? 'cross' : phase === 'checking' || (gate !== null && gate !== 'ask') ? 'spin' : null;
  /** Whether the selected provider is currently checking the key. */
  const checking = phase === 'checking' || accepted && !needsEndpoint && (gate !== null && gate !== 'ask');
  /** Whether the open chooser is asking the user to identify an unknown key shape. */
  const asking = rowOpen && !pinned && (shape === 'unknown' || shape === 'empty' || shape === 'ambiguous' || shape === 'zhipu') && !refused;
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
      : rowFace({ t, shape, pinned, checking, refused });
  const note = asking && typing
    ? { text: t('agent3.setup_note_unknown_pick'), danger: false }
    : noteLine({
      t, shape, pinned, typing, refused, needsEndpoint, checking,
      held: settings.keyed.length > 0,
    });
  const foot = footVerbs({ refused, needsEndpoint, waiting: gate !== null || phase === 'checking' });
  /** Leaving is available only before configuration starts or after the connection is complete. */
  const canLeave = gaps.length === 0 || gaps.includes('key');
  /** Derives the desk face from the same facts used by this screen's row, note and footer. */
  const step: SetupFace = (() => {
    // The active screen step takes priority over status retained from an earlier step.
    if (phase === 'custom') {
      const host = urlHost(urlDraft);
      return host ? { step: 'endpoint', name: host } : { step: 'endpoint' };
    }
    if (phase === 'checking' || phase === 'manage') return { step: 'shaped', name: providerName(provider, t) };
    if (refused) return row.id ? { step: 'refused', name: row.name } : { step: 'refused' };
    // A missing custom endpoint takes priority over key-shape status.
    if (needsEndpoint) return { step: 'endpoint' };
    if (asking) return { step: 'unknown' };
    if (shape === 'ambiguous') return { step: 'typing' };
    if (row.id && accepted) return { step: 'shaped', name: row.name };
    return { step: typing ? 'typing' : 'awake' };
  })();
  // Depend on scalar face fields because the derived object is rebuilt every render.
  const stepId = step.step;
  const stepName = step.name ?? '';
  useEffect(() => {
    onFace?.(phase === 'manage' ? null : { step: stepId, ...(stepName ? { name: stepName } : {}) });
  }, [onFace, stepId, stepName, phase]);

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
        if (phase === 'checking') setPhase('key');
        setModelsSettled(false);
        setKeyDraft(next);
        setRefused(false);
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
      onPick={(choice) => {
        const [id, region] = choice.split(':');
        pickProvider(id as ProviderId, region === '1' ? 1 : region === '0' ? 0 : undefined);
      }}
      {...(pinned ? { activeId: pinned } : {})}
      zoom={zoom}
      items={rosterItems(t, shape)}
      row={<SetupProviderFace row={row} mark={mark} />}
    />
  );

  if (phase === 'manage' && !onManage) return <ManageScreen jobCount={0} listModels={listModels} onDone={onDone} />;

  return (
    <motion.div {...zoneEnter(reduced)} data-testid="setup-screen" data-phase={phase} style={WRAP_STYLE}>
      {(phase === 'key' || phase === 'checking' || phase === 'manage') && (
        <>
          {!typing && <p style={SAY_STYLE}>{t('agent3.setup_say_key')} <HelpLink page="agent-setup" anchor="agsetup-keys" /></p>}
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
                    {/* Refused keys offer deliberate reuse. */}
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
                  setPhase(keyDraft === '' && runnerSettings(useAgentPanelSettings.getState()).apiKey ? 'checking' : 'key');
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
  refused: boolean;
}): RowFace {
  const { t, shape, pinned, checking, refused } = a;
  if (refused) {
    const id = pinned ?? (typeof shape === 'string' && shape !== 'ambiguous' && shape !== 'partial'
      && shape !== 'unknown' && shape !== 'empty' ? shape : null);
    return {
      id,
      name: id ? providerName(id, t) : t('agent3.setup_row_provider'),
      sub: t('agent3.setup_row_refused'),
      dim: false,
    };
  }
  // An explicit provider choice takes priority over automatic reading status.
  if (pinned) {
    return {
      id: pinned,
      name: providerName(pinned, t),
      sub: t(checking ? 'agent3.setup_row_pinned_checking' : 'agent3.setup_row_pinned'),
      dim: false,
    };
  }
  if (shape === 'ambiguous') {
    return {
      id: null,
      name: t('agent3.setup_row_two'),
      sub: t('agent3.setup_row_sofar'),
      dim: false,
    };
  }
  if (shape === 'empty' || shape === 'partial' || shape === 'unknown') {
    return { id: null, name: t('agent3.setup_row_any'), sub: t('agent3.setup_row_any_sub'), dim: true };
  }
  return {
    id: shape,
    name: providerName(shape, t),
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
  refused: boolean; needsEndpoint: boolean; held: boolean;
}): { text: string; danger: boolean } | null {
  const { t, shape, pinned, typing, checking, refused, needsEndpoint, held } = a;
  if (refused) return { text: t('agent3.setup_key_refused'), danger: true };
  // A missing endpoint prevents every key check and takes priority in the note.
  if (needsEndpoint) return { text: t('agent3.setup_say_custom'), danger: false };
  if (shape === 'ambiguous') {
    return { text: t('agent3.setup_note_ambiguous_wait'), danger: false };
  }
  if (pinned && checking) return { text: t('agent3.setup_note_pinned_checking', { name: providerName(pinned, t) }), danger: false };
  if (shape !== 'empty' && shape !== 'partial' && shape !== 'unknown' && checking) {
    return { text: t('agent3.setup_note_shaped', { name: providerName(shape, t) }), danger: false };
  }
  if (!typing) return held ? { text: t('agent3.setup_note_replaces'), danger: false } : null;
  if (shape === 'partial') return { text: t('agent3.setup_note_partial'), danger: false };
  if (shape === 'unknown') return { text: t('agent3.setup_note_unknown'), danger: false };
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
  refused: boolean; needsEndpoint: boolean; waiting: boolean;
}): FootVerb[] {
  if (a.refused) return ['recheck', 'manual'];
  if (a.needsEndpoint) return ['address'];
  if (a.waiting) return ['reenter'];
  return [];
}

/** Provider-menu items, with compatibility hints for ambiguous keys. */
function rosterItems(t: T, shape: KeyShape): FloatMenuItem[] {
  const amb = shape === 'ambiguous';
  const items: FloatMenuItem[] = PROVIDER_ROSTER.flatMap<FloatMenuItem>((id) => {
    if ((QUIRKS[id].baseUrls?.length ?? 0) > 1) {
      return ([0, 1] as const).map((region) => ({
        id: `${id}:${region}`, label: providerName(id, t),
        sub: t(region === 0 ? 'agent3.endpoint_global' : 'agent3.endpoint_cn'),
      }));
    }
    return [{ id, label: providerName(id, t) }];
  });
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
