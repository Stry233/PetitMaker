// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NoticeBar, NoticeLink } from '../../../ui/primitives/NoticeBar';
import { useChromeLayer } from '../../../ui/primitives/chrome-layer';
import { WindowFooter, WindowHeader } from '../../../ui/primitives/Window';
import { CopiedBubble, useCopyFeedback } from '../../../ui/primitives/CopiedBubble';
import { UiPreviewProvider } from '../../../ui/design/preview';
import { PANEL_EDGE } from '../../../ui/design/tokens';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { TOUCH_TARGET } from '../../../ui/design/scale';
import { weightVars } from '../../../ui/design/text-weight';
import type { InputMode } from '../../../platform/device/input-mode';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** A `div` standing as a chrome layer, the way the toasts and notices wear one. */
function ChromeLayer({ control, ...props }: { 'data-testid': string; control?: number }) {
  return <div {...props} style={useChromeLayer(control === undefined ? {} : { control })} />;
}

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

describe('the chrome layer', () => {
  it('stands fixed with the resolved weights, and inside its figure when pictured', () => {
    render(<ChromeLayer data-testid="live" />);
    const live = screen.getByTestId('live');
    expect(live.style.position).toBe('fixed');
    expect(live.style.getPropertyValue('--fw-body')).not.toBe('');
    cleanup();
    render(<UiPreviewProvider><ChromeLayer data-testid="pictured" /></UiPreviewProvider>);
    expect(screen.getByTestId('pictured').style.position).toBe('absolute');
  });

  it('publishes the weights resolved for the zoom it draws at, lifted for a fingertip in touch mode alone', () => {
    sizeWindow(390, 844);
    const drawn = (inputMode: InputMode) => {
      render(<InputModeProvider inputMode={inputMode}><ChromeLayer data-testid="layer" control={TOUCH_TARGET} /></InputModeProvider>);
      const layer = screen.getByTestId('layer');
      const zoom = Number(layer.style.zoom);
      const expected = Object.entries(weightVars(zoom, 1, false));
      const published = expected.map(([name]) => [name, layer.style.getPropertyValue(name)]);
      cleanup();
      return { zoom, expected: expected.map(([name, v]) => [name, String(v)]), published };
    };
    const touch = drawn('touch');
    expect(touch.published).toEqual(touch.expected);
    const pc = drawn('pc');
    expect(touch.zoom).toBeGreaterThan(pc.zoom);
    expect(pc.published).toEqual(pc.expected);
    sizeWindow(1024, 768);
  });
});

describe('NoticeBar', () => {
  it('stands off the named edge on the panel plate and edge, with an optional stripe', () => {
    render(<NoticeBar data-testid="notice" edge="bottom" offset={16} stripe><span>words</span></NoticeBar>);
    const card = screen.getByTestId('notice');
    expect(card.style.bottom).toBe('16px');
    expect(card.style.position).toBe('fixed');
    expect(card.style.border).not.toBe('');
    expect(PANEL_EDGE).toContain('solid');
    expect(card.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens its links in a new tab', () => {
    render(<NoticeLink href="https://example.com">go</NoticeLink>);
    expect(screen.getByText('go').getAttribute('target')).toBe('_blank');
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
  it('names what was copied until the hold runs out, and stays quiet when the clipboard refuses', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    let api: ReturnType<typeof useCopyFeedback<'build'>> | null = null;
    function Probe() {
      api = useCopyFeedback<'build'>();
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
