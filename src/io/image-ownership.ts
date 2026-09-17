import type { GridState } from '../core/model/types';
import { clampNotes } from '../core/model/notes';
import { attributedNotes, protectedImageNotes } from '../core/provenance/image-attribution';
import { readPref, writePref } from '../core/runtime/prefs';
import { canonicalize } from './share/canonical';
import { bytesToHex, sha256 } from './share/crypto/sha256';

const RECEIPT_LIMIT = 128;

function receipts(): string[] {
  try {
    const raw: unknown = JSON.parse(readPref('ownImageExports'));
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)).slice(-RECEIPT_LIMIT) : [];
  } catch { return []; }
}

/** Content-only digest. Neither the receipt nor any browser identity enters a shared file. */
async function imageDigest(state: GridState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([canonicalize(state), clampNotes(attributedNotes(state)) ?? null]));
  return bytesToHex(await sha256(bytes));
}

export async function isOwnImageExport(state: GridState): Promise<boolean> {
  const known = receipts();
  return known.length > 0 && known.includes(await imageDigest(state));
}

/** Snapshot content and eligibility; the caller records it only after a successful download. */
export async function prepareOwnImageReceipt(state: GridState): Promise<() => void> {
  if (protectedImageNotes(state)) return () => {};
  const digest = await imageDigest(state);
  return () => {
    const next = [...receipts().filter(v => v !== digest), digest].slice(-RECEIPT_LIMIT);
    writePref('ownImageExports', JSON.stringify(next));
  };
}
