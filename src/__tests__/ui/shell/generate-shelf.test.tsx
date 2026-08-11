/**
 * The generate shelf: the candidate mechanic, the maze marks, the three bands and the ranges.
 *
 * The candidate mechanic runs the REAL generator on a DETACHED copy of the map, so the two
 * assertions that matter are that a map the user built is untouched by every measure there is
 * after a batch and two rerolls, and that the picture a candidate shows is the map that clicking
 * it produces. A stub would prove nothing about either.
 *
 * The component tests stub the candidate building (it is the slow part and it is proved above) and
 * keep everything else real, so what they assert is the wiring: which cells the maze marks, what a
 * run takes, and where each slider's ends come from. The row of names is pinned by the DECISIONS
 * that hold it still — the edge it hangs from and the declared height of the block under it — since
 * jsdom lays nothing out and a rect assertion would only restate the constants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../kit/operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../kit/operations')>();
  return {
    ...actual,
    generateCandidate: vi.fn(actual.generateCandidate),
    generateMap: vi.fn(actual.generateMap),
  };
});

import { setActiveView } from '../../../canvas/active-view';
import type { ActiveView } from '../../../canvas/view-projection';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { ELEVATION_MAX } from '../../../core/model/constants';
import {
  CommandType, ItemCategory, TerrainType,
  type GenerateConfig, type GridState, type MacroCoord,
} from '../../../core/model/types';
import { I18nProvider } from '../../../i18n/context';
import type { KitContext } from '../../../kit/context';
import { serialize } from '../../../io/json-codec';
// The component reads the barrel, which is mocked above; these are the real implementations.
import { clearGenerated, generateCandidate, generateMap } from '../../../kit/operations/generate';
import { generateCandidate as barrelCandidate, generateMap as barrelGenerateMap } from '../../../kit/operations';
import type { Candidate } from '../../../kit/operations';
import { getCatalogByCategory } from '../../../state/catalog';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import { ScaleProvider } from '../../../ui/design/scale';
import { GenerateShelf } from '../../../ui/shell/bars/GenerateShelf';
import { MazeEndpoints } from '../../../ui/shell/bars/MazeEndpoints';
import {
  BODY_H, CANDIDATES, CARD_H, CARD_MAX_H, GAP, PAD, SEED_DIGITS, SLIDERS, STRIP, TABS,
  batchSeeds, maxElevationFor, shelfConfig,
} from '../../../ui/shell/bars/generate-shelf';
import { ROW, SCROLL, SEARCH, SHELF_BOX, tabRowGap } from '../../../ui/shell/bars/object-shelf';
import { SHELF_SCALE, SHELF_TABS, standsInNameRow } from '../../../ui/shell/units';
import { makeState, placeCmd } from '../../rules/_helpers';

/** Small enough that a batch of real generations is cheap, large enough that they build something. */
const SIZE = 40;

/**
 * The map itself: cells, objects, and the per-cell and per-object taint that says who made each of
 * them. Object ids are KEPT: nothing about a candidate reaches this map, so every id it carried is
 * still the id it carries.
 *
 * The ledger is compared separately, because it is a HISTORY that never rewinds. A candidate must
 * not add to it at all, not even the `reverted` entry an undone edit of any kind leaves behind.
 */
function snapshot(state: GridState): string {
  const parsed = JSON.parse(serialize(state));
  delete parsed.metadata;
  delete parsed.provenance?.ledger;
  delete parsed.provenance?.session;
  return JSON.stringify(parsed);
}

function ledger(state: GridState): { id: string; status: string }[] {
  const parsed = JSON.parse(serialize(state));
  return parsed.provenance?.ledger ?? [];
}

/** The same map by VALUE, with the object ids dropped: an id is minted per placement and is
 *  deliberately not seed-derived, so two runs of one recipe build the same map under different
 *  ids. What must match is everything else. */
function mapValue(state: GridState): string {
  const parsed = JSON.parse(serialize(state));
  return JSON.stringify({
    cells: parsed.cells,
    objects: (parsed.objects as Record<string, unknown>[]).map(({ id, ...rest }) => rest),
  });
}

function makeKit(): KitContext {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(state));
  return { state, executor: exec, registry: exec.getRegistry() };
}

/** The same kit, installed where `currentKit()` reads it from. */
function installKit(): KitContext {
  const kit = makeKit();
  useEditorStore.setState({ gridState: kit.state, commandExecutor: kit.executor as CommandExecutor });
  return kit;
}

/** One island recipe with the seed left open, so a test can vary a single term of it. */
const ISLAND = {
  kind: 'earth', naturalness: 100, maxElevation: 4, corridorWidth: 1, gates: null,
} as const;

const island = (seed: number): GenerateConfig => shelfConfig({ ...ISLAND, seed });

const maze = (seed: number, gates: { entrance: MacroCoord | null; exit: MacroCoord | null } | null): GenerateConfig =>
  shelfConfig({ kind: 'maze', seed, naturalness: 100, maxElevation: 3, corridorWidth: 1, gates });

function mount() {
  useEditorStore.getState().setEditMode({ mode: 'generate' });
  return render(
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <GenerateShelf />
      </ScaleProvider>
    </I18nProvider>,
  );
}

/** Let the debounced picture pass fire and finish. The bar prints no report, so what says it has
 *  stopped working is its own actions coming back: they are refused while a batch is being built. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 420)); });
  await waitFor(() => expect(
    screen.getByRole('button', { name: 'New batch' }).getAttribute('aria-disabled'),
  ).toBe('false'));
}

/** Type a recipe number into the last card and confirm it, which is the one way to make the batch
 *  deterministic: every other card's seed is drawn from a random base per mount. */
