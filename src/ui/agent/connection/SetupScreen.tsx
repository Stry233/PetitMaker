/*
 * Guides key entry, provider detection and connection completion. Automatic advance waits for an
 * idle interval or Enter so typing never loses focus. Ambiguous keys require a provider choice;
 * custom endpoints require an address. Model choice and oversight remain in management. Network
 * functions are injected, and default adapters load dynamically by provider dialect.
 */
import { forwardRef, useEffect, useImperativeHandle, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { defaultListModels, type ListModels, type ProviderId, type SetupEntry } from '../../../agent/panel';
import type { Translate } from '../../../i18n/keys';
import { useT } from '../../../i18n/context';
import { providerName } from '../../../i18n/providers';
import { useUiPreview } from '../../design/preview';
import { DANGER_INK } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { FloatMenu } from '../../primitives/FloatMenu';
import { useFrameZoom, useZoomedLayoutTransform } from '../../shell/use-frame-zoom';
import { HelpLink } from '../parts/panel-parts';
import { SetupKeyField, type Mark } from './SetupKeyField';
import { SetupProviderFace } from './SetupProviderFace';
import { FOOT_LABEL, footVerbs, noteLine, rosterItems, rowFace, urlHost, type FootVerb } from './setup-copy';
import { useKeyReading, type KeyReading } from './use-key-reading';
import { ManageScreen } from './ManageScreen';
import { EndpointField } from '../parts/EndpointField';
import {
  FOOT_STYLE, GROUP_STYLE, NOTE_STYLE, SAY_STYLE, stepSlide, WRAP_STYLE,
  type SetupFace,
} from './setup-parts';
import { endpointUrlLooksUsable } from '../../../platform/remote/endpoint-url';

export { defaultListModels, type ListModels } from '../../../agent/panel';
export { IDLE_MS } from '../../../agent/panel';
export { SetupKeyField, type Mark } from './SetupKeyField';
export { SetupProviderFace } from './SetupProviderFace';
export { rowFace } from './setup-copy';

interface SetupScreenProps {
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
  /** Focus the key field as the screen opens. */
  focusKey?: boolean;
}

/** What the panel may ask of a standing setup screen. */
export interface SetupHandle {
  focusKey(): void;
}

export const SetupScreen = forwardRef<SetupHandle, SetupScreenProps>(function SetupScreen({
  onDone,
  listModels = defaultListModels,
  onLeave,
  onFace,
  entry = 'key',
  onManage,
  focusKey = false,
}, ref) {
  const t = useT();
  const zoom = useFrameZoom();
  const zoomedLayout = useZoomedLayoutTransform();
  const reduced = useReducedMotionConfig() === true;
  const pictured = useUiPreview();
  const r = useKeyReading({ entry, listModels, focusKey, pictured, ...(onManage ? { onManage } : {}), ...(onLeave ? { onLeave } : {}) });
  const { phase, refused, gate, pinned, shape, regionProvider, url, fieldRef } = r;
  useImperativeHandle(ref, () => ({ focusKey: () => fieldRef.current?.focus() }), [fieldRef]);

  const typing = r.keyDraft.length > 0;
  const waiting = gate !== null && gate !== 'ask';
  const mark: Mark = refused ? 'cross' : phase === 'checking' || waiting ? 'spin' : null;
  /** Whether the selected provider is currently checking the key. */
  const checking = phase === 'checking' || r.accepted && !r.needsEndpoint && waiting;
  /** Whether the open chooser is asking the user to identify an unknown key shape. */
  const asking = r.rowOpen && !pinned && (shape === 'unknown' || shape === 'empty' || shape === 'ambiguous') && !refused;
  const row = phase === 'custom'
    // The endpoint step gives the provider row its custom-provider identity.
    ? { id: 'custom' as ProviderId, name: t('agent.setup_custom_endpoint'), sub: t('agent.setup_row_openai_compat'), dim: false }
    : regionProvider
      ? { id: regionProvider, name: providerName(regionProvider, t), sub: t('agent.setup_row_region'), dim: false }
    : asking
      ? { id: null, name: t('agent.setup_row_whose'), sub: t(typing ? 'agent.setup_row_key_stays' : 'agent.setup_row_pick'), dim: false }
      : rowFace({ t, shape, pinned, checking, refused });
  const note = regionProvider && typing
    ? { text: t('agent.setup_note_region', { name: providerName(regionProvider, t) }), danger: false }
    : asking && typing
    ? { text: t('agent.setup_note_unknown_pick'), danger: false }
    : noteLine({ t, shape, pinned, typing, refused, needsEndpoint: r.needsEndpoint, checking, held: r.settings.keyed.length > 0 });
  const foot = footVerbs({ refused, needsEndpoint: r.needsEndpoint, waiting: gate !== null || phase === 'checking' });
  /** Leaving is available only before configuration starts or after the connection is complete. */
  const canLeave = r.gaps.length === 0 || r.gaps.includes('key');

  /** Derives the desk face from the same facts used by this screen's row, note and footer. */
  const step: SetupFace = (() => {
    // The active screen step takes priority over status retained from an earlier step.
    if (phase === 'custom') {
      const host = urlHost(url.value);
      return host ? { step: 'endpoint', name: host } : { step: 'endpoint' };
    }
    if (phase === 'checking' || phase === 'manage') return { step: 'shaped', name: providerName(r.provider, t) };
    if (refused) return row.id ? { step: 'refused', name: row.name } : { step: 'refused' };
    // A missing custom endpoint takes priority over key-shape status.
    if (r.needsEndpoint) return { step: 'endpoint' };
    if (asking) return { step: 'unknown' };
    if (shape === 'ambiguous') return { step: 'typing' };
    if (row.id && r.accepted) return { step: 'shaped', name: row.name };
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
      value={r.keyDraft}
      masked={r.keyMasked}
      optional={phase === 'custom' || pinned === 'custom'}
      refused={refused}
      shakeSeq={r.shakeSeq}
      inputRef={fieldRef}
      onChange={r.editKey}
      onFocus={r.focusField}
      onBlur={r.blurField}
      onEnter={phase === 'custom' ? r.saveEndpoint : r.confirmNow}
    />
  );

  const providerRow = (
    <FloatMenu
      data-testid="setup-prov-row"
      aria-label={t('agent.setup_pick_provider')}
      open={r.rowOpen}
      onOpen={r.chooseByHand}
      onClose={() => r.setRowOpen(false)}
      onPick={(choice) => {
        if (choice === 'automatic') { r.detectAutomatically(); return; }
        const [id, region] = choice.split(':');
        r.pickProvider(id as ProviderId, region === '1' ? 1 : region === '0' ? 0 : undefined);
      }}
      {...(pinned ? { activeId: pinned } : {})}
      zoom={zoom}
      items={rosterItems(t, shape, pinned !== null, regionProvider)}
      row={<SetupProviderFace row={row} mark={mark} />}
    />
  );

  if (phase === 'manage' && !onManage) return <ManageScreen jobCount={0} listModels={listModels} onDone={onDone} />;

  return (
    <div data-testid="setup-screen" data-phase={phase} style={WRAP_STYLE}>
      {(phase === 'key' || phase === 'checking' || phase === 'manage') && (
        <>
          {!typing && phase === 'key' && <p style={SAY_STYLE}>{t('agent.setup_say_key')} <HelpLink page="agent-setup" anchor="agsetup-keys" /></p>}
          <motion.div {...slides} style={GROUP_STYLE}>{keyField}</motion.div>
          <motion.div {...slides} style={GROUP_STYLE}>{providerRow}</motion.div>
          {note && (
            <motion.p
              {...slides}
              data-testid="setup-note"
              style={note.danger ? { ...NOTE_STYLE, color: DANGER_INK } : NOTE_STYLE}
            >
              {note.text}
            </motion.p>
          )}
          <div style={FOOT_STYLE}>
            {foot.length > 0 && <FootVerbs t={t} verbs={foot} refused={refused} reading={r} />}
            {!foot.includes('reenter') && canLeave && onLeave && <LeaveRow t={t} onLeave={r.leave} />}
          </div>
        </>
      )}

      {phase === 'custom' && (
        <>
          <p style={SAY_STYLE}>{t('agent.setup_say_custom')}</p>
          <div style={GROUP_STYLE}>{keyField}</div>
          {providerRow}
          <div style={GROUP_STYLE}>
            <EndpointField testId="setup-endpoint-input" value={url.value} bad={url.bad} onChange={url.edit} onEnter={r.saveEndpoint} />
            <p
              data-testid="setup-endpoint-note"
              style={url.bad ? { ...NOTE_STYLE, color: DANGER_INK } : NOTE_STYLE}
            >
              {t(url.bad ? 'agent.setup_endpoint_invalid' : 'agent.setup_note_custom')}
            </p>
          </div>
          <div style={FOOT_STYLE}>
            <div style={FOOT_ROW}>
              <ActionButton
                appearance="primary"
                data-testid="setup-endpoint-save"
                // Keep the disabled action in layout until the endpoint becomes usable.
                data-gated={!endpointUrlLooksUsable(url.value) || undefined}
                disabled={!endpointUrlLooksUsable(url.value)}
                onClick={r.saveEndpoint}
                style={FOOT_PRIMARY}
              >
                {t('agent.setup_endpoint_check')}
              </ActionButton>
              <ActionButton
                appearance="secondary"
                data-testid="setup-act-reenter"
                onClick={() => { url.settle(); r.setPhase('key'); }}
                style={FOOT_GHOST}
              >
                {t('agent.setup_back')}
              </ActionButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

/** The recovery verbs under the key step; the primary ones lead. */
function FootVerbs({ t, verbs, refused, reading }: { t: Translate; verbs: FootVerb[]; refused: boolean; reading: KeyReading }) {
  const press: Record<FootVerb, () => void> = {
    reenter: reading.reenter,
    manual: reading.chooseByHand,
    address: () => reading.setPhase('custom'),
    recheck: reading.confirmNow,
  };
  return (
    <div style={FOOT_ROW}>
      {verbs.map((verb) => {
        const primary = verb === 'recheck' || verb === 'address';
        return (
          <ActionButton
            key={verb}
            appearance={primary ? 'primary' : 'secondary'}
            data-testid={`setup-act-${verb}`}
            onClick={press[verb]}
            style={primary ? FOOT_PRIMARY : FOOT_GHOST}
          >
            {/* Refused keys offer deliberate reuse. */}
            {verb === 'recheck'
              ? t(refused ? 'agent.setup_use_this_key' : 'agent.dock_act_try_again')
              : t(FOOT_LABEL[verb])}
          </ActionButton>
        );
      })}
    </div>
  );
}

/** Footer action that returns from setup to its originating surface. */
function LeaveRow({ t, onLeave }: { t: Translate; onLeave: () => void }) {
  return (
    <div style={FOOT_ROW}>
      <ActionButton appearance="secondary" data-testid="setup-leave" onClick={onLeave} style={FOOT_GHOST}>
        {t('agent.setup_back')}
      </ActionButton>
    </div>
  );
}

/** Recovery actions remain single-line and wrap as complete controls when translated copy is wider. */
const FOOT_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const FOOT_PRIMARY: CSSProperties = { flex: '2 1 auto', whiteSpace: 'nowrap', padding: '12px 14px' };
const FOOT_GHOST: CSSProperties = { flex: '1 1 auto', whiteSpace: 'nowrap', padding: '12px 12px' };
