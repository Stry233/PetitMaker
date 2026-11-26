// @vitest-environment jsdom
/**
 * The dreaming board: the board's outer height is fixed to the tallest trio its rotation can show,
 * measured off a hidden ruler.
 * The reserved height is the tallest window of three consecutive orders in the cycle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { DreamOffice, DREAMS } from '../../../ui/agent/desk/DreamOffice';
import { translations } from '../../_support/locale-tables';
import { connectionReady, runnerSettings, useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS } from '../../../agent/providers/defaults';
import { __setSignInRound } from '../../../agent/connection/sign-in-round';

/** Mounted inside `act`, because the board's own rAF loop commits a beat on the first frame. */
function mount(pinned: boolean | { onConnect: () => void } = false): { container: HTMLElement } {
  let out!: { container: HTMLElement };
  const onConnect = typeof pinned === 'object' ? pinned.onConnect : () => {};
  act(() => { out = render(<I18nProvider><DreamOffice onConnect={onConnect} pinned={pinned === true} /></I18nProvider>); });
  return out;
}

describe('every slip carries its own built picture', () => {
  it('renders a thumbnail image on each visible row, never an empty box', () => {
    const { container } = mount();
    const thumbs = container.querySelectorAll('[data-testid="dream-thumb"]');
    expect(thumbs.length).toBeGreaterThan(0);
    for (const img of thumbs) {
      expect((img as HTMLImageElement).getAttribute('src'), 'thumb src').toBeTruthy();
    }
  });
});

describe('the dreaming board reserves one height', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Docked, the zone is the window's height, so the whole pool stands with no rotation or reserve. */
  describe('docked, the board stands the whole pool', () => {
    it('shows every order in the pool, standing', () => {
      const { container } = mount(true);
      expect(container.querySelectorAll('[data-testid="dream-row"]')).toHaveLength(DREAMS.length);
    });

    it('turns nothing over: the standing pool has nothing left to reveal', () => {
      const { container } = mount(true);
      const order = () => [...container.querySelectorAll('[data-testid="dream-row"]')]
        .map((r) => r.getAttribute('data-order'));
      const first = order();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(order()).toEqual(first);
      expect(container.querySelector('[data-testid="dream-row-leaving"]')).toBeNull();
    });
  });

  /** A wrapping title or sub line grows the reserve, so the three longest lines stay under the counts
   *  where they wrap in the live panel (1280x800 at the frame's 1.25 zoom). */
  it('keeps the pool\'s known-tall lines short enough not to wrap, in en and in ru', () => {
    const village = DREAMS.find((o) => o.id === 'village')!;
    const forest = DREAMS.find((o) => o.id === 'forest')!;
    const road = DREAMS.find((o) => o.id === 'road')!;
    // Measured fit boundaries at the panel's column width: the bolder, larger title font and
    // Cyrillic both wrap sooner.
    const titleCap: Record<'en' | 'ru', number> = { en: 34, ru: 28 };
    const subCap: Record<'en' | 'ru', number> = { en: 37, ru: 33 };
    for (const locale of ['en', 'ru'] as const) {
      expect(translations[locale][village.subKey]!.length, `${locale} village sub`).toBeLessThanOrEqual(subCap[locale]);
      expect(translations[locale][forest.subKey]!.length, `${locale} forest sub`).toBeLessThanOrEqual(subCap[locale]);
      expect(translations[locale][road.titleKey]!.length, `${locale} road title`).toBeLessThanOrEqual(titleCap[locale]);
    }
  });
});

describe('the keyless office points at Help', () => {
  it('opens the setup page at its sign-in section from Learn more', () => {
    useEditorStore.getState().setHelpTarget(null);
    const { container } = mount();
    fireEvent.click(within(container).getByRole('button', { name: translations.en['agent.learn_more'] }));
    expect(useEditorStore.getState().helpTarget).toEqual({ page: 'agent-setup', anchor: 'agsetup-signin' });
    expect(useEditorStore.getState().modals.help).toBe(true);
  });
});

describe('the two ways to connect', () => {
  beforeEach(async () => {
    localStorage.clear();
    for (const id of PROVIDER_IDS) useAgentConnection.getState().forgetKey(id);
    useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
    await useAgentConnection.getState().hydrate();
  });
  afterEach(() => { __setSignInRound(null); });

  const worded = (key: string) => translations.en[key]!.replace('{name}', translations.en['provider.name_openrouter']!);
  const within$ = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('offers signing in with the deployment provider first, then an API key, and says whose account pays', () => {
    const { container } = mount();
    expect(within$(container, 'dream-sign-in')!.textContent).toBe(worded('agent.setup_sign_in'));
    expect(within$(container, 'dream-connect')!.textContent).toBe(translations.en['agent.dream_use_key']);
    expect(within$(container, 'dream-note')!.textContent).toContain(worded('agent.setup_sign_in_note'));
  });

  it('says so when the browser opens no window', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { container } = mount();
    await act(async () => { fireEvent.click(within$(container, 'dream-sign-in')!); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(within$(container, 'dream-note')!.textContent).toBe(translations.en['agent.setup_sign_in_blocked']);
    open.mockRestore();
  });

  it('waits on the provider window with a way to cancel in the API key button place', async () => {
    const opened = { location: { href: 'about:blank' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    const { container } = mount();
    await act(async () => { fireEvent.click(within$(container, 'dream-sign-in')!); });
    expect(within$(container, 'dream-note')!.textContent).toBe(worded('agent.setup_sign_in_waiting'));
    expect(within$(container, 'dream-sign-in')!.getAttribute('aria-busy')).toBe('true');
    expect(within$(container, 'dream-connect')).toBeNull();
    await act(async () => { fireEvent.click(within$(container, 'dream-sign-in-cancel')!); });
    expect(within$(container, 'dream-note')!.textContent).toContain(worded('agent.setup_sign_in_note'));
    expect(within$(container, 'dream-connect')).not.toBeNull();
    open.mockRestore();
  });
  it('connects with the returned key and does not send the user to the key screen', async () => {
    // A provider whose model is already chosen: the connection is whole the moment the key lands.
    useAgentConnection.setState({ model: { ...useAgentConnection.getState().model, openrouter: 'some/model' } });
    const opened = { location: { href: 'about:blank' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    const exchange = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ key: 'sk-or-v1-returned-key' }), { status: 200 }));
    const onConnect = vi.fn();
    const { container } = mount({ onConnect });
    await act(async () => { fireEvent.click(within$(container, 'dream-sign-in')!); });
    await waitFor(() => expect(opened.location.href).toContain('openrouter.ai/auth'));
    const answer = new BroadcastChannel('petit-sign-in');
    await act(async () => {
      answer.postMessage({ state: new URL(opened.location.href).searchParams.get('state'), code: 'the-code' });
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    answer.close();
    await waitFor(() => expect(connectionReady(useAgentConnection.getState())).toBe(true));
    expect(runnerSettings(useAgentConnection.getState()).apiKey).toBe('sk-or-v1-returned-key');
    expect(useAgentConnection.getState().providerPinned).toBe(false);
    expect(onConnect).not.toHaveBeenCalled();
    open.mockRestore();
    exchange.mockRestore();
  });
});
