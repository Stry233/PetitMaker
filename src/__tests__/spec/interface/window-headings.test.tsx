// @vitest-environment jsdom
/**
 * Every open window carries one title heading that names it. jsdom has no layout, so Help's body (the
 * element carrying `data-columns`) reports the width a test gives it, which picks one or two columns.
 */
import { MotionConfig } from 'framer-motion';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { I18nProvider, translateFor } from '../../../i18n/context';
import type { TextKey } from '../../../i18n/keys';
import { useEditorStore } from '../../../state/store';
import type { InputMode } from '../../../platform/device/input-mode';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { SettingsModal } from '../../../ui/chrome/modals/settings/SettingsModal';
import { ShareWindow } from '../../../ui/chrome/modals/export/ShareWindow';
import { ImportModal } from '../../../ui/chrome/modals/import/ImportModal';
import { StylizeWindow } from '../../../ui/chrome/modals/export/stylize/StylizeWindow';
import { HelpModal } from '../../../ui/help/HelpModal';

const en = (key: TextKey): string => translateFor('en', key);
const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;

function helpBodyWidth(px: number): void {
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
  act(() => { for (const id of ['share', 'stylize'] as const) useEditorStore.getState().setModal(id, false); });
  vi.unstubAllGlobals();
  Object.defineProperty(Element.prototype, 'clientWidth', clientWidth);
});

function mount(node: ReactNode, inputMode: InputMode = 'pc') {
  return render(<MotionConfig reducedMotion="always"><I18nProvider><InputModeProvider inputMode={inputMode}>{node}</InputModeProvider></I18nProvider></MotionConfig>);
}

/** A dialog's title headings: those at level 1 or 2, under which its sections stand. */
const titleHeadings = (dialog: HTMLElement) => within(dialog).queryAllByRole('heading')
  .filter((h) => h.tagName === 'H1' || h.tagName === 'H2');

/** The one title heading inside the dialog named `name`, failing on none or several. */
function titleHeading(name: string): HTMLElement {
  const headings = titleHeadings(screen.getByRole('dialog', { name }));
  expect(headings.map((h) => h.textContent)).toHaveLength(1);
  return headings[0]!;
}

describe('window title headings', () => {
  const windows: [string, () => ReactNode, TextKey][] = [
    ['Save and share', () => <ShareWindow open />, 'share.title'],
    ['Import', () => <ImportModal open onClose={() => {}} />, 'import.title'],
    ['Settings', () => <SettingsModal open onClose={() => {}} />, 'modal.settings_title'],
  ];
  for (const [label, node, key] of windows) {
    spec('UI-66', `${label} shows its title as the window's one heading`, () => {
      mount(node());
      expect(titleHeading(en(key)).textContent).toBe(en(key));
    });
  }

  spec('UI-66', 'a window is named by its title heading', () => {
    act(() => useEditorStore.getState().setModal('stylize', true));
    mount(<StylizeWindow />);
    const heading = titleHeading(en('stylize.win_title'));
    expect(screen.getByRole('dialog', { name: en('stylize.win_title') }).getAttribute('aria-labelledby')).toBe(heading.id);
  });

  spec('UI-66', 'Help in one column titles its page list, and a page shown by its own title', async () => {
    helpBodyWidth(360);
    mount(<HelpModal open onClose={() => {}} />, 'touch');
    expect(titleHeading(en('modal.help_title')).textContent).toBe(en('modal.help_title'));

    cleanup();
    setStoreState({ helpTarget: { page: 'camera' } });
    mount(<HelpModal open onClose={() => {}} />, 'touch');
    await waitFor(() => expect(titleHeading(en('modal.help_title')).textContent).toBe(en('help.camera.title')));
  });

  spec('UI-66', 'Help in two columns has the shown page\'s title as its one heading', async () => {
    helpBodyWidth(1000);
    mount(<HelpModal open onClose={() => {}} />);
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: en('modal.help_title') })).getByRole('article')).toBeTruthy());
    expect(titleHeading(en('modal.help_title')).closest('article')).toBeTruthy();
  });
});
