import { describe, it, expect, vi } from 'vitest';

/** A fresh registry, without the tables the test setup registers. */
async function freshRegistry() {
  vi.resetModules();
  return import('../../i18n/translations');
}

describe('the locale tables', () => {
  it('hold English from the start and another locale once it is loaded', async () => {
    const registry = await freshRegistry();
    expect(registry.localeLoaded('en')).toBe(true);
    expect(registry.localeLoaded('ru')).toBe(false);
    const before = registry.localeTablesVersion();
    const heard = vi.fn();
    const stop = registry.onLocaleTables(heard);
    await registry.loadLocale('ru');
    stop();
    expect(registry.localeLoaded('ru')).toBe(true);
    expect(registry.translations.ru?.['delete.confirm_btn']).toBeTruthy();
    expect(registry.localeTablesVersion()).toBe(before + 1);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('load each locale once however often it is asked for', async () => {
    const registry = await freshRegistry();
    const first = registry.loadLocale('fr');
    expect(registry.loadLocale('fr')).toBe(first);
    await first;
    const version = registry.localeTablesVersion();
    await registry.loadLocale('fr');
    expect(registry.localeTablesVersion()).toBe(version);
  });

  it('bring every locale in for a reader that offers them all', async () => {
    const registry = await freshRegistry();
    await registry.loadAllLocales();
    expect((['zh', 'ja', 'ru', 'th', 'id', 'fr'] as const).every(registry.localeLoaded)).toBe(true);
  });
});
