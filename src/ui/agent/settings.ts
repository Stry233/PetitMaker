/*
 * settings.ts — what the panel is CONNECTED to: provider, model, oversight, custom endpoint, and
 * whether a key is held. The one store the setup screen writes and the runner reads.
 *
 * THE KEY IS NOT IN THE STORE. Everything else here is state a component may select and render;
 * a key is neither, so it lives in a module-level keyring and the store carries only
 * `keyed` — which providers a key is held for. A component that cannot obtain the secret cannot
 * leak it into a render tree, a devtools snapshot or a serialized error, and the one caller that
 * genuinely needs it (`runnerSettings`, feeding `exec/runner.ts`) asks for it by calling a function.
 *
 * PERSISTENCE GOES THROUGH `agent/security/key-storage.ts` AND NOWHERE ELSE. That module owns the record's
 * shape, its migrations (a retired oversight name still on disk) and the WebCrypto vault: keys are
 * written sealed, and a raw key never reaches localStorage. This file assembles the record and
 * hands it over — it does not touch storage itself, so there is one writer and one threat model.
 *
 * `hydrate()` is two passes because the vault is async: `loadAgentSettings()` answers synchronously
 * (non-secret fields, plus the obfuscated-fallback keys of a browser with no vault), then the sealed
 * blob is opened and merged UNDER anything typed in the meantime — a key the user has just
 * connected outranks the one that was on disk when the panel opened. What a merge CANNOT express is
 * a key deliberately deleted, since an absence has nothing to win with, so a revocation travels as
 * its own fact (`forgotten`) and is applied after both merges, and to what is written.
 *
 * AND UNTIL THAT LANDS, THIS STORE WRITES NOTHING. The record on disk is shared with the legacy
 * settings surface, and every field here is a DEFAULT before the read: `persist`'s own header has
 * the whole argument, including why a key just typed is no exception.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Oversight } from '../../agent/core/gates';
import {
  hydrateSealedKeys, loadAgentSettings, markKeysHydrated, sanitizeEndpointUrl, saveAgentSettings,
  type AgentSettings,
} from '../../agent/security/key-storage';
import { PROVIDER_IDS, QUIRKS, type ProviderId } from '../../agent/providers/defaults';

/** The keys, held outside the store for the reason in the file header. Never exported. */
let keyring: Partial<Record<ProviderId, string>> = {};

/** The regional host a key was resolved against, read at hydration for `runnerSettings`'s `region`.
 *  Persistence does not go through here: `persist` merges over the record as it stands on disk, so
 *  this field (and anything else the store does not model) rides along untouched. */
let carried: Pick<AgentSettings, 'regionBaseUrl'> = {};

/** Set when a mutation arrives before hydration finished, so the write `persist` declined can be
 *  made once it is safe. Without it a press inside the vault's own opening window would live in the
 *  store and quietly never reach the disk. */
let owedWrite = false;

/**
 * Providers whose key has been REVOKED in this session, held until a hydration has accounted for it.
 *
 * A merge cannot express an absence. `hydrate` folds the disk's keys under whatever the keyring
 * already holds, which is right for a key just typed and exactly wrong for one just deleted: the
 * revoked key is not in the keyring to win with, so the copy on disk (obfuscated or sealed) walks
 * straight back in, and the write then puts it back on disk too. Deletion therefore travels as its
 * own fact, applied after each merge AND to every record `persist` writes; `connectKey` withdraws a
 * provider from the set, since filing a key is the plainest possible retraction of having revoked
 * one. `hydrate` clears it only after its own owed write, which is where a revocation made before
 * the read finally reaches the disk.
 */
const forgotten = new Set<ProviderId>();

