// @vitest-environment jsdom
/**
 * The keyboard window's round trip: record a chord, export the keymap, reset, import the file back.
 * The codec itself is covered in `state/keymap/presets.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const downloaded: Blob[] = [];
vi.mock('../../../../../io/export/download', async (original) => ({
  ...await original<typeof import('../../../../../io/export/download')>(),
  downloadBlob: (blob: Blob) => { downloaded.push(blob); },
}));

// jsdom's Blob has no `text()`, which both Export and Import use; FileReader backs it here.
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

import { KeyboardModal } from '../../../../../ui/chrome/modals/keyboard/KeyboardModal';
import { boardZoomFor } from '../../../../../ui/chrome/modals/keyboard/BoardHBar';
import { I18nProvider } from '../../../../../i18n/context';
import { useKeybinds } from '../../../../../state/keymap/store';
import { effectiveCombo } from '../../../../../state/keymap/resolve';
import { useEditorStore } from '../../../../../state/store';
import { TOOLBAR_CONTEXTS } from '../../../../../state/keymap/toolbar';
import { setStoreState } from '../../../../_support/store';

/** A command with a default chord, so "back to default" and "the imported override" differ. */
const COMMAND = 'tool.brush';
const CHORD = 'j';

function renderWindow() {
  return render(
    <I18nProvider>
      <KeyboardModal open onClose={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  downloaded.length = 0;
  setStoreState({ locale: 'en', annotationTool: 'zone', annotationDraft: null, annotationDiscardAction: null });
  useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
  act(() => { useKeybinds.getState().resetAll(); });
});

afterEach(() => {
  cleanup();
  act(() => { useKeybinds.getState().resetAll(); });
});

describe('the keyboard window', () => {
  it('follows the active toolbar automatically', () => {
    const { baseElement: container } = renderWindow();
    expect(screen.queryByRole('combobox')).toBeNull();
    const key = (title: string) => [...container.querySelectorAll<HTMLElement>('#kbd-region [title]')].find(keycap => keycap.title === title);
    expect(key('Brush shape')?.textContent).toContain('5');
    act(() => useEditorStore.getState().setEditMode({ mode: 'annotate' }));
    expect(key('Brush shape')?.textContent).toContain('6');
    expect(key('Measure')?.textContent).toContain('5');
    expect(key('Font size')?.textContent).toContain('Q');
    act(() => useEditorStore.getState().setAnnotationTool('route'));
    expect(key('Line style')?.textContent).toContain('Q');
  });

  it.each(['mountain', 'annotate'] as const)('records one Brush binding for every toolbar from %s', async mode => {
    useEditorStore.getState().setEditMode({ mode });
    renderWindow();
    fireEvent.change(screen.getByPlaceholderText('Search commands'), { target: { value: 'brush' } });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Brush 1/ }));
    fireEvent.click(screen.getByText('Record'));
    expect(useKeybinds.getState().recording).toBe(true);
    fireEvent.keyDown(window, { key: CHORD });

    await waitFor(() => expect(useKeybinds.getState().overrides[COMMAND]).toBe(CHORD));
    expect(useKeybinds.getState().recording).toBe(false);
    for (const toolbar of TOOLBAR_CONTEXTS) expect(effectiveCombo(useKeybinds.getState().overrides, COMMAND, toolbar)).toBe(CHORD);
  });

  it('carries that rebind out through Export and back in through Import', async () => {
    const { baseElement: container } = renderWindow();
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
    const { baseElement: container } = renderWindow();
    act(() => { useKeybinds.getState().rebind(COMMAND, CHORD); });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['{nope'], 'x.json', { type: 'application/json' })] } });

    await waitFor(() => expect(useKeybinds.getState().overrides[COMMAND]).toBe(CHORD));
  });
});

describe('the keyboard window on a small screen', () => {
  it('offers a close button of its own, since a phone has no Escape and little backdrop', () => {
    const onClose = vi.fn();
    render(<I18nProvider><KeyboardModal open onClose={onClose} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scales the board down to the region before letting it scroll', () => {
    expect(boardZoomFor(2000, 1494)).toBe(1);
    expect(boardZoomFor(1414, 1494)).toBeCloseTo(1414 / 1494, 6);
    expect(boardZoomFor(600, 1494)).toBe(0.75);
    expect(boardZoomFor(0, 1494)).toBe(1);
    expect(boardZoomFor(2000, 1494, 285, 334)).toBeCloseTo(285 / 334, 6);
    expect(boardZoomFor(1414, 1494, 400, 334)).toBeCloseTo(1414 / 1494, 6);
  });
});
