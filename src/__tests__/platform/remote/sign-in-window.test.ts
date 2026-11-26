// @vitest-environment jsdom
/** A sign-in window settles on the return page's answer for its own round, its time limit or an abort. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_CHANNEL, openSignInWindow, signInReturnUrl, type SignInAnswer } from '../../../platform/remote/sign-in-window';

const opened = { location: { href: 'about:blank' }, close: vi.fn() };
const post = (answer: SignInAnswer): void => {
  const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
  channel.postMessage(answer);
  channel.close();
};
const ADDRESS = Promise.resolve('https://provider.test/auth');

beforeEach(() => {
  opened.location.href = 'about:blank';
  opened.close.mockClear();
  vi.spyOn(window, 'open').mockImplementation(() => opened as unknown as Window);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('openSignInWindow', () => {
  it('returns to the connect folder under the app base address', () => {
    expect(signInReturnUrl('https://example.test', '/')).toBe('https://example.test/connect/');
    expect(signInReturnUrl('https://example.test', '/Sub/')).toBe('https://example.test/Sub/connect/');
  });

  it('opens a window inside the press and sends it to the address once that is known', async () => {
    const result = openSignInWindow(ADDRESS, 'round-0', 60_000);
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank', expect.any(String));
    await ADDRESS;
    await Promise.resolve();
    expect(opened.location.href).toBe('https://provider.test/auth');
    post({ state: 'round-0', code: 'c' });
    await result;
  });

  it('settles with the code the return page posts for this round', async () => {
    const result = openSignInWindow(ADDRESS, 'round-1', 60_000);
    post({ state: 'another-round', code: 'not-mine' });
    post({ state: 'round-1', code: 'mine' });
    await expect(result).resolves.toEqual({ outcome: 'code', code: 'mine' });
  });

  it('reads an answer without a code as the provider declining, and shuts the window', async () => {
    const result = openSignInWindow(ADDRESS, 'round-2', 60_000);
    post({ state: 'round-2', error: 'access_denied' });
    await expect(result).resolves.toEqual({ outcome: 'denied' });
    expect(opened.close).toHaveBeenCalled();
  });

  it('says so when the browser opens no window', async () => {
    vi.mocked(window.open).mockReturnValue(null);
    await expect(openSignInWindow(ADDRESS, 'round-3', 60_000)).resolves.toEqual({ outcome: 'blocked' });
  });

  it('fails when the sign-in address cannot be made', async () => {
    await expect(openSignInWindow(Promise.reject(new Error('no address')), 'round-4', 60_000)).resolves.toEqual({ outcome: 'failed' });
    expect(opened.close).toHaveBeenCalled();
  });

  it('ends when the caller aborts it, and past its time limit', async () => {
    const abort = new AbortController();
    const cancelled = openSignInWindow(ADDRESS, 'round-5', 60_000, abort.signal);
    abort.abort();
    await expect(cancelled).resolves.toEqual({ outcome: 'cancelled' });

    vi.useFakeTimers();
    const slow = openSignInWindow(ADDRESS, 'round-6', 5_000);
    await vi.advanceTimersByTimeAsync(5_100);
    await expect(slow).resolves.toEqual({ outcome: 'timeout' });
  });
});
