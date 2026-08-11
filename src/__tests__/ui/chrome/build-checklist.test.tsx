/*
 * BuildChecklist — the "supply shelves" rewrite: full-width category cards with a multi-column
 * item grid inside, a roads card, a compact terrain-chip card, and a copy-as-text button.
 *
 * Assertions use plain DOM checks (getAttribute / toBeTruthy / textContent), matching the sibling
 * AboutModal suite's convention (this repo does not register @testing-library/jest-dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { BuildChecklist } from '../../../ui/chrome/modals/export/BuildChecklist';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { ItemCategory, TerrainType, type GridState, type MapTemplate, type PlacedObject } from '../../../core/model/types';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import { buildChecklist, buildChecklistText } from '../../../state/build-checklist';
import { getCatalogItem } from '../../../state/catalog';
import { setStoreState } from '../../_store';

/** A small hand-built map: a couple of buildings/trees/flora, some road tiles, two terrain
 *  layers with water — enough to exercise every card without paying for a full generation run. */
function fixtureState(): GridState {
  const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);

  const place = (catalogId: string, n: number, xBase: number, yBase: number) => {
    for (let i = 0; i < n; i++) {
      const id = `fixture-${catalogId}-${i}`;
      objects.set(id, {
        id, catalogId, position: { x: xBase + i, y: yBase }, rotation: 0, elevation: 0,
      });
    }
  };
  place('building-stall', 2, 5, 5);
  place('tree-apple', 3, 5, 8);
  place('flower-daisy', 1, 5, 11);
  place('road-dirt', 4, 5, 14);

  cells[20]![20]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
  cells[20]![21]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
  cells[25]![25]!.terrain = { type: TerrainType.Water, elevation: 0 };

  return { template, cells, objects, lockedLayers: new Set() };
}

function renderChecklist() {
  const state = fixtureState();
  setStoreState({ gridState: state, locale: 'en' });
  render(
    <I18nProvider>
      <BuildChecklist />
    </I18nProvider>,
  );
  return state;
}

/** A rendered inline color as hex. jsdom normalises `background` to `rgb(r, g, b)`, so a colour
 *  swatch check on what the element ACTUALLY renders has to come back through this. */
function renderedHex(value: string): string {
  const rgb = /rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (!rgb) throw new Error(`not a color: ${value}`);
  return `#${rgb.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
  return (navigator as unknown as { clipboard: { writeText: ReturnType<typeof vi.fn> } }).clipboard.writeText;
}

beforeEach(() => {
  setStoreState({ locale: 'en' });
});

afterEach(() => {
  cleanup();
  setStoreState({ gridState: null });
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

describe('BuildChecklist — supply shelves', () => {
  it('renders one full-width card per non-empty category, each carrying its own header + count chip', () => {
    renderChecklist();
    const buildingCard = screen.getByTestId(`checklist-card-${ItemCategory.Building}`);
    expect(within(buildingCard).getByText('Buildings')).toBeTruthy();
    expect(within(buildingCard).getByText('2')).toBeTruthy();
    expect(within(buildingCard).getByTestId('checklist-item-building-stall')).toBeTruthy();

    const treeCard = screen.getByTestId(`checklist-card-${ItemCategory.Tree}`);
    expect(within(treeCard).getByText('Trees')).toBeTruthy();
    expect(within(treeCard).getByText('3')).toBeTruthy();

    // An empty category never gets a card — no collapse, but nothing to show either.
    expect(screen.queryByTestId(`checklist-card-${ItemCategory.Facility}`)).toBeNull();
  });

  it('shows the real catalog sprite for a normal item and a colour swatch for a road tile', () => {
    renderChecklist();
    const stallRow = screen.getByTestId('checklist-item-building-stall');
    // An icon's alt="" (decorative) reads as ARIA role "presentation", not "img" — query the
    // element directly rather than by role, same as the sibling AboutModal avatar test does.
    const img = stallRow.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBeTruthy();

    const roadCard = screen.getByTestId('checklist-card-roads');
    const roadRow = within(roadCard).getByTestId('checklist-item-road-dirt');
    expect(roadRow.querySelector('img')).toBeNull();
    const swatch = roadRow.querySelector('span[style*="border-radius"]');
    expect(swatch).toBeTruthy();
    expect(renderedHex((swatch as HTMLElement).style.background)).toBe(getCatalogItem('road-dirt')!.color);
  });

  it('the item name ellipses and the count sits right-aligned, bold, tabular', () => {
    renderChecklist();
    const row = screen.getByTestId('checklist-item-building-stall');
    const count = row.querySelector('span:last-child') as HTMLElement;
    expect(count.textContent).toBe('x2');
    expect(count.style.fontWeight).toBe('800');
    expect(count.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('lays item rows out in a CSS grid inside the card, not a single column', () => {
    renderChecklist();
    const buildingCard = screen.getByTestId(`checklist-card-${ItemCategory.Building}`);
    const grid = buildingCard.lastElementChild as HTMLElement;
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
  });

  it('roads keep their cell counts, wearing the same card treatment', () => {
    renderChecklist();
    const roadCard = screen.getByTestId('checklist-card-roads');
    expect(within(roadCard).getAllByText('4 cells')).toHaveLength(2); // the header chip + the one road's own row
    const row = within(roadCard).getByTestId('checklist-item-road-dirt');
    expect(within(row).getByText('4 cells')).toBeTruthy();
  });

  it('terrain is one compact card of per-layer chips, never a full-height row per layer', () => {
    renderChecklist();
    const terrainCard = screen.getByTestId('checklist-card-terrain');
    expect(within(terrainCard).getByText('Ground')).toBeTruthy();
    expect(within(terrainCard).getByText('Layer 1')).toBeTruthy();
    // Compact: header + one flex-wrap row of chips, no per-layer block taking its own line.
    expect(terrainCard.children).toHaveLength(2);
  });

  it('the two old instructional sentences are gone — the headings alone carry the meaning', () => {
    renderChecklist();
    expect(screen.queryByText(/rebuild it again by hand/i)).toBeNull();
    expect(screen.queryByText(/a block needs something under it/i)).toBeNull();
  });
});

describe('BuildChecklist — copy as text', () => {
  it('writes the exact buildChecklistText payload to the clipboard on press', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const state = renderChecklist();
    const button = screen.getByTestId('checklist-copy-button');
    const expected = buildChecklistText(buildChecklist(state), 'en', (key, params) => translateFor('en', key, params));
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expected);
  });

  it('shows a "Copied" confirmation bubble after a successful copy', async () => {
    stubClipboard(() => Promise.resolve());
    renderChecklist();
    await act(async () => {
      fireEvent.click(screen.getByTestId('checklist-copy-button'));
      await Promise.resolve();
    });
    const bubble = screen.getByRole('status');
    expect(bubble.getAttribute('aria-live')).toBe('polite');
    expect(bubble.textContent).toContain('Copied');
  });

  it('never throws when the Clipboard API is unavailable', async () => {
    renderChecklist();
    const button = screen.getByTestId('checklist-copy-button');
    await act(async () => {
      expect(() => fireEvent.click(button)).not.toThrow();
      await Promise.resolve();
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });
});