async function typeRecipe(seed: number): Promise<void> {
  fireEvent.change(screen.getByLabelText('Your own recipe'), { target: { value: String(seed) } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this recipe number' }));
  await settle();
}

/** The recipe numbers the cards are showing, in the order they stand. */
function shownSeeds(): number[] {
  return screen.getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('Recipe: '))
    .map((label) => Number(label.slice('Recipe: '.length)));
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', region: [], selectingRegion: false });
  vi.mocked(barrelCandidate).mockClear();
  vi.mocked(barrelCandidate).mockImplementation(async () => null);
  vi.mocked(barrelGenerateMap).mockClear();
  vi.mocked(barrelGenerateMap).mockImplementation(generateMap);
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [], selectingRegion: false });
  useEditorStore.getState().setEditMode({ mode: null });
});

/** Terrain and a tree the person put there, so the map under the shelf is somebody's work rather
 *  than a generator's. One stroke group, so it is one undo entry like any hand edit. */
function buildByHand(kit: KitContext): void {
  const watermark = kit.executor.getUndoStackSize();
  const cells: MacroCoord[] = [];
  for (let y = 4; y <= 9; y++) for (let x = 4; x <= 9; x++) cells.push({ x, y });
  kit.executor.execute({ type: CommandType.PaintTerrain, timestamp: 1, cells, terrainType: TerrainType.Mountain, elevation: 1 });
  kit.executor.execute(placeCmd({
    id: 'by-hand', catalogId: getCatalogByCategory(ItemCategory.Tree)[0]!.id,
    position: { x: 20, y: 20 }, rotation: 0, elevation: 0,
  }));
  kit.executor.commitStroke(watermark);
}

const rect = (x0: number, y0: number, x1: number, y1: number): MacroCoord[] => {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};

const painted = (state: GridState): number => state.cells.flat().filter((c) => c.terrain).length;

describe('a candidate', () => {
  it('leaves a map that somebody built exactly as it was, through a batch and two rerolls', async () => {
    const kit = makeKit();
    // An island first, so the recorded recipe holds something a candidate could overwrite, then
    // hand work on top of it: an empty map would pass this test without proving anything.
    await generateMap(kit, { config: island(4242), region: null });
    buildByHand(kit);

    const before = snapshot(kit.state);
    const stack = kit.executor.getUndoStackSize();
    const recipe = kit.state.generation;
    const wrote = ledger(kit.state);

    for (const base of [777, 31337, 90210]) {
      for (const seed of batchSeeds(base)) {
        const candidate = await generateCandidate(kit, { config: island(seed), region: null });
        expect(candidate).not.toBeNull();
        expect(candidate!.state).not.toBe(kit.state);
        expect(painted(candidate!.state)).toBeGreaterThan(0);
      }
    }

    expect(snapshot(kit.state)).toBe(before);
    expect(kit.executor.getUndoStackSize()).toBe(stack);
    expect(kit.state.generation).toEqual(recipe);
    // Not "restores the ledger": nothing is written to it, because nothing here happened to this map.
    expect(ledger(kit.state)).toEqual(wrote);
  }, 300_000);

  it('does not move the scope that Clear is bounded by', async () => {
    const kit = makeKit();
    await generateMap(kit, { config: island(4242), region: null });   // the whole map, so Clear is unbounded
    expect(painted(kit.state)).toBeGreaterThan(0);

    await generateCandidate(kit, { config: island(88), region: rect(2, 2, 6, 6) });

    clearGenerated(kit, { region: null });
    expect(painted(kit.state)).toBe(0);
  }, 60_000);

  it('is a picture of the map that clicking it produces', async () => {
    const kit = makeKit();
    const candidate = await generateCandidate(kit, { config: island(31415), region: null });
    expect(candidate).not.toBeNull();

    await generateMap(kit, { config: island(31415), region: null });

    // By VALUE, which is the whole of what a picture can show: the card is a photograph of this
    // grid taken by the renderer that draws the live one, so two grids that agree here cannot
    // photograph differently.
    expect(mapValue(kit.state)).toBe(mapValue(candidate!.state));
  }, 60_000);

  it('builds a different map per recipe, so the row is a row of choices', async () => {
    const kit = makeKit();
    const maps = new Set<string>();
    for (const seed of batchSeeds(5150)) {
      const candidate = await generateCandidate(kit, { config: island(seed), region: null });
      maps.add(mapValue(candidate!.state));
    }
    expect(maps.size).toBe(CANDIDATES);
  }, 120_000);
});

