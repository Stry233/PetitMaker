/**
 * SiteLog — the log column wears the same soft edge every scroller does (`ui/primitives/
 * scroll-fade.ts`). Its near-bottom autoscroll guard owns `onScroll` already; the fade hook binds
 * its own separate listener (see the file's own comment), so this only needs to pin that the
 * column's own scroll metrics decide the mask, same as every other site in this inventory. The
 * mask arrives and leaves over a settle loop rather than popping, so this reads it back with
 * `waitFor` against the real `requestAnimationFrame`, the idiom the shelf/panel sites established.
 */
import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { SiteLog } from '../../../ui/agent/SiteLog';
import { SCROLL_FADE } from '../../../ui/primitives/scroll-fade';
import type { OrderSlipEntry } from '../../../agent/session';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const entry = (id: number): OrderSlipEntry => ({ id, kind: 'oslip', text: `Card ${id}` });

function renderLog() {
  const logRef = createRef<HTMLDivElement>();
  const utils = render(
    <Wrapper>
      <SiteLog
        top={0}
        height={800}
        entries={[entry(1), entry(2), entry(3)]}
        hasKey
        onStarter={() => {}}
        renderEntry={(e) => <div key={e.id}>{(e as OrderSlipEntry).text}</div>}
        logRef={logRef}
        onScroll={() => {}}
      />
    </Wrapper>,
  );
  return { ...utils, logRef };
}

describe('the log column fades where it can still travel', () => {
  it('carries the mask only where scroll metrics say there is room', async () => {
    renderLog();
    const log = screen.getByTestId('sitelog');
    expect(log.style.maskImage).toBe('');

    Object.defineProperty(log, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 800, configurable: true });
    Object.defineProperty(log, 'scrollTop', { value: 300, configurable: true });
    fireEvent.scroll(log);
    await waitFor(() => {
      expect(log.style.maskImage).toContain('linear-gradient(to bottom,');
      expect(log.style.maskImage).toContain('transparent 0');
      expect(log.style.maskImage).toContain('transparent 100%');
    });

    Object.defineProperty(log, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(log, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(log);
    await waitFor(() => expect(log.style.maskImage).toBe(''));
  });

  it('still fires the caller\'s own onScroll (the near-bottom autoscroll guard) untouched', () => {
    let calls = 0;
    render(
      <Wrapper>
        <SiteLog
          top={0}
          height={800}
          entries={[entry(1)]}
          hasKey
          onStarter={() => {}}
          renderEntry={(e) => <div key={e.id}>{(e as OrderSlipEntry).text}</div>}
          logRef={createRef<HTMLDivElement>()}
          onScroll={() => { calls++; }}
        />
      </Wrapper>,
    );
    fireEvent.scroll(screen.getByTestId('sitelog'));
    expect(calls).toBe(1);
  });
});

/**
 * Before the fade this column scrolled with zero React renders: `onScroll` only wrote a ref. The
 * fade's settle loop now writes state on every settle frame, so the scroller div is split into its
 * own component (`FadingLogScroll`) receiving the entry cards as `children` — a stable element
 * reference SiteLog builds once per its OWN render, so a settle-driven re-render of the scroller
 * bails out of the card subtree instead of re-running every `renderEntry`.
 */
describe('the log column isolates entries from the fade\'s own settle re-renders', () => {
  it('does not re-render an entry card while the mask settles on scroll', async () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      return <div />;
    }
    const logRef = createRef<HTMLDivElement>();
    render(
      <Wrapper>
        <SiteLog
          top={0}
          height={800}
          entries={[entry(1), entry(2), entry(3)]}
          hasKey
          onStarter={() => {}}
          renderEntry={(e) => <Probe key={e.id} />}
          logRef={logRef}
          onScroll={() => {}}
        />
      </Wrapper>,
    );
    const log = screen.getByTestId('sitelog');
    const mounted = renders;
    expect(mounted).toBe(3);

    Object.defineProperty(log, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 800, configurable: true });
    Object.defineProperty(log, 'scrollTop', { value: 300, configurable: true });
    fireEvent.scroll(log);
    // Wait for the settle loop to fully land (the exact settled px, not an in-transit fraction),
    // so several re-renders of the scroller have actually happened before the count is checked.
    await waitFor(() => expect(log.style.maskImage).toContain(`#000 ${SCROLL_FADE}px`));

    expect(renders).toBe(mounted);
  });
});
