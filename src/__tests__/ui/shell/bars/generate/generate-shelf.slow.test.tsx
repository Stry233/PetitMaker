// @vitest-environment jsdom
/**
 * The generate shelf: the candidate mechanic, the maze marks, the three bands and the ranges. A
 * candidate runs the real generator on a detached copy, so the user's map is untouched and a
 * candidate's picture is the map clicking it produces. The component tests stub candidate building
 * and keep the rest real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LOCALES } from '../../../../../core/model/locale';
import type { CellSet } from '../../../../../core/grid/grids';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

vi.mock('../../../../../ui/shell/bars/generate/use-stencil-review', () => ({
  useStencilReview: () => ({ allowed: true, pending: false, note: null, retry: undefined }),
}));

vi.mock('../../../../../editor/operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../editor/operations')>();
  return {
    ...actual,
    generateCandidate: vi.fn(actual.generateCandidate),
    generateMap: vi.fn(actual.generateMap),
  };
});

/**
 * A picture kind's plan is rasterized on a real canvas, which jsdom lacks; the plan itself is proved
 * in `__tests__/tools/generation/stencil/`, and a shelf test only needs one to exist.
 */
vi.mock('../../../../../tools/generation/stencil/stencil-plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../tools/generation/stencil/stencil-plan')>();
  return {
    ...actual,
    buildStencilPlan: vi.fn(async () => ({
      read: 'shape' as const,
      fill: { kind: 'terrain' as const, terrain: 1 },
      stencil: { width: 1, height: 1, coverage: new Uint8Array([255]), color: new Uint32Array([0]) },
      origin: { x: 0, y: 0 },
    })),
    // The mocked builder never files into the real cache, so the peek always answers "not cached".
    peekStencilPlan: vi.fn(() => undefined),
  };
});

/** The development shelf, where every kind offers its own card; the release state goes through
 *  `hasCustomCard`'s build argument below. */
vi.mock('../../../../../platform/build/build-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../platform/build/build-info')>();
  return { ...actual, IS_DEV_BUILD: true };
});

vi.mock('../../../../../ui/shell/bars/generate/generate-shelf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../ui/shell/bars/generate/generate-shelf')>();
  return { ...actual, hasCustomCard: vi.fn(actual.hasCustomCard) };
});

import { setActiveView } from '../../../../../view/active-view';
import { setMapRenderer } from '../../../../../view/map2d/scene/renderer-registry';
import type { MapRenderer } from '../../../../../view/map2d/scene/map-renderer';
import type { ActiveView } from '../../../../../tools/pointer/runtime';
import { CommandExecutor } from '../../../../../core/commands/command-executor';
import { CommandType, TerrainType, type GridState, type MacroCoord } from '../../../../../core/model/types';
import { type DesignedConfig, type GenerateConfig } from '../../../../../tools/generation/recipe';
import { I18nProvider, localizedName, translateFor } from '../../../../../i18n/context';
import { setToastPresenter } from '../../../../../platform/channels/toast-bus';
import type { EditContext } from '../../../../../core/commands/edit-context';
import { serialize } from '../../../../../io/save/json-codec';
// The component reads the barrel, which is mocked above; these are the real implementations.
import { clearGenerated, generateMap } from '../../../../../editor/operations/generate';
import { generateCandidate, __resetCandidateCache } from '../../../../../tools/generation/run/candidates';
import { generateCandidate as barrelCandidate, generateMap as barrelGenerateMap } from '../../../../../editor/operations';
import type { Candidate, Outcome } from '../../../../../editor/operations';
import { getCatalogByCategory } from '../../../../../state/catalog';
import { createDefaultRegistry } from '../../../../../rules';
import { useEditorStore } from '../../../../../state/store';
import { ScaleProvider } from '../../../../../ui/design/scale';
import { GenerateShelf } from '../../../../../ui/shell/bars/generate/GenerateShelf';
import { ModeBar } from '../../../../../ui/shell/controls/ModeBar';
import { MazeEndpoints } from '../../../../../ui/shell/bars/generate/MazeEndpoints';
import {
  CANDIDATES, SEED_DIGITS, TABS, hasCustomCard, maxElevationFor,
} from '../../../../../ui/shell/bars/generate/generate-shelf';
import { batchSeeds, kindConfig } from '../../../../../tools/generation/kinds';
import { IMAGE_POOL, sampleName } from '../../../../../ui/shell/bars/generate/stencil-samples';
import { APP_NAME, brandName } from '../../../../../i18n/terms/brand';
import { makeState, placeCmd } from '../../../../_support/map-state';
import { ELEVATION_MAX } from '../../../../../core/game/profile';
import { createExecutor } from '../../../../../state/executor';
import { ItemCategory } from '../../../../../config/catalog/categories';

/** Small enough that a batch of real generations is cheap, large enough that they build something. */
const SIZE = 40;

/**
 * The map with its cells, objects, ids and authorship taint. The ledger is compared separately: it
 * never rewinds, so a candidate must not add to it at all, not even a `reverted` entry.
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

/** The map by value without object ids, which are minted per placement and not seed-derived. */
function mapValue(state: GridState): string {
  const parsed = JSON.parse(serialize(state));
  return JSON.stringify({
    cells: parsed.cells,
    objects: (parsed.objects as Record<string, unknown>[]).map(({ id, ...rest }) => rest),
  });
}

function makeKit(): EditContext {
  const state = makeState(SIZE, SIZE);
  const exec = createExecutor(state, createDefaultRegistry(), useEditorStore.getState().eventBus);
  return { state, executor: exec, registry: exec.getRegistry() };
}

/** The same context, installed where `currentEditor()` reads it from. */
function installKit(): EditContext {
  const kit = makeKit();
  useEditorStore.setState({ gridState: kit.state, commandExecutor: kit.executor as CommandExecutor });
  return kit;
}

/** One island recipe with the seed left open, so a test can vary a single term of it. */
const ISLAND = {
  kind: 'island', richness: 100, maxElevation: 4, corridorWidth: 1, gates: null,
} as const;

