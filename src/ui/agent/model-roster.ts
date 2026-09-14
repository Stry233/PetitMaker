/** Account model lists expire after five minutes and are invalidated when credentials change. */
import type { ProviderId } from '../../agent/providers/defaults';

const ROSTERS = new Map<string, { ids: readonly string[]; expires: number }>();

export function rosterKey(provider: ProviderId, customBaseUrl?: string): string {
  return `${provider}|${customBaseUrl ?? ''}`;
}

export function rememberedRoster(key: string): readonly string[] | undefined {
  const cached = ROSTERS.get(key);
  return cached && cached.expires > Date.now() ? cached.ids : undefined;
}

export function rememberRoster(key: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  ROSTERS.set(key, { ids, expires: Date.now() + 5 * 60_000 });
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
