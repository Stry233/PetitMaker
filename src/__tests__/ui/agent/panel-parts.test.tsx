// @vitest-environment jsdom
/** The count pill's copy: the total of steps a job took and the tail the list left showing. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CountPill } from '../../../ui/agent/parts/panel-parts';
import { I18nProvider } from '../../../i18n/context';

// `CountPill` reads `useT`, which reaches the editor store for the active locale; the store's own
// persistence writes to `localStorage`, which jsdom leaves absent here.
const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function inI18n(node: React.ReactElement) {
  return render(node, { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> });
}

describe('CountPill', () => {
  it('names the total on its own, and the tail it left showing when some rows are visible', () => {
    const all = inI18n(<CountPill total={9} />);
    expect(all.getByTestId('ops-count-pill').textContent).toBe('9 steps');
    all.unmount();
    const some = inI18n(<CountPill total={9} shown={3} />);
    expect(some.getByTestId('ops-count-pill').textContent).toBe('9 steps, last 3');
  });

  it('says only the total when the tail is the whole list', () => {
    const { getByTestId } = inI18n(<CountPill total={3} shown={3} />);
    expect(getByTestId('ops-count-pill').textContent).toBe('3 steps');
  });

  it('says one step, not one steps, at a job of exactly one', () => {
    const { getByTestId } = inI18n(<CountPill total={1} />);
    expect(getByTestId('ops-count-pill').textContent).toBe('1 step');
  });
});
