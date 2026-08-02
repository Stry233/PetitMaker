/**
 * Persistence for the agent's BYOK settings (provider, per-provider model, keys).
 *
 * SECURITY: keys are sealed AT REST with the WebCrypto vault (vault.ts — AES-GCM
 * under a non-extractable CryptoKey held in IndexedDB), so localStorage carries
 * only ciphertext once the async upgrade lands. Where the vault is unavailable
 * (old browsers, some private windows, jsdom), keys fall back to base64
 * OBFUSCATION — NOT encryption. Either way, anything executing in this origin
 * (devtools, XSS, a storage-capable extension) can still obtain keys — see
 * vault.ts + docs/THREAT_MODEL.md for the honest threat model. The structural protections
 * remain primary: BYOK keeps keys OFF any server, keys are sent ONLY to the
 * selected provider's HTTPS API (CSP connect-src allowlists those), never logged
 * (error text is redacted — redact.ts), and the UI discloses "stored locally in
 * this browser only". Users on shared machines should clear site data.
 */
import type { ProviderId } from './types';
import { PROVIDER_META, PROVIDER_IDS, providerBaseUrls } from './providers/defaults';
import { sealSecret, openSecret, type SealedBlob } from './vault';

export type Oversight = 'strict' | 'checkpoint' | 'yolo';

export interface AgentSettings {
  provider: ProviderId;
  model: Record<ProviderId, string>;
  keys: Partial<Record<ProviderId, string>>;
  /** Legacy approval flag, kept as a back-compat mirror of `oversight==='strict'`. */
  askBeforeEdits: boolean;
  /** Gate policy (Site Log): strict = every edit asks; checkpoint = plans and
   *  wide/destructive steps ask; yolo = only sketches wait. */
  oversight: Oversight;
  /** Base URL of the 'custom' provider's OpenAI-compatible endpoint (e.g. an
   *  Open WebUI/LiteLLM gateway). Not a secret — stored plain. */
  customBaseUrl?: string;
  /** Which regional deployment a key belongs to, for the platforms that run more than one
   *  (Moonshot, Qwen, Zhipu). Filled in when the key is connected; absent means the provider's
   *  primary host. Not a secret — stored plain. */
  regionBaseUrl?: Partial<Record<ProviderId, string>>;
}

const LS_KEY = 'petit-agent-settings-v1';

const enc = (s: string): string => btoa(unescape(encodeURIComponent(s)));
const dec = (s: string): string => {
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return '';
  }
};

/** The stored record: non-secret fields plain; keys either obfuscated (`keys`,
 *  the fallback + the brief window before the async seal lands) or encrypted
 *  (`keysSealed`). */
interface StoredRecord {
  provider?: ProviderId;
  model?: Record<ProviderId, string>;
  keys?: Record<string, string>;
  keysSealed?: SealedBlob;
  askBeforeEdits?: boolean;
  /** Widened: a record written before a rename still holds the old name. */
  oversight?: string;
  customBaseUrl?: string;
  regionBaseUrl?: Record<string, string>;
}

/**
 * Stored regional hosts, keeping only a URL the provider itself declares.
 *
 * The key travels to whatever this names, and localStorage is writable by anything running in
 * the origin, so an arbitrary string here would be an arbitrary destination for a key. The
 * declared host list is the allowlist — same posture as json-codec dropping unknown catalogIds.
 */
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

/** Oversight names retired from the type but still on users' disks. Dropping one
 *  would fall back to the default, so a user who asked never to be interrupted
 *  would start being interrupted with no indication why. Read-only: the loader
 *  maps forward and the next save writes the current name. */
const RENAMED_OVERSIGHTS: Record<string, Oversight> = { autopilot: 'yolo' };

/** Stored oversight → current name. Falls back through the legacy boolean
 *  (askBeforeEdits true → strict) to the default. */
function readOversight(rec: Pick<StoredRecord, 'oversight' | 'askBeforeEdits'>): Oversight {
  const stored = rec.oversight;
  if (stored) {
    if (OVERSIGHTS.includes(stored)) return stored as Oversight;
    const renamed = RENAMED_OVERSIGHTS[stored];
    if (renamed) return renamed;
  }
  return rec.askBeforeEdits === true ? 'strict' : 'checkpoint';
}

/**
 * Normalize a user-typed custom endpoint: add a missing scheme, force https
 * for anything that is not loopback (an http endpoint would carry the API key
 * in cleartext), drop non-http(s) schemes, drop embedded credentials, trim
 * trailing slashes. Returns '' for unusable input.
 */