const island = (seed: number): GenerateConfig => kindConfig({ ...ISLAND, seed });

const maze = (seed: number, gates: { entrance: MacroCoord | null; exit: MacroCoord | null } | null): GenerateConfig =>
  kindConfig({ kind: 'maze', seed, richness: 100, maxElevation: 3, corridorWidth: 1, gates });

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

/** The shelf in the mode bar, which stands the scope screen in its place while a region is selected. */
function mountInBar() {
  useEditorStore.getState().setEditMode({ mode: 'generate' });
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ModeBar mode="generate" surface={null} />
        </ScaleProvider>
      </I18nProvider>
    </MotionConfig>,
  );
}

/** Move the faked `setTimeout` clock `ms` forward; it still advances in real time, so `waitFor` polls. */
async function elapse(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Let the debounced picture pass finish, read off New batch, which is refused while a batch builds. */
async function settle(): Promise<void> {
  await elapse(420);
  await waitFor(() => expect(
    screen.getByRole('button', { name: 'New batch' }).getAttribute('aria-disabled'),
  ).toBe('false'));
}

/** Type a recipe number into the last card, the one deterministic card: the others draw their seeds
 *  from a random base per mount. */
async function typeRecipe(seed: number): Promise<void> {
  fireEvent.change(screen.getByLabelText('Your own recipe'), { target: { value: String(seed) } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this recipe number' }));
  await settle();
  // The field flips to the picture on a motion clock, which the faked timers do not drive.
  await screen.findByRole('button', { name: `Recipe: ${seed}` });
}

/** The recipe numbers the cards are showing, in the order they stand. */
function shownSeeds(): number[] {
  return screen.getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('Recipe: '))
    .map((label) => Number(label.slice('Recipe: '.length)));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  useEditorStore.setState({ locale: 'en', region: [], selectingRegion: false });
  vi.mocked(barrelCandidate).mockClear();
  vi.mocked(barrelCandidate).mockImplementation(async () => null);
  vi.mocked(barrelGenerateMap).mockClear();
  vi.mocked(barrelGenerateMap).mockImplementation(generateMap);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
  setActiveView(null);
  setMapRenderer(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [], selectingRegion: false });
  useEditorStore.getState().setEditMode({ mode: null });
});

