/** The stylize studio's generation status, version shelf, selection, and canvas controls. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { versionStore, DIALECTS, StylizeError } from '../../../io/stylize';
import { Studio, type RunStylize } from '../../../ui/chrome/modals/export/stylize/Studio';
import { StylizeWindow } from '../../../ui/chrome/modals/export/stylize/StylizeWindow';
import { makeState } from '../../rules/_helpers';

vi.mock('../../../io/stylize/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../io/stylize/settings')>();
  return {
    ...actual,
    loadStylizeKey: async () => 'a-stored-key',
    loadStylizeSettings: () => ({
      provider: 'gemini' as const, model: 'gemini-2.5-flash-image', customBaseUrl: '',
      direction: 'watercolor' as const, customPrompt: '',
    }),
    saveStylizeSettings: () => {},
    saveStylizeKey: async () => {},
  };
});

const CFG = { key: 'a-stored-key', baseUrl: 'https://example.com', model: 'a-model' };
const picture = (src: string) => ({ src } as HTMLImageElement);

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

function renderStudio(run: RunStylize) {
  return render(
    <Studio
      connected
      dialect={DIALECTS.gemini}
      cfg={CFG}
      onSettings={() => {}}
      onDone={() => {}}
      run={run}
      captureOriginal={() => 'data:image/png;base64,ORIGINAL'}
    />,
    { wrapper: Wrapper },
  );
}

const generateButton = () => screen.getByRole('button', { name: 'Generate illustration' }) as HTMLButtonElement;
const shown = () => screen.getByTestId('stylize-canvas').getAttribute('data-picture');

async function press(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  versionStore.reset();
  useEditorStore.setState({ locale: 'en', gridState: makeState(12, 12) });
});

describe('the stylize studio', () => {
  it('mints a numbered card from a finished job and stands the shelf down again', async () => {
    const run: RunStylize = async () => ({ image: picture('data:image/png;base64,ONE') });
    renderStudio(run);

    await press(generateButton());

    expect(screen.getByText('Take 1')).toBeTruthy();
    expect(versionStore.getState().running).toBe(false);
    expect(versionStore.getState().versions).toHaveLength(1);
  });

  it('stands one progress bar while a take is painting and takes it down when the picture lands', async () => {
    let release: (v: { image: HTMLImageElement }) => void = () => {};
    renderStudio(() => new Promise((resolve) => { release = resolve; }));

    await press(generateButton());
    // Generation has one progress indicator in the shelf.
    expect(document.querySelectorAll('[data-testid="stylize-progress"]')).toHaveLength(1);
    expect(document.querySelectorAll('.pw-busy')).toHaveLength(0);

    await act(async () => {
      release({ image: picture('data:image/png;base64,ONE') });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => { expect(screen.queryByTestId('stylize-progress')).toBeNull(); });
    expect(screen.getByText('Take 1')).toBeTruthy();
  });

  it('states a refusal in the status slot and re-arms the verb', async () => {
    const run: RunStylize = async () => { throw new StylizeError('refused'); };
    renderStudio(run);

    await press(generateButton());

    expect(screen.getByText('The provider declined this request')).toBeTruthy();
    expect(generateButton().disabled).toBe(false);
    expect(versionStore.getState().versions).toHaveLength(0);
  });

  it('tries a version on hover and keeps it on a press', async () => {
    act(() => { versionStore.mint({ kind: 'model', direction: 'coastal', image: picture('one'), fingerprint: 0 }); });
    renderStudio(async () => ({ image: picture('x') }));
    const original = screen.getByRole('button', { name: 'Original' });

    fireEvent.mouseEnter(original);
    expect(shown()).toBe('original');
    // Hover previews a version without changing the saved selection.
    fireEvent.mouseLeave(original);
    expect(shown()).toBe('v1');
    expect(versionStore.getState().selectedId).toBe('v1');

    await press(original);
    expect(versionStore.getState().selectedId).toBeNull();
  });

  it('swaps the canvas and the corner picture without touching the selection', async () => {
    act(() => { versionStore.mint({ kind: 'model', direction: 'coastal', image: picture('one'), fingerprint: 0 }); });
    renderStudio(async () => ({ image: picture('x') }));
    expect(shown()).toBe('v1');

    await press(screen.getByRole('button', { name: 'Click to swap' }));
    expect(shown()).toBe('original');
    expect(versionStore.getState().selectedId).toBe('v1');
  });

  it('restores a custom version\'s own words when it is picked again', async () => {
    act(() => {
      versionStore.mint({ kind: 'model', direction: 'custom', prompt: 'soft pencil on cream paper', image: picture('one'), fingerprint: 0 });
      versionStore.select(null);
    });
    renderStudio(async () => ({ image: picture('x') }));

    await press(screen.getByRole('button', { name: 'Take 1' }));
    const desk = screen.getByPlaceholderText(/Describe the style you want/) as HTMLTextAreaElement;
    expect(desk.value).toBe('soft pencil on cream paper');
  });

  it('appends a chip to the description with the joining the compiler expects', async () => {
    renderStudio(async () => ({ image: picture('x') }));
    fireEvent.click(screen.getByText('Custom'));

    const desk = screen.getByPlaceholderText(/Describe the style you want/) as HTMLTextAreaElement;
    fireEvent.change(desk, { target: { value: 'cream paper' } });
    fireEvent.click(screen.getByRole('button', { name: 'soft muted tones' }));

    expect((screen.getByPlaceholderText(/Describe the style you want/) as HTMLTextAreaElement).value)
      .toBe('cream paper, soft muted tones');
  });

  it('retires a picture and falls back to the original', async () => {
    act(() => { versionStore.mint({ kind: 'model', direction: 'coastal', image: picture('one'), fingerprint: 0 }); });
    renderStudio(async () => ({ image: picture('x') }));

    await press(screen.getByRole('button', { name: 'Remove this picture' }));
    expect(versionStore.getState().versions).toHaveLength(0);
    expect(versionStore.getState().selectedId).toBeNull();
    expect(shown()).toBe('original');
  });

  it('opens the window straight on the create page when a connection stands', async () => {
    render(<StylizeWindow onClose={() => {}} listModels={async () => ['a-model']} />, { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Generate illustration' })).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('lists all ten presets plus the custom row', () => {
    renderStudio(async () => ({ image: picture('x') }));
    // Scoped to the scroller itself: the default pick ('watercolor') repeats its own name in the
    // reserved pane beside it, which a page-wide query would trip over.
    const scroller = within(screen.getByTestId('stylize-direction-scroll'));
    const names = [
      'Forest watercolor', 'Coastal wash', 'Sakura sketch', 'Autumn orchard', 'Colored pencil',
      'Storybook line', 'Ink and wash', 'Antique atlas', 'Crayon play',
      'Lantern night', 'Custom',
    ];
    for (const name of names) expect(scroller.getByText(name)).toBeTruthy();
  });

  it('scrolls the row list on its own element, with the desk standing outside it', () => {
    renderStudio(async () => ({ image: picture('x') }));
    const scroller = screen.getByTestId('stylize-direction-scroll');
    // The declared CSS an overflowing list of twelve rows needs to scroll rather than push the
    // reserved pane down: a shrinkable flex item (`min-height: 0`) scrolling its own overflow.
    expect(scroller.style.overflowY).toBe('auto');
    expect(scroller.style.minHeight).toBe('0');

    // 自定义 is a member of the scroller like its eleven siblings.
    const customRow = screen.getByText('Custom').closest('button')!;
    expect(scroller.contains(customRow)).toBe(true);

    // The reserved pane never is, the writing desk it opens into included.
    fireEvent.click(customRow);
    const desk = screen.getByPlaceholderText(/Describe the style you want/);
    expect(scroller.contains(desk)).toBe(false);
  });

  it('updates the reserved pane when a preset deep in the list is picked', () => {
    renderStudio(async () => ({ image: picture('x') }));
    // Before the pick, 'Lantern night' names only its own row; after, the pane repeats it.
    expect(screen.getAllByText('Lantern night')).toHaveLength(1);
    fireEvent.click(screen.getByText('Lantern night'));
    expect(screen.getAllByText('Lantern night')).toHaveLength(2);
  });

  it('pans and zooms the canvas with the export preview\'s own hands: wheel in, double-click home', () => {
    renderStudio(async () => ({ image: {} as HTMLImageElement }));
    const stage = screen.getByTestId('stylize-canvas');
    const view = screen.getByTestId('stylize-canvas-view');
    expect(view.style.transform).toContain('scale(1)');

    fireEvent.wheel(stage, { deltaY: -100 });
    expect(view.style.transform).toContain('scale(1.12');

    fireEvent.doubleClick(stage);
    expect(view.style.transform).toContain('scale(1)');
  });

  it('the shelf scrolls sideways past six occupants instead of wrapping into a second row', () => {
    act(() => {
      for (let i = 0; i < 7; i++) {
        versionStore.mint({ kind: 'model', direction: 'watercolor', image: {} as HTMLImageElement, fingerprint: 0 });
      }
    });
    renderStudio(async () => ({ image: {} as HTMLImageElement }));

    const row = screen.getByTestId('stylize-shelf-scroll');
    expect(row.style.overflowX).toBe('scroll');
    expect(row.style.display).toBe('flex');
    // 原图 plus all seven takes stand in the one row; nothing is dropped and no ghosts remain.
    expect(within(row).getByLabelText('Original')).toBeTruthy();
    for (let n = 1; n <= 7; n++) expect(within(row).getByLabelText(`Take ${n}`)).toBeTruthy();
  });

  it('a retake anchors on the kept take of the same direction, not on the pack sample', async () => {
    act(() => {
      versionStore.mint({ kind: 'model', direction: 'watercolor', image: { src: 'data:image/png;base64,KEPT' } as HTMLImageElement, fingerprint: 0 });
    });
    let seen: unknown = null;
    renderStudio(async (deps) => {
      seen = (deps as { styleRef?: unknown }).styleRef;
      return { image: {} as HTMLImageElement };
    });

    await press(generateButton());

    expect(seen).toEqual({ url: 'data:image/png;base64,KEPT', kind: 'take' });
  });
});

describe('the procedural path', () => {
  const fakeCanvas = () => ({
    toDataURL: () => 'data:image/png;base64,PROC',
  } as unknown as HTMLCanvasElement);

  // jsdom never loads an image, so the data-URL decode step is given a synchronous stand-in.
  beforeEach(() => {
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderStudioProc(renderProc: () => HTMLCanvasElement | null, connected = false) {
    const procRenderer = async () =>
      ({ renderProcPackAsync: renderProc, takeSeed: (_s: unknown, roll: number) => 1 + roll } as unknown as Awaited<ReturnType<typeof import('../../../io/stylize')['loadProcRenderer']>>);
    return render(
      <Studio
        connected={connected}
        dialect={null}
        cfg={null}
        onSettings={() => {}}
        onDone={() => {}}
        procRenderer={procRenderer}
        captureOriginal={() => 'data:image/png;base64,ORIGINAL'}
      />,
      { wrapper: Wrapper },
    );
  }

  it('draws on this machine with no connection standing, and the take carries no model kind', async () => {
    useEditorStore.setState({ gridState: makeState() });
    const renderProc = vi.fn(fakeCanvas);
    renderStudioProc(renderProc);
    // A drawn-here direction arms the verb with nothing filed at all.
    fireEvent.click(screen.getByRole('button', { name: /Watercolor/ }));
    expect(generateButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(generateButton());
      await vi.waitFor(() => { expect(versionStore.getState().versions).toHaveLength(1); });
    });
    expect(renderProc).toHaveBeenCalledTimes(1);
    const minted = versionStore.getState().versions[0]!;
    expect(minted.kind).toBe('proc');
    expect(minted.direction).toBe('aquarelle');
  });

  it('asking the same style again re-rolls its seed, so the takes are siblings, not copies', async () => {
    useEditorStore.setState({ gridState: makeState() });
    const renderProc = vi.fn(fakeCanvas);
    renderStudioProc(renderProc);
    fireEvent.click(screen.getByRole('button', { name: /Watercolor/ }));
    for (const count of [1, 2, 3]) {
      await act(async () => {
        fireEvent.click(generateButton());
        await vi.waitFor(() => { expect(versionStore.getState().versions).toHaveLength(count); });
      });
    }
    const seeds = (renderProc.mock.calls as unknown as [{ seed: number }][]).map((c) => c[0].seed);
    expect(seeds).toEqual([1, 2, 3]);
    expect(versionStore.getState().versions.map((v) => v.roll)).toEqual([0, 1, 2]);
  });

  it('a model direction stays disarmed without a key, and never reaches the renderer', () => {
    useEditorStore.setState({ gridState: makeState() });
    const renderProc = vi.fn(fakeCanvas);
    renderStudioProc(renderProc);
    fireEvent.click(screen.getByRole('button', { name: /Forest watercolor/ }));
    expect(generateButton().disabled).toBe(true);
    expect(screen.getByText('This style needs an API key')).toBeTruthy();
    expect(renderProc).not.toHaveBeenCalled();
  });

  it('a run the device gave up on stands the verb down again', async () => {
    // The on-device runtime can stall on its first fetch; the studio must not be left with
    // Generate disabled for the rest of the session.
    useEditorStore.setState({ gridState: makeState() });
    renderStudioProc(() => { throw new StylizeError('device'); });
    fireEvent.click(screen.getByRole('button', { name: /Watercolor/ }));
    await act(async () => {
      fireEvent.click(generateButton());
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(versionStore.getState().versions).toHaveLength(0);
    expect(versionStore.getState().running).toBe(false);
    expect(generateButton().disabled).toBe(false);
  });

  it('a refused draw states itself in the slot rather than minting', async () => {
    useEditorStore.setState({ gridState: makeState() });
    renderStudioProc(() => null);
    fireEvent.click(screen.getByRole('button', { name: /Watercolor/ }));
    await act(async () => {
      fireEvent.click(generateButton());
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(versionStore.getState().versions).toHaveLength(0);
    expect(versionStore.getState().running).toBe(false);
  });
});
