// @vitest-environment jsdom
/**
 * The responsibilities notice before a download. jsdom lays nothing out, so the notice's scroller
 * is given the sizes a short window would give it.
 */
import { afterEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useEffect } from 'react';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useExportNotice } from '../../../ui/chrome/modals/export/review/ExportNotice';
import { setStoreState } from '../../_support/store';

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Asks for the notice once and reports the decision. */
function Asking({ onDecision }: { onDecision: (accepted: boolean) => void }) {
  const { request, notice } = useExportNotice(true, 0, null);
  useEffect(() => { void request().then(onDecision); }, [request, onDecision]);
  return notice;
}

/** Gives the notice's scroller a 200 px view of 600 px of text, scrolled to `top`. */
function layOut(region: HTMLElement, top: number): void {
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: 200 });
  Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 600 });
  region.scrollTop = top;
  region.dispatchEvent(new Event('scroll'));
}

describe('the export notice', () => {
  spec('FILE-31', 'confirms only after its reading time and once scrolled to its end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    setStoreState({ locale: 'en' });
    const onDecision = vi.fn();
    render(<MotionConfig reducedMotion="always"><I18nProvider><Asking onDecision={onDecision} /></I18nProvider></MotionConfig>);
    const region = await act(async () => screen.getByRole('region', { name: 'Before you export' }));
    const confirm = () => screen.getAllByRole('button').at(-1)!;

    act(() => layOut(region, 0));
    act(() => { vi.advanceTimersByTime(8000); });
    expect(confirm()).toHaveProperty('disabled', true);

    act(() => layOut(region, 400));
    expect(confirm()).toHaveProperty('disabled', false);
    await act(async () => { confirm().click(); });
    expect(onDecision).toHaveBeenCalledWith(true);
  });
});
