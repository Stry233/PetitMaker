/**
 * A locale's interface table is its own chunk (`i18n/locales/index.ts`). These cover what happens
 * around that arrival: it reaches a tree that already rendered, an interface key outranks a window's
 * own prose, a chunk is fetched once however many callers ask, and a chunk that failed is retried by
 * the next call rather than remembered as broken.
 *
 * Every case uses a key no shipped table carries, so the installed tables (vitest.setup.ts) cannot
 * answer for the layer under test.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { I18nProvider, registerBaseStrings, registerExtraStrings, translateFor, useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';

const chunk = vi.hoisted(() => ({ attempts: 0 }));
vi.mock('../../i18n/locales/id', () => {
  chunk.attempts += 1;
  if (chunk.attempts === 1) throw new Error('chunk failed to load');
  return { id: { 'probe.retried': 'Berjaya selepas cuba semula' } };
});

const { ensureLocaleStrings } = await import('../../i18n/locales');

function Probe() {
  const t = useT();
  return <span data-testid="probe">{t('probe.late')}</span>;
}

describe('a table that arrives after the first frame', () => {
  it('reaches the tree that already rendered with the fallback', () => {
    useEditorStore.setState({ locale: 'fr' });
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('probe.late');
    act(() => { registerBaseStrings({ fr: { 'probe.late': 'tardif' } }); });
    expect(screen.getByTestId('probe').textContent).toBe('tardif');
  });
});

describe('the two late-arriving layers', () => {
  it('keeps the interface wording when a window registers the same key', () => {
    registerBaseStrings({ ru: { 'probe.shared': 'интерфейс' } });
    registerExtraStrings({ ru: { 'probe.shared': 'справка' } });
    expect(translateFor('ru', 'probe.shared')).toBe('интерфейс');
  });
});

describe('a chunk that fails to load', () => {
  it('is fetched again by the next call instead of being remembered as broken', async () => {
    // The mock factory's throw arrives wrapped by the runner, so the failure itself is what is
    // asserted here, not its text.
    await expect(ensureLocaleStrings('id')).rejects.toThrow();
    expect(chunk.attempts).toBe(1);

    await expect(ensureLocaleStrings('id')).resolves.toBeUndefined();
    expect(chunk.attempts).toBe(2);
    expect(translateFor('id', 'probe.retried')).toBe('Berjaya selepas cuba semula');
  });

  it('is fetched once however many callers ask for it', async () => {
    const before = chunk.attempts;
    await Promise.all([ensureLocaleStrings('id'), ensureLocaleStrings('id'), ensureLocaleStrings('id')]);
    expect(chunk.attempts).toBe(before);
  });
});
