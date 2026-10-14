/*
 * The key grammar setup reads a draft with: whether it is worth acting on, which provider its shape
 * names, and where quiet advance or an explicit press sends it.
 */
import { detectProviderFromKey } from '../providers/detect';
import type { ProviderId } from '../providers/defaults';

/** Minimum actionable key shape and shared provider-key alphabet. */
const KEY_OK = /^[A-Za-z0-9_.-]{12,}$/;

/** A `sk-` key of 32 or more hex digits: DeepSeek's shape, and every gateway's. */
const SK_HEX = /^sk-[0-9a-f]{32,}$/i;
/** The same shape, still being typed. */
const SK_PARTIAL = /^s(k(-[0-9a-f]{0,31})?)?$/i;

export type KeyShape = ProviderId | 'empty' | 'partial' | 'ambiguous' | 'unknown';

/** Whether the field holds enough to be worth acting on. */
export function keyLooksUsable(raw: string): boolean {
  return KEY_OK.test(raw.trim());
}

/** Classifies the current key text without retaining an earlier verdict. */
export function readKeyShape(raw: string): KeyShape {
  const key = raw.trim();
  if (key === '') return 'empty';
  const named = detectProviderFromKey(key);
  if (named) return named;
  if (SK_HEX.test(key)) return 'ambiguous';
  if (SK_PARTIAL.test(key)) return 'partial';
  return 'unknown';
}

/**
 * Chooses the next route for a key shape. Quiet advance ignores short or partial keys; an explicit
 * action opens the chooser, and custom providers require an endpoint before commit.
 */
export type KeyDestination = 'commit' | 'ask' | 'endpoint' | null;

export function keyDestination(a: {
  shape: KeyShape; usable: boolean; endpointFiled: boolean; explicit: boolean;
}): KeyDestination {
  if (a.shape === 'empty') return null;
  // Quiet advance waits for a usable key; an explicit action may open the chooser sooner.
  if (!a.usable && !a.explicit) return null;
  if (a.shape === 'partial') return a.explicit ? 'ask' : null;
  if (a.shape === 'custom') return a.endpointFiled ? 'commit' : 'endpoint';
  if (a.shape === 'ambiguous') return 'ask';
  if (a.shape === 'unknown') return 'ask';
  return 'commit';
}