/** Terrain and a tree laid by hand in one stroke group, so the map under the shelf is a person's work. */
function buildByHand(kit: EditContext): void {
  const watermark = kit.executor.beginStroke();
  const cells: MacroCoord[] = [];
  for (let y = 4; y <= 9; y++) for (let x = 4; x <= 9; x++) cells.push({ x, y });
  kit.executor.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 1 });
  kit.executor.execute(placeCmd({
    id: 'by-hand', catalogId: getCatalogByCategory(ItemCategory.Tree)[0]!.id,
    position: { x: 20, y: 20 }, rotation: 0, elevation: 0,
  }));
  watermark.commit();
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
    // An island first, so the recorded recipe holds something a candidate could overwrite.
    await generateMap(kit, { config: island(4242), region: null });
    buildByHand(kit);

    const before = snapshot(kit.state);
    const stack = kit.executor.historyDepth();
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
    expect(kit.executor.historyDepth()).toBe(stack);
    expect(kit.state.generation).toEqual(recipe);
    expect(ledger(kit.state)).toEqual(wrote);
  }, 300_000);

  it('does not move the scope that Clear is bounded by', async () => {
    const kit = makeKit();
    await generateMap(kit, { config: island(4242), region: null });   // the whole map: Clear is unbounded
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

    // The card is drawn by the live renderer, so grids equal by value photograph alike.
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
  /** An end asked for inside the maze stays inside, on a cell a walker can stand on. */
  it('reports an interior request as a place inside, not as a hole in the wall', async () => {
    const kit = makeKit();
    const asked = { entrance: { x: 12, y: 14 }, exit: null };
    const outcome = await generateMap(kit, { config: maze(9, asked), region: null });

    const landed = outcome.detail?.kind === 'maze' ? outcome.detail.gates.entrance : null;
    expect(landed).toBeTruthy();
    const onBorder = landed!.x === 0 || landed!.y === 0 || landed!.x === SIZE - 1 || landed!.y === SIZE - 1;
    expect(onBorder).toBe(false);
    expect(kit.state.cells[landed!.y]![landed!.x]!.terrain ?? null).toBeNull();
  }, 30_000);

  /** The ends are opt-in; "In and out" adopts the landed pair, and only then can the way be shown. */
  it('keeps the map clear of marks by default, and adopts the landed pair when the ends are chosen', async () => {
    const kit = installKit();
    setActiveView({
      projection: { screenToPoint: () => ({ x: 0, y: 0 }), cellToScreen: () => ({ x: 0, y: 0, scale: 1 }) },
      overlay: { flashCommit: () => {}, showPath: () => {}, clearPath: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(kit.executor.historyDepth()).toBe(1));
    expect(screen.queryByTestId('shell-gate-entrance'), 'no marks uninvited').toBeNull();
    expect(
      screen.getByRole('switch', { name: 'Show the way' }).getAttribute('aria-disabled'),
      'the way answers for a pair nobody chose',
    ).toBe('true');

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());
    const kinds = ['shell-gate-entrance', 'shell-gate-exit']
      .map((id) => screen.getByTestId(id).getAttribute('data-kind'));
    for (const kind of kinds) expect(['hole', 'target']).toContain(kind);
    expect(
      within(screen.getByTestId('shell-gen-strip')).getByRole('switch', { name: 'Show the way' })
        .getAttribute('aria-disabled'),
      'and the way can be asked for once they are',
    ).toBeNull();
  }, 60_000);

  /** A toggle may not move the controls beside it, its own included. */
  it('leaves the strip the same shape whichever way the ends switch is thrown', async () => {
    installKit();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();

    const shape = (): string[] => [...screen.getByTestId('shell-gen-strip').children]
      .map((c) => c.getAttribute('data-testid') ?? c.querySelector('[role="slider"]')?.getAttribute('aria-label') ?? 'spacer');
    const before = shape();
    expect(before).toContain('shell-gen-route');

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    expect(shape()).toEqual(before);
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    expect(shape()).toEqual(before);
  }, 30_000);

  /** An end is a recipe input (the carve grows out from the entrance), so a drop re-runs the landed
   *  recipe with the moved pair as gates. */
  it('re-runs the recipe with the dropped end as an input', async () => {
    const kit = installKit();
    // A projection that is the map's own grid, so a cell can be aimed at by name.
    setActiveView({
      projection: {
        screenToPoint: (x: number, y: number) => ({ x: Math.round(x) + 0.5, y: Math.round(y) + 0.5 }),
        cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }),
      },
      overlay: { flashCommit: () => {}, showPath: () => {}, clearPath: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await settle();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    // A drop while a run is landing is refused, so the maze must be standing first.
    await waitFor(() => expect(kit.executor.historyDepth()).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());

    const mark = () => screen.getByTestId('shell-gate-entrance');
    const was = mark().getAttribute('data-cell')!;
    const [wx, wy] = was.split(',').map(Number) as [number, number];
    // Along the wall it stands on, far enough that the nearest place to cut is a different one.
    const onTopOrBottom = wy === 0 || wy === SIZE - 1;
    const to = onTopOrBottom ? { x: wx + 6, y: wy } : { x: wx, y: wy + 6 };
    const undoBefore = kit.executor.historyDepth();

    // jsdom has no PointerEvent and RTL's fallback carries no coordinates; a MouseEvent under the
    // pointer event's name has them.
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
    // The drop was a generation: one more undo entry, and the new way in is open.
    await waitFor(() => expect(kit.executor.historyDepth()).toBe(undoBefore + 1));
    const [nx, ny] = now.split(',').map(Number) as [number, number];
    expect(kit.state.cells[ny]![nx]!.terrain ?? null).toBeNull();
  }, 60_000);

  it('draws nothing until a run has put a maze on the map', () => {
    render(<I18nProvider><MazeEndpoints ends={null} onMove={() => {}} /></I18nProvider>);
    expect(screen.queryByTestId('shell-gate-entrance')).toBeNull();
  });

  /** The ends are inputs to every run, so they must be reachable before the first one. */
  it('offers both marks the moment the ends are chosen, before any run', async () => {
    const kit = installKit();
    setActiveView({
      projection: { screenToPoint: () => ({ x: 0, y: 0 }), cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }) },
      overlay: { flashCommit: () => {}, showPath: () => {}, clearPath: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull();
    expect(screen.queryByTestId('shell-gate-exit')).not.toBeNull();
    expect(kit.executor.historyDepth(), 'no run was needed to get them').toBe(0);
  });

  /**
   * A road's flat sweep reaches the wall beside every corridor lane, so the way cannot be paved; it is
   * drawn on the terrain grid, where the walls render, and never crosses a wall.
   */
  it('drapes the way over the corridors when switched on, and takes it down when off', async () => {
    const kit = installKit();
    const shown: MacroCoord[][] = [];
    let cleared = 0;
    setActiveView({
      projection: { screenToPoint: () => ({ x: 0, y: 0 }), cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }) },
      overlay: {
        flashCommit: () => {},
        showPath: (set: CellSet) => { expect(set.grid).toBe('terrain'); shown.push([...set.cells]); },
        clearPath: () => { cleared += 1; },
      },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await settle();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    // The marks stand before any run, so only the undo stack says the run landed.
    await waitFor(() => expect(kit.executor.historyDepth()).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('shell-gate-entrance')).not.toBeNull());

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show the way' })); });
    expect(shown.length, 'the drape went up').toBeGreaterThan(0);
    const route = shown[shown.length - 1]!;
    expect(route.length).toBeGreaterThan(1);
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

  /** Choosing the ends lets go of the landed card, but the maze on the map is unchanged, so its walk is
   *  still the way. */
  it('shows the way of the maze already standing, on the first press', async () => {
    const kit = installKit();
    const shown: MacroCoord[][] = [];
    setActiveView({
      projection: { screenToPoint: () => ({ x: 0, y: 0 }), cellToScreen: (x: number, y: number) => ({ x, y, scale: 1 }) },
      overlay: { flashCommit: () => {}, showPath: (set: CellSet) => { expect(set.grid).toBe('terrain'); shown.push([...set.cells]); }, clearPath: () => {} },
    } as unknown as ActiveView);
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();
    // Landed with the ends left to the generator.
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(kit.executor.historyDepth()).toBeGreaterThan(0));

    // The ends are a recipe setting, so the batch's pictures drop.
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'In and out' })); });
    await settle();

    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Show the way' })); });
    expect(shown.length, 'the way of the maze that is standing').toBeGreaterThan(0);
    expect(shown[shown.length - 1]!.length).toBeGreaterThan(1);
  }, 60_000);
});

describe('a run', () => {
  it('takes the whole map where no region is painted', async () => {
    const kit = installKit();
    mount();
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    // Only a full run records the recipe it was built from.
    await waitFor(() => expect(kit.state.generation).toBeTruthy());

    let outside = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) if (kit.state.cells[y]![x]!.terrain && (x > 8 || y > 8)) outside++;
    }
    expect(outside).toBeGreaterThan(0);
  }, 60_000);

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

describe('the row of names', () => {
  it('offers every kind of island and nothing else', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.getAllByRole('tab').map((el) => el.textContent))
      .toEqual(['Maze', 'Letter', 'Picture', 'Planet']);
    expect(TABS.map((tab) => tab.id)).toEqual(['maze', 'text', 'image', 'island']);
    expect(screen.queryByLabelText('Seed')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  }, 30_000);

  it('offers no Clear, which the menu carries instead', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  }, 30_000);
});

