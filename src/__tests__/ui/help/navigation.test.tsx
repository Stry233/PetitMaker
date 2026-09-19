import { StrictMode } from 'react';
import { MotionConfig } from 'framer-motion';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { HelpModal } from '../../../ui/chrome/modals/help/HelpModal';
import { makeState } from '../../rules/_helpers';
import { setStoreState } from '../../_store';

const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  setStoreState({ gridState: makeState(20, 20), locale: 'en', helpTarget: { page: 'frame' } });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this.id);
    let host = this.parentElement;
    while (host && host.style.overflowY !== 'auto') host = host.parentElement;
    if (host) host.scrollTop = 123;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const close = () => {};
function Help({ open }: { open: boolean }) {
  return <StrictMode><MotionConfig reducedMotion="always"><I18nProvider><HelpModal open={open} onClose={close} /></I18nProvider></MotionConfig></StrictMode>;
}

describe('Help section navigation', () => {
  it('waits for the destination article and preserves its anchor through development effect replay', async () => {
    const { container, rerender } = render(<Help open />);
    await waitFor(() => expect(container.querySelector('article h2')?.textContent).toContain('interface'));
    rerender(<Help open={false} />);
    await waitFor(() => expect(container.querySelector('article')).toBeNull());
    act(() => useEditorStore.getState().setHelpTarget({ page: 'welcome', anchor: 'welcome-resume' }));
    rerender(<Help open />);
    await waitFor(() => expect(scrolled).toContain('help-welcome-resume'));
    const article = container.querySelector('article')!;
    expect(article.parentElement?.parentElement?.scrollTop).toBe(123);

    scrolled.length = 0;
    act(() => useEditorStore.getState().setHelpTarget({ page: 'welcome', anchor: 'welcome-help' }));
    await waitFor(() => expect(scrolled).toContain('help-welcome-help'));
    await waitFor(() => expect(container.querySelector('#help-welcome-help')?.closest('section')?.textContent).toContain('What’s this?'));
    expect(article.parentElement?.parentElement?.scrollTop).toBe(123);
  });
});
