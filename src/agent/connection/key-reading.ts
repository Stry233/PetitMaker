/*
 * The key reading behind setup: the draft, the provider it reads as, model
 * discovery and the automatic advance. Explicit provider choices override key-shape suggestions, and
 * every user action that supersedes a reading outdates its discovery so a late result cannot touch
 * the screen. Model selection belongs to management, which the reading hands off to once the key
 * checks out.
 */
import { createModelDiscovery, discoverySettled, type ProbeAnswer } from '../../platform/async/model-discovery';
import { endpointUrlLooksUsable } from '../../platform/remote/endpoint-url';
import { isRegionSplit, QUIRKS, type ProviderId, type ProviderRegion } from '../providers/defaults';
import { keyDestination, keyLooksUsable, readKeyShape, type KeyDestination, type KeyShape } from './key-grammar';
import { checkKey, type ListModels } from './model-discovery';
import { rememberedRoster, rosterKey } from './model-roster';
import {
  connectionGaps, providerForSavedKey, providerRegion, runnerSettings, useAgentConnection, type AgentConnectionState,
} from './store';

/** How long typing must rest before a draft key or address is acted on, in ms. */
export const IDLE_MS = 900;

/** Whether the persisted custom-provider selection still needs an endpoint address. */
function endpointOwed(a: { provider: ProviderId; customBaseUrl: string }): boolean {
  return a.provider === 'custom' && a.customBaseUrl === '';
}

/** Setup entry point selected by a repair action. */
export type SetupEntry = 'key' | 'chooser' | 'endpoint';

export type SetupPhase = 'key' | 'custom' | 'checking' | 'manage';

export interface KeyReadingState {
  phase: SetupPhase;
  keyDraft: string;
  /** The key masks while unfocused and remains visible while editing. */
  keyMasked: boolean;
  refused: boolean;
  /** Bumped on every refusal, so a second refusal of the same key shakes again. */
  shakeSeq: number;
  rowOpen: boolean;
  provider: ProviderId;
  /** Explicit provider choice, including a custom provider still awaiting its endpoint. */
  pinned: ProviderId | null;
  shape: KeyShape;
  regionProvider: ProviderId | null;
  accepted: boolean;
  /** Outstanding requirements for the provider currently being configured. */
  gaps: ReturnType<typeof connectionGaps>;
  /** Whether a custom provider still needs an endpoint before its key can be checked. */
  needsEndpoint: boolean;
  /** Automatic destination after the key remains idle, excluding the user-initiated endpoint step. */
  gate: Exclude<KeyDestination, 'endpoint'>;
}

export interface KeyReadingOptions {
  entry: SetupEntry;
  listModels: ListModels;
  onManage?: () => void;
  onLeave?: () => void;
  /** Help previews render the screen without issuing provider requests or timers. */
  pictured: boolean;
}

export interface KeyReading {
  get(): KeyReadingState;
  subscribe(listener: () => void): () => void;
  /** Starts hearing the connection store and the idle timer; returns the stop. */
  start(): () => void;
  /** The newest callbacks, listing source and preview flag. */
  setOptions(options: Omit<KeyReadingOptions, 'entry'>): void;
  setPhase(phase: SetupPhase): void;
  setRowOpen(open: boolean): void;
  /** Immediately follows the same destination table used by idle advance. */
  confirmNow(): void;
  /** Files a typed custom endpoint and checks the key against it; false when the address is refused. */
  saveEndpoint(url: string): boolean;
  /** Returns to key entry while retaining the draft and suspending its automatic advance. */
  reenter(): void;
  /** Opens an explicit provider override and invalidates automatic detection for the current draft. */
  chooseByHand(): void;
  pickProvider(id: ProviderId, region?: ProviderRegion): void;
  detectAutomatically(): void;
  leave(): void;
  /** A changed key invalidates pending results and re-enables idle advance. */
  editKey(next: string): void;
  focusField(): void;
  blurField(next: string): void;
}

const conn = (): AgentConnectionState => useAgentConnection.getState();

