// @vitest-environment jsdom
/**
 * The stylize window's connection page, reached as a user does: pick a direction that needs a key
 * and take its pane's verb. The model list is an injected fake and the probe's debounce runs on fake
 * timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../../../i18n/context';
import { useEditorStore } from '../../../../../../state/store';
import { versionStore } from '../../../../../../state/stylize-versions';
import { StylizeWindow } from '../../../../../../ui/chrome/modals/export/stylize/StylizeWindow';
import { defaultListModels, type StylizeListModels } from '../../../../../../editor/export/stylize';
import { loadStylizeKey, loadStylizeSettings } from '../../../../../../io/storage/stylize-settings';

const DEBOUNCE = 600;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

/** Lets the window's async boot (the vault read) settle before anything is asserted. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

/** Runs the key/address debounce out and lets the probe's promise land. */
async function probe(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function startButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Start creating' }) as HTMLButtonElement;
}

async function openHero(listModels: StylizeListModels) {
  const view = render(<StylizeWindow onClose={() => {}} listModels={listModels} />, { wrapper: Wrapper });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: /Forest watercolor/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
  await settle();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  versionStore.reset();
  useEditorStore.setState({ locale: 'en' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the stylize hero', () => {
  it('opens on the studio, and a model direction\'s pane is the way to the form', async () => {
    render(<StylizeWindow onClose={() => {}} listModels={async () => ['a-model']} />, { wrapper: Wrapper });
    await settle();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate illustration' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Forest watercolor/ }));
    expect(screen.getByText('This style needs an API key')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a key' }));
    await settle();
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(startButton().disabled).toBe(true);
  });

  it('walks the model row from empty to a list with the first model pre-picked', async () => {
    let release: (v: string[]) => void = () => {};
    const listModels: StylizeListModels = () => new Promise<string[]>((resolve) => { release = resolve; });
    await openHero(listModels);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIzaSy-test-key' } });
    await act(async () => { vi.advanceTimersByTime(DEBOUNCE); });
    expect(screen.getByText('Loading models')).toBeTruthy();

    await act(async () => { release(['gemini-2.5-flash-image', 'gemini-2.5-pro-image']); await Promise.resolve(); });
    expect(screen.getByText('gemini-2.5-flash-image')).toBeTruthy();
    expect(startButton().disabled).toBe(false);
  });

  it('keeps the button disabled until every ingredient the provider needs stands', async () => {
    await openHero(async () => ['a-model']);

    fireEvent.click(screen.getByLabelText('Provider'));
    fireEvent.click(screen.getByText('Custom endpoint'));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'gateway-token' } });
    await probe();
    // A custom endpoint also needs an address, and the probe waits for it.
    expect(startButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Endpoint address'), { target: { value: 'https://gateway.example.com' } });
    await probe();
    expect(startButton().disabled).toBe(false);
  });

  it('falls back to a typed model where the endpoint will not enumerate', async () => {
    await openHero(async () => null);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIzaSy-test-key' } });
    await probe();

    const typed = screen.getByPlaceholderText('Type a model name') as HTMLInputElement;
    expect(startButton().disabled).toBe(true);
    fireEvent.change(typed, { target: { value: 'my-own-model' } });
    expect(startButton().disabled).toBe(false);
  });

  it('prefills the provider default model where the list cannot enumerate, and never overwrites a typed value', async () => {
    await openHero(async () => null);

    fireEvent.click(screen.getByLabelText('Provider'));
    fireEvent.click(screen.getByText('StepFun'));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sf-test-key' } });
    await probe();

    const typed = screen.getByPlaceholderText('Type a model name') as HTMLInputElement;
    expect(typed.value).toBe('step-image-edit-2');
    expect(startButton().disabled).toBe(false);

    fireEvent.change(typed, { target: { value: 'my-own-model' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sf-test-key-2' } });
    await probe();
    expect((screen.getByPlaceholderText('Type a model name') as HTMLInputElement).value).toBe('my-own-model');
  });

  it('states a refused verify in the status slot and stays on the connection page', async () => {
    const { StylizeError } = await import('../../../../../../pipelines/stylize');
    let calls = 0;
    const listModels: StylizeListModels = async () => {
      calls += 1;
      if (calls === 1) return ['a-model'];
      throw new StylizeError('bad_key');
    };
    await openHero(listModels);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIzaSy-test-key' } });
    await probe();
    expect(startButton().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(startButton());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Key rejected')).toBeTruthy();
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it.each([401, 403])('fails the connection check and files nothing when the provider answers the model list with %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status })));
    try {
      await openHero(defaultListModels);
      fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIzaSy-test-key' } });
      await probe();
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText('Key rejected')).toBeTruthy();
      fireEvent.change(screen.getByPlaceholderText('Type a model name'), { target: { value: 'typed-model' } });
      await act(async () => {
        fireEvent.click(startButton());
        for (let i = 0; i < 6; i++) await Promise.resolve();
      });
      expect(screen.getByText('Key rejected')).toBeTruthy();
      expect(screen.getByLabelText('API key')).toBeTruthy();
      expect(await loadStylizeKey()).toBeNull();
      expect(loadStylizeSettings().model).not.toBe('typed-model');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves the connection page once the connection verifies', async () => {
    await openHero(async () => ['a-model']);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIzaSy-test-key' } });
    await probe();
    await act(async () => {
      fireEvent.click(startButton());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The arriving create page is asserted rather than the connection form's absence: the two pages
    // cross in one box, so the leaving one still paints for a beat.
    expect(screen.getByRole('button', { name: 'Generate illustration' })).toBeTruthy();
  });
});