/**
 * How to end the job in flight, registered by whoever owns the runner (`PanelColumn`).
 *
 * A KEY GOING AWAY MUST NOT ORPHAN A RUNNING JOB. Nothing here stops the loop: it goes on streaming
 * and go on executing write tools against the live map, while `isConnected` turns false and every
 * surface reads that as "there is no session" — the job zone becomes the setup form, the composer
 * turns off its own pointer events, and the record goes with them. So `forgetKey` ABORTS FIRST, and
 * the abort lands on the log as an ordinary stop (a `jobEnd {aborted}`) while the panel can still
 * show it. The dock's keyless face carries a stop of its own for any path that reaches the same
 * state without coming through here (`DeskHeader.tsx`'s `IN_FLIGHT`).
 */
let stopLiveJob: (() => void) | undefined;

/** Registers (or, with `undefined`, withdraws) that abort. One owner: the last caller wins, and the
 *  runner it names outlives the panel being closed. */
export function setLiveJobStop(stop: (() => void) | undefined): void {
  stopLiveJob = stop;
}

/** A keyring with this session's revocations taken back out of it. */
function dropForgotten(ring: Partial<Record<ProviderId, string>>): Partial<Record<ProviderId, string>> {
  if (forgotten.size === 0) return ring;
  const out = { ...ring };
  for (const id of forgotten) delete out[id];
  return out;
}

export interface AgentPanelSettingsState {
  provider: ProviderId;
  /** Per-provider model id, keyed like the stored record so switching providers keeps each pick. */
  model: Record<ProviderId, string>;
  oversight: Oversight;
  /** The `custom` provider's endpoint, already sanitized. Empty means none configured. */
  customBaseUrl: string;
  /**
   * The custom address whose LAST COMPLETED verification failed outright, or '' where none has.
   *
   * KEYED BY THE ADDRESS, not a boolean, so filing a different address retires the verdict by
   * itself: the verdict is about one server, and a new address is merely unverified until its own
   * check settles. NOT PERSISTED — the address on disk comes back unverified and the model gap
   * (the failure empties the pick) is what keeps an unproven connection out of idle across a reload.
   */
  endpointDown: string;
  /** The model id a failed endpoint check CLEARED, or ''. Held so a recovered endpoint's list can
   *  offer the user's own earlier pick visibly; it is never restored silently — the re-pick is
   *  theirs. NOT PERSISTED: the cleared pick is cleared on disk too. */
  formerModel: string;
  /** Which providers a key is held for. The keys themselves are not here — see the header. */
  keyed: readonly ProviderId[];
  /**
   * Whether the armed provider was NAMED BY THE USER rather than read off a key's shape.
   *
   * The setup field reads a key's format on every keystroke, and that reading must never overrule a
   * choice already made: an OpenAI pick followed by an OpenAI key bounced straight back to the
   * chooser it came from. A pin is the user's answer standing, and only a revocation retracts it.
   * NOT PERSISTED — it describes the flow the user is in, not the connection they have.
   */
  providerPinned: boolean;
  /** True once the async vault pass has finished, so an empty keyring means "none" rather than
   *  "not read yet". The setup screen shows nothing different either way; the runner does. */
  hydrated: boolean;

