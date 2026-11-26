// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { NoticeAction, NoticeLink } from '../../../ui/primitives/NoticeBar';
import { WindowFooter, WindowHeader } from '../../../ui/primitives/Window';
import { CopiedBubble, useCopyFeedback } from '../../../ui/primitives/CopiedBubble';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('NoticeBar', () => {
  it('opens its links in a new tab', () => {
    render(<NoticeLink href="https://example.com">go</NoticeLink>);
    expect(screen.getByText('go').getAttribute('target')).toBe('_blank');
  });

  /** How the pill stands while hovered and then while pressed, settled under reduced motion. */
  const feedback = async (el: HTMLElement) => {
    const settle = () => act(() => new Promise((r) => setTimeout(r, 80)));
    fireEvent.pointerEnter(el, { pointerType: 'pen' });
    await settle();
    const hovered = el.style.transform;
    fireEvent.pointerLeave(el, { pointerType: 'pen' });
    fireEvent.pointerDown(el, { pointerType: 'pen', isPrimary: true, button: 0 });
    await settle();
    return { hovered, pressed: el.style.transform };
  };

  it.each([
    ['action', () => <NoticeAction>act</NoticeAction>],
    ['link', () => <NoticeLink href="https://example.com">act</NoticeLink>],
  ])('answers a hover and a press on its %s pill', async (_kind, pill) => {
    render(<MotionConfig reducedMotion="always">{pill()}</MotionConfig>);
    const { hovered, pressed } = await feedback(screen.getByText('act'));
    expect(hovered).toMatch(/scale\(1\.03\)/);
    expect(pressed).toMatch(/scale\(0\.95\)/);
  });
});

describe('Window parts', () => {
  it('puts Back at the start and Close at the end of the title row', () => {
    const back = vi.fn(), close = vi.fn();
    render(<WindowHeader title="Title" back={{ label: 'Back', onPress: back }} close={{ label: 'Close', onPress: close }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(back).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('orders the footer as the alternative, the way out and then the confirming action', () => {
    render(<WindowFooter tertiary={<button type="button">Other</button>} cancel={<button type="button">Cancel</button>} primary={<button type="button">Save</button>} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Other', 'Cancel', 'Save']);
  });
});

describe('useCopyFeedback', () => {
  it('names what was copied until the hold runs out, and stays quiet when the copy did not land', async () => {
    vi.useFakeTimers();
    const copy = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    let api: ReturnType<typeof useCopyFeedback<'build'>> | null = null;
    function Probe() {
      api = useCopyFeedback<'build'>(copy);
      return <CopiedBubble show={api.copied !== null} side="above">Copied</CopiedBubble>;
    }
    render(<Probe />);
    await act(async () => { await api!.copy('x', 'build'); });
    expect(api!.copied).toBe('build');
    expect(screen.getByRole('status').textContent).toContain('Copied');
    // The bubble holds for 1.2 s.
    act(() => { vi.advanceTimersByTime(1199); });
    expect(api!.copied).toBe('build');
    act(() => { vi.advanceTimersByTime(1); });
    expect(api!.copied).toBeNull();
    await act(async () => { await api!.copy('y', 'build'); });
    expect(api!.copied).toBeNull();
  });
});
