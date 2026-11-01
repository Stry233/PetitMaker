// @vitest-environment jsdom
/**
 * Help in a window too narrow for two columns shows its page list and its pages as two screens.
 * jsdom has no layout, so the Help body (the element carrying `data-columns`) reports the width a
 * test gives it; every other element keeps jsdom's 0.
 */
import { MotionConfig } from 'framer-motion';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { HelpModal } from '../../../ui/help/HelpModal';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';
import type { TextKey } from '../../../i18n/keys';

const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;

function bodyWidth(px: number): void {
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get(this: Element) { return this.hasAttribute('data-columns') ? px : clientWidth.get!.call(this) as number; },
  });
}

beforeEach(() => {
  setStoreState({ gridState: makeState(20, 20), locale: 'en', helpTarget: null });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(Element.prototype, 'clientWidth', clientWidth);
});

const en = (key: TextKey): string => translateFor('en', key);
const NARROW = 360;
const WIDE = 1000;

function mountHelp(width: number, onClose: () => void = () => {}) {
  bodyWidth(width);
  const view = render(<MotionConfig reducedMotion="always"><I18nProvider><HelpModal open onClose={onClose} /></I18nProvider></MotionConfig>);
  return { ...view, dialog: screen.getByRole('dialog', { name: en('modal.help_title') }) };
}

const catalog = (dialog: HTMLElement) => within(dialog).queryByRole('navigation', { name: en('modal.help_title') });
const back = (dialog: HTMLElement) => within(dialog).queryByRole('button', { name: en('help.back_to_pages') });
const pageTitle = (dialog: HTMLElement) => dialog.querySelector('article h2')?.textContent ?? null;

describe('Help in limited space', () => {
  spec('UI-36', 'a narrow Help opens on the page list alone, with no Back', async () => {
    const { dialog } = mountHelp(NARROW);
    expect(catalog(dialog)).toBeTruthy();
    await waitFor(() => expect(dialog.querySelector('article')).toBeNull());
    expect(back(dialog)).toBeNull();
  });

  spec('UI-36', 'choosing a page shows its text alone, and Back returns to the list with the page still chosen', async () => {
    const { dialog } = mountHelp(NARROW);
    const row = within(catalog(dialog)!).getByRole('button', { name: en('help.camera.title') });
    row.focus();
    fireEvent.click(row);
    await waitFor(() => expect(pageTitle(dialog)).toBeTruthy());
    expect(catalog(dialog)).toBeNull();
    const backButton = back(dialog)!;
    expect(document.activeElement).toBe(backButton);

    fireEvent.click(backButton);
    await waitFor(() => expect(catalog(dialog)).toBeTruthy());
    expect(dialog.querySelector('article')).toBeNull();
    const current = within(catalog(dialog)!).getByRole('button', { current: true });
    expect(current.textContent).toBe(en('help.camera.title'));
    expect(document.activeElement).toBe(current);
  });

  spec('UI-36', 'Help opened at a page from elsewhere lands on that page\'s text, and Back leads to the list', async () => {
    setStoreState({ helpTarget: { page: 'camera' } });
    const { dialog } = mountHelp(NARROW);
    await waitFor(() => expect(pageTitle(dialog)).toBeTruthy());
    expect(catalog(dialog)).toBeNull();
    fireEvent.click(back(dialog)!);
    await waitFor(() => expect(catalog(dialog)).toBeTruthy());
  });

  spec('UI-36', 'a search result lands on its page\'s text', async () => {
    const { dialog } = mountHelp(NARROW);
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'camera' } });
    const results = await screen.findByRole('menu', { name: en('help.search_placeholder') });
    fireEvent.click(within(results).getAllByRole('menuitemradio')[0]!);
    await waitFor(() => expect(pageTitle(dialog)).toBeTruthy());
    expect(catalog(dialog)).toBeNull();
    expect(back(dialog)).toBeTruthy();
  });

  spec('UI-36', 'Escape on a page closes Help rather than going back', async () => {
    const onClose = vi.fn();
    setStoreState({ helpTarget: { page: 'camera' } });
    const { dialog } = mountHelp(NARROW, onClose);
    await waitFor(() => expect(pageTitle(dialog)).toBeTruthy());
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  spec('UI-36', 'each opening of a narrow Help starts on the list', async () => {
    const { dialog, rerender } = mountHelp(NARROW);
    fireEvent.click(within(catalog(dialog)!).getByRole('button', { name: en('help.camera.title') }));
    await waitFor(() => expect(pageTitle(dialog)).toBeTruthy());
    const tree = (open: boolean) => <MotionConfig reducedMotion="always"><I18nProvider><HelpModal open={open} onClose={() => {}} /></I18nProvider></MotionConfig>;
    rerender(tree(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(tree(true));
    const again = screen.getByRole('dialog', { name: en('modal.help_title') });
    await waitFor(() => expect(catalog(again)).toBeTruthy());
    expect(again.querySelector('article')).toBeNull();
  });

  spec('UI-36', 'a wide Help keeps the page list beside the text, with no Back', async () => {
    const { dialog } = mountHelp(WIDE);
    await waitFor(() => expect(pageTitle(dialog)).toBeTruthy());
    expect(catalog(dialog)).toBeTruthy();
    fireEvent.click(within(catalog(dialog)!).getByRole('button', { name: en('help.camera.title') }));
    await waitFor(() => expect(pageTitle(dialog)).not.toBe(en('help.welcome.title')));
    expect(catalog(dialog)).toBeTruthy();
    expect(back(dialog)).toBeNull();
    act(() => useEditorStore.getState().setHelpTarget({ page: 'settings' }));
    await waitFor(() => expect(catalog(dialog)).toBeTruthy());
  });

  spec('UI-36', 'with motion on, a reopen shows the list at its first frame, with no screen leaving', async () => {
    bodyWidth(NARROW);
    const tree = (open: boolean) => <MotionConfig reducedMotion="never"><I18nProvider><HelpModal open={open} onClose={() => {}} /></I18nProvider></MotionConfig>;
    const { rerender } = render(tree(true));
    const dialog = screen.getByRole('dialog', { name: en('modal.help_title') });
    fireEvent.click(within(catalog(dialog)!).getByRole('button', { name: en('help.camera.title') }));
    await waitFor(() => expect(catalog(dialog)).toBeNull());
    rerender(tree(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(tree(true));
    const again = screen.getByRole('dialog', { name: en('modal.help_title') });
    const list = catalog(again)!;
    expect(list).toBeTruthy();
    expect(again.querySelector('article')).toBeNull();
    expect(again.querySelector('[data-leaving]')).toBeNull();
  });
});
