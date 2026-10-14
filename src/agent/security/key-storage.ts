/**
 * Provider key persistence inside the assistant's settings record. Keys are sealed with the browser
 * vault when available and otherwise stored with reversible base64 obfuscation. Client-side code
 * can use any locally stored key; `docs/THREAT_MODEL.md` describes that boundary.
 */
import type { ProviderId } from '../providers/defaults';
import { sealSecret, openSecret, type SealedBlob } from '../../platform/storage/vault';
import { readStoredPref, writePref } from '../../platform/storage/prefs';

/** The stored settings record, or null when it is unset or storage is unavailable. */
export function storedSettings(): string | null {
  const stored = readStoredPref('agentSettings');
  return stored.available ? stored.raw : null;
}

const enc = (s: string): string => btoa(unescape(encodeURIComponent(s)));
const dec = (s: string): string => {
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return '';
  }
};

/** The key fields of the stored settings record: obfuscated or vault-sealed keys. */
export interface StoredKeys {
  keys?: Record<string, string>;
  keysSealed?: SealedBlob;
}

/** The obfuscated keys a stored record holds; vault-sealed keys arrive through `hydrateSealedKeys`. */
export function readObfuscatedKeys(rec: StoredKeys): Partial<Record<ProviderId, string>> {
  const keys: Partial<Record<ProviderId, string>> = {};
  for (const [k, v] of Object.entries(rec.keys ?? {})) {
    const decoded = dec(v);
    if (decoded) keys[k as ProviderId] = decoded;
  }
  return keys;
}

/** What one credential store knows about the sealed blob on disk. */
export interface SealState {
  /** Distinguishes a deliberately empty keyring from one awaiting startup hydration. */
  hydrated: boolean;
  /**
   * An unread sealed blob is preserved across settings saves until it can be opened. A key removed
   * while its blob is unread may reappear if vault access later returns.
   */
  sealedUnread: boolean;
  /** Signature of the keys the last hydration opened, or null when none were readable. */
  signature: string | null;
}

export function newSealState(): SealState {
  return { hydrated: false, sealedUnread: false, signature: null };
}

/** Canonical form of a keyring, comparable across saves. */
function keyringSignature(keys: Partial<Record<ProviderId, string>>): string {
  const pairs = Object.entries(keys).filter(([, v]) => Boolean(v)).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(pairs);
}

/** Decrypt stored keys for the startup merge. */
export async function hydrateSealedKeys(seal: SealState): Promise<Partial<Record<ProviderId, string>> | null> {
  try {
    const stored = readStoredPref('agentSettings');
    // Unreadable storage leaves the unread-blob state as it was: the blob may still be there.
    if (!stored.available) {
      seal.signature = null;
      return null;
    }
    const rec = JSON.parse(stored.raw ?? 'null') as StoredKeys | null;
    if (!rec?.keysSealed) {
      seal.sealedUnread = false;
      return null;
    }
    const plain = await openSecret(rec.keysSealed);
    seal.sealedUnread = plain === null;
    if (plain === null) {
      seal.signature = null;
      return null;
    }
    const keys = JSON.parse(plain) as Partial<Record<ProviderId, string>>;
    seal.signature = keyringSignature(keys);
    return keys;
  } catch {
    seal.signature = null;
    return null;
  }
}

/** The key fields a settings save writes for `keyring`: the obfuscated keys, left out while the
 *  sealed blob still holds exactly these keys, and the sealed blob to keep. */
export function keysToStore(keyring: Partial<Record<ProviderId, string>>, seal: SealState): StoredKeys {
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(keyring)) if (v) keys[k] = enc(v);
  // The sealed blob still holds exactly these keys, so the obfuscated copy is left out.
  const sealedIsCurrent = seal.hydrated
    && seal.signature !== null
    && seal.signature === keyringSignature(keyring);
  // Preserve sealed keys while hydration is pending or the blob is unreadable.
  let keysSealed: SealedBlob | undefined;
  if (!seal.hydrated || seal.sealedUnread || sealedIsCurrent || Object.keys(keys).length > 0) {
    try {
      keysSealed = (JSON.parse(storedSettings() ?? 'null') as StoredKeys | null)?.keysSealed;
    } catch {
      /* corrupted record → write fresh */
    }
  }
  return { keys: sealedIsCurrent && keysSealed ? undefined : keys, keysSealed };
}

/** Seal obfuscated keys without overwriting a newer settings save. */
export async function upgradeToSealed(seal: SealState): Promise<void> {
  const stored = readStoredPref('agentSettings');
  if (!stored.available || !stored.raw) return;
  const rec = JSON.parse(stored.raw) as StoredKeys;
  const obf = rec.keys ?? {};
  if (Object.keys(obf).length === 0) return;
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(obf)) {
    const decoded = dec(v);
    if (decoded) plain[k] = decoded;
  }
  // Merge a newly readable old blob under the live keyring before resealing.
  if (seal.sealedUnread && rec.keysSealed) {
    const reopened = await openSecret(rec.keysSealed);
    if (!reopened) return;
    try {
      for (const [k, v] of Object.entries(JSON.parse(reopened) as Record<string, string>)) plain[k] ??= v;
    } catch {
      /* unreadable content → the live keys alone */
    }
    seal.sealedUnread = false;
  }
  const sealed = await sealSecret(JSON.stringify(plain));
  if (!sealed) return; // Keep the obfuscated fallback when the vault is unavailable.
  const now = readStoredPref('agentSettings');
  if (!now.available) return;
  const cur = JSON.parse(now.raw ?? 'null') as StoredKeys | null;
  if (!cur || JSON.stringify(cur.keys) !== JSON.stringify(rec.keys)) return; // A newer save owns the upgrade.
  delete cur.keys;
  cur.keysSealed = sealed;
  if (!writePref('agentSettings', JSON.stringify(cur))) return;
  seal.signature = keyringSignature(plain as Partial<Record<ProviderId, string>>);
}
