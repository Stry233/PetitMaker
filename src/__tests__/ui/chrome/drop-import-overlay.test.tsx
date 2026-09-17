// Window-level drag-and-drop import: decision logic only (a real OS drag can't be simulated, so
// this drives the same window listeners with synthetic
// `dragenter`/`dragover`/`dragleave`/`drop` Events carrying a hand-built `dataTransfer` — jsdom
// has no DragEvent constructor, but the component only ever reads `.types`/`.files`, so a plain
// Event with that property attached round-trips through addEventListener exactly the same way).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { makeState, setTerrain } from '../../rules/_helpers';
import { TerrainType } from '../../../core/model/types';
import { ModalShell } from '../../../ui/primitives/ModalShell';

const inspectMock = vi.fn();
const commitMock = vi.fn();
vi.mock('../../../io/import-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../io/import-file')>();
  return { ...actual, inspectImportFile: (...args: unknown[]) => inspectMock(...args) };
});
/** A decoded file waiting for the user's word, as `inspectImportFile` hands it over. */
function ready(notes?: { title?: string; description?: string }) {
  return { status: 'ready', preview: { source: 'json', state: makeState(), warnings: [], ...(notes ? { notes } : {}) }, commit: commitMock };
}

import { DropImportOverlay } from '../../../ui/chrome/modals/import/DropImportOverlay';
import { setStoreState, setStoreModal } from '../../_store';

function Wrapper({ children }: { children: React.ReactNode }) {
  // reducedMotion="always" collapses every enter/exit to its end state instantly, exactly like
  // App.tsx does for motionPref==='reduced' — needed here so an exit animation's DOM presence
  // doesn't race the assertions right after the triggering state flip.
  return <MotionConfig reducedMotion="always"><I18nProvider>{children}</I18nProvider></MotionConfig>;
}

/** A bare object carrying only what the code under test reads (`types`, `files`) — real
 *  DataTransfer isn't constructible in jsdom. */
function dragEvent(type: string, { types = ['Files'], files = [] as unknown[] } = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
  e.dataTransfer = { types, files };
  return e;
}

function fireWindow(e: Event) {
  act(() => { window.dispatchEvent(e); });
}

/** The overlay's drop zone has nothing to pick, so it renders the click-free copy. */
const HINT = 'Drop a map image or .json file here';