describe('the maze ends', () => {
  /** An end asked for INSIDE the maze is a destination: it stays inside, on a cell a walker can
   *  stand on. The old model could not express one and moved it to the map's edge instead. */
  it('reports an interior request as a place inside, not as a hole in the wall', async () => {
    const kit = makeKit();
    const asked = { entrance: { x: 12, y: 14 }, exit: null };
    const outcome = await generateMap(kit, { config: maze(9, asked), region: null });

    const landed = outcome.mazeGates?.entrance;
    expect(landed).toBeTruthy();
    const onBorder = landed!.x === 0 || landed!.y === 0 || landed!.x === SIZE - 1 || landed!.y === SIZE - 1;
    expect(onBorder).toBe(false);
    expect(kit.state.cells[landed!.y]![landed!.x]!.terrain ?? null).toBeNull();
  }, 30_000);

  /**
   * THE ENDS ARE OPT-IN: a landed default maze puts no marks up and offers no way switch — the
   * generator chose the pair, and a strip that carried the way's control anyway would answer for
   * ends nobody chose. Flipping "in and out" adopts the LANDED pair, so the marks appear where the
   * maze's ends already are, and the way's switch arrives with them.
   */
  it('keeps the map clear of marks by default, and adopts the landed pair when the ends are chosen', async () => {
    installKit();
    setActiveView({
      projection: { screenToMacro: () => ({ x: 0, y: 0 }), cellToScreen: () => ({ x: 0, y: 0, scale: 1 }) },
      overlay: { flashCommit: () => {}, showRoute: () => {}, clearRoute: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(vi.mocked(barrelGenerateMap)).toHaveBeenCalled());
    expect(screen.queryByTestId('shell-gate-entrance'), 'no marks uninvited').toBeNull();
    expect(screen.queryByTestId('shell-gen-route'), 'no way switch uninvited').toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());
    const kinds = ['shell-gate-entrance', 'shell-gate-exit']
      .map((id) => screen.getByTestId(id).getAttribute('data-kind'));
    for (const kind of kinds) expect(['hole', 'target']).toContain(kind);
    expect(within(screen.getByTestId('shell-gen-strip')).getByTestId('shell-gen-route')).toBeTruthy();
  }, 60_000);

  /**
   * THE DRAG IS THE WHOLE INTERACTION, so it is driven here rather than described: a press on the
   * mark, a move over the map, a release. An end is a RECIPE INPUT — the carve grows out from the
   * entrance — so the drop re-runs the landed recipe with the moved pair as gates, and the whole
   * maze answers rather than one cell of wall.
   */
  it('re-runs the recipe with the dropped end as an input', async () => {
    const kit = installKit();
    // A projection that IS the map's own grid, so the test can aim at a cell by name.
    setActiveView({
      projection: {
        screenToMacro: (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) }),
        cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }),
      },
      overlay: { flashCommit: () => {}, showRoute: () => {}, clearRoute: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await settle();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    // The maze has to be STANDING before the drag: a drop while a run is landing is refused, and a
    // refused drop would leave this asserting on the marks alone.
    await waitFor(() => expect(kit.executor.getUndoStackSize()).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());

    const mark = () => screen.getByTestId('shell-gate-entrance');
    const was = mark().getAttribute('data-cell')!;
    const [wx, wy] = was.split(',').map(Number) as [number, number];
    // Along the wall it stands on, far enough that the nearest place to cut is a different one.
    const onTopOrBottom = wy === 0 || wy === SIZE - 1;
    const to = onTopOrBottom ? { x: wx + 6, y: wy } : { x: wx, y: wy + 6 };
    const undoBefore = kit.executor.getUndoStackSize();

    // jsdom has no PointerEvent, and the fallback event RTL builds for one carries no coordinates —
    // which is the whole of what a drag is. A MouseEvent under the pointer event's own name has
    // them, and the listeners are on the window by name.
    const at = (type: string, c: { x: number; y: number }): MouseEvent =>
      new MouseEvent(type, { clientX: c.x, clientY: c.y, bubbles: true });
    await act(async () => {
      fireEvent.pointerDown(mark(), { clientX: wx, clientY: wy });
      window.dispatchEvent(at('pointermove', to));
      window.dispatchEvent(at('pointerup', to));
    });

    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());
    const now = mark().getAttribute('data-cell')!;
    expect(now).not.toBe(was);
    expect(mark().getAttribute('data-kind')).toBe('hole');
    // The drop was a generation: one more entry to undo, and the new way in is open on the map.
    await waitFor(() => expect(kit.executor.getUndoStackSize()).toBe(undoBefore + 1));
    const [nx, ny] = now.split(',').map(Number) as [number, number];
    expect(kit.state.cells[ny]![nx]!.terrain ?? null).toBeNull();
  }, 60_000);

  it('draws nothing until a run has put a maze on the map', () => {
    render(<I18nProvider><MazeEndpoints ends={null} onMove={() => {}} /></I18nProvider>);
    expect(screen.queryByTestId('shell-gate-entrance')).toBeNull();
  });

  /**
   * THE ENDS ARE SETTINGS, NOT PROPERTIES OF A LANDED MAZE: the moment they are asked for the
   * marks stand, draggable, with no card clicked — they are inputs to every run the tab can make.
   * The old model showed them only after a landing, which made the inputs unreachable until the
   * thing they were inputs TO had already run without them.
   */
  it('offers both marks the moment the ends are chosen, before any run', async () => {
    installKit();
    setActiveView({
      projection: { screenToMacro: () => ({ x: 0, y: 0 }), cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }) },
      overlay: { flashCommit: () => {}, showRoute: () => {}, clearRoute: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull();
    expect(screen.queryByTestId('shell-gate-exit')).not.toBeNull();
    expect(vi.mocked(barrelGenerateMap), 'no run was needed to get them').not.toHaveBeenCalled();
  });

  /**
   * THE WAY IS A DRAPE, and it fits the corridor: a road's flat sweep reaches the wall beside
   * every corridor lane, so the answer cannot legally be paved — it is drawn instead, on the
   * TERRAIN grid, because the walls render at −HALF_TILE and the visible corridor floor between
   * two of them is the corridor cell's terrain-shifted rect. The drape follows the switch both
   * ways, and every cell of it is corridor or gate, never wall.
   */
  it('drapes the way over the corridors when switched on, and takes it down when off', async () => {
    const kit = installKit();
    const shown: MacroCoord[][] = [];
    let cleared = 0;
    setActiveView({
      projection: { screenToMacro: () => ({ x: 0, y: 0 }), cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }) },
      overlay: {
        flashCommit: () => {},
        showRoute: (cells: MacroCoord[]) => { shown.push(cells); },
        clearRoute: () => { cleared += 1; },
      },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await settle();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    // The marks stand BEFORE any run (the test above pins that), so the gate-entrance wait grants
    // the run no time; the undo stack is what says the run actually landed. Without it, the click's
    // macrotask yield (generateMap's own) can outrun this test and the drape reads an empty maze.
    await waitFor(() => expect(kit.executor.getUndoStackSize()).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show the way' })); });
    expect(shown.length, 'the drape went up').toBeGreaterThan(0);
    const route = shown[shown.length - 1]!;
    expect(route.length).toBeGreaterThan(1);
    // Corridor floor or a gate's own ring cell — never a standing wall away from the two holes.
    const gates = ['shell-gate-entrance', 'shell-gate-exit']
      .map((id) => screen.getByTestId(id).getAttribute('data-cell'));
    for (const c of route) {
      const walled = kit.state.cells[c.y]![c.x]!.terrain !== null;
      expect(`wall:${walled && !gates.includes(`${c.x},${c.y}`)}`).toBe('wall:false');
    }

    const before = cleared;
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show the way' })); });
    expect(cleared, 'the drape came down').toBeGreaterThan(before);
  });
});

describe('a run', () => {
  it('takes the whole map where no region is painted', async () => {
    const kit = installKit();
    mount();
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    // The map records the recipe it was built from, which only a FULL run is reproducible from.
    await waitFor(() => expect(kit.state.generation).toBeTruthy());

    let outside = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if (kit.state.cells[y]![x]!.terrain && (x > 8 || y > 8)) outside++;
    }
    expect(outside).toBeGreaterThan(0);
  }, 60_000);

  /** The scope is the painted region, which is the whole point of the chip: a run acts where the
   *  visitor said and nowhere else, and the region survives it so the chip still reads. */
  it('stays inside the painted region, and leaves it painted', async () => {
    const kit = installKit();
    const region = rect(6, 6, 18, 18);
    useEditorStore.setState({ region });
    mount();
    await settle();
    await typeRecipe(4242);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recipe: 4242' })); });
    await waitFor(() => expect(kit.state.cells.flat().some((c) => c.terrain)).toBe(true));

    let outside = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (kit.state.cells[y]![x]!.terrain && (x < 6 || x > 18 || y < 6 || y > 18)) outside++;
      }
    }
    expect(outside).toBe(0);
    expect(useEditorStore.getState().region).toEqual(region);
  }, 60_000);
});