/** Finishing a region invalidates every candidate, so the scope screen takes the cards away and Done
 *  brings a new batch. */
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
    expect(within(screen.getByTestId('shell-gen-scope')).getByText('Whole planet')).toBeTruthy();
  }, 60_000);

  it('opens a screen of its own in the bar\'s place, hiding the cards', async () => {
    installKit();
    mountInBar();
    await settle();
    expect(screen.getAllByRole('button', { name: /^Recipe/ }).length).toBe(CANDIDATES);

    fireEvent.click(screen.getByTestId('shell-gen-scope'));
    expect(useEditorStore.getState().selectingRegion).toBe(true);
    expect(screen.getByTestId('shell-scope-screen')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^Recipe/ })).toHaveLength(0);
    expect(screen.getByTestId('shell-mode-bar').contains(screen.getByTestId('shell-gen-strip'))).toBe(true);
    expect(screen.getByTestId('shell-mode-bar').getAttribute('aria-hidden')).toBe('true');
  }, 30_000);

  it('offers a picture kind\'s scope only the figures it can fill, at its least side', async () => {
    installKit();
    mountInBar();
    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    await settle();
    fireEvent.click(screen.getByTestId('shell-gen-scope'));
    const scope = screen.getByTestId('shell-scope-screen');
    expect(within(scope).getByLabelText('Rectangle')).toBeTruthy();
    expect(within(scope).queryByLabelText('Line')).toBeNull();
    expect(useEditorStore.getState().regionRequest.minSide).not.toBeNull();

    fireEvent.click(within(scope).getByText(/^Done|^At least/));
    expect(useEditorStore.getState().regionRequest.minSide).toBeNull();
  }, 30_000);

  /** A region too small for the picture kind blanks the cards, but each card's plan survives, so a
   *  click would build the picture fitted to the last region. */
  it.each([7, 20])('builds pictures in a %i-cell box and refuses a stale card after shrinking below the minimum', async (side) => {
    const kit = installKit();
    useEditorStore.setState({ region: rect(2, 2, side + 1, side + 1) });
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    await settle();
    const cards = (): HTMLElement[] => screen.getAllByTestId(/^shell-candidate-/);
    expect(cards().length).toBeGreaterThan(0);
    expect(cards()[0]!.getAttribute('aria-disabled')).toBe('false');

    // Too small for the kind.
    act(() => { useEditorStore.setState({ region: rect(2, 2, 7, 7) }); });
    await settle();

    const card = cards()[0]!;
    expect(card.getAttribute('aria-disabled'), 'it stands, and it refuses').toBe('true');
    await act(async () => { fireEvent.click(card); });
    await settle();
    expect(kit.executor.historyDepth(), 'nothing landed').toBe(0);
  }, 60_000);
});

describe('the batch tile', () => {
  it('stands at the end of the cards, drawn as a mark', async () => {
    installKit();
    mount();
    await settle();

    // The recipes scroll and the pair does not, so a card keeps one size at every window.
    const pair = screen.getByTestId('shell-gen-batch').parentElement!;
    expect([...pair.children]).toEqual([
      screen.getByTestId('shell-gen-batch'), screen.getByTestId('shell-gen-clear'),
    ]);

    const line = pair.parentElement!;
    const cardRun = line.children[0] as HTMLElement;
    expect(cardRun.style.overflowX).toBe('auto');
    // The drawn candidates and the visitor's own card scroll together.
    expect(cardRun.children).toHaveLength(CANDIDATES + 1);

    const tile = screen.getByRole('button', { name: 'New batch' });
    expect(tile.textContent).toBe('');
    expect(tile.querySelector('img')).not.toBeNull();

    // One size for the pair; the gap between them keeps a hand from sliding onto the other.
    const clear = screen.getByTestId('shell-gen-clear');
    expect(clear.style.width).toBe(tile.style.width);
    expect(clear.style.height).toBe(tile.style.height);
    expect(parseFloat(clear.style.left) + parseFloat(clear.style.top)).toBeGreaterThan(
      Math.min(parseFloat(tile.style.width), parseFloat(tile.style.height)));
  }, 30_000);

  it('draws another batch of recipes, and leaves what is on the map standing', async () => {
    const kit = installKit();
    mount();
    await settle();
    const before = shownSeeds();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(kit.state.generation).toBeTruthy());
    const depth = kit.executor.historyDepth();

    fireEvent.click(screen.getByRole('button', { name: 'New batch' }));
    await settle();
    expect(shownSeeds()).not.toEqual(before);
    expect(kit.executor.historyDepth()).toBe(depth);
    expect(kit.state.generation).toBeTruthy();
  }, 60_000);

  it('offers nothing that confirms a click, because the click was the confirmation', async () => {
    installKit();
    mount();
    await settle();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
  }, 30_000);
});

