/**
 * AES-GCM key sealing with a non-extractable CryptoKey stored in IndexedDB. This protects copied
 * localStorage ciphertext, but code executing in the origin can still use the key handle.
 * Operations return null when SubtleCrypto or IndexedDB is unavailable.
 */

import { base64ToBytes, bytesToBase64 } from '../../core/base/bytes';
import { BROWSER_DATABASES } from './prefs';
import { idbStore } from './idb-store';

export interface SealedBlob {
  /** base64 12-byte AES-GCM IV */
  iv: string;
  /** base64 ciphertext (includes the GCM tag) */
  ct: string;
}

const STORE = 'k';
const KEY_ID = 'aes-v1';
const vault = idbStore(BROWSER_DATABASES.agentVault, STORE, 2000);

const subtle = (): SubtleCrypto | null =>
  typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;

let keyPromise: Promise<CryptoKey | null> | null = null;

/** The stored key, undefined when none is stored, or null when the vault could not answer. */
const readKey = (): Promise<{ key: CryptoKey | undefined } | null> => vault.settle<{ key: CryptoKey | undefined } | null>((db, done) => {
  const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID);
  req.onsuccess = () => done({ key: req.result as CryptoKey | undefined });
  req.onerror = () => done(null);
}, null);

const storeKey = (key: CryptoKey): Promise<boolean> => vault.settle((db, done) => {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(key, KEY_ID);
  tx.oncomplete = () => done(true);
  tx.onerror = tx.onabort = () => done(false);
}, false);

/** Create or load the origin's non-extractable vault key; a new key is made only when the vault
 *  answered that it holds none. */
async function loadKey(): Promise<CryptoKey | null> {
  const s = subtle();
  if (!s) return null;
  const read = await readKey();
  if (!read) return null;
  if (read.key) return read.key;
  try {
    const key = await s.generateKey({ name: 'AES-GCM', length: 256 }, /* extractable */ false, ['encrypt', 'decrypt']);
    return (await storeKey(key)) ? key : null;
  } catch {
    return null;
  }
}

/** The vault key, loaded once; a vault that could not answer, or ran past its deadline, is asked again next time. */
function getVaultKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;
  const mine: Promise<CryptoKey | null> = loadKey().then((key) => {
    if (!key && keyPromise === mine) keyPromise = null;
    return key;
  });
  keyPromise = mine;
  return mine;
}

async function sealWithKey(key: CryptoKey, plain: string): Promise<SealedBlob> {
  const s = subtle();
  if (!s) throw new Error('SubtleCrypto unavailable');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

async function openWithKey(key: CryptoKey, blob: SealedBlob): Promise<string> {
  const s = subtle();
  if (!s) throw new Error('SubtleCrypto unavailable');
  const plain = await s.decrypt({ name: 'AES-GCM', iv: base64ToBytes(blob.iv) }, key, base64ToBytes(blob.ct));
  return new TextDecoder().decode(plain);
}

/** Delete the vault, resolving on completion, failure or the deadline. */
export function deleteVault(): Promise<void> {
  keyPromise = null;
  return vault.remove();
}

/** Encrypt with the origin vault key; null when the vault is unavailable. */
export async function sealSecret(plain: string): Promise<SealedBlob | null> {
  const key = await getVaultKey();
  if (!key) return null;
  try {
    return await sealWithKey(key, plain);
  } catch {
    return null;
  }
}

/** Decrypt with the origin vault key; null when unavailable or tampered. */
export async function openSecret(blob: SealedBlob): Promise<string | null> {
  const key = await getVaultKey();
  if (!key) return null;
  try {
    return await openWithKey(key, blob);
  } catch {
    return null;
  }
}
