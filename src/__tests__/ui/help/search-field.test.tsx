// @vitest-environment jsdom
/** The Help search field: Enter opens the first hit only once an IME composition has finished. */
import { MotionConfig } from 'framer-motion';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { HelpModal } from '../../../ui/help/HelpModal';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';

beforeEach(() => {
  setStoreState({ gridState: makeState(20, 20), locale: 'en', helpTarget: { page: 'frame' } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const help = () => render(<MotionConfig reducedMotion="always"><I18nProvider><HelpModal open onClose={() => {}} /></I18nProvider></MotionConfig>);
const heading = (container: HTMLElement) => container.querySelector('article h2')?.textContent ?? '';

describe('Help search field', () => {
  it('keeps the search while Enter commits an IME composition, and opens the first hit after', async () => {
    const { baseElement } = help();
    await waitFor(() => expect(heading(baseElement)).not.toBe(''));
    const field = screen.getByRole('searchbox') as HTMLInputElement;
    const results = translateFor('en', 'help.search_placeholder');
    fireEvent.change(field, { target: { value: 'camera' } });
    await screen.findByRole('menu', { name: results });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(field.value, 'the composition Enter opened a page').toBe('camera');
    expect(screen.getByRole('menu', { name: results })).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe('');
    await waitFor(() => expect(screen.queryByRole('menu', { name: results })).toBeNull());
  });
});