export function createKeyReading(initial: KeyReadingOptions): KeyReading {
  let options: Omit<KeyReadingOptions, 'entry'> = initial;
  const { entry } = initial;
  /** Restore missing addresses directly; existing credentials resume validation. */
  let phase: SetupPhase = (() => {
    if (entry === 'endpoint') return 'custom';
    if (entry === 'chooser') return 'key';
    const gaps = connectionGaps(conn());
    return gaps.includes('key') || gaps.length === 0 ? 'key' : gaps.includes('endpoint') ? 'custom' : 'checking';
  })();
  let keyDraft = phase === 'custom' ? runnerSettings({ ...conn(), provider: 'custom' }).apiKey : '';
  let keyMasked = keyDraft.length > 0;
  /** Tracks field focus for password-manager fills that arrive without focus events. */
  let keyFocused = false;
  let rowOpen = entry === 'chooser';
  let automatic = false;
  let refused = false;
  /** Provider and key currently used by model discovery; the store remains authoritative for rendering. */
  let armed: ProviderId | null = null;
  let armedKey = '';
  /** Key value whose automatic advance is suspended until the field changes. */
  let heldBack: string | null = null;
  let handedOff = false;
  let askedOnMount = false;
  let refusalsSeen = 0;
  let idle: { key: string; timer: ReturnType<typeof setTimeout> | undefined } = { key: '', timer: undefined };
  let started = false;
  /** Depth of the action or settling pass running now; store and discovery news waits for its end. */
  let busy = 0;

  const discovery = createModelDiscovery<{ id: ProviderId; apiKey: string }>(
    async ({ id, apiKey }, _signal, isCurrent): Promise<ProbeAnswer> => {
      const result = await checkKey(id, apiKey, options.listModels, isCurrent);
      if (result === 'listed') return { models: rememberedRoster(rosterKey(id, conn().customBaseUrl)) ?? [] };
      return result === 'unlisted' || result === 'refused' ? result : 'skipped';
    },
  );

  const listeners = new Set<() => void>();
  let snap: KeyReadingState;

  function derive(): KeyReadingState {
    const settings = conn();
    const provider = armed ?? settings.provider;
    const pinned = !automatic && (settings.providerPinned || endpointOwed(settings)) ? settings.provider : null;
    const savedProvider = pinned ? null : providerForSavedKey(keyDraft);
    const shape: KeyShape = pinned ?? savedProvider ?? readKeyShape(keyDraft);
    const regionProvider = shape in QUIRKS && isRegionSplit(shape as ProviderId)
      && savedProvider !== shape && (!pinned || providerRegion(settings, pinned) === undefined) ? shape as ProviderId : null;
    const accepted = shape === 'custom' ? keyDraft.trim() !== '' : keyLooksUsable(keyDraft);
    const gaps = connectionGaps(settings, provider);
    const needsEndpoint = shape === 'custom' && settings.customBaseUrl === '';
    const gate: Exclude<KeyDestination, 'endpoint'> = (() => {
      if (phase !== 'key' || refused || heldBack === keyDraft) return null;
      const dest = keyDestination({ shape, usable: accepted, endpointFiled: !needsEndpoint, explicit: false });
      if (regionProvider && dest) return 'ask';
      return dest === 'endpoint' ? null : dest;
    })();
    return {
      phase, keyDraft, keyMasked, refused, shakeSeq: discovery.get().refusals, rowOpen,
      provider, pinned, shape, regionProvider, accepted, gaps, needsEndpoint, gate,
    };
  }

  /** Checks the credential and caches the available models without choosing one. */
  const loadModels = (id: ProviderId, apiKey: string) => discovery.probe({ id, apiKey });

  /** Files the key and provider while keeping the key field visible during validation. */
  function commit(id: ProviderId, key: string): void {
    armed = id;
    armedKey = key;
    conn().connectKey(id, key);
    rowOpen = false;
    refused = false;
    phase = 'checking';
    loadModels(id, key);
  }

  function fire(what: Exclude<KeyDestination, null>, shape: KeyShape): void {
    const key = keyDraft.trim();
    if (what === 'endpoint') { phase = 'custom'; return; }
    if (key === '' && shape !== 'custom') return;
    if (what === 'ask') { rowOpen = true; return; }
    commit(shape as ProviderId, key);
  }

  /** Runs `change`, then settles once the outermost change ends. */
  function batch(change: () => void): void {
    busy += 1;
    try { change(); } finally { busy -= 1; }
    if (busy === 0) settle();
  }

  /** Applies what follows from the current facts until nothing changes, then publishes. */
  function settle(): void {
    busy += 1;
    try { settleFacts(); } finally { busy -= 1; }
    armIdle();
    for (const listener of [...listeners]) listener();
  }

  function settleFacts(): void {
    for (;;) {
      const s = derive();
      // Validation returns to key entry if its stored key disappears.
      if (s.phase === 'checking' && s.gaps.includes('key')) { phase = 'key'; continue; }
      const blocked = s.gaps.includes('key') || s.gaps.includes('endpoint');
      if (s.phase === 'checking' && discoverySettled(discovery.get().state) && !blocked) { phase = 'manage'; continue; }
      if (started && !options.pictured && !askedOnMount && s.phase === 'checking' && armed === null) {
        askedOnMount = true;
        const held = runnerSettings(conn()).apiKey;
        armedKey = held;
        loadModels(s.provider, held);
        continue;
      }
      snap = s;
      break;
    }
    if (phase === 'manage' && !handedOff) {
      handedOff = true;
      conn().clearProviderPin();
      options.onManage?.();
      snap = derive();
    }
  }

  /** The idle advance restarts whenever the destination, the draft or its shape changes. */
  function armIdle(): void {
    const key = started && snap.gate && !options.pictured ? `${snap.gate}|${keyDraft}|${snap.shape}` : '';
    if (key === idle.key) return;
    clearTimeout(idle.timer);
    const { gate, shape } = snap;
    idle = { key, timer: key && gate ? setTimeout(() => { idle = { key: '', timer: undefined }; batch(() => fire(gate, shape)); }, IDLE_MS) : undefined };
  }

  discovery.subscribe(() => {
    const found = discovery.get();
    if (found.state === 'refused' && found.refusals !== refusalsSeen) {
      refusalsSeen = found.refusals;
      armed = null;
      refused = true;
      phase = 'key';
    }
    if (busy === 0) settle();
  });

  const act = (change: () => void) => () => batch(change);
  snap = derive();

  return {
    get: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      started = true;
      const off = useAgentConnection.subscribe(() => { if (busy === 0) settle(); });
      settle();
      return () => {
        started = false;
        off();
        discovery.supersede();
        clearTimeout(idle.timer);
        idle = { key: '', timer: undefined };
      };
    },
    setOptions(next) { options = next; },
    setPhase: (next) => act(() => { phase = next; })(),
    setRowOpen: (open) => act(() => { rowOpen = open; })(),
    confirmNow: act(() => {
      const dest = keyDestination({ shape: snap.shape, usable: snap.accepted, endpointFiled: !snap.needsEndpoint, explicit: true });
      if (!dest) return;
      discovery.supersede();
      heldBack = null;
      fire(snap.regionProvider ? 'ask' : dest, snap.shape);
    }),
    saveEndpoint(url) {
      let filed = false;
      batch(() => {
        if (!endpointUrlLooksUsable(url) || conn().setCustomBaseUrl(url) === '') return;
        filed = true;
        conn().pinProvider('custom');
        discovery.supersede();
        heldBack = null;
        commit('custom', keyDraft.trim());
      });
      return filed;
    },
    reenter: act(() => {
      discovery.reset();
      phase = 'key';
      refused = false;
      rowOpen = false;
      heldBack = keyDraft;
    }),
    chooseByHand: act(() => {
      discovery.reset();
      if (phase === 'checking') phase = 'key';
      heldBack = keyDraft;
      rowOpen = true;
    }),
    pickProvider: (id, region) => act(() => {
      // An explicit pick clears status from the reading it supersedes.
      automatic = false;
      refused = false;
      if (id === 'custom') { rowOpen = false; phase = 'custom'; return; }
      if (region !== undefined) conn().setProviderRegion(id, region);
      conn().pinProvider(id);
      rowOpen = false;
      discovery.supersede();
      const key = keyDraft.trim() || armedKey;
      if (key !== '') { commit(id, key); return; }
      heldBack = null;
      // Existing credentials resume management or credential checking.
      const held = runnerSettings({ ...conn(), provider: id }).apiKey;
      if (held === '') return;
      if (connectionGaps(conn(), id).length === 0) { phase = 'manage'; return; }
      commit(id, held);
    })(),
    detectAutomatically: act(() => {
      discovery.reset();
      armed = null;
      conn().clearProviderPin();
      automatic = true;
      refused = false;
      heldBack = null;
      phase = 'key';
    }),
    leave: act(() => {
      discovery.supersede();
      conn().clearProviderPin();
      options.onLeave?.();
    }),
    editKey: (next) => act(() => {
      discovery.reset();
      heldBack = null;
      if (phase === 'checking') phase = 'key';
      keyDraft = next;
      refused = false;
      // Mask password-manager or extension fills that arrive while the field is unfocused.
      if (!keyFocused) keyMasked = next.length > 0;
    })(),
    focusField: act(() => { keyFocused = true; keyMasked = false; }),
    blurField: (next) => act(() => { keyFocused = false; keyMasked = next.length > 0; })(),
  };
}
