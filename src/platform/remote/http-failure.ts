/** What a provider's non-2xx HTTP status says about the request, read the same way by the assistant
 *  and the illustration services. Each caller maps the class onto its own user-facing faces. */
export type HttpFailureKind = 'auth' | 'quota' | 'rate-limit' | 'server' | 'client';

/** Wording of an exhausted quota or an unpaid balance: the account accepted the key but may not
 *  spend. `quota` stays unbounded so `insufficient_quota` and `quota_exceeded` match. */
export const QUOTA_WORDING = /quota|\bbilling\b|\bbalance\b|\boverdue\b|\bpayment\b|usage limit|insufficient[\s_-]*(?:funds|credit)|\bcredits?\b/i;

/** The class of an HTTP failure status, or null for a status that is not a failure. A 403 is a
 *  rejected key unless its message speaks of quota or billing. */
export function httpFailureKind(status: number, message: string): HttpFailureKind | null {
  if (status === 401) return 'auth';
  if (status === 402) return 'quota';
  if (status === 403) return QUOTA_WORDING.test(message) ? 'quota' : 'auth';
  if (status === 408 || status === 409 || status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  return null;
}
