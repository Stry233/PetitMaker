// @vitest-environment jsdom
/**
 * The panel the layer count opens, at both of its sizes. The panel is a view of the map: each row's
 * figure is the app's cumulative count, an empty floor keeps its row, the eye and lock write
 * straight to the store, and a paint refused by a locked layer names the layer.
 *
 * The size ladder: the arrows walk between the three sizes and stop at both ends, and a press on the
 * count opens the same size at every window.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EventBus } from '../../../../core/commands/event-bus';
import { bumpCellsVersion } from '../../../../core/model/grid-model';
import { CommandType, TerrainType, type Command, type GridState } from '../../../../core/model/types';
import { type EditorEvents } from '../../../../state/editing/events';
import { CellZone } from '../../../../core/game/zones';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { isAnnotating } from '../../../../state/editing/edit-mode';
import { showNotesForEditing } from '../../../../editor/editing/annotation-edit';
import { colsOf } from '../../../../ui/shell/controls/layer-plate';
import { Rail } from '../../../../ui/shell/Rail';
import { makeState, setTerrain, setZone } from '../../../_support/map-state';
import { ELEVATION_MAX } from '../../../../core/game/profile';
import { evidenceOn } from '../../../../core/grid/grids';
import { cellSet } from '../../../../core/grid/grids';
import { TERRAIN_GRID } from '../../../../core/game/profile';

/** A map with a shape to it: a broad first floor, a narrower second, one cell on the third. */
function stepped(): GridState {
  const state = makeState();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
  setTerrain(state, 0, 0, TerrainType.Mountain, 3);
  return state;
}

function mount() {
  return render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
}

/** Mounts on a window of the given height, which the rail's column is planned against. */
function mountAt(windowHeight: number) {
  window.innerHeight = windowHeight;
  return mount();
}

/** Opens the panel by pressing the count. */
function openPanel(): void {
  fireEvent.click(screen.getByTestId('shell-layer-readout').parentElement!);
}

