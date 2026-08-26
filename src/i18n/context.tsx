import { createContext, useContext, useCallback, useEffect, type ReactNode } from 'react';
import { translations } from './translations';
import { useEditorStore } from '../state/store';
import { brandName } from '../version';
import type { Locale, LocalizedName } from '../core/model/types';

type TFunction = (key: string, params?: Record<string, string | number>) => string;

/** Resolve a content name for the active locale, falling back to English. */
export function localizedName(name: LocalizedName, locale: Locale): string {
  return name[locale] ?? name.en;
}

const I18nContext = createContext<TFunction>((key) => key);

/** Resolve a key for a specific locale (falling back to English) + interpolate `{name}` params.
 *  The `{app}` token is always resolved from the central brand name (see version.ts), so no
 *  translation string ever hardcodes the project name. */
export function translateFor(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = translations[locale]?.[key] ?? translations['en'][key] ?? key;
  text = text.split('{app}').join(brandName(locale));
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, String(v));
  }
  return text;
}

/** Hook-free translate for imperative code outside the provider (e.g. toasts in event
 *  handlers). Reads the active locale from the store, like other imperative store access. */
export function translate(key: string, params?: Record<string, string | number>): string {
  return translateFor(useEditorStore.getState().locale, key, params);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useEditorStore((s) => s.locale);
  const t: TFunction = useCallback((key, params) => translateFor(locale, key, params), [locale]);
  // Keep the browser-tab title in sync with the (single-sourced) brand + tagline.
  useEffect(() => {
    document.title = `${translateFor(locale, 'app.name')} - ${translateFor(locale, 'app.tagline')}`;
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): TFunction {
  return useContext(I18nContext);
}
