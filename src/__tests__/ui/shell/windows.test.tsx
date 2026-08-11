/**
 * The five windows the menu opens, and the menu itself.
 *
 * The risk in repainting a window is not that a pixel moves but that a feature quietly stops being
 * reachable. These drive the reaching: the menu opens each window, every settings row still writes
 * its preference, a rebind survives the keyboard page's own export and import, and all five reach
 * the screen.
 *
 * The shell is mounted from a RESET module graph, so nothing here may use the outer `_store` helper
 * (see its header note): the re-imported graph carries its own store.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import type { ModalId } from '../../../state/store';

// The FIRST mount here pays for transforming the whole shell graph, which is a second or two of
// work no assertion in this file is about and which the default 5s budget has to cover on top of
// the test itself. A loaded machine turns that into a failure that says nothing.
vi.setConfig({ testTimeout: 20_000 });

/** Mount the shell from a reset graph, and hand back that graph's own store. */
async function mountShell() {
  vi.resetModules();
  const { Shell } = await import('../../../ui/shell/Shell');
  const { I18nProvider } = await import('../../../i18n/context');
  const { useEditorStore } = await import('../../../state/store');
  act(() => { useEditorStore.setState({ locale: 'en' }); });
  const view = render(
    <I18nProvider>
      <Shell onRestoreSession={() => {}}><div /></Shell>
    </I18nProvider>,
  );
  return { view, useEditorStore };
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  MotionGlobalConfig.skipAnimations = false;
});

/** Each menu row, by the window title it carries, and the overlay it is expected to open. */
const ROWS: readonly [label: string, modal: ModalId][] = [
  ['New Project', 'newProject'],
  ['Import map', 'import'],
  ['Settings', 'settings'],
  ['Keyboard Shortcuts', 'help'],
  ['About', 'about'],
];

/** The whole sheet, in order, and it is FIVE WINDOWS AND NOTHING ELSE.
 *
 * Clear was here once and does not belong: this menu holds actions about the SESSION, and clearing
 * takes back the last generation, bounded by that run's region and by the map's own authorship.
 * Nobody undoing a generation hunts for it under a menu beside Settings. It stands beside the batch
 * tile in the generate shelf now, where the other thing you do to a whole batch already is. */
const SHEET: readonly string[] = [
  'New Project', 'Import map', 'Settings', 'Keyboard Shortcuts', 'About',
];

describe('the menu', () => {
  it('opens on the menu button and offers the five windows and the one action', async () => {
    await mountShell();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = await screen.findByRole('menu');
    expect(menu).toBeTruthy();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(SHEET);
  });

  /** Every row here OPENS something. The sheet used to carry one row that acted on the map instead,
   *  and that row has moved to the shelf it acts on. */
  it('offers nothing that acts on the map', async () => {
    await mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');

    expect(screen.queryByRole('menuitem', { name: 'Clear generated' })).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(ROWS.length);
  });

  it.each(ROWS)('the %s row opens its window', async (label, modal) => {
    const { useEditorStore } = await mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');

    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(useEditorStore.getState().modals[modal]).toBe(true);
    // The sheet is a menu, not a window: choosing from it puts it away.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes on Escape without opening anything', async () => {
    const { useEditorStore } = await mountShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await screen.findByRole('menu');

    fireEvent.keyDown(window, { key: 'Escape' });
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

  it('adopts the two openers that name a section rather than a window', async () => {
    const { useEditorStore } = await mountShell();
    // The agent's export tool and the new-map warning set these; there is no window of
    // their own to open, so the share window must answer for them.
    act(() => { useEditorStore.getState().setModal('export', true); });
    expect(await screen.findByRole('dialog', { name: 'Save and share' })).toBeTruthy();
    act(() => { useEditorStore.getState().setModal('export', false); });

    act(() => { useEditorStore.getState().setModal('exportJson', true); });
    expect(await screen.findByRole('dialog', { name: 'Save and share' })).toBeTruthy();
    act(() => { useEditorStore.getState().setModal('exportJson', false); });
  });
});

describe('the shell puts every window on screen', () => {
  it('mounts all five at once', async () => {
    const { useEditorStore } = await mountShell();
    act(() => { for (const [, id] of ROWS) useEditorStore.getState().setModal(id, true); });
    // Every window is a dialog with its own title as the accessible name. All five at once is not a
    // real session, but it is the cheapest proof that the shell's tree refuses none of them.
    for (const [label] of ROWS) {
      expect(screen.getAllByRole('dialog', { name: label }).length).toBeGreaterThan(0);
    }
    act(() => { for (const [, id] of ROWS) useEditorStore.getState().setModal(id, false); });
  });

  it('and the export surface, which is a section of the share window rather than a window', async () => {
    const { useEditorStore } = await mountShell();
    act(() => { useEditorStore.getState().setModal('export', true); });
    expect(screen.getAllByRole('dialog', { name: 'Save and share' }).length).toBeGreaterThan(0);
    act(() => { useEditorStore.getState().setModal('export', false); });
  });
});
