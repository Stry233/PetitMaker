/**
 * Agent provider settings and key persistence. Keys are sealed with the browser vault when
 * available and otherwise stored with reversible base64 obfuscation. Client-side code can use any
 * locally stored key; `docs/THREAT_MODEL.md` describes that boundary.
 */
import { PROVIDER_META, PROVIDER_IDS, providerBaseUrls, type ProviderId } from '../providers/defaults';
import { sealSecret, openSecret, type SealedBlob } from '../../core/runtime/vault';
import { sanitizeEndpointUrl } from '../../core/runtime/endpoint-url';
import { PREFS } from '../../core/runtime/prefs';

export type Oversight = 'strict' | 'checkpoint' | 'yolo';

export interface AgentSettings {
  provider: ProviderId;
  model: Record<ProviderId, string>;
  keys: Partial<Record<ProviderId, string>>;
  /** Compatibility mirror of `oversight === 'strict'`. */
  askBeforeEdits: boolean;
  /** Approval policy: every edit, checkpoints, or sketches only. */
  oversight: Oversight;
  /** OpenAI-compatible custom endpoint. Stored as a non-secret field. */
  customBaseUrl?: string;
  /** Registry URL that accepted each region-specific provider key. Stored as a non-secret field. */
  regionBaseUrl?: Partial<Record<ProviderId, string>>;
}

const enc = (s: string): string => btoa(unescape(encodeURIComponent(s)));
const dec = (s: string): string => {
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return '';
  }
};

/** Non-secret fields plus either obfuscated or vault-sealed keys. */
interface StoredRecord {
  provider?: ProviderId;
  model?: Record<ProviderId, string>;
  keys?: Record<string, string>;
  keysSealed?: SealedBlob;
  askBeforeEdits?: boolean;
  /** Wider than `Oversight` so renamed stored values can be migrated. */
  oversight?: string;
  customBaseUrl?: string;
  regionBaseUrl?: Record<string, string>;
}

