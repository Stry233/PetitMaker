// @vitest-environment jsdom
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
import { readFileSync } from 'node:fs';
import { createGrid } from '../../../../../core/model/grid-model';
import { templateLandmarkObjects } from '../../../../../core/model/landmarks';
import { TerrainType, type GridState, type MapTemplate } from '../../../../../core/model/types';
import { I18nProvider, localizedName } from '../../../../../i18n/context';
import { getCatalogByCategory } from '../../../../../state/catalog';
import { useEditorStore, type ShareSection } from '../../../../../state/store';
import { ShareWindow } from '../../../../../ui/chrome/modals/export/ShareWindow';
import { ItemCategory } from '../../../../../config/catalog/categories';

const TABS = ['Keep working', 'For a friend', 'Into the game'];

beforeEach(() => {
  act(() => { useEditorStore.setState({ locale: 'en' }); });
});

afterEach(() => {
  act(() => {
    useEditorStore.getState().setModal('share', false);
    useEditorStore.getState().setShareTarget(null);
  });
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  return render(<I18nProvider><ShareWindow /></I18nProvider>);
}

const openWith = (section?: ShareSection) =>
  act(() => { if (section) useEditorStore.getState().openShare(section); else useEditorStore.getState().setModal('share', true); });

describe('the save-and-share window', () => {
  it('is closed until something opens it', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers exactly the three sections, in order', async () => {
    mount();
    openWith();
    await screen.findByRole('dialog', { name: 'Save and share' });
    for (const tab of TABS) expect(screen.getByRole('button', { name: tab })).toBeTruthy();
  });

  it.each([
    [undefined, 'Keep working'],
    ['keep', 'Keep working'],
    ['friend', 'For a friend'],
    ['game', 'Into the game'],
  ] as const)('opening at %s lands on the %s section', async (section, tab) => {
    mount();
    openWith(section);
    await screen.findByRole('dialog', { name: 'Save and share' });
    expect(screen.getByRole('button', { name: tab }).getAttribute('aria-pressed')).toBe('true');
  });

  it('consumes the section it opened at, so a plain reopen lands on the first section', async () => {
    mount();
    openWith('friend');
    await screen.findByRole('dialog', { name: 'Save and share' });
    expect(useEditorStore.getState().shareTarget).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(useEditorStore.getState().modals.share).toBe(false));
  });

  it('the build checklist is a section of this window, reading the live map', async () => {
    // A hand-built map rather than a generated one: this probe is about the section being wired to
    // the store, not about what a generated island contains (build-checklist.test.ts owns that).
    const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
    const gridState: GridState = {
      template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
    };
    const plaza = (templateLandmarkObjects(template)[0] ?? null);
    if (plaza) gridState.objects.set(plaza.id, plaza);
    const house = getCatalogByCategory(ItemCategory.Building)[0]!;
    gridState.objects.set('probe-house', {
      id: 'probe-house', catalogId: house.id, position: { x: 4, y: 4 }, rotation: 0, elevation: 0,
    });
    const cell = gridState.cells[10]![10]!;
    cell.terrain = { type: TerrainType.Mountain, elevation: 2 };
    act(() => { useEditorStore.setState({ gridState }); });

    mount();
    openWith();
    await screen.findByRole('dialog', { name: 'Save and share' });
    fireEvent.click(screen.getByRole('button', { name: 'Into the game' }));

    expect(screen.getByRole('button', { name: 'Into the game' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Things to place')).toBeTruthy();
    expect(screen.getByText('Terrain, layer by layer')).toBeTruthy();
    expect(screen.getByText(localizedName(house.name, 'en'))).toBeTruthy();
    // Two layers under one 2-high cell, lowest first.
    expect(screen.getByText('Layer 2')).toBeTruthy();
    expect(screen.getByText('Layer 3')).toBeTruthy();
    // The plaza is on the map but is not something to place: it comes with the template, so a list
    // for rebuilding by hand leaves it out. The omission is the fact: a sentence under the list
    // explaining it is one more thing to read.
    expect(screen.queryByText(/plaza/i)).toBeNull();
    act(() => { useEditorStore.setState({ gridState: null }); });
  });

  it('a section switch keeps the others mounted, so nothing typed is thrown away', async () => {
    mount();
    openWith();
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
