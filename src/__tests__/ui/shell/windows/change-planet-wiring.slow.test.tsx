// @vitest-environment jsdom
import { afterPaint } from '../../../../platform/async/after-paint';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import type { Arrival, ArrivalLine } from '../../../../ui/session/arrival-bus';
import { subscribeArrival, __resetArrivals } from '../../../../ui/session/arrival-bus';
import { Windows } from '../../../../ui/shell/windows/Windows';
import { LiteWindows } from '../../../../ui/lite/LiteWindows';
import { transferArrival } from '../../../../ui/shell/windows/planet-arrival';
import { setToastPresenter } from '../../../../platform/channels/toast-bus';
import { I18nProvider, translateFor } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { createDefaultRegistry } from '../../../../rules';
import { createGrid } from '../../../../core/model/grid-model';
import { createGridState } from '../../../../core/model/template';
import { templateAnchor } from '../../../../core/model/landmarks';
import { MAP_TEMPLATES } from '../../../../config/maps';
import { CommandType, TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { translations } from '../../../../i18n/translations';
import type { Locale } from '../../../../core/model/locale';
import { savePlanet, type PlanetEntry } from '../../../../io/storage/planet-library';
import { planetFixture } from '../../../_support/planet';
import { createExecutor } from '../../../../state/executor';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
/** The lines a transfer that moved something reports for what it left behind. */
const linesFor = (dropped: { cells: number; objects: number }): readonly ArrivalLine[] =>
  transferArrival({ moved: { cells: 1, objects: 0 }, dropped }).detail ?? [];

/** A few cells beside the Neighbor Center, where every planet has land (PLAN-24). */
function besidePlaza(): MacroCoord {
  const plaza = templateAnchor(HEXIA)!;
  return { x: Math.round(plaza.x + plaza.width + 3), y: Math.round(plaza.y + plaza.height / 2) };
}

/** A Hexia map with one painted cell at each of `at`. */
function world(at: readonly MacroCoord[] = [besidePlaza()]) {
  const state: GridState = {
    template: HEXIA, cells: createGrid(HEXIA), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
  const executor = createExecutor(state, createDefaultRegistry());
  act(() => {
    useEditorStore.setState({ commandExecutor: executor, gridState: state, exportedAt: null, locale: 'en', tourRunning: false });
    useEditorStore.getState().setModal('newProject', true);
    // One command a cell, so a cell the rules refuse leaves the others painted.
    for (const cell of at) {
      executor.execute({ type: CommandType.PaintTerrain, cells: [cell], terrainType: TerrainType.Mountain, elevation: 1 });
    }
  });
  return { state, executor };
}

/** Cells painted as `world` paints them. */
const paintedCells = (state: GridState) => state.cells.flat()
  .filter((c) => c.terrain?.type === TerrainType.Mountain && c.terrain.elevation === 1).length;
const opened = () => useEditorStore.getState().gridState!;
/** Cells the build added to the planet that opened, over what its template paints itself. */
const built = () => paintedCells(opened()) - paintedCells(createGridState(opened().template));

/** Every arrival announced while the window is being driven. */
function heard(): Arrival[] {
  const seen: Arrival[] = [];
  subscribeArrival((a) => { seen.push(a); });
  return seen;
}

// By testid, since the button's label changes with what it will do.
const press = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('planet-switch'));
    await afterPaint();
  });
};

/** Next only moves the window to its carry step; nothing is switched yet. */
const next = press;

beforeEach(() => { __resetArrivals(); localStorage.clear(); });
afterEach(() => {
  cleanup();
  __resetArrivals();
  act(() => {
    useEditorStore.getState().setModal('newProject', false);
    useEditorStore.setState({ planetSession: null, tourRunning: false });
  });
});

describe('what the notice says a transfer cost', () => {
  // A moved coastline routinely costs a couple of hundred cells while every object arrives, so cells
  // and objects are never summed into one number.
  it('names only what was actually lost, on a line of its own', () => {
    const came = { key: 'arrival.transferred' };
    expect(linesFor({ cells: 174, objects: 2 }))
      .toEqual([came, { key: 'arrival.transferred_both', params: { cells: 174, objects: 2 } }]);
    expect(linesFor({ cells: 174, objects: 0 }))
      .toEqual([came, { key: 'arrival.transferred_ground', params: { cells: 174 } }]);
    expect(linesFor({ cells: 0, objects: 2 }))
      .toEqual([came, { key: 'arrival.transferred_pieces', params: { objects: 2 } }]);
    expect(linesFor({ cells: 0, objects: 0 })).toEqual([came]);
  });

  // The greeting follows what travelled: an empty island arrives like any boot.
  it('greets a transfer that moved nothing as a plain arrival', () => {
    expect(transferArrival({ moved: { cells: 0, objects: 0 }, dropped: { cells: 0, objects: 0 } }))
      .toEqual({ kind: 'boot' });
    // A build that left and did not land is reported, with that fact last on its own row.
    expect(transferArrival({ moved: { cells: 0, objects: 0 }, dropped: { cells: 4, objects: 0 } }))
      .toEqual({
        kind: 'transferred',
        detail: [{ key: 'arrival.transferred_lost' }, { key: 'arrival.transferred_lost_none' }],
      });
    expect(transferArrival({ moved: { cells: 1, objects: 0 }, dropped: { cells: 0, objects: 0 } }))
      .toEqual({ kind: 'transferred', detail: [{ key: 'arrival.transferred' }] });
  });

  it('and every line it can name reads as a whole sentence in every locale', () => {
    for (const locale of Object.keys(translations) as Locale[]) {
      const lines: ArrivalLine[] = [
        ...[{ cells: 1, objects: 1 }, { cells: 174, objects: 0 }, { cells: 0, objects: 3 }, { cells: 0, objects: 0 }]
          .flatMap((dropped) => [...linesFor(dropped)]),
        { key: 'arrival.transferred_lost' },
        { key: 'arrival.transferred_lost_none' },
      ];
      for (const line of lines) {
        const text = translateFor(locale, line.key, line.params);
        expect({ locale, key: line.key, text }).not.toMatchObject({ text: expect.stringContaining('{') });
        expect(text).not.toBe(line.key);
      }
    }
  });
});