  /** Reads the stored record in. CALL IT FIRST: it seeds every field from disk, so a mutation made
   *  before it has its non-key fields re-seeded (a key survives — the keyring is merged, and what
   *  this store holds wins). The panel calls it on mount, which is before a user can press
   *  anything; the only window it leaves open is the vault's own, and a press inside that one is
   *  kept and written when the read lands. */
  hydrate(): Promise<void>;
  /** Files a key against a provider and arms that provider. The one way a key enters the app. */
  connectKey(provider: ProviderId, key: string): void;
  /** Forgets the armed provider's key, returning the panel to setup. Aborts the job in flight
   *  first, where one is running and the key being dropped is the one it is running on (see
   *  `setLiveJobStop`). */
  forgetKey(provider?: ProviderId): void;
  setProvider(provider: ProviderId): void;
  /** Arms a provider the user NAMED, and pins it (see `providerPinned`). The manual chooser's one
   *  verb; `setProvider` stays the unpinned arming a shape reading may make. */
  pinProvider(provider: ProviderId): void;
  setModel(model: string): void;
  setOversight(oversight: Oversight): void;
  /** Sanitizes through `key-storage.ts:sanitizeEndpointUrl` (https unless loopback, no embedded
   *  credentials) and reports what was stored, so a caller can tell an unusable URL from a stored
   *  one without re-implementing the rule. */
  setCustomBaseUrl(raw: string): string;
  /**
   * Files what a completed endpoint verification PROVED, and it moves on evidence both ways.
   *
   * `reachable: false` is the failed check the readiness gate turns on: the verdict is recorded
   * against the address that failed (`endpointDown`), and the filed model is CLEARED into
   * `formerModel` — a model the address cannot be asked about is not a pick the panel may carry to
   * idle, so the row empties rather than standing flagged. `reachable: true` (a list arrived, or the
   * endpoint answered without one) retires the verdict; the model stays wherever the failure left
   * it, because the empty row is the user's to fill.
   */
  recordEndpointCheck(reachable: boolean): void;
}

/** Is a key held for this provider (the armed one by default)? The panel's setup-or-desk question. */
export function isConnected(state: AgentPanelSettingsState, provider?: ProviderId): boolean {
  return state.keyed.includes(provider ?? state.provider);
}

/**
 * WHAT A CONNECTION IS STILL MISSING, in the order the connection screen asks for it.
 *
 *   key      — no key is held for the armed provider
 *   endpoint — the armed provider is the user's own server and no address is filed, OR the filed
 *              address FAILED its last completed verification (`endpointDown`): an address proven
 *              to answer nothing is no more a server than no address at all
 *   model    — no model id stands for the armed provider
 *
 * Every one of the three is something a request needs. A key alone reaches an endpoint that refuses
 * it; `custom` with no address reaches whatever host the SDK defaults to, which is another company's
 * server holding a key that was never meant for it; and no model id is a request with no `model`
 * field. So "connected" (a key is held) is NOT the same question as "ready to take an order", and
 * this is the second one.
 */
export type ConnectionGap = 'key' | 'endpoint' | 'model';

export function connectionGaps(
  state: AgentPanelSettingsState, provider?: ProviderId,
): readonly ConnectionGap[] {
  const id = provider ?? state.provider;
  const gaps: ConnectionGap[] = [];
  if (!state.keyed.includes(id)) gaps.push('key');
  if (id === 'custom'
    && (state.customBaseUrl === '' || (state.endpointDown !== '' && state.endpointDown === state.customBaseUrl))) {
    gaps.push('endpoint');
  }
  if ((state.model[id] ?? '') === '') gaps.push('model');
  return gaps;
}

/**
 * THE ONE READINESS TEST, AND EVERY DOOR OUT OF SETUP GOES THROUGH IT. An idle panel says it is
 * waiting for an order, and a panel that cannot carry one must not say so: the composer, the setup
 * screen's Done and the panel's own choice of surface are three readings of this single answer.
 */
export function connectionReady(state: AgentPanelSettingsState, provider?: ProviderId): boolean {
  return connectionGaps(state, provider).length === 0;
}

/**
 * The armed connection as the runner wants it: exactly `RunnerConfig`'s data half (`exec/runner.ts`
 * supplies the live map deps and rule registry itself). `apiKey` is '' when none is held, which is
 * the caller's cue that there is nothing to run yet.
 *
 * `region` is derived rather than stored: a region-split platform (Moonshot/Qwen/Zhipu) issues a
 * key against ONE of its hosts, and which one was resolved is recorded as the host's URL. Its
 * index in `QUIRKS[id].baseUrls` is the runner's `region`, so the two representations cannot drift.
 */
