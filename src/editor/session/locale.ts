// The interface language switch: it takes effect once the locale's strings have arrived, so no
// surface draws a mixed frame.
import type { Locale } from '../../core/model/locale';
import { translate } from '../../i18n/context';
import { loadLocale, localeLoaded } from '../../i18n/translations';
import { showToast } from '../../platform/channels/toast-bus';
import { useEditorStore } from '../../state/store';

/** Switches the interface to `code`, loading its strings first; a failed load says so and keeps the current language. */
export function switchLocale(code: Locale): void {
  const { setLocale } = useEditorStore.getState();
  if (localeLoaded(code)) { setLocale(code); return; }
  loadLocale(code).then(() => useEditorStore.getState().setLocale(code), () => showToast(translate('boot.chunk_failed'), 'error'));
}