/** How many floors the panel draws on one row, read off the tiles' grid. */
function columnsShown(): number {
  const grid = screen.getByTestId('shell-layer-row-0').closest('[style*="grid-template-columns"]') as HTMLElement;
  return Number(/repeat\((\d+)/.exec(grid.style.gridTemplateColumns)![1]);
}

/** Walks one rung of the size ladder. */
function press(dir: 'smaller' | 'bigger'): void {
  fireEvent.click(screen.getByTestId(`shell-layer-${dir}`));
}

/** Walks down the ladder until the pill is back. */
function closePanel(): void {
  // The ladder has three sizes, so two presses reach the pill from any of them.
  for (let i = 0; i < 3 && !screen.queryByTestId('shell-layer-readout'); i++) press('smaller');
}

const count = (elev: number) => screen.getByTestId(`shell-layer-count-${elev}`).textContent;

/** The two chevrons' paths (`ui/primitives/line-glyphs`), to read which way a mark points. */
const CHEVRON = { left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7' } as const;

/** The share a floor's bar is filled to, without the pixel minimum that keeps a few cells visible. */
function width(elev: number): string {
  const w = screen.getByTestId(`shell-layer-bar-${elev}`).style.width;
  return /([\d.]+%)/.exec(w)?.[1] ?? w;
}

beforeEach(() => {
  // Reset the window height so one test's height cannot decide the next one's layout.
  window.innerHeight = 900;
  useEditorStore.setState({
    locale: 'en',
    eventBus: new EventBus<EditorEvents>(),
    gridState: stepped(),
    activeLayer: 2,
    displayLayer: null,
    layerVisibility: {},
  });
});
afterEach(cleanup);

describe('the layer panel', () => {
  /** The panel replaces the collapsed count and stays up beside the map: neither a click outside nor
   *  Escape closes it, only walking down the ladder. */
  it('replaces the count, and only the arrow in it walks back', async () => {
    mount();
    expect(screen.queryByTestId('shell-layer-panel'), 'the interface is at rest').toBeNull();
    const opener = screen.getByTestId('shell-layer-readout').parentElement!;
    expect(opener.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(opener);
    expect(screen.getByTestId('shell-layer-panel')).toBeTruthy();
    expect(screen.queryByTestId('shell-layer-readout'), 'the collapsed count is gone').toBeNull();
    expect(screen.queryByLabelText('Raise the build layer')).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByTestId('shell-layer-panel'), 'still up').toBeTruthy();

    // The plate hangs off the window's right edge and grows leftward, so the way back is the
    // right-hand arrow, pointing at the edge.
    const back = screen.getByTestId('shell-layer-smaller');
    const out = screen.getByTestId('shell-layer-bigger');
    expect(back.querySelector('svg'), 'and it carries a mark saying which way it goes').toBeTruthy();
    expect(out.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING,
      'and it stands to the right of the way on').toBeTruthy();
    expect(back.querySelector('path')!.getAttribute('d'), 'back points at the window\'s edge')
      .toBe(CHEVRON.right);
    expect(out.querySelector('path')!.getAttribute('d'), 'and on points into the map')
      .toBe(CHEVRON.left);

    closePanel();
    // AnimatePresence keeps the panel mounted through its exit.
    await waitFor(() => expect(screen.queryByTestId('shell-layer-panel')).toBeNull());
    expect(screen.getByTestId('shell-layer-readout')).toBeTruthy();
  });

  /** The active floor is marked on its own tile, so the head does not name it a second time. */
  it('does not repeat the active floor in its head', () => {
    useEditorStore.setState({ activeLayer: 3 });
    mount();
    openPanel();
    const head = screen.getByTestId('shell-layer-smaller').parentElement!.parentElement!;
    expect(head.textContent, 'the head says no floor name at all').not.toContain('Layer 3');
    expect(screen.getByTestId('shell-layer-row-3').getAttribute('aria-pressed'), 'the tile says it')
      .toBe('true');
  });

  /** Pill, file and square form a ladder, not a cycle: one press past the square must not drop to
   *  the pill. A spent arrow stays on the plate, disabled. */
  it('walks the three sizes with the two arrows, and stops at both ends', async () => {
    mountAt(1440);
    openPanel();
    expect(columnsShown(), 'the count opens the file, which is the rung above the pill').toBe(1);
    expect((screen.getByTestId('shell-layer-bigger') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('shell-layer-smaller') as HTMLButtonElement).disabled).toBe(false);

    press('bigger');
    expect(columnsShown(), 'and the arrow into the map steps up to the square').toBe(colsOf('grid'));
    expect((screen.getByTestId('shell-layer-bigger') as HTMLButtonElement).disabled, 'nothing bigger')
      .toBe(true);

    press('smaller');
    expect(columnsShown(), 'and back down again').toBe(1);

    // The pill is the bottom rung, so walking down reaches it.
    closePanel();
    await waitFor(() => expect(screen.queryByTestId('shell-layer-panel')).toBeNull());
    expect(screen.getByTestId('shell-layer-readout')).toBeTruthy();
  });

  /** Opening is one step up the ladder at every window; the window decides only where the plate
   *  stands (`planRail`), tested below. */
  it('opens the same size at every window, one step up the ladder', () => {
    for (const h of [720, 900, 1440]) {
      mountAt(h);
      openPanel();
      expect(columnsShown(), `${h}px opens the file`).toBe(1);
      press('bigger');
      expect(columnsShown(), `${h}px`).toBe(colsOf('grid'));
      cleanup();
    }
  });

  /** The grid mutates in place and the panel subscribes only while open, so opening must reread the
   *  map rather than show what it held at mount. */
  it('reads the map as it is on opening, not as it was when the rail mounted', () => {
    act(() => { useEditorStore.setState({ gridState: makeState(), activeLayer: 0 }); });
    mount();
    openPanel();
    expect(count(0)).toBe('0');
    closePanel();

    act(() => { useEditorStore.setState({ gridState: stepped() }); });
    openPanel();
    expect(count(1)).toBe('16');
    expect(count(2)).toBe('4');
  });

  it('counts a floor cumulatively', () => {
    mount();
    openPanel();
    // `stepped`: the block on layer 3 counts on layers 1 and 2 as well.
    expect(count(1)).toBe('16');
    expect(count(2)).toBe('4');
    expect(count(3)).toBe('1');
  });

  /** A panel that grew tiles as the user built would move them under the pointer. */
  it('lists every floor the map can hold, occupied or not', () => {
    mount();
    openPanel();
    for (let e = 0; e <= ELEVATION_MAX; e++) expect(screen.getByTestId(`shell-layer-row-${e}`), `floor ${e}`).toBeTruthy();
    expect(screen.queryByTestId(`shell-layer-row-${ELEVATION_MAX + 1}`), 'and no more than it can').toBeNull();
    expect(count(0), 'nothing stands on the ground of this map').toBe('0');
    expect(count(ELEVATION_MAX), 'nor anywhere near the top of it').toBe('0');
  });

  /** Rows of `colsOf('grid')` filled from the ground up, so the short row is the top one: each row
   *  ascends left to right and stands above the one drawn after it. */
  it('lays the stack out as a square, upper rows first', () => {
    mountAt(1440);
    openPanel();
    press('bigger');
    const listed = [...document.querySelectorAll('[data-testid^="shell-layer-row-"]')]
      .map((el) => Number(el.getAttribute('data-testid')!.replace('shell-layer-row-', '')));
    const cols = columnsShown();
    expect(cols, 'the floors make the square\'s rows').toBe(colsOf('grid'));
    expect(cols, 'and the square is wider than the file').toBeGreaterThan(1);

    // Rows are cut from the ground up, so the DOM's first row holds the remainder.
    const bands: number[][] = [];
    const first = listed.length % cols || cols;
    bands.push(listed.slice(0, first));
    for (let i = first; i < listed.length; i += cols) bands.push(listed.slice(i, i + cols));
    for (const band of bands) {
      expect(band, 'a row ascends left to right').toEqual([...band].sort((a, b) => a - b));
    }
    for (let i = 1; i < bands.length; i++) {
      expect(Math.max(...bands[i]!), 'and every row stands above the one after it')
        .toBeLessThan(Math.min(...bands[i - 1]!));
    }
    expect(bands[bands.length - 1], 'the last row drawn is the ground one').toContain(0);
  });

  /** The file is the same rule with one floor per row. */
  it('reads the file downward, top floor first', () => {
    mountAt(720);
    openPanel();
    expect(columnsShown(), 'the count opens the file').toBe(1);
    const listed = [...document.querySelectorAll('[data-testid^="shell-layer-row-"]')]
      .map((el) => Number(el.getAttribute('data-testid')!.replace('shell-layer-row-', '')));
    expect(listed).toEqual([...listed].sort((a, b) => b - a));
    expect(listed[0]).toBe(ELEVATION_MAX);
    expect(listed[listed.length - 1], 'the ground is the bottom of the file').toBe(0);
  });

  /** The bar is the floor's share of the island, so building elsewhere never changes it. */
  it('measures a floor against the map rather than against the busiest floor', async () => {
    mount();
    openPanel();
    // 20x20 of grass, 16 cells reaching layer 1 and 4 reaching layer 2.
    expect(width(1)).toBe('4%');
    expect(width(2)).toBe('1%');

    const state = useEditorStore.getState().gridState!;
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    bumpCellsVersion(state);
    act(() => { useEditorStore.getState().eventBus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, [{ x: 4, y: 0 }])] }); });

    await waitFor(() => expect(width(1), 'the floor that grew').toBe('8%'));
    expect(width(2), 'and the one that did not').toBe('1%');
  });

  /** Capacity is the buildable cells; zones that refuse every edit are not room a floor could take. */
  it('counts only the cells a floor could occupy as its capacity', () => {
    const state = stepped();
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) setZone(state, x, y, CellZone.Void);
    useEditorStore.setState({ gridState: state });
    mount();
    openPanel();
    // The same 16 cells, on an island of 200 buildable ones rather than 400.
    expect(width(1)).toBe('8%');
  });

  /** A count is cells plus the objects on them, so it can exceed the island; the bar stops at full. */
  it('stops the bar at full rather than letting it run past its track', () => {
    const full = makeState();
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTerrain(full, x, y, TerrainType.Mountain, 1);
    full.objects.set('o', {
      id: 'o', catalogId: 'flower_red', position: { x: 0, y: 0 }, rotation: 0, elevation: 1,
    });
    useEditorStore.setState({ gridState: full });
    mount();
    openPanel();
    expect(count(1), 'four hundred cells and a flower standing on one of them').toBe('401');
    expect(width(1)).toBe('100%');
  });

  /** Floors are numbered as the game numbers them (the ground is layer 1), alike on the collapsed
   *  count and on the tiles. */
  it('names a floor the same way on the count as in its tiles', () => {
    useEditorStore.setState({ activeLayer: 0 });
    mount();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 1');
    openPanel();
    expect(screen.getByTestId('shell-layer-row-0').getAttribute('aria-label')).toBe('Layer 1');

    fireEvent.click(screen.getByTestId('shell-layer-row-3'));
    expect(screen.getByTestId('shell-layer-row-3').getAttribute('aria-label')).toBe('Layer 4');
    closePanel();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 4');
  });

  it('marks the floor being built on, and moves it when a row is pressed', () => {
    mount();
    openPanel();
    expect(screen.getByTestId('shell-layer-row-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shell-layer-row-1').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('shell-layer-row-1'));
    expect(useEditorStore.getState().activeLayer).toBe(1);
    expect(screen.getByTestId('shell-layer-row-1').getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the floor being PREVIEWED while one is, since that is the one a stroke would land on', () => {
    useEditorStore.setState({ activeLayer: 1, displayLayer: 3 });
    mount();
    openPanel();
    expect(screen.getByTestId('shell-layer-row-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shell-layer-row-1').getAttribute('aria-pressed')).toBe('false');
  });

  it('writes visibility and lock through to the store the map reads', () => {
    mount();
    openPanel();

    fireEvent.click(screen.getByTestId('shell-layer-eye-2'));
    expect(useEditorStore.getState().layerVisibility[2]).toBe(false);
    fireEvent.click(screen.getByTestId('shell-layer-eye-2'));
    expect(useEditorStore.getState().layerVisibility[2]).toBe(true);

    fireEvent.click(screen.getByTestId('shell-layer-lock-1'));
    expect(useEditorStore.getState().gridState!.lockedLayers.has(1)).toBe(true);
    fireEvent.click(screen.getByTestId('shell-layer-lock-1'));
    expect(useEditorStore.getState().gridState!.lockedLayers.has(1)).toBe(false);
  });

  it('follows the map while it is open', async () => {
    mount();
    openPanel();
    expect(count(3)).toBe('1');

    const state = useEditorStore.getState().gridState!;
    setTerrain(state, 1, 1, TerrainType.Mountain, 3);
    bumpCellsVersion(state);
    act(() => { useEditorStore.getState().eventBus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, [{ x: 1, y: 1 }])] }); });

    // The subscription coalesces to one callback a frame.
    await waitFor(() => expect(count(3)).toBe('2'));
  });

  it('says which layer refused a paint, and only that one', async () => {
    useEditorStore.getState().setLayerLocked(1, true);
    mount();
    openPanel();
    const tint = screen.getByTestId('shell-layer-refused-1');
    expect(screen.queryByTestId('shell-layer-refused-2'), 'an unlocked layer has nothing to say').toBeNull();
    expect(tint.style.opacity).toBe('0');

    const cmd = { type: CommandType.PaintTerrain, cells: [{ x: 0, y: 0 }], terrainType: TerrainType.Mountain, elevation: 1 } as unknown as Command;
    act(() => {
      useEditorStore.getState().eventBus.emit('validation-failed', {
        cmd,
        errors: [{ ruleId: 'V-LOCK-01', message: 'error.layer_locked', ...evidenceOn('terrain', [{ x: 0, y: 0 }]) }],
      });
    });
    await waitFor(() => expect(Number(screen.getByTestId('shell-layer-refused-1').style.opacity)).toBeGreaterThan(0));
  });

  it('ignores a refusal that was not the layer lock', async () => {
    useEditorStore.getState().setLayerLocked(1, true);
    mount();
    openPanel();
    const cmd = { type: CommandType.PaintTerrain, cells: [{ x: 0, y: 0 }], terrainType: TerrainType.Mountain, elevation: 1 } as unknown as Command;
    act(() => {
      useEditorStore.getState().eventBus.emit('validation-failed', {
        cmd,
        errors: [{ ruleId: 'V-MTN-02', message: 'error.floating_block', ...evidenceOn('terrain', [{ x: 0, y: 0 }]) }],
      });
    });
    expect(screen.getByTestId('shell-layer-refused-1').style.opacity).toBe('0');
  });
});

