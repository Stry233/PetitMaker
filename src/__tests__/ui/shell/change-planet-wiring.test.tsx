import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import type { Arrival, ArrivalLine } from '../../../core/runtime/arrival-bus';
import { subscribeArrival, __resetArrivals } from '../../../core/runtime/arrival-bus';
import { Windows } from '../../../ui/shell/windows/Windows';
import { LiteWindows } from '../../../ui/lite/LiteWindows';
import { transferArrival, transferLines } from '../../../ui/shell/windows/planet-arrival';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { createGrid } from '../../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../../config/maps';
import { CommandType, TerrainType, type EditorEvents, type GridState } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import { translateFor } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import type { Locale } from '../../../core/model/types';
import { newMap, transferMap } from '../../../kit/operations';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;

// The two verbs are the operations layer's, and they are exercised on their own elsewhere: what is
// under test here is which one the window reaches for and what it says afterwards.
vi.mock('../../../kit/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../kit/operations')>()),
  newMap: vi.fn(),
  transferMap: vi.fn(() => ({
    target: TAFA, offset: { x: 0, y: 1 }, carried: true,
    moved: { cells: 100, objects: 5 }, dropped: { cells: 3, objects: 1 }, violations: [],
  })),
}));

function world({ built = true }: { built?: boolean } = {}) {
  const state: GridState = {
    template: HEXIA, cells: createGrid(HEXIA), objects: new Map(), lockedLayers: new Set(),
  };
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  act(() => {
    useEditorStore.setState({ commandExecutor: executor, gridState: state, exportedAt: null, locale: 'en' });
    useEditorStore.getState().setModal('newProject', true);
    if (built) {
      executor.execute({
        type: CommandType.PaintTerrain, timestamp: 1, cells: [{ x: 40, y: 60 }],
        terrainType: TerrainType.Mountain, elevation: 1,
      });
    }
  });
  return { state, executor };
}

/** Every arrival announced while the window is being driven. */
function heard(): Arrival[] {
  const seen: Arrival[] = [];
  subscribeArrival((a) => { seen.push(a); });
  return seen;
}

// By testid: the verb is named for what it will do, and starting over does not say "switch".
const press = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('planet-switch'));
    await new Promise((r) => { setTimeout(r, 0); });
  });
};

beforeEach(() => { __resetArrivals(); vi.clearAllMocks(); });
afterEach(() => {
  cleanup();
  __resetArrivals();
  act(() => { useEditorStore.getState().setModal('newProject', false); });
});

