/*
 * model-roster.ts — the model lists this SESSION has already asked an endpoint for.
 *
 * `ManageScreen` fetches the roster when it mounts, and the gear is the panel's ONE settings door, so
 * every visit to it spent a `/models` request: free on most platforms, counted on a rate-limited one,
 * and the same answer every time within a session. So the answer is remembered for as long as the
 * page lives, and the request is spent on the first visit only.
 *
 * KEYED BY ENDPOINT AND NEVER BY KEY. The secret lives outside the store on purpose
 * (`settings.ts`'s own rule) and nothing here may hold or hash a copy of it, so the key is the
 * provider plus the custom base URL — which is exactly what makes forgetting a key the moment to
 * forget the roster too: what an endpoint can run is an answer about the credential that asked.
 *
 * ONLY A NON-EMPTY LIST IS AN ANSWER. An empty one is the same dead end a refusal is, and a
 * remembered nothing would be a request never spent again on an endpoint that had simply been down.
 */
import type { ProviderId } from '../../agent/providers/defaults';

const ROSTERS = new Map<string, readonly string[]>();

export function rosterKey(provider: ProviderId, customBaseUrl?: string): string {
  return `${provider}|${customBaseUrl ?? ''}`;
}

export function rememberedRoster(key: string): readonly string[] | undefined {
  return ROSTERS.get(key);
}

export function rememberRoster(key: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  ROSTERS.set(key, ids);
}

/** Drops every remembered list: the credential that asked for them has gone. */
export function forgetRosters(): void {
  ROSTERS.clear();
}

/** Drops ONE endpoint's list, for a caller re-asking that endpoint on purpose (the manage card's
 *  address check). The other endpoints' answers are still true, so clearing them would spend their
 *  requests again for nothing. */
export function forgetRoster(key: string): void {
  ROSTERS.delete(key);
}
