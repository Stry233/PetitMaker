/**
 * One sign-in round with a provider: a window on its consent page, the code that comes back, and the
 * key that code is traded for. Called inside the press that asks for it, since the window must open
 * there; everything that waits comes after the window stands.
 */
import { wallClock } from '../../core/base/clock';
import { createSignal } from '../../core/base/signal';
import type { ProviderId } from '../providers/defaults';
import { PROVIDER_SIGN_INS } from '../providers/sign-in';
import { newPkcePair, randomToken } from '../../platform/remote/pkce';
import { useAgentConnection } from './store';
import { openSignInWindow, signInReturnUrl, type SignInResult } from '../../platform/remote/sign-in-window';

/** The key a round returned, or how it ended without one. */
export type SignInOutcome =
  | { readonly key: string }
  | { readonly failed: Exclude<SignInResult['outcome'], 'code'> };

/** How long a round waits for the user to finish on the provider's page, in ms. */
const ROUND_LIMIT_MS = 10 * 60 * 1000;

async function signInWithProvider(id: ProviderId, signal: AbortSignal): Promise<SignInOutcome> {
  const flow = PROVIDER_SIGN_INS[id];
  if (!flow) return { failed: 'failed' };
  const state = randomToken(16);
  const pair = newPkcePair();
  const address = pair.then(({ challenge }) => flow.authorizeUrl({ returnUrl: signInReturnUrl(), challenge, state }, fetch));
  const result = await openSignInWindow(address, state, ROUND_LIMIT_MS, signal);
  if (result.outcome !== 'code') return { failed: result.outcome };
  try {
    return { key: await flow.exchange(result.code, (await pair).verifier, fetch) };
  } catch {
    return { failed: 'failed' };
  }
}

/** A sign-in with `provider`: waiting on its page, or ended with no window, no consent or no key. */
interface SignInStanding {
  provider: ProviderId;
  standing: 'waiting' | 'blocked' | 'denied' | 'failed';
}

let runRound: (id: ProviderId, signal: AbortSignal) => Promise<SignInOutcome> = signInWithProvider;
let standing: SignInStanding | null = null;
/** The round under way; a newer round or a cancel aborts it, and a late answer of it is dropped. */
let round: AbortController | null = null;
const published = createSignal();
const say = (next: SignInStanding | null): void => { standing = next; published.emit(); };

/**
 * The page's one sign-in: at most one round at a time, held here and not by a screen, so a round
 * outlives the panel closing and the screen that started it. Its key is filed under its provider
 * exactly as a pasted and checked key is, with no provider pin and no screen opened: the connection
 * store says what the panel shows next, as it does for every other key.
 */
export const signIn = {
  get: (): SignInStanding | null => standing,
  subscribe: (listener: () => void): (() => void) => published.subscribe(listener),
  /** Starts a round with `id`; call it inside the press, since the provider's window opens there. */
  start(id: ProviderId): void {
    round?.abort();
    const mine = new AbortController();
    round = mine;
    const outcome = runRound(id, mine.signal);
    say({ provider: id, standing: 'waiting' });
    void outcome.then((ended) => {
      if (round !== mine) return;
      round = null;
      if ('key' in ended) {
        useAgentConnection.getState().connectSignedIn(id, ended.key, wallClock());
        say(null);
        return;
      }
      say(ended.failed === 'cancelled' || ended.failed === 'timeout' ? null : { provider: id, standing: ended.failed });
    });
  },
  /** Ends the round under way, or clears the last one's ending. */
  cancel(): void {
    round?.abort();
    round = null;
    if (standing !== null) say(null);
  },
  /** Clears the ending of a round that returned no key, once a surface has said it; an ending stands
   *  until then, and a round under way is left alone. */
  acknowledge(): void {
    if (standing !== null && standing.standing !== 'waiting') say(null);
  },
};

/** Replaces how a round runs, and ends any round standing; null restores the provider's own page. */
export function __setSignInRound(run: ((id: ProviderId, signal: AbortSignal) => Promise<SignInOutcome>) | null): void {
  signIn.cancel();
  runRound = run ?? signInWithProvider;
}