/** The last card is the visitor's own: a seed is a candidate you name yourself, not a setting. */
describe('the card you type', () => {
  const field = () => screen.getByLabelText('Your own recipe');

  it('holds the field where its picture will be, and builds nothing until it has a number', async () => {
    installKit();
    mount();
    await settle();

    const card = screen.getByTestId('shell-candidate-custom');
    expect(within(card).getByLabelText('Your own recipe')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Use this recipe number' })).toBeNull();
    fireEvent.change(field(), { target: { value: '2' } });
    expect(within(card).getByRole('button', { name: 'Use this recipe number' })).toBeTruthy();
    fireEvent.change(field(), { target: { value: '' } });
    expect(within(card).getByLabelText('Your own recipe'), 'an empty card stays a field').toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^Recipe: / }), 'an empty card is not a recipe').toBeNull();
  }, 30_000);

  /** Enter alone is invisible, so finishing the number also has a button. */
  it.each(['button', 'enter'])('takes a typed number as a recipe (%s)', async (how) => {
    installKit();
    mount();
    await settle();

    fireEvent.change(field(), { target: { value: '24680' } });
    if (how === 'enter') fireEvent.keyDown(field(), { key: 'Enter' });
    else fireEvent.click(screen.getByRole('button', { name: 'Use this recipe number' }));
    await settle();

    expect(await screen.findByRole('button', { name: 'Recipe: 24680' })).toBeTruthy();
    expect(screen.queryByLabelText('Your own recipe')).toBeNull();
    // The visible text too, not only the aria-label.
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
    // The faces cross on a registry motion, so the field arrives a frame later.
    await waitFor(() => expect((field() as HTMLInputElement).value).toBe('24680'));
  }, 30_000);

  /** A typed number is the only thing on this shelf the visitor authored. */
  it('keeps its number through a new batch, while the others are drawn again', async () => {
    installKit();
    mount();
    await settle();
    await typeRecipe(13579);
    const drawn = shownSeeds().filter((n) => n !== 13579);

    fireEvent.click(screen.getByRole('button', { name: 'New batch' }));
    await settle();

    expect(screen.getByRole('button', { name: 'Recipe: 13579' })).toBeTruthy();
    expect(shownSeeds().filter((n) => n !== 13579)).not.toEqual(drawn);
  }, 60_000);

  it('lands its own recipe when the picture is clicked', async () => {
    const kit = installKit();
    mount();
    await settle();
    await typeRecipe(31415);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recipe: 31415' })); });
    await waitFor(() => expect(kit.state.generation?.seed).toBe(31415));
  }, 60_000);

  it('keeps what each tab typed to that tab', async () => {
    installKit();
    mount();
    await settle();
    const letters = () => screen.getByLabelText('Your own letters') as HTMLInputElement;
    const open = async (name: string) => { fireEvent.click(screen.getByRole('tab', { name })); await settle(); };

    fireEvent.change(field(), { target: { value: '12' } });
    await open('Letter');
    await waitFor(() => expect(letters().value).toBe(''));
    fireEvent.change(letters(), { target: { value: 'AB' } });
    await open('Planet');
    await waitFor(() => expect((field() as HTMLInputElement).value).toBe(''));

    await open('Maze');
    await waitFor(() => expect((field() as HTMLInputElement).value).toBe('12'));
    await open('Letter');
    await waitFor(() => expect(letters().value).toBe('AB'));
  }, 60_000);

  it('files each tab\'s confirmed card on its own', async () => {
    installKit();
    mount();
    await settle();
    const open = async (name: string) => { fireEvent.click(screen.getByRole('tab', { name })); await settle(); };

    await typeRecipe(24680);
    await open('Letter');
    fireEvent.change(screen.getByLabelText('Your own letters'), { target: { value: 'ABC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this text' }));
    await settle();
    expect((await screen.findByRole('button', { name: 'Edit text' })).textContent).toBe('ABC ✎');
    await open('Planet');
    await waitFor(() => expect((field() as HTMLInputElement).value).toBe(''));

    await open('Maze');
    expect(await screen.findByRole('button', { name: 'Recipe: 24680' })).toBeTruthy();
    await open('Letter');
    expect((await screen.findByRole('button', { name: 'Edit text' })).textContent).toBe('ABC ✎');
  }, 60_000);
});

describe('a candidate that has been clicked', () => {
  /** Each click is its own undo step, so every card looked at can be walked back to. */
  it('leaves one undo step per card clicked, and every one of them walks back', async () => {
    const kit = installKit();
    mount();
    await settle();

    const cards = () => screen.getAllByRole('button', { name: /^Recipe/ });
    const depth = kit.executor.historyDepth();
    const maps: string[] = [];
    for (const i of [0, 1, 2]) {
      await act(async () => { fireEvent.click(cards()[i]!); });
      await waitFor(() => expect(kit.executor.historyDepth()).toBe(depth + i + 1));
      maps.push(mapValue(kit.state));
    }
    expect(new Set(maps).size).toBe(3);

    for (const i of [1, 0]) {
      act(() => { kit.executor.undo(); });
      expect(mapValue(kit.state)).toBe(maps[i]);
    }
    act(() => { kit.executor.undo(); });
    expect(kit.executor.historyDepth()).toBe(depth);
    expect(kit.executor.canRedo()).toBe(true);
  }, 120_000);
});

/** One island kind; the land, isles and lakes biases stay a config field the engine reads and saved
 *  recipes carry. */
describe('the island kind', () => {
  const designedOf = (config: GenerateConfig): DesignedConfig => {
    if (config.algorithm !== 'designed') throw new Error(`the island kind ran ${config.algorithm}`);
    return config;
  };

  it('records the one bias the interface still means', () => {
    // `mixed` neither suppresses nor amplifies the water richness asks for.
    expect(designedOf(kindConfig({ ...ISLAND, kind: 'island', seed: 1 })).mode).toBe('mixed');
  });

  /** Two of the three biases a saved map can name are ones this interface no longer produces. */
  it.each(['earth', 'water', 'mixed'] as const)('generates a saved %s recipe', async (mode) => {
    const kit = makeKit();
    await generateMap(kit, {
      config: { ...designedOf(kindConfig({ ...ISLAND, kind: 'island', seed: 2024 })), mode },
      region: null,
    });
    expect(kit.state.cells.flat().some((c) => c.terrain)).toBe(true);
    expect((kit.state.generation as DesignedConfig | undefined)?.mode).toBe(mode);
  }, 60_000);

  it('reaches the config the click generates from, and takes the grid\'s own ceiling with it', async () => {
    const kit = installKit();
    mount();
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: 'Planet' }));
    await settle();
    expect(Number(screen.getByRole('slider', { name: 'Tallest layer' }).getAttribute('aria-valuemax')))
      .toBe(maxElevationFor('island'));
    expect(maxElevationFor('island')).toBe(ELEVATION_MAX);

    fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!);
    // The recorded recipe shows the kind reached the engine.
    await waitFor(() => expect(kit.state.generation?.algorithm).toBe('designed'));
  }, 60_000);
});