/** Accept stored regional hosts only when the provider registry declares them. */
function readRegionBaseUrl(rec: StoredRecord['regionBaseUrl']): AgentSettings['regionBaseUrl'] {
  if (!rec || typeof rec !== 'object') return undefined;
  const out: Partial<Record<ProviderId, string>> = {};
  for (const [id, url] of Object.entries(rec)) {
    if (!PROVIDER_IDS.includes(id as ProviderId)) continue;
    if (providerBaseUrls(id as ProviderId).includes(url)) out[id as ProviderId] = url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const OVERSIGHTS: readonly string[] = ['strict', 'checkpoint', 'yolo'];

/** Stored names mapped to their current approval policy on load. */
const RENAMED_OVERSIGHTS: Record<string, Oversight> = { autopilot: 'yolo' };

/** Read the current policy, then the compatibility mirror, then the default. */
function readOversight(rec: Pick<StoredRecord, 'oversight' | 'askBeforeEdits'>): Oversight {
  const stored = rec.oversight;
  if (stored) {
    if (OVERSIGHTS.includes(stored)) return stored as Oversight;
    const renamed = RENAMED_OVERSIGHTS[stored];
    if (renamed) return renamed;
  }
  return rec.askBeforeEdits === true ? 'strict' : 'checkpoint';
}

function defaultAgentSettings(): AgentSettings {
  return {
    provider: 'claude',
    // Models remain empty until discovered from a connected provider or entered by the user.
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    keys: {},
    askBeforeEdits: false,
    oversight: 'checkpoint',
  };
}

export function loadAgentSettings(): AgentSettings {
  if (typeof localStorage === 'undefined') return defaultAgentSettings();
  try {
    const raw = localStorage.getItem(PREFS.agentSettings.key);
    if (!raw) return defaultAgentSettings();
    const parsed = JSON.parse(raw) as StoredRecord;
    const base = defaultAgentSettings();
    // Vault-sealed keys arrive asynchronously through `hydrateSealedKeys`.
    const keys: AgentSettings['keys'] = {};
    for (const [k, v] of Object.entries(parsed.keys ?? {})) {
      const decoded = dec(v);
      if (decoded) keys[k as ProviderId] = decoded;
    }
    const oversight = readOversight(parsed);
    return {
      provider: parsed.provider && parsed.provider in PROVIDER_META ? parsed.provider : base.provider,
      model: { ...base.model, ...parsed.model },
      keys,
      askBeforeEdits: oversight === 'strict',
      oversight,
      // Stored free-text endpoints receive the same normalization as newly typed values.
      customBaseUrl: typeof parsed.customBaseUrl === 'string' ? sanitizeEndpointUrl(parsed.customBaseUrl) || undefined : undefined,
      regionBaseUrl: readRegionBaseUrl(parsed.regionBaseUrl),
    };
  } catch {
    return defaultAgentSettings();
  }
}

/** Distinguishes a deliberately empty keyring from one awaiting startup hydration. */
let keysHydrated = false;
export function markKeysHydrated(): void {
  keysHydrated = true;
}

/**
 * An unread sealed blob is preserved across settings saves until it can be opened. A key removed
 * while its blob is unread may reappear if vault access later returns.
 */
let sealedUnread = false;

/** Canonical form of a keyring, comparable across saves. */
function keyringSignature(keys: Partial<Record<ProviderId, string>>): string {
  const pairs = Object.entries(keys).filter(([, v]) => Boolean(v)).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(pairs);
}

/** Signature of the keys the last hydration opened, or null when none were readable. */
let hydratedSignature: string | null = null;

/** Decrypt stored keys for the startup merge. */
export async function hydrateSealedKeys(): Promise<Partial<Record<ProviderId, string>> | null> {
  if (typeof localStorage === 'undefined') return null;
  try {
    const rec = JSON.parse(localStorage.getItem(PREFS.agentSettings.key) ?? 'null') as StoredRecord | null;
    if (!rec?.keysSealed) {
      sealedUnread = false;
      return null;
    }
    const plain = await openSecret(rec.keysSealed);
    sealedUnread = plain === null;
    if (plain === null) {
      hydratedSignature = null;
      return null;
    }
    const keys = JSON.parse(plain) as Partial<Record<ProviderId, string>>;
    hydratedSignature = keyringSignature(keys);
    return keys;
  } catch {
    hydratedSignature = null;
    return null;
  }
}

/** Seal obfuscated keys without overwriting a newer settings save. */
async function upgradeToSealed(): Promise<void> {
  const raw = localStorage.getItem(PREFS.agentSettings.key);
  if (!raw) return;
  const rec = JSON.parse(raw) as StoredRecord;
  const obf = rec.keys ?? {};
  if (Object.keys(obf).length === 0) return;
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(obf)) {
    const decoded = dec(v);
    if (decoded) plain[k] = decoded;
  }
  // Merge a newly readable old blob under the live keyring before resealing.
  if (sealedUnread && rec.keysSealed) {
    const reopened = await openSecret(rec.keysSealed);
    if (!reopened) return;
    try {
      for (const [k, v] of Object.entries(JSON.parse(reopened) as Record<string, string>)) plain[k] ??= v;
    } catch {
      /* unreadable content → the live keys alone */
    }
    sealedUnread = false;
  }
  const sealed = await sealSecret(JSON.stringify(plain));
  if (!sealed) return; // Keep the obfuscated fallback when the vault is unavailable.
  const cur = JSON.parse(localStorage.getItem(PREFS.agentSettings.key) ?? 'null') as StoredRecord | null;
  if (!cur || JSON.stringify(cur.keys) !== JSON.stringify(rec.keys)) return; // A newer save owns the upgrade.
  delete cur.keys;
  cur.keysSealed = sealed;
  localStorage.setItem(PREFS.agentSettings.key, JSON.stringify(cur));
  hydratedSignature = keyringSignature(plain as Partial<Record<ProviderId, string>>);
}

export function saveAgentSettings(s: AgentSettings): void {
  if (typeof localStorage === 'undefined') return;
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.keys)) if (v) keys[k] = enc(v);
  // The sealed blob still holds exactly these keys, so the obfuscated copy is left out.
  const sealedIsCurrent = keysHydrated
    && hydratedSignature !== null
    && hydratedSignature === keyringSignature(s.keys);
  // Preserve sealed keys while hydration is pending or the blob is unreadable.
  let keysSealed: SealedBlob | undefined;
  if (!keysHydrated || sealedUnread || sealedIsCurrent || Object.keys(keys).length > 0) {
    try {
      keysSealed = (JSON.parse(localStorage.getItem(PREFS.agentSettings.key) ?? 'null') as StoredRecord | null)?.keysSealed;
    } catch {
      /* corrupted record → write fresh */
    }
  }
  // Write synchronously before the asynchronous vault upgrade.
  localStorage.setItem(
    PREFS.agentSettings.key,
    JSON.stringify({
      provider: s.provider, model: s.model, keys: sealedIsCurrent && keysSealed ? undefined : keys, keysSealed,
      askBeforeEdits: s.oversight === 'strict', // Compatibility mirror.
      oversight: s.oversight,
      customBaseUrl: s.customBaseUrl,
      regionBaseUrl: s.regionBaseUrl,
    }),
  );
  void upgradeToSealed().catch(() => {});
}
