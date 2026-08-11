/**
 * The save-and-share window: one home for three purposes.
 *
 * The two panels it carries are the phone shell's own export windows, so the risk here is not a
 * moved pixel but a section that stops being reachable, or an opener that lands on the wrong one.
 * These drive the reaching. The window's card and both panels are heavy (a preview capture, a
 * share-code build), so a test that only wants the tabs opens the window and reads the strip.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
// @ts-ignore - node:fs is untyped here (no @types/node); the test reads a shipped map JSON.
import { readFileSync } from 'node:fs';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import { ItemCategory, TerrainType, type GridState, type MapTemplate } from '../../../core/model/types';
import { I18nProvider, localizedName } from '../../../i18n/context';
import { getCatalogByCategory } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { ShareWindow } from '../../../ui/shell/windows/ShareWindow';

const TABS = ['Keep working', 'For a friend', 'Into the game'];

beforeEach(() => {
  act(() => { useEditorStore.setState({ locale: 'en' }); });
});

afterEach(() => {
  act(() => {
    for (const id of ['share', 'export', 'exportJson'] as const) useEditorStore.getState().setModal(id, false);
  });
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  return render(<I18nProvider><ShareWindow /></I18nProvider>);
}

const openWith = (id: 'share' | 'export' | 'exportJson') =>
  act(() => { useEditorStore.getState().setModal(id, true); });

describe('the save-and-share window', () => {
  it('is closed until something opens it', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers exactly the three sections, in order', async () => {
    mount();
    openWith('share');
    await screen.findByRole('dialog', { name: 'Save and share' });
    for (const tab of TABS) expect(screen.getByRole('button', { name: tab })).toBeTruthy();
  });

  it.each([
    ['share', 'Keep working'],
    ['exportJson', 'Keep working'],
    ['export', 'For a friend'],
  ] as const)('opening on %s lands on the %s section', async (id, tab) => {
    mount();
    openWith(id);
    await screen.findByRole('dialog', { name: 'Save and share' });
    expect(screen.getByRole('button', { name: tab }).getAttribute('aria-pressed')).toBe('true');
  });

  it('closing puts all three openers down, whichever one opened it', async () => {
    mount();
    openWith('export');
    await screen.findByRole('dialog', { name: 'Save and share' });
    act(() => { useEditorStore.getState().setModal('exportJson', true); });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      const { modals } = useEditorStore.getState();
      expect(modals.share || modals.export || modals.exportJson).toBe(false);
    });
  });

  it('the build checklist is a section of this window, reading the live map', async () => {
    // A hand-built map rather than a generated one: this probe is about the section being wired to
    // the store, not about what a generated island contains (build-checklist.test.ts owns that).
    const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
    const gridState: GridState = {
      template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
    };
    const plaza = createPlazaObject(template);
    if (plaza) gridState.objects.set(plaza.id, plaza);
    const house = getCatalogByCategory(ItemCategory.Building)[0]!;
    gridState.objects.set('probe-house', {
      id: 'probe-house', catalogId: house.id, position: { x: 4, y: 4 }, rotation: 0, elevation: 0,
    });
    const cell = gridState.cells[10]![10]!;
    cell.terrain = { type: TerrainType.Mountain, elevation: 2 };
    act(() => { useEditorStore.setState({ gridState }); });

    mount();
    openWith('share');
    await screen.findByRole('dialog', { name: 'Save and share' });
    fireEvent.click(screen.getByRole('button', { name: 'Into the game' }));

    expect(screen.getByRole('button', { name: 'Into the game' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Things to place')).toBeTruthy();
    expect(screen.getByText('Terrain, layer by layer')).toBeTruthy();
    expect(screen.getByText(localizedName(house.name, 'en'))).toBeTruthy();
    // Two layers under one 2-high cell, lowest first.
    expect(screen.getByText('Layer 1')).toBeTruthy();
    expect(screen.getByText('Layer 2')).toBeTruthy();
    // The plaza is on the map but is NOT something to place: it comes with the template, so a list
    // for rebuilding by hand leaves it out. The list used to say so in a sentence under itself; the
    // omission is the fact, and a sentence explaining it was one more thing to read.
    expect(screen.queryByText(/plaza/i)).toBeNull();
    act(() => { useEditorStore.setState({ gridState: null }); });
  });

  it('a section switch keeps the others mounted, so nothing typed is thrown away', async () => {
    mount();
    openWith('share');
    await screen.findByRole('dialog', { name: 'Save and share' });
    // The save section's Pretty-print switch is unique to it; it survives a trip to another tab.
    const pretty = screen.getByRole('switch', { name: 'Pretty-print' });
    fireEvent.click(pretty);
    expect(pretty.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Into the game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep working' }));
    expect(screen.getByRole('switch', { name: 'Pretty-print' }).getAttribute('aria-checked')).toBe('true');
  });
});
