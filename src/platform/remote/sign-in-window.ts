/**
 * A provider's sign-in page opened in a window of its own, and the answer its return hands back.
 *
 * The page's `Cross-Origin-Opener-Policy: same-origin` cuts the opener link once the window visits
 * another origin: the handle then reads as closed and takes no messages. So the return page
 * (`public/connect/index.html`) answers on a same-origin `BroadcastChannel`, and a round ends on
 * that answer, on its time limit or when the caller aborts it, never on the handle.
 */

/** The channel `public/connect-return.js` posts on. */
export const SIGN_IN_CHANNEL = 'petit-sign-in';

/** What the return page posts: the round's `state` with the provider's code, or with its refusal. */
export interface SignInAnswer {
  readonly state: string;
  readonly code?: string;
  readonly error?: string;
}

export type SignInResult =
  | { readonly outcome: 'code'; readonly code: string }
  /** `blocked`: the browser opened no window. `denied`: the provider returned no code. `failed`: the
   *  sign-in address could not be made. `cancelled`: the caller aborted the round. */
  | { readonly outcome: 'blocked' | 'denied' | 'failed' | 'timeout' | 'cancelled' };

/** The address a provider returns the user to: the `connect/` folder under the app's base address. */
export function signInReturnUrl(origin: string = window.location.origin, base: string = import.meta.env.BASE_URL): string {
  return `${origin}${base.endsWith('/') ? base : `${base}/`}connect/`;
}

const WINDOW_FEATURES = 'popup,width=520,height=720';

/**
 * Opens a window at once, since a browser lets a page open one only inside the press that asked for
 * it, sends it to `url` when that settles, and resolves once the return page answers for `state`,
 * `timeoutMs` passes or `signal` aborts. Answers for another state are ignored, so two rounds never
 * cross.
 */
export function openSignInWindow(url: Promise<string>, state: string, timeoutMs: number, signal?: AbortSignal): Promise<SignInResult> {
  const opened = window.open('about:blank', '_blank', WINDOW_FEATURES);
  if (!opened) return Promise.resolve({ outcome: 'blocked' });
  return new Promise<SignInResult>((resolve) => {
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    let settled = false;
    const settle = (result: SignInResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      signal?.removeEventListener('abort', onAbort);
      channel.close();
      // A window still on this origin can be shut; one that left it no longer answers to this page.
      if (result.outcome !== 'code') { try { opened.close(); } catch { /* the handle is cut */ } }
      resolve(result);
    };
    const onAbort = (): void => settle({ outcome: 'cancelled' });
    channel.onmessage = (event: MessageEvent<SignInAnswer>) => {
      const answer = event.data;
      if (!answer || answer.state !== state) return;
      settle(typeof answer.code === 'string' && answer.code !== '' ? { outcome: 'code', code: answer.code } : { outcome: 'denied' });
    };
    const limit = setTimeout(() => settle({ outcome: 'timeout' }), timeoutMs);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort);
    url.then(
      (address) => { if (!settled) opened.location.href = address; },
      () => settle({ outcome: 'failed' }),
    );
  });
}
