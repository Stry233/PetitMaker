/**
 * The keyboard window's own round trip: record a chord, export the keymap, throw the overrides
 * away, import the file back.
 *
 * The codec is covered on its own in `keybind-presets.test.ts`. This is the WINDOW: that the
 * recording listener writes an override, that Export hands the serializer's output to the download,
 * and that the file input feeds it back through the validating parser. A repaint has no business
 * touching any of that, which is exactly why it is worth pinning while one happens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const downloaded: Blob[] = [];
vi.mock('../../../io/image-export', () => ({
  downloadBlob: (blob: Blob) => { downloaded.push(blob); },
}));

// jsdom's Blob carries no `text()`, and both halves of the round trip go through it (Export hands
// out a Blob, Import reads a File). Backed by FileReader, which jsdom does implement.
if (typeof Blob.prototype.text !== 'function') {
  Object.defineProperty(Blob.prototype, 'text', {
    configurable: true,
    value(this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    },
  });
}

import { KeyboardModal } from '../../../ui/chrome/modals/keyboard/KeyboardModal';
import { I18nProvider } from '../../../i18n/context';
import { useKeybinds, effectiveCombo } from '../../../core/runtime/keybindings';
import { setStoreState } from '../../_store';

/** A command with a default chord, so "back to default" and "the imported override" differ. */
const COMMAND = 'tool.brush';
const CHORD = 'j';

function renderWindow() {
  return render(
    <I18nProvider>
      <KeyboardModal onClose={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  downloaded.length = 0;
  setStoreState({ locale: 'en' });
  act(() => { useKeybinds.getState().resetAll(); });
});

afterEach(() => {
  cleanup();
  act(() => { useKeybinds.getState().resetAll(); });
});

describe('the keyboard window', () => {
  it('records a chord onto the command the search found', async () => {
    renderWindow();
    fireEvent.change(screen.getByPlaceholderText('Search commands'), { target: { value: 'free brush' } });
    // By role: the board already engraves the same label on the key that holds the command, and only
    // the search hit is a button.
    fireEvent.click(await screen.findByRole('button', { name: /Free Brush/ }));
    fireEvent.click(screen.getByText('Record'));
    fireEvent.keyDown(window, { key: CHORD });

    await waitFor(() => expect(useKeybinds.getState().overrides[COMMAND]).toBe(CHORD));
  });

  it('carries that rebind out through Export and back in through Import', async () => {
    const { container } = renderWindow();
    act(() => { useKeybinds.getState().rebind(COMMAND, CHORD); });
    expect(effectiveCombo(useKeybinds.getState().overrides, COMMAND)).toBe(CHORD);

    fireEvent.click(screen.getByText('Export'));
    const [blob] = downloaded;
    expect(downloaded).toHaveLength(1);
    const json = await blob!.text();
    expect(JSON.parse(json).binds[COMMAND]).toBe(CHORD);

    act(() => { useKeybinds.getState().resetAll(); });
    expect(useKeybinds.getState().overrides[COMMAND]).toBeUndefined();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([json], 'petitmaker-keybinds.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(effectiveCombo(useKeybinds.getState().overrides, COMMAND)).toBe(CHORD));
  });

  it('refuses a malformed file and leaves the keymap alone', async () => {
    const { container } = renderWindow();
    act(() => { useKeybinds.getState().rebind(COMMAND, CHORD); });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['{nope'], 'x.json', { type: 'application/json' })] } });

    // The parser reports one of its six refusals and the window applies nothing, so what the user
    // already had survives a bad file.
    await waitFor(() => expect(useKeybinds.getState().overrides[COMMAND]).toBe(CHORD));
  });
});

/*
 * The board's own scroll region is the app's ONE both-axis scroller (`useScrollFadeBoth`), so it is
 * this window's job to cover the branch Task 1 left untested: two intersected mask layers when both
 * axes overflow, one plain layer once only one still does, and no mask at all once it fits.
 * `useTravel`'s settle loop runs on requestAnimationFrame + performance.now(), pumped with the same
 * queue/clock stub `scroll-fade.test.ts` established.
 */
describe('the keyboard region fades on the axes it can still travel', () => {
  let queue: FrameRequestCallback[] = [];
  let now = 0;

  function pump(ms = 16): void {
    now += ms;
    const q = queue;
    queue = [];
    for (const cb of q) cb(now);
  }
  function pumpUntil(done: () => boolean, max = 120): void {
    for (let i = 0; i < max && !done(); i++) act(() => pump());
  }

  beforeEach(() => {
    queue = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('carries two intersected masks, then one, then none, as travel drops per axis', () => {
    renderWindow();
    const region = screen.getByTestId('kbd-region');

    // Both axes overflowing, mid-scroll on each.
    Object.defineProperty(region, 'scrollWidth', { value: 2000, configurable: true });
    Object.defineProperty(region, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(region, 'scrollLeft', { value: 500, configurable: true });
    Object.defineProperty(region, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(region, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(region, 'scrollTop', { value: 200, configurable: true });
    fireEvent.scroll(region);
    pumpUntil(() => region.style.maskComposite === 'intersect');
    expect(region.style.maskImage.match(/linear-gradient/g)).toHaveLength(2);
    // jsdom's CSSStyleDeclaration doesn't recognize the vendor-prefixed `-webkit-mask-composite`
    // (unlike the now-standard `mask-composite`), so only the standard property is checkable here.
    expect(region.style.maskComposite).toBe('intersect');

    // The y axis now fits (a height squeeze absorbed, say); only x still has travel.
    Object.defineProperty(region, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(region, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(region);
    pumpUntil(() => !region.style.maskComposite);
    expect(region.style.maskImage).toContain('linear-gradient(to right,');
    expect(region.style.maskImage).not.toContain('linear-gradient(to bottom,');

    // Both axes now fit: no mask at all.
    Object.defineProperty(region, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(region, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(region);
    pumpUntil(() => region.style.maskImage === '');
    expect(region.style.maskImage).toBe('');
  });
});
