/**
 * Switching language fetches that language's table before committing the preference. Two rules are
 * covered here: the LATEST choice wins even when an earlier fetch lands afterwards, and a failure
 * keeps the language the reader is in while saying so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';

const { ensureLocaleStrings, showToast } = vi.hoisted(() => ({
  ensureLocaleStrings: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('../../../i18n/locales', () => ({ ensureLocaleStrings: (locale: string) => ensureLocaleStrings(locale) }));
vi.mock('../../../core/runtime/toast-bus', () => ({ showToast: (text: string, type: string) => showToast(text, type) }));

const { useLocaleSwitch } = await import('../../../ui/shell/windows/use-locale-switch');

/** A promise this test settles when it chooses, so a fetch can be held open across a later choice. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  ensureLocaleStrings.mockReset();
  showToast.mockReset();
  useEditorStore.setState({ locale: 'en' });
});

describe('useLocaleSwitch', () => {
  it('commits the language whose table arrived', async () => {
    ensureLocaleStrings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLocaleSwitch());
    await act(async () => { await result.current('fr'); });
    expect(useEditorStore.getState().locale).toBe('fr');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('lets the latest choice win when an earlier fetch lands afterwards', async () => {
    const first = deferred();
    ensureLocaleStrings.mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useLocaleSwitch());

    const earlier = result.current('ja');           // held open, ticket 1
    await act(async () => { await result.current('fr'); });
    expect(useEditorStore.getState().locale).toBe('fr');

    // The earlier fetch lands late: it must not take the interface back to a language already left.
    first.resolve();
    await act(async () => { await earlier; });
    expect(useEditorStore.getState().locale).toBe('fr');
  });

  it('keeps the language the reader is in, and says so, when the fetch fails', async () => {
    ensureLocaleStrings.mockRejectedValue(new Error('chunk failed'));
    const { result } = renderHook(() => useLocaleSwitch());
    await act(async () => { await result.current('ru'); });
    expect(useEditorStore.getState().locale).toBe('en');
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('does not report a failure a later choice has already superseded', async () => {
    const failing = deferred();
    ensureLocaleStrings.mockReturnValueOnce(failing.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useLocaleSwitch());

    const earlier = result.current('ru');
    await act(async () => { await result.current('fr'); });

    failing.resolve();
    await act(async () => { await earlier; });
    expect(useEditorStore.getState().locale).toBe('fr');
    expect(showToast).not.toHaveBeenCalled();
  });
});