describe('the three bands', () => {
  it('hangs the names where the object shelf hangs its own, so switching modes does not move them', () => {
    expect(PAD.side).toBe(SHELF_TABS.left);
    expect(SHELF_BOX.left).toBe(SHELF_TABS.left);
  });

  /** The other half of that: the two shelves stack different things under the row, so what has to
   *  agree is where its BOTTOM edge lands. Each side is added up here the way its own component
   *  lays it out, since the bug this pins is one shelf's stack drifting from the other's. */
  it('stands its bottom edge on the floor the object shelf uses', () => {
    const floor = SHELF_TABS.floor;
    // The generate shelf: the shelf's own bottom padding, the block, and the room over it.
    expect(PAD.bottom + BODY_H + (floor - PAD.bottom - BODY_H)).toBe(floor);
    expect(floor - PAD.bottom - BODY_H).toBeGreaterThanOrEqual(GAP.row);
    // The object shelf: its card row, the bar under it, the window margin, and its own gap.
    const underRow = (ROW.card + 2 * ROW.pad) * SHELF_SCALE + SHELF_BOX.rowGap
      + SCROLL.thumb.h * SHELF_SCALE + SHELF_BOX.bottom;
    expect(underRow + tabRowGap()).toBeCloseTo(floor, 6);
    expect(tabRowGap()).toBeGreaterThan(0);
  });

  /** The third band costs no height, and that is the whole reason it is there: the plate runs to
   *  the bottom of the window, so the strip is a band the shelf already had. What the cards give up
   *  is the strip's own depth and nothing more. */
  it('gives the strip its room out of the card, inside the plate the shelf already draws', () => {
    expect(BODY_H).toBe(CARD_H + STRIP.gap + STRIP.h);
    expect(CARD_H).toBeLessThanOrEqual(CARD_MAX_H);
    // The strip stands INSIDE the dark band rather than under it.
    expect(PAD.bottom + STRIP.h).toBeLessThanOrEqual(BODY_H);
  });

  /** A control standing in the row of names is centred on the WORDS' ink, whatever its own height:
   *  that is one rule for the object shelf's search field and for anything the generator ever puts
   *  there. Hung off the line box instead, a tall control sits low against the names. */
  it('centres what stands beside the names on the same line, at any control height', () => {
    const middles = [SEARCH.h, 42, 38, 90].map((h) => standsInNameRow(h) + h / 2);
    for (const mid of middles) expect(mid).toBeCloseTo(middles[0]!, 6);
    // Above the mark and its gap, which is where the line box that carries the names ends.
    expect(middles[0]!).toBeGreaterThan(SHELF_TABS.underline + SHELF_TABS.underlineGap);
  });

  /**
   * The row is `ShelfTabs`, which SCROLLS on the object shelf because six category names outrun the
   * room beside the search field. Four short kinds do not, so everything that row offers when it is
   * full resolves to nothing here: no fade at either end, and a wheel finds nowhere to travel.
   */
  it('scrolls nothing, having four names and room for all of them', async () => {
    installKit();
    mount();
    await settle();
    const list = screen.getAllByRole('tab')[0]!.parentElement as HTMLElement;
    expect(list.style.maskImage).toBe('');

    fireEvent.wheel(list, { deltaX: 0, deltaY: 100, deltaMode: 0 });
    expect(list.scrollLeft).toBe(0);
    expect(list.style.maskImage).toBe('');
  }, 30_000);

  it('cannot be moved by the kind: the block under the names is one declared height', async () => {
    installKit();
    mount();
    await settle();
    const land = screen.getByTestId('shell-gen-body').style.height;
    expect(land).toBe(`${BODY_H}px`);

    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();
    expect(screen.getByTestId('shell-gen-body').style.height).toBe(land);
  }, 30_000);
});