describe('the sliders', () => {
  it('lowers the ceiling on the maze, where a taller wall has nothing to stand on', async () => {
    installKit();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();

    const slider = screen.getByRole('slider', { name: 'Tallest layer' });
    expect(Number(slider.getAttribute('aria-valuemax'))).toBe(maxElevationFor('maze'));
    expect(maxElevationFor('maze')).toBeLessThan(ELEVATION_MAX);
  }, 30_000);

  it('swaps richness for corridor width, since one of the two is meaningless per kind', async () => {
    installKit();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Planet' }));
    await settle();
    expect(screen.queryByRole('slider', { name: 'Scenery richness' })).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Maze' }));
    await settle();
    expect(screen.queryByRole('slider', { name: 'Scenery richness' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Corridor' })).not.toBeNull();
  }, 30_000);

});

/** A candidate that is not a real run; the landing itself is proved in
 *  `editor/operations/generate-operation.slow.test.ts`. */
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

describe('the scope highlight', () => {
  /** The region still bounds every later run; only the scope screen's own Clear takes the drape down. */
  it('stays up after a run has landed', async () => {
    const kit = installKit();
    let cleared = 0;
    setActiveView({
      overlay: {
        flashCommit: () => {},
        showBuildableRegion: () => {},
        clearBuildableRegion: () => { cleared += 1; },
        showPath: () => {}, clearPath: () => {},
      },
    } as unknown as ActiveView);
    useEditorStore.setState({ region: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }] });
    mount();
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Recipe/ })[0]!); });
    await waitFor(() => expect(kit.executor.historyDepth()).toBe(1));
    expect(cleared, 'the drape survives the landed run').toBe(0);
    expect(useEditorStore.getState().region.length, 'the scope itself survives').toBe(3);
  }, 60_000);
});

describe('a click on its way to the map', () => {
  /** Landing on a map that already carries an island runs the recipe for real, most of a second on a
   *  full map, which would read as a freeze with nothing drawn. */
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

/** A run that throws rolls itself back, so the clicked card is the only place to read the refusal. */
describe('a click that does not reach the map', () => {
  it('is said on the card that was clicked, and clears itself', async () => {
    // Faking requestAnimationFrame here would stall Framer's frame loop for the rest of the file.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    try {
      installKit();
      vi.mocked(barrelCandidate).mockImplementation(async () => fakeCandidate());
      vi.mocked(barrelGenerateMap).mockRejectedValue(new Error('refused'));
      mount();
      await settle();

      const cards = screen.getAllByRole('button', { name: /^Recipe/ });
      await act(async () => { fireEvent.click(cards[1]!); });
      await waitFor(() => expect(screen.queryByText('Did not build')).not.toBeNull());
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

/**
 * The picture kinds' strip. A letter stands one layer on its ground, so it has no tallest layer; a
 * picture's heights are its colours, so its tallest layer is the depth of the terrain ramp and means
 * nothing when the picture is tiled with items.
 */
describe('what a picture is built from', () => {
  const knobs = (): string[] =>
    screen.queryAllByRole('slider').map((s) => s.getAttribute('aria-label') ?? '');
  const segments = (testId: string): string[] =>
    within(screen.getByTestId(testId)).getAllByRole('button').map((b) => b.textContent ?? '');
  const segment = (testId: string, name: string): HTMLElement =>
    within(screen.getByTestId(testId)).getByRole('button', { name });

  /** Each control in the strip by name, in order, regardless of state. */
  const stripShape = (): string[] =>
    [...screen.getByTestId('shell-gen-strip').children].map((c) => {
      const own = c.getAttribute('data-testid') ?? c.querySelector('[data-testid]')?.getAttribute('data-testid');
      if (own) return own;
      const slider = c.querySelector('[role="slider"]');
      if (slider) return `slider:${slider.getAttribute('aria-label')}`;
      return c.textContent?.trim() ? `text:${c.textContent.trim().slice(0, 12)}` : 'spacer';
    });

  async function open(tab: string): Promise<void> {
    installKit();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    await settle();
  }

  it('gives a letter no tallest layer at all, since it stands one layer on its own ground', async () => {
    await open('Letter');
    expect(knobs()).not.toContain('Tallest layer');
    expect(segments('shell-gen-fill')).toEqual(['Mountain', 'Water', 'Objects', 'Prints']);
  }, 30_000);

  /** Arm the letter's item, so choosing Objects is a material change rather than a trip through the
   *  item shelf. */
  async function armItem(): Promise<void> {
    await act(async () => { fireEvent.click(segment('shell-gen-fill', 'Objects')); });
    const name = localizedName(getCatalogByCategory(ItemCategory.Flora)[0]!.name, 'en');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: name } });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name })[0]!); });
    await settle();
  }

  it.each([
    ['Letter', ['Mountain', 'Water', 'Objects', 'Prints']],
    ['Picture', ['Mountain', 'Water', 'Mixed', 'Flowers', 'Trees', 'Paths']],
  ])('keeps every knob standing through every material of %s', async (tab, materials) => {
    await open(tab);
    if (tab === 'Letter') await armItem();
    const shape = stripShape();
    for (const material of materials) {
      await act(async () => { fireEvent.click(segment('shell-gen-fill', material)); });
      expect({ material, shape: stripShape() }).toEqual({ material, shape });
    }
  }, 60_000);

  it('dims the knob that cannot act rather than taking it away', async () => {
    await open('Picture');
    const layer = () => screen.getByRole('slider', { name: 'Tallest layer' });
    expect(layer().getAttribute('aria-disabled')).toBeNull();

    // Mixed is terrain with objects at its anchor points, so the ramp is still its ground.
    await act(async () => { fireEvent.click(segment('shell-gen-fill', 'Mixed')); });
    expect(layer().getAttribute('aria-disabled')).toBeNull();

    await act(async () => { fireEvent.click(segment('shell-gen-fill', 'Flowers')); });
    expect(layer().getAttribute('aria-disabled')).toBe('true');
    expect(layer().getAttribute('aria-valuetext')).toBe('n/a');

    cleanup();
    await open('Letter');
    // A letter's dimmed control is the item its shape is tiled with.
    const chip = () => screen.getByTestId('shell-gen-item');
    expect(chip().getAttribute('aria-disabled')).toBe('true');
    await armItem();
    expect(chip().getAttribute('aria-disabled')).toBe('false');
  }, 60_000);

  /** A letter is tiled with one item, which the item shelf chooses. */
  it('offers the object split and the path surfaces to a picture, and neither to a letter', async () => {
    await open('Picture');
    expect(segments('shell-gen-fill')).toEqual(['Mountain', 'Water', 'Mixed', 'Flowers', 'Trees', 'Paths']);
    cleanup();
    await open('Letter');
    expect(segments('shell-gen-fill')).toEqual(['Mountain', 'Water', 'Objects', 'Prints']);
  }, 30_000);

  /** Mixed carries the accent, so decoration follows from the material. */
  it('offers no accent switch on either picture kind', async () => {
    await open('Picture');
    expect(screen.queryByRole('switch', { name: 'Accent' })).toBeNull();
    cleanup();
    await open('Letter');
    expect(screen.queryByRole('switch', { name: 'Accent' })).toBeNull();
  }, 30_000);

  /** Each kind keeps its own tallest layer, so the maze's ceiling of 3 does not carry into a picture. */
  it('gives a picture the whole ramp even after the maze, which caps at three', async () => {
    await open('Maze');
    const layer = () => screen.getByRole('slider', { name: 'Tallest layer' });
    expect(layer().getAttribute('aria-valuemax')).toBe('3');
    expect(layer().getAttribute('aria-valuenow')).toBe('3');

    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    await settle();
    expect(layer().getAttribute('aria-valuemax')).toBe(String(ELEVATION_MAX));
    expect(layer().getAttribute('aria-valuenow')).toBe(String(ELEVATION_MAX));
  }, 30_000);

  /** The chip names the chosen item and is the way back to the shelf that changes it. */
  it('keeps a letter\'s chosen item on the strip, and reopens the shelf that changes it', async () => {
    await open('Letter');
    await act(async () => { fireEvent.click(segment('shell-gen-fill', 'Objects')); });
    // The item shelf stands in for this one, as the scope screen does.
    expect(screen.queryByTestId('shell-gen-strip')).toBeNull();

    const item = getCatalogByCategory(ItemCategory.Flora)[0]!;
    const name = localizedName(item.name, 'en');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: name } });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name })[0]!); });
    await settle();

    const chip = screen.getByTestId('shell-gen-item');
    expect(chip.textContent).toContain(name);
    fireEvent.click(chip);
    expect(screen.queryByTestId('shell-gen-strip')).toBeNull();
  }, 30_000);
});