export function sanitizeEndpointUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${u}`;
  try {
    const url = new URL(u);
    // CSP cannot express an IPv6 literal (its host grammar is letters, digits and hyphens), so an
    // endpoint written that way is unreachable however it is stored. `localhost` is the spelling
    // that connect-src can name, and it resolves to the same loopback interface.
    if (url.hostname === '[::1]') url.hostname = 'localhost';
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) {
      url.protocol = 'https:';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    // A password in `https://user:pass@host` would sit in a field persisted in the clear, beside
    // a key the vault seals; a browser also refuses to fetch a URL carrying credentials.
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function defaultAgentSettings(): AgentSettings {
  return {
    provider: 'claude',
    // No seeded model: a model is only real once a live listModels() picks it (or
    // the user enters one). Seeding a per-provider default would show a "fake"
    // model for a platform whose key isn't effective, and let the user start a
    // chat against a model that may not exist.
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    keys: {},
    askBeforeEdits: false,
    oversight: 'checkpoint',
  };
}

export function loadAgentSettings(): AgentSettings {
  if (typeof localStorage === 'undefined') return defaultAgentSettings();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultAgentSettings();
    const parsed = JSON.parse(raw) as StoredRecord;
    const base = defaultAgentSettings();
    // Synchronous path only decodes the obfuscated fallback; vault-sealed keys
    // arrive via hydrateSealedKeys() (async) — the store merges them in.
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
      customBaseUrl: typeof parsed.customBaseUrl === 'string' && parsed.customBaseUrl ? parsed.customBaseUrl : undefined,
      regionBaseUrl: readRegionBaseUrl(parsed.regionBaseUrl),
    };
  } catch {
    return defaultAgentSettings();
  }
}

/** True once the startup hydration finished — from then on an empty key set in
 *  a save means "deliberately cleared", not "not yet loaded". */
let keysHydrated = false;
export function markKeysHydrated(): void {
  keysHydrated = true;
}

/** Decrypt the vault-sealed keys, if any. The store calls this once at startup
 *  and merges the result under any keys the user has already typed this session. */
export async function hydrateSealedKeys(): Promise<Partial<Record<ProviderId, string>> | null> {
  if (typeof localStorage === 'undefined') return null;
  try {
    const rec = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as StoredRecord | null;
    if (!rec?.keysSealed) return null;
    const plain = await openSecret(rec.keysSealed);
    if (!plain) return null;
    return JSON.parse(plain) as Partial<Record<ProviderId, string>>;
  } catch {
    return null;
  }
}

/**
 * Replace the record's obfuscated keys with a vault-sealed blob. Runs after
 * every save; re-reads the record at completion so a save that landed during
 * sealing is never clobbered (its own upgrade is in flight and wins).
 */
async function upgradeToSealed(): Promise<void> {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return;
  const rec = JSON.parse(raw) as StoredRecord;
  const obf = rec.keys ?? {};
  if (Object.keys(obf).length === 0) return;
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(obf)) {
    const decoded = dec(v);
    if (decoded) plain[k] = decoded;
  }
  const sealed = await sealSecret(JSON.stringify(plain));
  if (!sealed) return; // vault unavailable → obfuscated fallback stays
  const cur = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as StoredRecord | null;
  if (!cur || JSON.stringify(cur.keys) !== JSON.stringify(rec.keys)) return; // newer save owns the upgrade
  delete cur.keys;
  cur.keysSealed = sealed;
  localStorage.setItem(LS_KEY, JSON.stringify(cur));
}

export function saveAgentSettings(s: AgentSettings): void {
  if (typeof localStorage === 'undefined') return;
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.keys)) if (v) keys[k] = enc(v);
  // Carry the existing sealed blob forward: a save that fires BEFORE the async
  // key hydration completes has empty in-memory keys, and dropping the blob
  // there would destroy the stored keys. When this save carries keys of its
  // own, the upgrade below re-seals and replaces the carried blob anyway.
  let keysSealed: SealedBlob | undefined;
  if (!keysHydrated || Object.keys(keys).length > 0) {
    try {
      keysSealed = (JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as StoredRecord | null)?.keysSealed;
    } catch {
      /* corrupted record → write fresh */
    }
  }
  // Sync write keeps the obfuscated form so a mid-seal tab close never loses
  // keys; the async upgrade then swaps it for the encrypted blob.
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      provider: s.provider, model: s.model, keys, keysSealed,
      askBeforeEdits: s.oversight === 'strict',   // back-compat mirror
      oversight: s.oversight,
      customBaseUrl: s.customBaseUrl,
      regionBaseUrl: s.regionBaseUrl,
    }),
  );
  void upgradeToSealed().catch(() => {});
}