describe('switching planet', () => {
  it('carries the build over and says only that it came along when nothing was lost', async () => {
    world();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await next();
    await press();

    expect(opened().template.id).toBe(TAFA.id);
    expect(built(), 'the painted cell came along').toBe(1);
    expect(seen).toEqual([{ kind: 'transferred', detail: [{ key: 'arrival.transferred' }] }]);
    expect(useEditorStore.getState().modals.newProject).toBe(false);
  });

  it('an island with nothing on it takes the fresh road, and is greeted as an ordinary arrival', async () => {
    world([]);
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    // An empty island shows no carry row, so one press switches.
    await press();

    expect(opened().template.id).toBe(TAFA.id);
    expect(seen).toEqual([{ kind: 'boot' }]);
  });

  it('choosing the planet you are on starts it over: the plain new map on this same template', async () => {
    world();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
    await press();

    expect(opened().template.id).toBe(HEXIA.id);
    expect(built(), 'the build is gone').toBe(0);
    expect(seen).toEqual([{ kind: 'boot' }]);
    expect(useEditorStore.getState().modals.newProject).toBe(false);
  });

  it('starting fresh opens the plain new map, and announces a plain arrival', async () => {
    world();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await next();
    fireEvent.click(screen.getByRole('radio', { name: 'Start fresh' }));
    await press();

    expect(opened().template.id).toBe(TAFA.id);
    expect(built()).toBe(0);
    expect(seen).toEqual([{ kind: 'boot' }]);
  });
});

describe('saved planets', () => {
  const bay = (): PlanetEntry => {
    const r = savePlanet('Bay', planetFixture());
    if (!r.ok) throw new Error('save failed');
    return r.entry;
  };

  it('[PLAN-23] opens a saved planet at once when there is nothing to carry', async () => {
    world([]);
    const entry = bay();
    render(<I18nProvider><Windows /></I18nProvider>);
    fireEvent.click(screen.getByTestId(`planet-${entry.entryId}`));
    await press();
    expect(opened().template.id).toBe(entry.template.id);
    expect([opened().template.width, opened().template.height]).toEqual([entry.template.width, entry.template.height]);
  });

  it('[PLAN-23] carries the build to a saved planet', async () => {
    world();
    const entry = bay();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);
    fireEvent.click(screen.getByTestId(`planet-${entry.entryId}`));
    await next();
    await press();
    expect(opened().template.id).toBe(entry.template.id);
    expect(paintedCells(createGridState(entry.template)), 'the saved planet opens bare').toBe(0);
    expect(built(), 'the painted cell came along').toBe(1);
    expect(seen).toEqual([{ kind: 'transferred', detail: [{ key: 'arrival.transferred' }] }]);
  });

  it('New planet closes the window and opens the planet editor', () => {
    world();
    render(<I18nProvider><Windows /></I18nProvider>);
    fireEvent.click(screen.getByTestId('planet-new'));
    expect(useEditorStore.getState().planetSession).not.toBeNull();
    expect(useEditorStore.getState().modals.newProject).toBe(false);
  });

  it('leaves the window standing when the planet editor refuses to open', () => {
    world();
    // The planet editor does not open over a running tour.
    act(() => { useEditorStore.setState({ tourRunning: true }); });
    render(<I18nProvider><Windows /></I18nProvider>);
    fireEvent.click(screen.getByTestId('planet-new'));
    expect(useEditorStore.getState().planetSession).toBeNull();
    expect(useEditorStore.getState().modals.newProject).toBe(true);
  });

  it('coming back from the planet editor reopens the window on that planet', () => {
    world();
    const entry = bay();
    act(() => { useEditorStore.getState().setModal('newProject', false); });
    render(<I18nProvider><Windows /></I18nProvider>);
    act(() => { useEditorStore.getState().returnToPlanets(entry.entryId); });
    expect(useEditorStore.getState().modals.newProject).toBe(true);
    expect(screen.getByTestId(`planet-${entry.entryId}`).getAttribute('aria-pressed')).toBe('true');
    // Closing the window releases the planet.
    act(() => { useEditorStore.getState().setModal('newProject', false); });
    expect(useEditorStore.getState().planetReturn).toBeNull();
  });
});

describe('Lite planet changes', () => {
  it('carries the build with no arrival card, and no toast when nothing was lost', async () => {
    world();
    const arrivals = heard();
    const present = vi.fn();
    const unregister = setToastPresenter(present);
    try {
      render(<I18nProvider><LiteWindows /></I18nProvider>);
      fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
      await next();
      await press();
      expect(opened().template.id).toBe(TAFA.id);
      expect(built(), 'the painted cell came along').toBe(1);
      expect(present).not.toHaveBeenCalled();
      expect(arrivals).toEqual([]);
      expect(useEditorStore.getState().modals.newProject).toBe(false);
    } finally { unregister(); }
  });

  it('starts a fresh planet without transfer feedback', async () => {
    world([]);
    const present = vi.fn();
    const unregister = setToastPresenter(present);
    try {
      render(<I18nProvider><LiteWindows /></I18nProvider>);
      fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
      await press();
      expect(opened().template.id).toBe(TAFA.id);
      expect(present).not.toHaveBeenCalled();
      expect(useEditorStore.getState().modals.newProject).toBe(false);
    } finally { unregister(); }
  });
});
