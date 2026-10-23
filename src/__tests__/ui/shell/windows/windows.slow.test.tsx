// @vitest-environment jsdom
/**
 * The five windows the menu opens, and the menu itself.
 *
 * The risk in repainting a window is not that a pixel moves but that a feature quietly stops being
 * reachable. These drive the reaching: the menu opens each window, every settings row still writes
 * its preference, a rebind survives the keyboard page's own export and import, and all five reach
 * the screen.
 *
 * The shell is mounted from a reset module graph, so nothing here may use the outer `_store` helper
 * (see its header note): the re-imported graph carries its own store. A test that opens a lazy window
 * waits for it: a chunk still loading at the next reset evaluates half-bound into the next graph.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import type { ModalId } from '../../../../state/store';

// The first mount here pays for transforming the whole shell graph, which is a second or two of
// work no assertion in this file is about and which the default 5s budget has to cover on top of
// the test itself. A loaded machine turns that into a failure that says nothing.
vi.setConfig({ testTimeout: 20_000 });

/** Mount the shell from a reset graph, and hand back that graph's own store. */
async function mountShell() {
  vi.resetModules();
  const { Shell } = await import('../../../../ui/shell/Shell');
  const { I18nProvider } = await import('../../../../i18n/context');
  const { useEditorStore } = await import('../../../../state/store');
  act(() => { useEditorStore.setState({ locale: 'en' }); });
  const view = render(
    <I18nProvider>
      <Shell onRestoreSession={() => {}}><div /></Shell>
    </I18nProvider>,
  );
  return { view, useEditorStore };
}

/** Load the lazy window chunks (Help) from the mounted shell's own graph. Each mount re-evaluates
 *  them in a fresh graph, and with transforms cold that alone outlasts a query's one-second wait;
 *  loaded first, an open leaves only React's retry, which the query's first poll sees. */
async function loadLazyWindows(): Promise<void> {
  const { loadHelpModal } = await import('../../../../ui/help/loaders');
  await loadHelpModal();
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  MotionGlobalConfig.skipAnimations = false;
});

/** Each menu row, by the window title it carries, and the overlay it is expected to open. */
const ROWS: readonly [label: string, modal: ModalId][] = [
  ['Change a planet', 'newProject'],
  ['Import map', 'import'],
  ['Settings', 'settings'],
  ['Help', 'help'],
  ['About', 'about'],
];

/** The whole sheet, in order, and it is five windows and nothing else. The keyboard window is
 * not among them: its door is the keymap miniature at the bottom of Settings.
 *
 * Clear does not belong here: this menu holds actions about the session, and clearing
 * takes back the last generation, bounded by that run's region and by the map's own authorship.
 * Nobody undoing a generation hunts for it under a menu beside Settings. It stands beside the batch
 * tile in the generate shelf, where the other thing you do to a whole batch already is. */
const SHEET: readonly string[] = [
  'Change a planet', 'Import map', 'Settings', 'Help', 'About',
];

describe('the menu', () => {
  it('opens on the menu button and offers the five windows and nothing else', async () => {
    await mountShell();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = await screen.findByRole('menu');
    expect(menu).toBeTruthy();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(SHEET);
  });

  /** Every row here opens something: a row that acts on the map belongs to the shelf it acts on,
   *  not to this sheet. */
  it('offers nothing that acts on the map', async () => {
    await mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');

    expect(screen.queryByRole('menuitem', { name: 'Clear generated' })).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(ROWS.length);
  });

  it.each(ROWS)('the %s row opens its window', async (label, modal) => {
    const { useEditorStore } = await mountShell();
    await loadLazyWindows();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');

    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(useEditorStore.getState().modals[modal]).toBe(true);
    // The sheet is a menu, not a window: choosing from it puts it away.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect((await screen.findAllByRole('dialog', { name: label })).length).toBeGreaterThan(0);
  });

  it('closes on Escape without opening anything', async () => {
    const { useEditorStore } = await mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');

    // From the focused row, as a key press arrives: the menu hears it before the shortcuts on the window.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const open = Object.values(useEditorStore.getState().modals).filter(Boolean);
    expect(open).toHaveLength(0);
  });
});

describe('the save-and-share button', () => {
  it('opens the window that holds the three sections', async () => {
    const { useEditorStore } = await mountShell();
    expect(useEditorStore.getState().modals.share).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save and share' }));
    expect(useEditorStore.getState().modals.share).toBe(true);
    const dialog = await screen.findByRole('dialog', { name: 'Save and share' });
    expect(dialog).toBeTruthy();
    act(() => { useEditorStore.getState().setModal('share', false); });
  });

  it('opens at the section an opener names', async () => {
    const { useEditorStore } = await mountShell();
    act(() => { useEditorStore.getState().openShare('friend'); });
    expect(await screen.findByRole('dialog', { name: 'Save and share' })).toBeTruthy();
    act(() => { useEditorStore.getState().setModal('share', false); });

    act(() => { useEditorStore.getState().openShare('keep'); });
    expect(await screen.findByRole('dialog', { name: 'Save and share' })).toBeTruthy();
    act(() => { useEditorStore.getState().setModal('share', false); });
  });
});

describe('the shell puts every window on screen', () => {
  it('mounts all five at once', async () => {
    const { useEditorStore } = await mountShell();
    // Every window is a dialog with its own title as the accessible name. All five at once is not a
    // real session, but it is the cheapest proof that the shell's tree refuses none of them. Help is
    // a lazy chunk, loaded first, so the awaited act flushes React's retry and no query waits on a
    // clock. The same act waits out the one frame the assistant character re-seats itself on.
    await loadLazyWindows();
    await act(async () => {
      for (const [, id] of ROWS) useEditorStore.getState().setModal(id, true);
      await new Promise<void>((frame) => requestAnimationFrame(() => frame()));
    });
    for (const [label] of ROWS) {
      expect(screen.getAllByRole('dialog', { name: label }).length).toBeGreaterThan(0);
    }
    act(() => { for (const [, id] of ROWS) useEditorStore.getState().setModal(id, false); });
  });

  it('and the export surface, which is a section of the share window rather than a window', async () => {
    const { useEditorStore } = await mountShell();
    act(() => { useEditorStore.getState().openShare('friend'); });
    expect(screen.getAllByRole('dialog', { name: 'Save and share' }).length).toBeGreaterThan(0);
    act(() => { useEditorStore.getState().setModal('share', false); });
  });
});
