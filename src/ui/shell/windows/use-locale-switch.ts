/**
 * A language whose table is its own chunk (see i18n/locales/index.ts): fetch it, then commit the
 * preference, so the interface never switches to a language it cannot speak yet.
 *
 * The ticket makes the LATEST choice win. A switch made while an earlier fetch is still in flight is
 * the one the reader asked for last, so only it may commit the preference or report a failure — an
 * earlier fetch that resolves late must not drag the interface back to a language already left.
 *
 * A failed fetch keeps the previous language, says so, and leaves the failed chunk unremembered, so
 * the picker's next press is the retry.
 */
import { useCallback, useRef } from 'react';
import type { Locale } from '../../../core/model/types';
import { translate } from '../../../i18n/context';
import { ensureLocaleStrings } from '../../../i18n/locales';
import { showToast } from '../../../core/runtime/toast-bus';
import { useEditorStore } from '../../../state/store';

export function useLocaleSwitch(): (next: Locale) => Promise<void> {
  const setLocale = useEditorStore((s) => s.setLocale);
  const latest = useRef(0);

  return useCallback(async (next: Locale) => {
    const ticket = ++latest.current;
    try {
      await ensureLocaleStrings(next);
    } catch {
      if (ticket === latest.current) showToast(translate('modal.settings_language_failed'), 'error');
      return;
    }
    if (ticket === latest.current) setLocale(next);
  }, [setLocale]);
}
