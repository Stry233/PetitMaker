/**
 * The assistant's connection settings as one stored record: provider, models, effort, approval
 * policy and endpoints, with the provider keys `key-storage.ts` seals or obfuscates.
 */
import { PROVIDER_META, PROVIDER_IDS, providerBaseUrls, type ProviderId } from '../providers/defaults';
import { sanitizeEndpointUrl } from '../../platform/remote/endpoint-url';
import { writePref } from '../../platform/storage/prefs';
import { isOversight, type Oversight } from '../core/gates';
import { keysToStore, readObfuscatedKeys, storedSettings, upgradeToSealed, type SealState, type StoredKeys } from './key-storage';

export interface AgentSettings {
  provider: ProviderId;
  model: Record<ProviderId, string>;
  effort?: Record<string, string>;
  keys: Partial<Record<ProviderId, string>>;
  /** Approval policy: every edit, checkpoints, or sketches only. */
  oversight: Oversight;
  /** OpenAI-compatible custom endpoint. Stored as a non-secret field. */
  customBaseUrl?: string;
  /** Explicitly configured authentication for the custom endpoint. Omission requires a key. */
  customAuth?: 'none';
  /** Registry URL that accepted each region-specific provider key. Stored as a non-secret field. */
  regionBaseUrl?: Partial<Record<ProviderId, string>>;
}

/** Non-secret fields plus either obfuscated or vault-sealed keys. */
interface StoredRecord extends StoredKeys {
  provider?: ProviderId;
  model?: Record<ProviderId, string>;
  effort?: Record<string, string>;
  /** Read only: records written before `oversight` existed say strict review this way. */
  askBeforeEdits?: boolean;
  /** Wider than `Oversight` so renamed stored values can be migrated. */
  oversight?: string;
  customBaseUrl?: string;
  customAuth?: 'none';
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

/** Stored names mapped to their current approval policy on load. */
const RENAMED_OVERSIGHTS: Record<string, Oversight> = { autopilot: 'yolo' };

/** Read the current policy, then the legacy strict flag, then the default. */
function readOversight(rec: Pick<StoredRecord, 'oversight' | 'askBeforeEdits'>): Oversight {
  const stored = rec.oversight;
  if (stored) {
    if (isOversight(stored)) return stored;
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
    oversight: 'checkpoint',
  };
}

export function loadAgentSettings(): AgentSettings {
  try {
    const raw = storedSettings();
    if (!raw) return defaultAgentSettings();
    const parsed = JSON.parse(raw) as StoredRecord;
    const base = defaultAgentSettings();
    const keys = readObfuscatedKeys(parsed);
    const oversight = readOversight(parsed);
    return {
      provider: parsed.provider && parsed.provider in PROVIDER_META ? parsed.provider : base.provider,
      model: { ...base.model, ...parsed.model },
      effort: parsed.effort && typeof parsed.effort === 'object' ? Object.fromEntries(Object.entries(parsed.effort).filter(([key, value]) => key.length < 500 && typeof value === 'string' && /^(?:[a-z]+|budget:\d{1,7})$/.test(value))) : {},
      keys,
      oversight,
      // Stored free-text endpoints receive the same normalization as newly typed values.
      customBaseUrl: typeof parsed.customBaseUrl === 'string' ? sanitizeEndpointUrl(parsed.customBaseUrl) || undefined : undefined,
      ...(parsed.customAuth === 'none' ? { customAuth: 'none' as const } : {}),
      regionBaseUrl: readRegionBaseUrl(parsed.regionBaseUrl),
    };
  } catch {
    return defaultAgentSettings();
  }
}

/** Writes the record and reports whether it landed; private-mode storage throws from `setItem`. */
export function saveAgentSettings(s: AgentSettings, seal: SealState): boolean {
  const { keys, keysSealed } = keysToStore(s.keys, seal);
  // Written synchronously before the asynchronous vault upgrade. When storage is disabled or full,
  // the settings stay session-only.
  const written = writePref(
    'agentSettings',
    JSON.stringify({
      provider: s.provider, model: s.model, effort: s.effort, keys, keysSealed,
      oversight: s.oversight,
      customBaseUrl: s.customBaseUrl,
      customAuth: s.customAuth,
      regionBaseUrl: s.regionBaseUrl,
    }),
  );
  void upgradeToSealed(seal).catch(() => {});
  return written;
}