describe('the row of names', () => {
  /** The kinds ARE the names. A three-way toggle for the same question stood in the block below and
   *  the row named "Island" over it, which is a heading that says nothing. */
  it('offers the four kinds of island and nothing else', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.getAllByRole('tab').map((el) => el.textContent))
      .toEqual(['Land', 'Isles', 'Lakes', 'Maze']);
    expect(TABS.map((tab) => tab.id)).toEqual(['earth', 'water', 'mixed', 'maze']);
    // Nothing stands beside them: no recipe field, and no actions.
    expect(screen.queryByLabelText('Seed')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  }, 30_000);

  /** Clear is the one destructive action the shelf offered, and it is undo's job by another name.
   *  It is in the menu now; nothing about what it does changed. */
  it('offers no Clear, which the menu carries instead', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  }, 30_000);
});

/**
 * The scope: a chip in the strip, and a SCREEN behind it rather than a swap. Finishing a region
 * invalidates every candidate, so the shelf leaves and comes back with a new batch — cards left
 * standing would be a promise the next stroke breaks.
 */
describe('the scope chip', () => {
  it('says the whole island until a region is painted, and then the count', async () => {
    installKit();
    useEditorStore.setState({ region: rect(2, 2, 4, 4) });
    mount();
    await settle();
    expect(within(screen.getByTestId('shell-gen-scope')).getByText('9 cells')).toBeTruthy();

    cleanup();
    useEditorStore.setState({ region: [] });
    mount();
    await settle();
    expect(within(screen.getByTestId('shell-gen-scope')).getByText('Whole island')).toBeTruthy();
  }, 60_000);

  it('opens a screen of its own, taking the cards with it', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.getAllByRole('button', { name: /^Recipe/ }).length).toBe(CANDIDATES);

    fireEvent.click(screen.getByTestId('shell-gen-scope'));
    expect(useEditorStore.getState().selectingRegion).toBe(true);
    expect(screen.getByTestId('shell-scope-screen')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^Recipe/ })).toHaveLength(0);
    expect(screen.queryByTestId('shell-gen-strip')).toBeNull();
  }, 30_000);

  /** The return IS the regeneration: nothing is photographed while the screen is up, and Done is
   *  what starts the batch that answers the region just painted. */
  it('builds no candidate while the screen is up, and a fresh batch on Done', async () => {
    installKit();
    mount();
    await settle();
    fireEvent.click(screen.getByTestId('shell-gen-scope'));
    vi.mocked(barrelCandidate).mockClear();

    act(() => { useEditorStore.setState({ region: rect(3, 3, 9, 9) }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(vi.mocked(barrelCandidate).mock.calls).toHaveLength(0);

    fireEvent.click(screen.getByText(/^Done/));
    await settle();
    expect(vi.mocked(barrelCandidate).mock.calls).toHaveLength(CANDIDATES);
    // And the batch is built for the region that was painted, not for the whole island.
    expect(vi.mocked(barrelCandidate).mock.calls[0]![1].region).toHaveLength(49);
  }, 60_000);
});

describe('the batch tile', () => {
  /** New batch stood in the row of names, at the other end of the shelf from the pictures it
   *  replaces. It is a tile after the last card now, which is where the eye already is once every
   *  card has been turned down. */
  it('stands at the end of the cards, drawn as a mark', async () => {
    installKit();
    mount();
    await settle();

    // THE RECIPES SCROLL AND THE PAIR DOES NOT, which is what lets a card keep one size at every
    // window: the count and the picture stop being the same decision.
    const pair = screen.getByTestId('shell-gen-batch').parentElement!;
    expect([...pair.children]).toEqual([
      screen.getByTestId('shell-gen-batch'), screen.getByTestId('shell-gen-clear'),
    ]);

    const line = pair.parentElement!;
    const cardRun = line.children[0] as HTMLElement;
    expect(cardRun.style.overflowX).toBe('auto');
    // The five drawn for the visitor, and the one that is theirs, all scrolling together.
    expect(cardRun.children).toHaveLength(CANDIDATES + 1);

    const tile = screen.getByRole('button', { name: 'New batch' });
    expect(tile.textContent).toBe('');
    expect(tile.querySelector('img')).not.toBeNull();

    // Same plate, same size: the pair reads as one kind of control. What keeps a hand from sliding
    // off one onto the other is the GAP, which is wider than the row's own.
    const clear = screen.getByTestId('shell-gen-clear');
    expect(clear.style.width).toBe(tile.style.width);
    expect(clear.style.height).toBe(tile.style.height);
    expect(parseFloat(clear.style.marginLeft)).toBeGreaterThan(0);
  }, 30_000);

  it('draws another batch of recipes, and leaves what is on the map standing', async () => {
    const kit = installKit();
    mount();
    await settle();
    const before = shownSeeds();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(kit.state.generation).toBeTruthy());
    const depth = kit.executor.getUndoStackSize();

    fireEvent.click(screen.getByRole('button', { name: 'New batch' }));
    await settle();
    expect(shownSeeds()).not.toEqual(before);
    // Asking another question is not retracting the answer already given.
    expect(kit.executor.getUndoStackSize()).toBe(depth);
    expect(kit.state.generation).toBeTruthy();
  }, 60_000);

  /**
   * A CLICK IS THE ANSWER, so there is no second button to give it. Keep finalised what a click had
   * provisionally applied, which made the click mean less than it looked like it meant and put the
   * difference nowhere a person could read.
   */
  it('offers nothing that confirms a click, because the click was the confirmation', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
  }, 30_000);
});