describe('what the notice says a transfer cost', () => {
  /* Ground and pieces are different nouns at different scales: a moved coastline routinely costs a
     couple of hundred terrain cells while every object arrives, so one number over both would
     report that as a catastrophe against a card that counts pieces. */
  it('names only what was actually lost, on a line of its own', () => {
    const came = { key: 'arrival.transferred' };
    // What came along and what did not are two facts, so they are two lines: chained into one row
    // they were a sentence read over a map, which is a sentence not read.
    expect(transferLines({ cells: 174, objects: 2 }))
      .toEqual([came, { key: 'arrival.transferred_both', params: { cells: 174, objects: 2 } }]);
    expect(transferLines({ cells: 174, objects: 0 }))
      .toEqual([came, { key: 'arrival.transferred_ground', params: { cells: 174 } }]);
    expect(transferLines({ cells: 0, objects: 2 }))
      .toEqual([came, { key: 'arrival.transferred_pieces', params: { objects: 2 } }]);
    // Nothing lost is one line and then silence.
    expect(transferLines({ cells: 0, objects: 0 })).toEqual([came]);
  });

  /* The greeting is about what TRAVELLED, not about which button was pressed: an island with
     nothing on it arrives on the new planet like any other boot. */
  it('greets a transfer that moved nothing as a plain arrival', () => {
    expect(transferArrival({ moved: { cells: 0, objects: 0 }, dropped: { cells: 0, objects: 0 } }))
      .toEqual({ kind: 'boot' });
    // A build that went and did not land is the moment the report exists for, so it says that
    // instead of the greeting for a journey nothing made.
    // What the coast did, and what became of the build: the fact stands LAST, on its own row, where
    // it is what the notice is left saying.
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
          .flatMap((dropped) => [...transferLines(dropped)]),
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
  it('carries the build over and reports what did not fit', async () => {
    world();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await press();

    expect(transferMap).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transferMap).mock.calls[0]![1]).toEqual({ target: TAFA.id, carry: true });
    expect(newMap).not.toHaveBeenCalled();
    expect(seen).toEqual([{
      kind: 'transferred',
      detail: [
        { key: 'arrival.transferred' },
        { key: 'arrival.transferred_both', params: { cells: 3, objects: 1 } },
      ],
    }]);
    expect(useEditorStore.getState().modals.newProject).toBe(false);
  });

  it('says only that the build came along when nothing was lost', async () => {
    world();
    vi.mocked(transferMap).mockReturnValueOnce({
      target: TAFA, offset: { x: 0, y: 1 }, carried: true,
      moved: { cells: 100, objects: 5 }, dropped: { cells: 0, objects: 0 }, violations: [],
    });
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await press();

    expect(seen).toEqual([{ kind: 'transferred', detail: [{ key: 'arrival.transferred' }] }]);
  });

  it('an island with nothing on it takes the fresh road, and is greeted as an ordinary arrival', async () => {
    world({ built: false });
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    await press();

    // No carry row is on screen for an empty island, so the default it still holds is not an answer
    // anyone gave — and a replay that moves an empty grid is 200ms spent on nothing.
    expect(transferMap).not.toHaveBeenCalled();
    expect(newMap).toHaveBeenCalledWith(TAFA.id);
    expect(seen).toEqual([{ kind: 'boot' }]);
  });

  it('choosing the planet you are on starts it over: the plain new map on this same template', async () => {
    world();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${HEXIA.id}`));
    await press();

    expect(newMap).toHaveBeenCalledWith(HEXIA.id);
    expect(transferMap).not.toHaveBeenCalled();
    expect(seen).toEqual([{ kind: 'boot' }]);
    expect(useEditorStore.getState().modals.newProject).toBe(false);
  });

  it('starting fresh opens the plain new map, and announces a plain arrival', async () => {
    world();
    const seen = heard();
    render(<I18nProvider><Windows /></I18nProvider>);

    fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    await press();

    expect(newMap).toHaveBeenCalledWith(TAFA.id);
    expect(transferMap).not.toHaveBeenCalled();
    expect(seen).toEqual([{ kind: 'boot' }]);
  });
});

describe('Lite planet changes', () => {
  it('uses the shared transfer and reports dropped content through a toast', async () => {
    world();
    const arrivals = heard();
    const present = vi.fn();
    const unregister = setToastPresenter(present);
    try {
      render(<I18nProvider><LiteWindows /></I18nProvider>);
      fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
      await press();
      expect(transferMap).toHaveBeenCalledTimes(1);
      expect(vi.mocked(transferMap).mock.calls[0]![1]).toEqual({ target: TAFA.id, carry: true });
      expect(present).toHaveBeenCalledWith(translateFor('en', 'arrival.transferred_both', { cells: 3, objects: 1 }), 'info');
      expect(arrivals).toEqual([]);
      expect(useEditorStore.getState().editMode.mode).toBe(null);
      expect(useEditorStore.getState().modals.newProject).toBe(false);
    } finally { unregister(); }
  });

  it('starts a fresh planet without transfer feedback', async () => {
    world({ built: false });
    const present = vi.fn();
    const unregister = setToastPresenter(present);
    try {
      render(<I18nProvider><LiteWindows /></I18nProvider>);
      fireEvent.click(screen.getByTestId(`planet-${TAFA.id}`));
      await press();
      expect(newMap).toHaveBeenCalledWith(TAFA.id);
      expect(transferMap).not.toHaveBeenCalled();
      expect(present).not.toHaveBeenCalled();
      expect(useEditorStore.getState().modals.newProject).toBe(false);
    } finally { unregister(); }
  });
});
