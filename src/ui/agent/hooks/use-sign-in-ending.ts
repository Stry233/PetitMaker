/**
 * Says how a sign-in asked for over a held key ended when it returned no key. The not-connected
 * screen says this itself, so the toast speaks only while a key is held and no such screen stands.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { signIn } from '../../../agent/panel';
import { useT } from '../../../i18n/context';
import { providerName } from '../../../i18n/terms/providers';
import { showToast } from '../../../platform/channels/toast-bus';

const ENDING = {
  blocked: 'agent.setup_sign_in_blocked',
  denied: 'agent.setup_sign_in_denied',
  failed: 'agent.setup_sign_in_failed',
} as const;

export function useSignInEnding(connected: boolean): void {
  const t = useT();
  const round = useSyncExternalStore(signIn.subscribe, signIn.get);
  useEffect(() => {
    if (!connected || round === null || round.standing === 'waiting') return;
    showToast(t(ENDING[round.standing], { name: providerName(round.provider, t) }), 'warning');
    signIn.acknowledge();
  }, [connected, round, t]);
}
