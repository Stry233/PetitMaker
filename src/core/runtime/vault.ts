/**
 * AES-GCM key sealing with a non-extractable CryptoKey stored in IndexedDB. This protects copied
 * localStorage ciphertext, but code executing in the origin can still use the key handle.
 * Operations return null when SubtleCrypto or IndexedDB is unavailable.
 */

import { PREFS } from './prefs';

export interface SealedBlob {
  /** base64 12-byte AES-GCM IV */
  iv: string;
  /** base64 ciphertext (includes the GCM tag) */
  ct: string;
}

/** IndexedDB database name declared in the shared persisted-key table. */
const DB_NAME = PREFS.agentVault.key;
const STORE = 'k';
const KEY_ID = 'aes-v1';

const subtle = (): SubtleCrypto | null =>
  typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
const idb = (): IDBFactory | null => (typeof indexedDB !== 'undefined' ? indexedDB : null);

const b64 = (buf: ArrayBuffer): string => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

function openDb(f: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = f.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet<T>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let keyPromise: Promise<CryptoKey | null> | null = null;

/** Create or load the origin's non-extractable vault key. */
function getVaultKey(): Promise<CryptoKey | null> {
  keyPromise ??= (async () => {
    const s = subtle();
    const f = idb();
    if (!s || !f) return null;
    try {
      const db = await openDb(f);
      try {
        let key = await dbGet<CryptoKey>(db, KEY_ID);
        if (!key) {
          key = await s.generateKey({ name: 'AES-GCM', length: 256 }, /* extractable */ false, ['encrypt', 'decrypt']);
          await dbPut(db, KEY_ID, key);
        }
        return key;
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  })();
  return keyPromise;
}

/** Key-explicit crypto operation used by the vault and its tests. */
export async function sealWithKey(key: CryptoKey, plain: string): Promise<SealedBlob> {
  const s = subtle();
  if (!s) throw new Error('SubtleCrypto unavailable');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { iv: b64(iv.buffer), ct: b64(ct) };
}

export async function openWithKey(key: CryptoKey, blob: SealedBlob): Promise<string> {
  const s = subtle();
  if (!s) throw new Error('SubtleCrypto unavailable');
  const plain = await s.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return new TextDecoder().decode(plain);
}

/** Delete the vault, resolving on completion, failure, or a two-second deadline. */
export function deleteVault(): Promise<void> {
  keyPromise = null;
  const f = idb();
  if (!f) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(done, 2000);
    const req = f.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => {
      clearTimeout(timer);
      done();
    };
  });
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