/**
 * This row draws no scrollbar of its own (see the batch tile's own comment): the fade
 * (`ui/primitives/scroll-fade.ts`) is the only signal that there is more to see. jsdom lays
 * nothing out, so what is worth pinning is that the row's own scroll metrics decide the mask. The
 * mask arrives and leaves over a settle loop rather than popping, so this reads it back with
 * `waitFor` against the real `requestAnimationFrame` instead of synchronously against the
 * triggering scroll event.
 */
describe('the recipe row fades where it can still travel', () => {
  it('carries the mask only where scroll metrics say there is room', async () => {
    installKit();
    mount();
    await settle();

    const pair = screen.getByTestId('shell-gen-batch').parentElement!;
    const list = pair.parentElement!.children[0] as HTMLElement;
    expect(list.style.maskImage).toBe('');

    Object.defineProperty(list, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(list, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(list, 'scrollLeft', { value: 50, configurable: true });
    fireEvent.scroll(list);
    await waitFor(() => {
      expect(list.style.maskImage).toContain('linear-gradient(to right,');
      expect(list.style.maskImage).toContain('transparent 0');
      expect(list.style.maskImage).toContain('transparent 100%');
    });

    Object.defineProperty(list, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(list, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(list);
    await waitFor(() => expect(list.style.maskImage).toBe(''));
  }, 30_000);
});

/**
 * The last card, which is the visitor's own. It replaces the seed field and its confirm step: a
 * seed was never a setting, it is a candidate you name yourself.
 */
describe('the card you type', () => {
  const field = () => screen.getByLabelText('Your own recipe');

  /**
   * TWO STATES, AND THE FIRST ONE IS THE FIELD. A card showing a picture frame with the place to
   * type on a small line underneath puts that place where nobody looks; standing the field where
   * the picture will be says both what the card is for and where to type.
   */
  it('holds the field where its picture will be, and builds nothing until it has a number', async () => {
    installKit();
    mount();
    await settle();

    const card = screen.getByTestId('shell-candidate-custom');
    expect(within(card).getByLabelText('Your own recipe')).toBeTruthy();
    // An empty field has nothing to confirm, so the confirm is not there to press yet.
    expect(within(card).queryByRole('button', { name: 'Use this recipe number' })).toBeNull();
    fireEvent.change(field(), { target: { value: '2' } });
    expect(within(card).getByRole('button', { name: 'Use this recipe number' })).toBeTruthy();
    fireEvent.change(field(), { target: { value: '' } });
    // Every generation this batch asked for was one of the ones drawn: an empty card is not a recipe.
    expect(vi.mocked(barrelCandidate).mock.calls).toHaveLength(CANDIDATES);
  }, 30_000);

  /** The confirm belongs to the FIELD, not to the candidate: clicking a filled card still adopts it
   *  with no second step, but "I have finished typing" needs a button, since Enter alone is
   *  invisible. Either says it. */
  it.each(['button', 'enter'])('takes a typed number as a recipe (%s)', async (how) => {
    installKit();
    mount();
    await settle();
    vi.mocked(barrelCandidate).mockClear();

    fireEvent.change(field(), { target: { value: '24680' } });
    if (how === 'enter') fireEvent.keyDown(field(), { key: 'Enter' });
    else fireEvent.click(screen.getByRole('button', { name: 'Use this recipe number' }));
    await settle();

    expect(vi.mocked(barrelCandidate).mock.calls.map((c) => c[1].config.seed)).toEqual([24680]);
    // The picture takes the field's place, and the number moves to the line as the way back to it.
    expect(screen.getByRole('button', { name: 'Recipe: 24680' })).toBeTruthy();
    expect(screen.queryByLabelText('Your own recipe')).toBeNull();
    // The pill's own reading, not only its aria-label: the number plus the edit mark that makes it
    // discoverable as the way back to typing.
    expect(screen.getByRole('button', { name: 'Change the recipe number' }).textContent).toBe('#24680 ✎');
  }, 30_000);

  it('strips anything that is not a digit as it is typed', async () => {
    installKit();
    mount();
    await settle();

    fireEvent.change(field(), { target: { value: '1a2b3c4' } });
    expect((field() as HTMLInputElement).value).toBe('1234');
  }, 30_000);

  it('caps what it takes at the width the generator itself has, not a digit further', async () => {
    installKit();
    mount();
    await settle();

    const digits = '1'.repeat(SEED_DIGITS + 3);
    fireEvent.change(field(), { target: { value: digits } });
    expect((field() as HTMLInputElement).value).toBe('1'.repeat(SEED_DIGITS));
  }, 30_000);

  it('goes back to the field with the number in it', async () => {
    installKit();
    mount();
    await settle();
    await typeRecipe(24680);

    fireEvent.click(screen.getByRole('button', { name: 'Change the recipe number' }));
    // The two faces cross on the registry's own motion, so the field arrives a frame later.
    await waitFor(() => expect((field() as HTMLInputElement).value).toBe('24680'));
  }, 30_000);

  /** It is the one card a new batch does not replace: a batch that overwrote a number somebody
   *  typed would lose the only thing on this shelf they authored. */
  it('keeps its number through a new batch, while the others are drawn again', async () => {
    installKit();
    mount();
    await settle();
    await typeRecipe(13579);
    const drawn = shownSeeds().filter((n) => n !== 13579);
    vi.mocked(barrelCandidate).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'New batch' }));
    await settle();

    expect(screen.getByRole('button', { name: 'Recipe: 13579' })).toBeTruthy();
    expect(shownSeeds().filter((n) => n !== 13579)).not.toEqual(drawn);
    // And it is not re-photographed for it: a batch is three generations, not four.
    expect(vi.mocked(barrelCandidate).mock.calls.map((c) => c[1].config.seed)).not.toContain(13579);
  }, 60_000);

  it('lands its own recipe when the picture is clicked', async () => {
    const kit = installKit();
    mount();
    await settle();
    await typeRecipe(31415);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recipe: 31415' })); });
    await waitFor(() => expect(kit.state.generation?.seed).toBe(31415));
  }, 60_000);
});

/**
 * What used to be the Keep button's job, done by the click itself. The two halves of it are
 * separate: another candidate REPLACES the one standing, and anything else lets go of it.
 */
describe('a candidate that has been clicked', () => {
  /**
   * EACH CLICK IS ITS OWN UNDO STEP, and three of them leave three.
   *
   * This bar used to UNDO its own previous apply before landing the next, so however many islands
   * had been looked at the history held one entry and one redo, and the fourth card could not be
   * taken back to the third. The undo was there to make a candidate's fingerprint match again;
   * clearing the scope before the replay does that instead, which is what a generation does anyway.
   */
  it('leaves one undo step per card clicked, and every one of them walks back', async () => {
    const kit = installKit();
    mount();
    await settle();

    const cards = () => screen.getAllByRole('button', { name: /^Recipe/ });
    const depth = kit.executor.getUndoStackSize();
    const maps: string[] = [];
    for (const i of [0, 1, 2]) {
      await act(async () => { fireEvent.click(cards()[i]!); });
      await waitFor(() => expect(kit.executor.getUndoStackSize()).toBe(depth + i + 1));
      maps.push(mapValue(kit.state));
    }
    // Three different islands, or the three steps would be three names for one edit.
    expect(new Set(maps).size).toBe(3);

    // And back down through them, in order. Undo is the way back this bar promises.
    for (const i of [1, 0]) {
      act(() => { kit.executor.undo(); });
      expect(mapValue(kit.state)).toBe(maps[i]);
    }
    act(() => { kit.executor.undo(); });
    expect(kit.executor.getUndoStackSize()).toBe(depth);
    // Every one of them is still ahead, which is the "only ever one redo" this replaces.
    expect(kit.executor.canRedo()).toBe(true);
  }, 120_000);
});

describe('the kind of island', () => {
  it('is a real setting: the same recipe builds a different map under a different kind', async () => {
    const dry = makeKit();
    await generateMap(dry, { config: shelfConfig({ ...ISLAND, kind: 'earth', seed: 2024 }), region: null });
    const wet = makeKit();
    await generateMap(wet, { config: shelfConfig({ ...ISLAND, kind: 'water', seed: 2024 }), region: null });

    expect(mapValue(wet.state)).not.toBe(mapValue(dry.state));
    // The kinds are named after the difference: dry land gets no water at all, and water mode
    // spends the map on it.
    const water = (state: GridState): number =>
      state.cells.flat().filter((c) => c.terrain?.type === TerrainType.Water).length;
    expect(water(dry.state)).toBe(0);
    expect(water(wet.state)).toBeGreaterThan(0);
    // Water mode holds the land at ground level, which is where its own ceiling comes from.
    const tallest = (state: GridState): number => Math.max(
      0, ...state.cells.flat().map((c) => c.terrain?.elevation ?? 0),
    );
    expect(tallest(wet.state)).toBeLessThanOrEqual(maxElevationFor('water'));
  }, 60_000);

  it('reaches the config the click generates from, and takes the ceiling with it', async () => {
    const kit = installKit();
    mount();
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: 'Isles' }));
    await settle();
    expect(Number(screen.getByRole('slider', { name: 'Tallest layer' }).getAttribute('aria-valuemax')))
      .toBe(maxElevationFor('water'));

    fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!);
    // The map records the recipe it was built from, so this is the chosen kind arriving at the
    // engine rather than at another piece of component state.
    await waitFor(() => expect(kit.state.generation?.mode).toBe('water'));
  }, 60_000);
});