export function runnerSettings(state: AgentPanelSettingsState): {
  providerId: ProviderId; apiKey: string; model: string; oversight: Oversight;
  customBaseUrl?: string; region?: 0 | 1;
} {
  const providerId = state.provider;
  const out: ReturnType<typeof runnerSettings> = {
    providerId,
    apiKey: keyring[providerId] ?? '',
    model: state.model[providerId] ?? '',
    oversight: state.oversight,
  };
  if (state.customBaseUrl) out.customBaseUrl = state.customBaseUrl;
  const host = carried.regionBaseUrl?.[providerId];
  const index = host ? (QUIRKS[providerId].baseUrls ?? []).indexOf(host) : -1;
  if (index === 1) out.region = 1;
  return out;
}

function emptyModels(): Record<ProviderId, string> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
}

function keyedFrom(ring: Partial<Record<ProviderId, string>>): ProviderId[] {
  return PROVIDER_IDS.filter((id) => (ring[id] ?? '') !== '');
}

/**
 * Writes the record, MERGING this store's fields over what is on disk rather than assembling one
 * from its own state. Called after every mutation: the record is small and the write is synchronous.
 *
 * IT NEVER WRITES FROM AN UNHYDRATED STORE, and that is the whole reason this function is not three
 * lines. Before `hydrate()` lands, every field here is a DEFAULT — provider `claude`, no models, no
 * keys — and a record assembled from those is not a smaller version of what the user had, it is a
 * different one. Two things then go at once: the non-secret fields, and the KEY. `key-storage.ts`
 * carries a sealed blob forward past a keyless save only while its own `keysHydrated` flag is down,
 * and that flag is a module global the legacy settings surface raises at app boot — so a keyless
 * save from here, at any point after that, drops the blob and the user's key is gone. One press on
 * the oversight row was enough to do it.
 *
 * So: NOTHING is written until this store knows what it is overwriting, a key just typed included.
 * A save carrying keys does make `key-storage` re-seal rather than drop the blob — but it re-seals
 * only the keys the save CARRIES, and an unhydrated keyring is at most the one key just typed, so
 * that path would trade a key for every other provider's. The write is owed instead, and `hydrate`
 * pays it the moment the blob is merged in (a few milliseconds later), by which point the keyring is
 * whole. Nothing is lost either way: the store holds the key for the session regardless.
 */
function persist(state: AgentPanelSettingsState): void {
  if (!state.hydrated) {
    owedWrite = true;
    return;
  }
  owedWrite = false;

  const stored = loadAgentSettings();
  // The keyring OVER the loaded keys: `loadAgentSettings` only decodes the obfuscated fallback, so
  // another provider's key sitting there must not be dropped by a save this store makes. A key this
  // session REVOKED is the one thing that must be: it is in the record and not in the keyring, so
  // the merge alone would write it straight back.
  const keys = dropForgotten({ ...stored.keys, ...keyring });

  const record: AgentSettings = {
    ...stored, // regionBaseUrl and anything else this store does not model
    provider: state.provider,
    model: state.model,
    keys,
    askBeforeEdits: state.oversight === 'strict',
    oversight: state.oversight,
  };
  if (state.customBaseUrl) record.customBaseUrl = state.customBaseUrl;
  else delete record.customBaseUrl;
  saveAgentSettings(record);
}

