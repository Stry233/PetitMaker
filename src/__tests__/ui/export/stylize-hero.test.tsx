/**
 * stylize-hero.test.tsx — the connection page of the stylize window.
 *
 * THE WINDOW OPENS ON THE STUDIO, so every scenario here first walks to the connection page the way
 * a hand does: pick a direction that needs a key, and take the pane's own verb. What is under test
 * from there is the form's own decision-making, so the model list is an injected fake and no
 * network is touched: which ingredients arm 开始创作, how the model row walks from empty to a
 * pre-picked list, what a listless endpoint leaves standing, and what a refused verify does to the
 * permanent status slot. The debounce is driven on fake timers, since the probe is what every one
 * of those states hangs off.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { versionStore } from '../../../io/stylize';
import { StylizeWindow } from '../../../ui/chrome/modals/export/stylize/StylizeWindow';
import type { StylizeListModels } from '../../../ui/chrome/modals/export/stylize/use-stylize-connection';

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
  // The window opens on the studio now; the connection page is reached from a model direction's
  // own pane, which is the path a user without a key actually walks.
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
    // No connection page on arrival: the studio's own verb row is standing instead.
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate illustration' })).toBeTruthy();
    // Picking a keyed direction surfaces the requirement in the pane, and its verb opens the form.
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
    // The address is the ingredient a custom endpoint alone needs, so no probe has even run.
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

    // A user's own text stands: editing it and re-running the probe must not clobber the typed value.
    fireEvent.change(typed, { target: { value: 'my-own-model' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sf-test-key-2' } });
    await probe();
    expect((screen.getByPlaceholderText('Type a model name') as HTMLInputElement).value).toBe('my-own-model');
  });

  it('states a refused verify in the status slot and stays on the connection page', async () => {
    const { StylizeError } = await import('../../../io/stylize');
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
    // The create page is what stands afterwards. The connection form is asserted through its
    // ARRIVAL rather than through the other's absence: the two pages cross in one box, so the one
    // being replaced is still painting its leave for a beat after the swap is decided.
    expect(screen.getByRole('button', { name: 'Generate illustration' })).toBeTruthy();
  });
});