describe('the sliders', () => {
  it('takes the tallest layer from the grid, not from the drawing', async () => {
    installKit();
    mount();
    await settle();

    const slider = screen.getByRole('slider', { name: 'Tallest layer' });
    expect(Number(slider.getAttribute('aria-valuemax'))).toBe(ELEVATION_MAX);
    expect(maxElevationFor('earth')).toBe(ELEVATION_MAX);
  }, 30_000);

  it('lowers the ceiling on the maze, where a taller wall has nothing to stand on', async () => {
    installKit();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();

    const slider = screen.getByRole('slider', { name: 'Tallest layer' });
    expect(Number(slider.getAttribute('aria-valuemax'))).toBe(maxElevationFor('maze'));
    expect(maxElevationFor('maze')).toBeLessThan(ELEVATION_MAX);
  }, 30_000);

  it('swaps naturalness for corridor width, since one of the two is meaningless per kind', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.queryByRole('slider', { name: 'Naturalness' })).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();
    expect(screen.queryByRole('slider', { name: 'Naturalness' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Corridor' })).not.toBeNull();
    // Both knobs draw on the one track the design gives them.
    expect(SLIDERS.upper.track.y).toBeLessThan(SLIDERS.maxLayer.track.y);
  }, 30_000);

  /** They stand INSIDE the plate now, so the two of them plus the strip's other contents are one
   *  row rather than a column bolted beside the cards. */
  it('stands in the strip inside the plate', async () => {
    installKit();
    mount();
    await settle();
    const strip = screen.getByTestId('shell-gen-strip');
    expect(strip.style.height).toBe(`${STRIP.h}px`);
    expect(within(strip).getAllByRole('slider')).toHaveLength(2);
  }, 30_000);
});

/** A candidate that is not a real run. These two tests are about what the bar HANDS to the click;
 *  the landing itself is proved against the engine in `kit/generate-operation.test.ts`. */
function fakeCandidate(): Candidate {
  return {
    state: makeState(SIZE, SIZE),
    outcome: { cells: [], placed: 0, removedCells: 0, removedObjects: 0, violations: [], cancelled: false },
    commands: [],
    config: island(1),
    region: null,
    base: 'a map this is not',
  };
}

describe('clicking a card', () => {
  it('hands over the run the card already made, so the recipe is not built twice', async () => {
    installKit();
    const made = fakeCandidate();
    vi.mocked(barrelCandidate).mockImplementation(async () => made);
    vi.mocked(barrelGenerateMap).mockResolvedValue(made.outcome);
    mount();
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[1]!); });
    expect(vi.mocked(barrelGenerateMap).mock.calls[0]![1].candidate).toBe(made);
  }, 30_000);

  it('hands over nothing once a setting has moved, since those runs answer a question that changed', async () => {
    installKit();
    vi.mocked(barrelCandidate).mockImplementation(async () => fakeCandidate());
    vi.mocked(barrelGenerateMap).mockResolvedValue(fakeCandidate().outcome);
    mount();
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: 'Isles' }));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    expect(vi.mocked(barrelGenerateMap).mock.calls[0]![1].candidate).toBeNull();
  }, 30_000);
});