/** The region gate answers for one glyph; a word divides the region's width between its glyphs, so
 *  the floor scales with the word and the card says so rather than picturing smudges. */
describe('a word too long for its region', () => {

  it('says so on the card, and generates nothing for it', async () => {
    installKit();
    useEditorStore.setState({ region: rect(2, 2, 15, 15) });    // 14 wide: one glyph fits, three do not
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
    await settle();

    fireEvent.change(screen.getByLabelText('Your own letters'), { target: { value: 'ABC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this text' }));
    await settle();

    expect(await screen.findByText(translateFor('en', 'generate.text_too_wide'))).toBeTruthy();
  }, 30_000);

  it('takes the same word where the region has the room for it', async () => {
    installKit();
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
    await settle();

    fireEvent.change(screen.getByLabelText('Your own letters'), { target: { value: 'ABC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this text' }));
    await settle();
    expect(screen.queryByText(translateFor('en', 'generate.text_too_wide'))).toBeNull();
  }, 30_000);
});

/** The three buckets are separate, so the toast names the largest rather than adding them up. */
describe('the outcome of a letter', () => {
  const outcome = (
    stencil: { offBase: number; unsupported: number; atCeiling: number }, placed: number, budget?: 'adapted',
  ): Outcome => ({
    cells: [], placed, removedCells: 0, removedObjects: 0, violations: [], cancelled: false,
    detail: { kind: 'stencil', landing: { base: 0, ...stencil }, ...(budget ? { budget } : {}) },
  });

  it.each([
    [{ offBase: 6, unsupported: 1, atCeiling: 0 }, 20, /6 cells were left out: they stand on different ground/],
    [{ offBase: 0, unsupported: 4, atCeiling: 0 }, 20, /4 cells .* edge of the ground below/],
    [{ offBase: 3, unsupported: 0, atCeiling: 9 }, 0, /9 cells .* already at the tallest layer/],
    // A word often clips a step by a single cell, so the singular ships.
    [{ offBase: 1, unsupported: 0, atCeiling: 0 }, 20, /^1 cell was left out: it stands on different ground\.$/],
  ])('says the largest reason a word came up short (%#)', async (counts, placed, said) => {
    installKit();
    vi.mocked(barrelGenerateMap).mockResolvedValue(outcome(counts, placed));
    const heard: string[] = [];
    const stop = setToastPresenter((text) => heard.push(text));
    try {
      mount();
      fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
      await settle();
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^[A-Za-z&@?★☀❤♪]/ })[0]!); });
      await waitFor(() => expect(heard.length).toBe(1));
      expect(heard[0]).toMatch(said);
    } finally { stop(); }
  }, 30_000);

  it('says so when a run laid none of it, where nothing else can', async () => {
    // A glyph with no ink never reaches the ground, so no bucket counts it; unsaid, the press would
    // read as a broken button.
    installKit();
    vi.mocked(barrelGenerateMap).mockResolvedValue({
      cells: [], placed: 0, removedCells: 0, removedObjects: 0, violations: [], cancelled: false,
    });
    const heard: string[] = [];
    const stop = setToastPresenter((text) => heard.push(text));
    try {
      mount();
      fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
      await settle();
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^[A-Za-z&@?★☀❤♪]/ })[0]!); });
      await waitFor(() => expect(heard.length).toBe(1));
      expect(heard[0]).toMatch(/None of that word fit the region as painted/);
    } finally { stop(); }
  }, 30_000);

  it('reports a sparser run alongside the cells it left out', async () => {
    installKit();
    vi.mocked(barrelGenerateMap).mockResolvedValue(outcome({ offBase: 6, unsupported: 0, atCeiling: 0 }, 20, 'adapted'));
    const heard: string[] = [];
    const stop = setToastPresenter((text) => heard.push(text));
    try {
      mount();
      fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
      await settle();
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^[A-Za-z&@?★☀❤♪]/ })[0]!); });
      await waitFor(() => expect(heard.length).toBe(2));
      expect(heard[0]).toMatch(/6 cells were left out/);
      expect(heard[1]).toBe(translateFor('en', 'generate.budget_adapted'));
    } finally { stop(); }
  }, 30_000);

  it('says nothing about a word that was written whole', async () => {
    installKit();
    vi.mocked(barrelGenerateMap).mockResolvedValue(outcome({ offBase: 0, unsupported: 0, atCeiling: 0 }, 30));
    const heard: string[] = [];
    const stop = setToastPresenter((text) => heard.push(text));
    try {
      mount();
      fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
      await settle();
      await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^[A-Za-z&@?★☀❤♪]/ })[0]!); });
      await elapse(50);
      expect(heard).toEqual([]);
    } finally { stop(); }
  }, 30_000);
});