export const useAgentPanelSettings: UseBoundStore<StoreApi<AgentPanelSettingsState>> =
  create<AgentPanelSettingsState>((set, get) => {
    /** One mutation: fold the patch in, then write the whole record. */
    function commit(patch: Partial<AgentPanelSettingsState>): void {
      set(patch);
      persist(get());
    }

    return {
      provider: 'claude',
      model: emptyModels(),
      oversight: 'checkpoint',
      customBaseUrl: '',
      endpointDown: '',
      formerModel: '',
      keyed: [],
      providerPinned: false,
      hydrated: false,

      hydrate: async () => {
        const stored = loadAgentSettings();
        // Whatever this store already holds wins over the disk's copy of it — and a key this
        // session REVOKED is then taken back out, because the merge has no way to say "absent on
        // purpose" and would otherwise resurrect it.
        keyring = dropForgotten({ ...stored.keys, ...keyring });
        carried = stored.regionBaseUrl ? { regionBaseUrl: stored.regionBaseUrl } : {};
        set({
          provider: stored.provider,
          model: { ...emptyModels(), ...stored.model },
          oversight: stored.oversight,
          customBaseUrl: stored.customBaseUrl ?? '',
          keyed: keyedFrom(keyring),
        });

        const sealed = await hydrateSealedKeys();
        // Under whatever arrived since: a key connected while the vault was opening is the live
        // one, and the sealed copy of its predecessor must not take its place. The revocations are
        // applied here too — the sealed blob is the other place a deleted key can come back from —
        // and only then forgotten, once both merges have been accounted for.
        if (sealed) keyring = dropForgotten({ ...sealed, ...keyring });
        markKeysHydrated();
        set({ keyed: keyedFrom(keyring), hydrated: true });
        // A press that landed inside the vault's opening window was declined rather than written
        // over an unread record; the record is known now, so the owed write is made here. The write
        // is where a revocation reaches the DISK, so the set is cleared only once it has been made.
        if (owedWrite) persist(get());
        forgotten.clear();
      },

      connectKey: (provider, key) => {
        const trimmed = key.trim();
        if (trimmed === '') return;
        forgotten.delete(provider);
        keyring = { ...keyring, [provider]: trimmed };
        commit({ provider, keyed: keyedFrom(keyring) });
      },

      forgetKey: (provider) => {
        const id = provider ?? get().provider;
        // ONCE HYDRATED, an unkeyed provider is genuinely nothing to revoke, and recording one
        // would suppress a key the legacy surface files later. BEFORE hydration the keyring is not
        // yet an answer to what is held, so a forget there is a statement about the key on disk
        // that has not been read, and is taken at face value.
        if (get().hydrated && keyring[id] === undefined) return;
        // BEFORE the key is gone, and only for the ARMED provider — the running job reads its key
        // from the one this store has armed, so forgetting another provider's leaves it untouched.
        // A no-op when no job is running (the runner's `stop` is an idempotent abort).
        if (id === get().provider) stopLiveJob?.();
        forgotten.add(id);
        const next = { ...keyring };
        delete next[id];
        keyring = next;
        // The pin goes with the key. A revocation puts the user back at the mouth of the setup flow,
        // where a provider named for the key that has just gone would answer for the next one.
        commit({ keyed: keyedFrom(keyring), ...(id === get().provider ? { providerPinned: false } : {}) });
      },

      setProvider: (provider) => commit({ provider }),

      pinProvider: (provider) => commit({ provider, providerPinned: true }),

      setModel: (model) => commit({
        model: { ...get().model, [get().provider]: model },
        // A pick filed against the user's own server ANSWERS the offer of the earlier one, so the
        // recovered list stops marking it. Only there: the offer is only ever about `custom`.
        ...(model !== '' && get().provider === 'custom' ? { formerModel: '' } : {}),
      }),

      setOversight: (oversight) => commit({ oversight }),

      setCustomBaseUrl: (raw) => {
        const url = sanitizeEndpointUrl(raw);
        commit({ customBaseUrl: url });
        return url;
      },

      recordEndpointCheck: (reachable) => {
        if (reachable) {
          if (get().endpointDown !== '') set({ endpointDown: '' });
          return;
        }
        const was = get().model.custom ?? '';
        commit({
          endpointDown: get().customBaseUrl,
          model: { ...get().model, custom: '' },
          // A second failure arrives with the row already empty, and '' must not overwrite the pick
          // the first one remembered.
          ...(was !== '' ? { formerModel: was } : {}),
        });
      },
    };
  });