/**
 * A run that throws rolls itself back, so the map, the undo stack and the cards are all exactly as
 * they were: there is nothing on the screen for the visitor to read the refusal off except the card
 * they clicked.
 */
describe('the scope highlight', () => {
  /**
   * A LANDED RUN LEAVES THE HIGHLIGHT STANDING: the region is still the bound on every run after
   * this one, and the drape is what says so. It comes down in exactly one place — the scope
   * screen's own Clear, where the region itself is emptied — never as a side effect of using it.
   */
  it('stays up after a run has landed', async () => {
    installKit();
    let cleared = 0;
    setActiveView({
      overlay: {
        flashCommit: () => {},
        showBuildableRegion: () => {},
        clearBuildableRegion: () => { cleared += 1; },
        showRoute: () => {}, clearRoute: () => {},
      },
    } as unknown as ActiveView);
    useEditorStore.setState({ region: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }] });
    mount();
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(vi.mocked(barrelGenerateMap)).toHaveBeenCalled());
    expect(cleared, 'the drape survives the landed run').toBe(0);
    expect(useEditorStore.getState().region.length, 'the scope itself survives').toBe(3);
  }, 60_000);
});

describe('a click on its way to the map', () => {
  /**
   * LANDING IS NOT INSTANT AND THE CARD SAYS SO. A replay is about a tenth of a second; a card
   * landing on a map that already carries an island runs the recipe for real, which is most of a
   * second on a full map. Nothing said so and the app simply stopped, which is what "freezes with no
   * loading animation" was. The waiting is drawn on the card that was clicked, where the eye is.
   */
  it('says so on the card that was clicked, until it has landed', async () => {
    installKit();
    let land = (): void => {};
    vi.mocked(barrelGenerateMap).mockImplementation(async (...args) => {
      await new Promise<void>((r) => { land = r; });
      return generateMap(...args);
    });
    mount();
    await settle();

    const card = screen.getAllByRole('button', { name: /^Recipe/ })[1]!;
    const busyDots = () => card.querySelectorAll('span[style*="border-radius: 50%"]').length;
    expect(busyDots()).toBe(0);

    await act(async () => { fireEvent.click(card); });
    expect(busyDots(), 'the card carries the app\'s own loader while it lands').toBeGreaterThan(0);

    await act(async () => { land(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(busyDots()).toBe(0));
  }, 60_000);
});

describe('a click that does not reach the map', () => {
  it('is said on the card that was clicked, and clears itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      installKit();
      vi.mocked(barrelCandidate).mockImplementation(async () => fakeCandidate());
      vi.mocked(barrelGenerateMap).mockRejectedValue(new Error('refused'));
      mount();
      await settle();

      const cards = screen.getAllByRole('button', { name: /^Recipe/ });
      await act(async () => { fireEvent.click(cards[1]!); });
      await waitFor(() => expect(screen.queryByText('Did not build')).not.toBeNull());
      // On that card, and on none of the others.
      expect(within(cards[1]!).queryByText('Did not build')).not.toBeNull();
      expect(within(cards[0]!).queryByText(/^Recipe/)).not.toBeNull();

      await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
      expect(screen.queryByText('Did not build')).toBeNull();
      expect(within(cards[1]!).queryByText(/^Recipe/)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});

describe('the batch', () => {
  it('draws one seed per card, and the card applies that same seed', async () => {
    const kit = installKit();
    mount();
    await settle();

    const asked = vi.mocked(barrelCandidate).mock.calls.map((c) => c[1].config.seed);
    const shown = shownSeeds();

    expect(shown).toHaveLength(CANDIDATES);
    expect(asked).toEqual(shown);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Recipe: ${shown[1]}` })); });
    await waitFor(() => expect(kit.executor.getUndoStackSize()).toBe(1));
    expect(kit.state.generation?.seed).toBe(shown[1]);
  }, 60_000);
});