describe('the picture examples', () => {
  it('resolves the logo and every registered neighbor portrait', () => {
    expect(IMAGE_POOL.length).toBeGreaterThanOrEqual(CANDIDATES);
    expect(IMAGE_POOL.map((s) => s.id)).toEqual([
      'logo', 'dorjelang', 'elsasani', 'frostia', 'glenn', 'harpeno', 'heyu', 'isaki', 'manna', 'medowlyn',
      'mobai', 'mors', 'msafiri', 'nerina', 'rebella', 'tika', 'trixie', 'yunguo',
    ]);
    for (const sample of IMAGE_POOL) {
      expect({ id: sample.id, src: Boolean(sample.src) }).toEqual({ id: sample.id, src: true });
      for (const locale of LOCALES) {
        expect(sampleName(sample, locale)).not.toBe(sample.id);
      }
    }
  });

  it('names the logo after the app, in each locale it is asked in', () => {
    const logo = IMAGE_POOL.find((s) => s.id === 'logo')!;
    expect(sampleName(logo, 'en')).toBe(APP_NAME);
    expect(sampleName(logo, 'zh')).toBe(brandName('zh'));
  });

  it('uses localized names and falls back to English where a translation is unavailable', () => {
    const frostia = IMAGE_POOL.find((s) => s.id === 'frostia')!;
    expect([sampleName(frostia, 'ja'), sampleName(frostia, 'fr')]).toEqual(['フロスティア', 'Frostia']);
    const yunguo = IMAGE_POOL.find((s) => s.id === 'yunguo')!;
    expect([sampleName(yunguo, 'ru'), sampleName(yunguo, 'th')]).toEqual(['Юньго', 'อวิ๋นกั่ว']);
  });
});

describe('the batch', () => {
  it('draws one seed per card, and the card applies that same seed', async () => {
    const kit = installKit();
    mount();
    await settle();

    const shown = shownSeeds();

    expect(shown).toHaveLength(CANDIDATES);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Recipe: ${shown[1]}` })); });
    await waitFor(() => expect(kit.executor.historyDepth()).toBe(1));
    expect(kit.state.generation?.seed).toBe(shown[1]);
  }, 60_000);
});

/** A development build offers every own card; a release withholds the Picture one and shows the row
 *  without it. */
describe('the own card per build', () => {
  type Shelf = typeof import('../../../../../ui/shell/bars/generate/generate-shelf');
  const released = async (): Promise<(kind: Parameters<Shelf['hasCustomCard']>[0]) => boolean> => {
    const actual = await vi.importActual<Shelf>('../../../../../ui/shell/bars/generate/generate-shelf');
    return (kind) => actual.hasCustomCard(kind, false);
  };

  it('ships every own card in a development build and recipe and text cards in a release', async () => {
    const RELEASED = await released();
    for (const kind of ['maze', 'island', 'text', 'image'] as const) expect(hasCustomCard(kind, true), kind).toBe(true);
    expect(RELEASED('maze')).toBe(true);
    expect(RELEASED('island')).toBe(true);
    expect(RELEASED('text')).toBe(true);
    expect(RELEASED('image')).toBe(false);
  });

  it('ships the Letter and maze own cards while keeping Picture presets in a release', async () => {
    vi.mocked(hasCustomCard).mockImplementation(await released());
    const cards = () => screen.getByTestId('gen-cards-row').children.length;
    installKit();
    mount();
    await settle();
    expect(screen.getByTestId('shell-candidate-custom')).toBeTruthy();
    expect(cards()).toBe(CANDIDATES + 1);

    fireEvent.click(screen.getByRole('tab', { name: 'Letter' }));
    await settle();
    expect(screen.getByTestId('shell-candidate-custom')).toBeTruthy();
    expect(cards()).toBe(CANDIDATES + 1);

    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    await settle();
    expect(screen.queryByTestId('shell-candidate-import')).toBeNull();
    expect(cards()).toBe(CANDIDATES);
  }, 30_000);
});

/** Returning to a cached kind repaints from promises while the scroll rows re-measure each render;
 *  under reduced motion that must not become a render loop. */
describe('the shelf under reduced motion', () => {
  it('walks Maze, Letter, Planet and back to Maze without failing', async () => {
    __resetCandidateCache();
    installKit();
    setMapRenderer({
      captureState: async () => ({ width: 1706, height: 1000, toDataURL: () => 'data:image/png;base64,x' }),
    } as unknown as MapRenderer);
    vi.mocked(barrelCandidate).mockImplementation((...args) => generateCandidate(...args));
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    useEditorStore.getState().setEditMode({ mode: 'generate' });
    render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <ScaleProvider value={0.5}>
            <GenerateShelf />
          </ScaleProvider>
        </I18nProvider>
      </MotionConfig>,
    );
    const pictured = (): number => screen.getAllByRole('button', { name: /^Recipe/ })
      .filter((c) => c.querySelector('img[src^="data:image/png"]')).length;
    await waitFor(() => expect(pictured()).toBe(CANDIDATES), { timeout: 20_000 });

    for (const name of ['Letter', 'Planet', 'Maze']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      await elapse(420);
    }
    await waitFor(() => expect(pictured()).toBe(CANDIDATES), { timeout: 20_000 });
    expect(screen.getByRole('tab', { name: 'Maze' }).getAttribute('aria-selected')).toBe('true');
    expect(failed.mock.calls.map((call) => String(call[0]))).toEqual([]);
  }, 60_000);
});