const pressedRows = () => [...document.querySelectorAll('[data-testid="shell-layer-annotation"], [data-testid^="shell-layer-row-"]')]
  .filter((el) => el.getAttribute('aria-pressed') === 'true').map((el) => (el as HTMLElement).dataset.testid);

/**
 * One row is selected at a time: the notes row while annotate is armed, however it was entered, and
 * otherwise the floor a stroke lands on.
 */
describe('the selected row', () => {
  beforeEach(() => { useEditorStore.getState().setEditMode({ mode: null }); });

  const doors: [string, () => void][] = [
    ['its own row', () => fireEvent.click(screen.getByTestId('shell-layer-annotation'))],
    ['the notes door', () => showNotesForEditing()],
    ['the export window', () => showNotesForEditing({ close: 'share' })],
  ];
  it.each(doors)('selects the notes row alone when annotate is entered through %s', (_door, enter) => {
    mount();
    openPanel();
    expect(pressedRows()).toEqual(['shell-layer-row-2']);
    act(enter);
    expect(isAnnotating(useEditorStore.getState())).toBe(true);
    expect(pressedRows()).toEqual(['shell-layer-annotation']);
  });

  it('hands the selection back to a floor, and to the floor it was on when the notes row lets go', () => {
    mount();
    openPanel();
    fireEvent.click(screen.getByTestId('shell-layer-annotation'));
    fireEvent.click(screen.getByTestId('shell-layer-row-1'));
    expect(isAnnotating(useEditorStore.getState())).toBe(false);
    expect(pressedRows()).toEqual(['shell-layer-row-1']);
    fireEvent.click(screen.getByTestId('shell-layer-annotation'));
    fireEvent.click(screen.getByTestId('shell-layer-annotation'));
    expect(pressedRows()).toEqual(['shell-layer-row-1']);
  });
});