describe('DropImportOverlay', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en', gridState: makeState() });
    setStoreModal('import', false);
    inspectMock.mockReset(); commitMock.mockReset();
    inspectMock.mockResolvedValue(ready({ title: 'River garden', description: 'Three homes by the bend.' }));
    commitMock.mockReturnValue({ status: 'imported', source: 'json', warnings: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it('renders nothing before any drag', () => {
    const { container } = render(<DropImportOverlay />, { wrapper: Wrapper });
    expect(container.textContent).toBe('');
  });

  it('ignores a drag that carries no Files (e.g. dragging selected text)', () => {
    render(<DropImportOverlay />, { wrapper: Wrapper });
    fireWindow(dragEvent('dragenter', { types: ['text/plain'] }));
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows the hint on a file drag and hides it once every enter is matched by a leave (depth counter)', async () => {
    render(<DropImportOverlay />, { wrapper: Wrapper });
    fireWindow(dragEvent('dragenter'));
    expect(screen.getByText(HINT)).toBeTruthy();

    // Simulate the drag crossing from the window into a NESTED child: dragenter fires again
    // (depth 2) before the outer dragleave (depth 1). A naive "leave = hide" handler would flicker
    // the hint off here; the depth counter must not.
    fireWindow(dragEvent('dragenter'));
    fireWindow(dragEvent('dragleave'));
    expect(screen.getByText(HINT)).toBeTruthy(); // still net depth 1 — must not flicker

    fireWindow(dragEvent('dragleave'));
    // net depth 0 — now it hides. AnimatePresence's exit-unmount lands a tick after the state flip,
    // so a bare synchronous assertion would race it. This says nothing about reduced-motion timing:
    // jsdom has no display refresh, so framer's rAF spring integrates in wall-clock ms whatever
    // `reducedMotion` says, and a non-reduced exit resolves here just as fast.
    await waitFor(() => expect(screen.queryByText(HINT)).toBeNull());
  });

  it('drops on an EMPTY map decode the file, then ask before importing, without a replace warning', async () => {
    setStoreState({ gridState: makeState() }); // no terrain, no non-locked objects
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const file = { name: 'map.json', type: 'application/json', text: async () => '{}' };
    fireWindow(dragEvent('dragenter'));
    fireWindow(dragEvent('drop', { files: [file] }));
    await waitFor(() => expect(inspectMock).toHaveBeenCalledTimes(1));
    expect(inspectMock.mock.calls[0]?.[0]).toBe(file);
    await waitFor(() => expect(screen.getByText('Import this map?')).toBeTruthy());
    expect(screen.getByText('River garden')).toBeTruthy();
    expect(screen.getByText('Three homes by the bend.')).toBeTruthy();
    expect(screen.queryByText('It replaces the map you are working on.')).toBeNull();
    expect(commitMock).not.toHaveBeenCalled();
    await act(async () => { screen.getByText('Import').click(); });
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('drops on a map WITH content warn that the import replaces it', async () => {
    const withContent = makeState();
    setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
    setStoreState({ gridState: withContent });
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const file = { name: 'my-map.json', type: 'application/json', text: async () => '{}' };
    fireWindow(dragEvent('dragenter'));
    fireWindow(dragEvent('drop', { files: [file] }));
    await waitFor(() => expect(screen.getByText('It replaces the map you are working on.')).toBeTruthy());
    expect(commitMock).not.toHaveBeenCalled();
    expect(screen.getByText('Replace')).toBeTruthy();
  });

  it('the confirm Replace button installs the decoded map exactly once', async () => {
    const withContent = makeState();
    setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
    setStoreState({ gridState: withContent });
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const file = { name: 'my-map.json', type: 'application/json', text: async () => '{}' };
    fireWindow(dragEvent('drop', { files: [file] }));
    const replaceBtn = await screen.findByText('Replace');
    await act(async () => { replaceBtn.click(); });
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('cancel dismisses the confirm without importing', async () => {
    const withContent = makeState();
    setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
    setStoreState({ gridState: withContent });
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const file = { name: 'my-map.json', type: 'application/json', text: async () => '{}' };
    fireWindow(dragEvent('drop', { files: [file] }));
    const cancel = await screen.findByText('Cancel');
    act(() => { cancel.click(); });
    expect(commitMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Import this map?')).toBeNull());
  });

  it('a file that fails to decode shows no confirmation and leaves the page alone', async () => {
    inspectMock.mockResolvedValue({ status: 'failed', code: 'no-payload' });
    render(<DropImportOverlay />, { wrapper: Wrapper });
    fireWindow(dragEvent('drop', { files: [{ name: 'photo.jpg', type: 'image/jpeg' }] }));
    await waitFor(() => expect(inspectMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Reading map…')).toBeNull());
    expect(screen.queryByText('Import this map?')).toBeNull();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('does not show the hint or import while the ImportModal already owns the drop (avoids a double import)', () => {
    setStoreModal('import');
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const file = { name: 'map.json', type: 'application/json', text: async () => '{}' };
    fireWindow(dragEvent('dragenter'));
    expect(screen.queryByText(HINT)).toBeNull();
    fireWindow(dragEvent('drop', { files: [file] }));
    expect(inspectMock).not.toHaveBeenCalled();
  });

  it('dragover always preventDefault()s a file-carrying drag, modal open or not (stops the browser navigating away)', () => {
    setStoreModal('import');
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const e = dragEvent('dragover');
    fireWindow(e);
    expect(e.defaultPrevented).toBe(true);
  });

  // Reentrancy: a second drop/click while an import is already running (or a decision
  // already pending) must never start a concurrent second `importFile()`, which would race
  // `loadMap` and let whichever resolves last silently win the grid state.
  describe('reentrancy guard', () => {
    it('a second drop landing while the first is still decoding is ignored, not run concurrently', async () => {
      let resolveFirst!: (v: unknown) => void;
      inspectMock.mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));
      setStoreState({ gridState: makeState() });
      render(<DropImportOverlay />, { wrapper: Wrapper });

      const fileA = { name: 'a.json', type: 'application/json', text: async () => '{}' };
      const fileB = { name: 'b.json', type: 'application/json', text: async () => '{}' };
      fireWindow(dragEvent('dragenter'));
      fireWindow(dragEvent('drop', { files: [fileA] })); // -> decoding a
      expect(inspectMock).toHaveBeenCalledTimes(1);

      // A second, unrelated drag+drop arrives before the first resolves.
      fireWindow(dragEvent('dragenter'));
      fireWindow(dragEvent('drop', { files: [fileB] }));
      expect(inspectMock).toHaveBeenCalledTimes(1); // still just the first — the race never starts
      expect(inspectMock.mock.calls[0]?.[0]).toBe(fileA);

      await act(async () => { resolveFirst(ready()); });
      await waitFor(() => expect(screen.getByText('Import this map?')).toBeTruthy());
    });

    it('a fast double-click on Replace installs the map exactly once', async () => {
      const withContent = makeState();
      setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
      setStoreState({ gridState: withContent });
      render(<DropImportOverlay />, { wrapper: Wrapper });

      const file = { name: 'my-map.json', type: 'application/json', text: async () => '{}' };
      fireWindow(dragEvent('drop', { files: [file] }));
      const replaceBtn = await screen.findByText('Replace');
      // Both clicks dispatch synchronously in the same task, before React has a chance to
      // re-render the confirm buttons away — exactly the race a fast double-click produces.
      act(() => { replaceBtn.click(); replaceBtn.click(); });
      expect(commitMock).toHaveBeenCalledTimes(1);
    });
  });

  // A drag that leaves the viewport without a matching `dragleave` (over OS chrome,
  // another application, or a second monitor) must not leave the blurred hint stuck forever.
  describe('stuck-overlay reset', () => {
    it('window blur force-clears a stuck hover hint and its depth counter', async () => {
      render(<DropImportOverlay />, { wrapper: Wrapper });
      fireWindow(dragEvent('dragenter'));
      fireWindow(dragEvent('dragenter')); // depth 2 — as if the drag wandered over nested chrome
      expect(screen.getByText(HINT)).toBeTruthy();

      act(() => { window.dispatchEvent(new Event('blur')); });
      await waitFor(() => expect(screen.queryByText(HINT)).toBeNull());

      // The counter came back to 0, not merely decremented once — a single new dragenter (depth
      // 1) shows the hint again immediately rather than needing to first cancel out a leftover 2.
      fireWindow(dragEvent('dragenter'));
      expect(screen.getByText(HINT)).toBeTruthy();
    });

    it('the tab going hidden force-clears a stuck hover hint', async () => {
      render(<DropImportOverlay />, { wrapper: Wrapper });
      fireWindow(dragEvent('dragenter'));
      expect(screen.getByText(HINT)).toBeTruthy();

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await waitFor(() => expect(screen.queryByText(HINT)).toBeNull());
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    it('does not dismiss a pending confirm on window blur', async () => {
      const withContent = makeState();
      setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
      setStoreState({ gridState: withContent });
      render(<DropImportOverlay />, { wrapper: Wrapper });
      const file = { name: 'my-map.json', type: 'application/json', text: async () => '{}' };
      fireWindow(dragEvent('drop', { files: [file] }));
      await screen.findByText('Import this map?');

      act(() => { window.dispatchEvent(new Event('blur')); });
      expect(screen.getByText('Import this map?')).toBeTruthy();
    });

    it('does not interrupt a decode in flight on window blur', async () => {
      let resolveInspect!: (v: unknown) => void;
      inspectMock.mockImplementation(() => new Promise((resolve) => { resolveInspect = resolve; }));
      setStoreState({ gridState: makeState() });
      render(<DropImportOverlay />, { wrapper: Wrapper });
      const file = { name: 'map.json', type: 'application/json', text: async () => '{}' };
      fireWindow(dragEvent('drop', { files: [file] }));
      expect(screen.getByText('Reading map…')).toBeTruthy();

      act(() => { window.dispatchEvent(new Event('blur')); });
      expect(screen.getByText('Reading map…')).toBeTruthy();
      expect(inspectMock).toHaveBeenCalledTimes(1);

      await act(async () => { resolveInspect(ready()); });
    });
  });

  // A second drop landing while a decision is already pending must not swap the pending
  // file out from under the user; the question stays about the file that was already asked about.
  it('ignores a second drop while a confirm is already pending, keeping the original file', async () => {
    inspectMock.mockResolvedValue(ready()); // no title: the card names the file
    const withContent = makeState();
    setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
    setStoreState({ gridState: withContent });
    render(<DropImportOverlay />, { wrapper: Wrapper });
    const fileA = { name: 'a.json', type: 'application/json', text: async () => '{}' };
    const fileB = { name: 'b.json', type: 'application/json', text: async () => '{}' };
    fireWindow(dragEvent('drop', { files: [fileA] }));
    await waitFor(() => expect(screen.getByText('a.json')).toBeTruthy());

    fireWindow(dragEvent('dragenter'));
    fireWindow(dragEvent('drop', { files: [fileB] }));
    expect(screen.getByText('a.json')).toBeTruthy();
    expect(screen.queryByText('b.json')).toBeNull();
    expect(inspectMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
  });

  // Passive hover and importing phases stay outside shellStack so an existing modal retains Escape.
  describe('modal stacking (passive phases)', () => {
    it('does not swallow Escape for a modal stacked underneath during the passive hover phase', () => {
      const onCloseUnderlying = vi.fn();
      render(
        <div>
          <ModalShell open onClose={onCloseUnderlying} width={300}>
            <button>Underlying</button>
          </ModalShell>
          <DropImportOverlay />
        </div>,
        { wrapper: Wrapper },
      );
      fireWindow(dragEvent('dragenter'));
      expect(screen.getByText(HINT)).toBeTruthy(); // the overlay is up, in its passive hover phase

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCloseUnderlying).toHaveBeenCalledTimes(1);
    });

    it('the confirm phase still answers Escape itself', async () => {
      const withContent = makeState();
      setTerrain(withContent, 2, 2, TerrainType.Mountain, 1);
      setStoreState({ gridState: withContent });
      render(<DropImportOverlay />, { wrapper: Wrapper });
      const file = { name: 'my-map.json', type: 'application/json', text: async () => '{}' };
      fireWindow(dragEvent('drop', { files: [file] }));
      await screen.findByText('Import this map?');

      fireEvent.keyDown(window, { key: 'Escape' });
      // exit-unmount lands a tick after the state flip, so a synchronous assertion would race it.
      await waitFor(() => expect(screen.queryByText('Import this map?')).toBeNull());
    });

    it('does not restore focus after a passive hover phase closes', async () => {
      render(
        <div>
          <button>Away</button>
          <input aria-label="target" />
          <DropImportOverlay />
        </div>,
        { wrapper: Wrapper },
      );
      const away = screen.getByRole('button', { name: 'Away' });
      const target = screen.getByRole('textbox', { name: 'target' });
      act(() => away.focus());

      fireWindow(dragEvent('dragenter')); // hover starts; its backdrop is click-through (pointerEvents:'none')
      act(() => target.focus()); // the user clicks/focuses something else WHILE the hint is up
      expect(document.activeElement).toBe(target);

      fireWindow(dragEvent('dragleave')); // hover ends
      expect(document.activeElement).toBe(target); // must not get yanked back to `away`
      await waitFor(() => expect(screen.queryByText(HINT)).toBeNull()); // let the exit-unmount settle
    });
  });
});
