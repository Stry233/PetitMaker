import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/context';
import { ensureHelpStrings } from '../../../i18n/locales/help';
import { PageView } from '../../../ui/chrome/modals/help/PageView';
import { HELP_PAGES } from '../../../ui/chrome/modals/help/catalog';
import { FigureReadyContext } from '../../../ui/chrome/modals/help/figures/figure-ready';
import { useInView } from '../../../ui/chrome/modals/help/figures/use-in-view';
import { makeState } from '../../rules/_helpers';
import { setStoreState } from '../../_store';

const { generate, thumbnail } = vi.hoisted(() => ({ generate: vi.fn(), thumbnail: vi.fn(async () => null) }));
vi.mock('../../../tools/generation/designer/pipeline', () => ({ generateDesigned: generate }));
vi.mock('../../../canvas/thumbnail', async (original) => ({
  ...(await original<typeof import('../../../canvas/thumbnail')>()), renderThumbnail: thumbnail,
}));

const observers = new Set<Observer>();
class Observer {
  elements = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback) { observers.add(this); }
  observe(el: Element) { this.elements.add(el); }
  disconnect() { observers.delete(this); }
}

function approach(el: Element) {
  act(() => {
    for (const observer of [...observers]) {
      if (observer.elements.has(el)) observer.callback([{ target: el, isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('IntersectionObserver', Observer);
  setStoreState({ gridState: makeState(20, 20), locale: 'en' });
  ensureHelpStrings();
});
afterEach(() => {
  cleanup();
  observers.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const go = () => {};
function Welcome({ entered }: { entered: boolean }) {
  return <I18nProvider><FigureReadyContext.Provider value={entered}><PageView page={HELP_PAGES.welcome} onGo={go} /></FigureReadyContext.Provider></I18nProvider>;
}

describe('Help illustration work', () => {
  it('keeps unseen generation and map captures idle while preserving the article and figure dimensions', async () => {
    const { container, rerender } = render(<Welcome entered={false} />);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    const figures = container.querySelectorAll('figure');
    const checklist = figures[1]!;
    const save = figures[3]!;
    const height = (checklist.firstElementChild as HTMLElement).style.height;
    expect(container.querySelector('h2')?.textContent).toBeTruthy();
    expect(height).toBe('430px');
    expect(observers.size).toBe(0);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(generate).not.toHaveBeenCalled();
    expect(thumbnail).not.toHaveBeenCalled();

    rerender(<Welcome entered />);
    approach(figures[0]!);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(generate).not.toHaveBeenCalled();
    expect(thumbnail).not.toHaveBeenCalled();
    expect(save.querySelector('[data-testid="restore-card"]')).toBeNull();

    approach(checklist);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(generate).toHaveBeenCalledTimes(1);
    expect((checklist.firstElementChild as HTMLElement).style.height).toBe(height);
    expect(thumbnail).not.toHaveBeenCalled();

    approach(save);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(save.querySelector('[data-testid="restore-card"]')).toBeTruthy();
    expect(thumbnail).toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('cancels scheduled illustration work when the page leaves before it starts', async () => {
    const { container, unmount } = render(<Welcome entered />);
    approach(container.querySelector('#help-welcome-resume')!.closest('section')!.querySelector('figure')!);
    unmount();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(generate).not.toHaveBeenCalled();
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('keeps an admitted figure present during the modal exit', () => {
    function Figure() {
      const ref = useRef<HTMLDivElement>(null);
      const ready = useInView(ref);
      return <div ref={ref} data-ready={ready} />;
    }
    const { container, rerender } = render(<FigureReadyContext.Provider value><Figure /></FigureReadyContext.Provider>);
    approach(container.firstElementChild!);
    expect(container.firstElementChild?.getAttribute('data-ready')).toBe('true');
    rerender(<FigureReadyContext.Provider value={false}><Figure /></FigureReadyContext.Provider>);
    expect(container.firstElementChild?.getAttribute('data-ready')).toBe('true');
  });
});
