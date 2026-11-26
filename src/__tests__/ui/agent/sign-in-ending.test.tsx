// @vitest-environment jsdom
/**
 * A sign-in asked for from an error card runs over a held key, where no screen shows how it ended;
 * the user must still hear that it returned no key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { __setSignInRound, signIn, type SignInOutcome } from '../../../agent/connection/sign-in-round';
import { I18nProvider } from '../../../i18n/context';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { useSignInEnding } from '../../../ui/agent/hooks/use-sign-in-ending';
import { translations } from '../../_support/locale-tables';

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

/** Runs one round that ends as `outcome` under a hook mounted as `connected`, and returns the toasts. */
async function toastsAfter(outcome: SignInOutcome, connected: boolean): Promise<string[]> {
  const said: string[] = [];
  const restore = setToastPresenter((text) => { said.push(text); });
  __setSignInRound(() => Promise.resolve(outcome));
  renderHook(() => { useSignInEnding(connected); }, { wrapper });
  await act(async () => { signIn.start('openrouter'); await Promise.resolve(); await Promise.resolve(); });
  restore();
  return said;
}

afterEach(() => { cleanup(); __setSignInRound(null); });

describe('a sign-in over a held key that returns no key', () => {
  it('says the window was blocked and leaves no round standing', async () => {
    expect(await toastsAfter({ failed: 'blocked' }, true)).toEqual([translations.en['agent.setup_sign_in_blocked']]);
    expect(signIn.get()).toBeNull();
  });

  it('stays silent when the user closed the round themselves', async () => {
    expect(await toastsAfter({ failed: 'cancelled' }, true)).toEqual([]);
  });

  it('leaves the ending to the not-connected screen when no key is held', async () => {
    expect(await toastsAfter({ failed: 'denied' }, false)).toEqual([]);
    expect(signIn.get()).toEqual({ provider: 'openrouter', standing: 'denied' });
  });
});
