/**
 * The illustration window's settings, stored in one preference record. The API key is persisted
 * only as a vault-sealed blob; when sealing is unavailable, the caller keeps it in memory for the
 * session. Settings, Local data is how a stored key is forgotten.
 */
import {
  CUSTOM_DIRECTION_ID, STYLE_PACKS, STYLIZE_PROVIDERS, isProcPackId,
  type StylizeDirection, type StylizeProvider,
} from '../../pipelines/stylize/facts';
import { sealSecret, openSecret, type SealedBlob } from '../../platform/storage/vault';
import { sanitizeEndpointUrl } from '../../platform/remote/endpoint-url';
import { jsonObject, jsonPref, writeJsonPref } from '../../platform/storage/prefs';

export interface StylizeSettings {
  provider: StylizeProvider['id'];
  model: string;
  customBaseUrl: string;
  direction: StylizeDirection;
  customPrompt: string;
}

/** Stored shape; an absent `keySealed` means no persisted connection. */
interface StoredRecord {
  provider?: string;
  model?: string;
  customBaseUrl?: string;
  direction?: string;
  customPrompt?: string;
  keySealed?: SealedBlob | null;
}

const PROVIDER_IDS: readonly string[] = STYLIZE_PROVIDERS.map((p) => p.id);
const DIRECTION_IDS: readonly string[] = [...STYLE_PACKS.map((p) => p.id), CUSTOM_DIRECTION_ID];

/** The provider a window with no stored connection opens on. */
export const DEFAULT_STYLIZE_PROVIDER: StylizeProvider['id'] = 'gemini';

function defaultStylizeSettings(): StylizeSettings {
  return { provider: DEFAULT_STYLIZE_PROVIDER, model: '', customBaseUrl: '', direction: 'aquarelle', customPrompt: '' };
}

function readRecord(): StoredRecord | null {
  return jsonPref('stylize', jsonObject) as StoredRecord | null;
}

export function loadStylizeSettings(): StylizeSettings {
  const rec = readRecord();
  const base = defaultStylizeSettings();
  if (!rec) return base;
  return {
    provider: typeof rec.provider === 'string' && PROVIDER_IDS.includes(rec.provider)
      ? (rec.provider as StylizeProvider['id']) : base.provider,
    model: typeof rec.model === 'string' ? rec.model : base.model,
    customBaseUrl: typeof rec.customBaseUrl === 'string' ? sanitizeEndpointUrl(rec.customBaseUrl) : base.customBaseUrl,
    direction: typeof rec.direction === 'string' && (DIRECTION_IDS.includes(rec.direction) || isProcPackId(rec.direction))
      ? (rec.direction as StylizeDirection) : base.direction,
    customPrompt: typeof rec.customPrompt === 'string' ? rec.customPrompt : base.customPrompt,
  };
}

/** Write non-secret fields while preserving the sealed key. */
export function saveStylizeSettings(s: StylizeSettings): void {
  const cur = readRecord();
  const rec: StoredRecord = {
    provider: s.provider,
    model: s.model,
    customBaseUrl: sanitizeEndpointUrl(s.customBaseUrl),
    direction: s.direction,
    customPrompt: s.customPrompt,
    keySealed: cur?.keySealed ?? null,
  };
  writeJsonPref('stylize', rec);
}

export async function loadStylizeKey(): Promise<string | null> {
  const rec = readRecord();
  if (!rec?.keySealed) return null;
  return openSecret(rec.keySealed);
}

/** Persist a key only when the vault can seal it. */
export async function saveStylizeKey(plain: string): Promise<void> {
  const sealed = await sealSecret(plain);
  if (!sealed) return;
  const cur = readRecord() ?? {};
  writeJsonPref('stylize', { ...cur, keySealed: sealed } satisfies StoredRecord);
}
