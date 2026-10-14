// @vitest-environment jsdom
/** The selection card offers the selection's actions and details and follows its projected bounds. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SelectionCard } from '../../../../ui/chrome/floating/SelectionCard';
import { useEditorStore } from '../../../../state/store';
import { activeToolOf, armedItemOf, contentTypeOf } from '../../../../state/editing/edit-mode';
import { I18nProvider } from '../../../../i18n/context';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../../rules';
import { __setCatalogItem } from '../../../../state/catalog';
import { CommandType, TerrainType } from '../../../../core/model/types';
import { ToolType } from '../../../../state/editing/vocabulary';
import type { GridState, PlacedObject, ValidationError } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { setActiveView } from '../../../../view/active-view';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import { setMapWheelSink } from '../../../../view/interaction/map-wheel';
import { newMap } from '../../../../editor/operations/map';
import { editorPort } from '../../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession } from '../../../../editor/operations/planet-session';
import { placeSessionLandmark } from '../../../_support/session-landmarks';
import { host } from '../../../../editor/host/host';
import { CellZone } from '../../../../core/game/zones';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { createExecutor } from '../../../../state/executor';
import { ItemCategory } from '../../../../config/catalog/categories';
import { headlessViewVerbs } from '../../../_support/tool-manager';
import { HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';

// The chrome scale is normally derived from the viewport + the animated uiZoom; here it is a value the
// test owns, so a scale change can be driven deterministically (the tracking has to survive one).
let mockChrome = 1;
vi.mock('../../../../ui/design/scale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../ui/design/scale')>();
  return { ...actual, useChromeScale: () => mockChrome, useTouchPrimary: () => false };
});

__setCatalogItem({
  id: 'sel-hut', category: ItemCategory.Building, name: { en: 'sel-hut' },
  width: 1, height: 1, loadValue: 7, rotatable: false, placementMode: 'point', traits: [],
});
__setCatalogItem({
  id: 'sel-rot-hut', category: ItemCategory.Building, name: { en: 'sel-rot-hut' },
  width: 1, height: 1, loadValue: 5, rotatable: true, placementMode: 'point', traits: [],
});
// A non-square footprint that turns: a quarter turn swaps its sides and can shift its anchor cell.
__setCatalogItem({
  id: 'sel-long', category: ItemCategory.Building, name: { en: 'sel-long' },
  width: 3, height: 2, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});
// A non-square, non-rotatable footprint: the one shape rotateGroup refuses.
__setCatalogItem({
  id: 'sel-span', category: ItemCategory.Bridge, name: { en: 'sel-span' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

interface Spec { id: string; catalogId: string; x: number; y: number; locked?: boolean }

function placeAll(specs: Spec[]): { gs: GridState; exec: CommandExecutor } {
  const gs = makeState(24, 24);
  const exec = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: s.catalogId, position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
      ...(s.locked ? { locked: true } : {}),
    };
    const res = exec.execute({ type: CommandType.PlaceObject, object });
    expect(res.success).toBe(true);
  }
  return { gs, exec };
}

function renderWithSelection(specs: Spec[]) {
  const { gs, exec } = placeAll(specs);
  useEditorStore.setState({
    gridState: gs,
    commandExecutor: exec,
    selection: specs.map((s) => ({ kind: 'object', id: s.id }) as const),
    locale: 'en',
  });
  return { gs, exec, ...render(<SelectionCard />, { wrapper: Wrapper }) };
}

/** A linear ViewProjection double offset by (dx, dy) and scaled, standing in for whatever framing a
 *  pan, orbit or dolly produced. `behind` stands in for a point behind a 3D camera; `orbit` makes it
 *  a 3D camera. */
function makeView(dx: number, dy: number, scale = 10, behind = false, orbit = false): ActiveView {
  return {
    projection: {
      cellToScreen: (x: number, y: number) => ({
        x: x * scale + dx, y: y * scale + dy, scale, ...(behind ? { behind: true } : {}),
      }),
      screenToPoint: () => ({ x: 0, y: 0 }),
    },
    camera: { zoomBy: () => {}, ...(orbit ? { orbit: () => {} } : {}) },
    overlay: HEADLESS_OVERLAY,
    ...headlessViewVerbs(),
  } as unknown as ActiveView;
}

/** The header's default gap from the selection it names, in css px. */
const CARD_GAP = 14;
/** The positioned card; a card for the previous selection may still be leaving. jsdom does no
 *  layout, so its imperatively written style is the measurement. */
const card = () => screen.getAllByTestId('selection-card').slice(-1)[0]!;
/** The header row's bottom edge, in css px, while the card grows upward from it. */
const headerBottom = () => window.innerHeight - parseFloat(card().style.bottom);

// An unplaced card stays hidden, so every test starts with a view to place it through.
beforeEach(() => { setActiveView(makeView(300, 300, 10)); });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setActiveView(null);
  mockChrome = 1;
  useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [], deletePopover: null, viewMode: '2d' });
});

describe('SelectionCard: actions', () => {
  it('shows pick and delete for a repeatable object without rotation', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(screen.getByTestId('handle-delete')).toBeTruthy();
    expect(screen.getByTestId('handle-pick')).toBeTruthy();
    expect(screen.queryByTestId('handle-rotate')).toBeNull();
  });

  it('names the selected item', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(screen.getByTestId('selection-details').textContent).toContain('sel-hut');
  });

  it('picks the live object rotation without changing map content or history', () => {
    const { gs, exec } = renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    gs.objects.get('a')!.rotation = 90;
    const before = exec.historyDepth();
    fireEvent.click(screen.getByRole('button', { name: 'Pick for placement' }));
    const s = useEditorStore.getState();
    expect([armedItemOf(s), activeToolOf(s)]).toEqual(['sel-rot-hut', ToolType.ObjectPlacer]);
    expect(s).toMatchObject({ placementRotation: 90, selection: [], editMode: { mode: 'object' } });
    expect(gs.objects.size).toBe(1);
    expect(exec.historyDepth()).toBe(before);
  });

  it.each([TerrainType.Mountain, TerrainType.Water])('picks terrain type %s and its height into the brush panel', (type) => {
    const gs = makeState(24, 24);
    gs.cells[4]![4]!.terrain = { type, elevation: 2 };
    useEditorStore.setState({ gridState: gs, selection: [{ kind: 'terrain', x: 4, y: 4 }], locale: 'en' });
    render(<SelectionCard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('handle-pick'));
    const s = useEditorStore.getState();
    expect([activeToolOf(s), contentTypeOf(s)]).toEqual([ToolType.TerrainBrush, type === TerrainType.Mountain ? 'mountain' : 'water']);
    expect(s).toMatchObject({
      activeLayer: 2, layerPinned: true, selection: [],
      editMode: { arming: { kind: 'brush' }, mode: type === TerrainType.Mountain ? 'mountain' : 'water' },
    });
    expect(gs.cells[4]![4]!.terrain).toEqual({ type, elevation: 2 });
  });

  it('picks a road material into the road brush instead of the object shelf', () => {
    renderWithSelection([{ id: 'a', catalogId: 'path-overgrown-dirt', x: 4, y: 4 }]);
    fireEvent.click(screen.getByTestId('handle-pick'));
    const s = useEditorStore.getState();
    expect([activeToolOf(s), armedItemOf(s)]).toEqual([ToolType.TerrainBrush, null]);
    expect(s).toMatchObject({ tileMaterial: 'path-overgrown-dirt', tileMaterialPicked: true, editMode: { mode: 'road', arming: { kind: 'brush' } } });
  });

  it('does not offer picking for unique buildings or the central plaza', () => {
    const gs = makeState(24, 24);
    for (const catalogId of ['building-myhouse', ANCHOR_LANDMARK.id]) {
      gs.objects.set('unique', { id: 'unique', catalogId, position: { x: 4, y: 4 }, rotation: 0, elevation: 0 });
      useEditorStore.setState({ gridState: gs, selection: [{ kind: 'object', id: 'unique' }] });
      render(<SelectionCard />, { wrapper: Wrapper });
      expect(screen.queryByTestId('handle-pick')).toBeNull();
      cleanup();
    }
  });

  it('does not offer picking for groups or bare ground', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }, { id: 'b', catalogId: 'sel-hut', x: 6, y: 4 }]);
    expect(screen.queryByTestId('handle-pick')).toBeNull();
    act(() => { useEditorStore.setState({ selection: [{ kind: 'terrain', x: 10, y: 10 }] }); });
    expect(screen.queryByTestId('handle-pick')).toBeNull();
  });

  it('offers rotation for a rotatable object', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    expect(screen.getByTestId('handle-rotate')).toBeTruthy();
  });

  it('offers neither delete nor rotation for a locked object', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4, locked: true }]);
    expect(screen.queryByTestId('handle-delete')).toBeNull();
    expect(screen.queryByTestId('handle-rotate')).toBeNull();
  });

  it('opens the delete confirmation for a single object and closes it on a second press', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    fireEvent.click(screen.getByTestId('handle-delete'));
    expect(useEditorStore.getState().deletePopover).toEqual({ kind: 'object', id: 'a' });
    fireEvent.click(screen.getByTestId('handle-delete'));
    expect(useEditorStore.getState().deletePopover).toBeNull();
  });
});

describe('SelectionCard: the plaza', () => {
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  function selectPlaza() {
    act(() => { useEditorStore.setState({ selection: [{ kind: 'object', id: ANCHOR_LANDMARK.id }], locale: 'en' }); });
  }

  it('offers rotate and delete in the planet session, and rotate turns it about its centre', () => {
    newMap(editorPort, 'hexia');
    enterPlanetSession(editorPort, null);
    const exec = useEditorStore.getState().commandExecutor!;
    const cells = [];
    for (let y = 10; y < 70; y++) for (let x = 10; x < 70; x++) cells.push({ x, y });
    exec.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
    expect(placeSessionLandmark({ x: 20.5, y: 20 }, 0).success).toBe(true);
    selectPlaza();
    render(<SelectionCard />, { wrapper: Wrapper });
    expect(screen.getByTestId('handle-delete')).toBeTruthy();
    fireEvent.click(screen.getByTestId('handle-rotate'));
    const { width: w, height: h } = ANCHOR_LANDMARK;
    expect(useEditorStore.getState().gridState!.objects.get(ANCHOR_LANDMARK.id)).toMatchObject(
      { rotation: 90, width: h, height: w, position: { x: 20.5 + (w - h) / 2, y: 20 + (h - w) / 2 } },
    );
    fireEvent.click(screen.getByTestId('selection-details'));
    expect(screen.queryByRole('button', { name: 'Facing 0°' })).toBeNull();
  });

  it('offers neither rotate nor delete for the plaza on an ordinary map', () => {
    newMap(editorPort, 'hexia');
    selectPlaza();
    render(<SelectionCard />, { wrapper: Wrapper });
    expect(screen.queryByTestId('handle-rotate')).toBeNull();
    expect(screen.queryByTestId('handle-delete')).toBeNull();
  });
});

describe('SelectionCard: details', () => {
  it('opens and closes the details from the name, with the facts of the item', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    const toggle = screen.getByTestId('selection-details');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const text = card().textContent ?? '';
    expect(text).toContain('1×1');
    expect(text).toContain('Load');
    expect(text).toContain('7');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('turns a rotatable object to the facing chosen in the details', () => {
    const { gs } = renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    fireEvent.click(screen.getByTestId('selection-details'));
    fireEvent.click(screen.getByRole('button', { name: 'Facing 180°' }));
    expect(gs.objects.get('a')!.rotation).toBe(180);
  });

  it('offers no facing for an object that does not rotate', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    fireEvent.click(screen.getByTestId('selection-details'));
    expect(screen.queryByRole('button', { name: 'Facing 0°' })).toBeNull();
  });

  it('lists each kind in a group and narrows the selection to one', () => {
    renderWithSelection([
      { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'sel-hut', x: 6, y: 4 },
      { id: 'c', catalogId: 'sel-rot-hut', x: 8, y: 4 },
    ]);
    expect(screen.getByTestId('selection-details').textContent).toContain('3 objects');
    fireEvent.click(screen.getByTestId('selection-details'));
    fireEvent.click(screen.getByRole('button', { name: 'Select only sel-hut' }));
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: 'a' }, { kind: 'object', id: 'b' }]);
  });
});

describe('SelectionCard: group actions', () => {
  it('rotates a group and surfaces a refusal when a member cannot turn', () => {
    const { gs } = renderWithSelection([
      { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
      { id: 'span', catalogId: 'sel-span', x: 8, y: 4 },
    ]);
    const seen: ValidationError[] = [];
    useEditorStore.getState().eventBus.on('validation-failed', ({ errors }) => seen.push(...errors));
    fireEvent.click(screen.getByTestId('handle-rotate'));
    expect(seen.some((e) => e.message === 'error.span_no_group_rotate')).toBe(true);
    expect(gs.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
  });

  it('deletes a group without a confirm step: it removes what it can, in one undo', () => {
    const { gs, exec } = renderWithSelection([
      { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'sel-hut', x: 6, y: 4 },
      { id: 'plaza', catalogId: 'sel-hut', x: 10, y: 4, locked: true },
    ]);
    const before = exec.historyDepth();
    fireEvent.click(screen.getByTestId('handle-delete'));
    expect(useEditorStore.getState().deletePopover).toBeNull();
    expect(gs.objects.has('a')).toBe(false);
    expect(gs.objects.has('b')).toBe(false);
    expect(gs.objects.has('plaza')).toBe(true);
    expect(exec.historyDepth()).toBe(before + 1);
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: 'plaza' }]);
  });
});

describe('SelectionCard: placement', () => {
  it('stands above the selection, centred on it', () => {
    setActiveView(makeView(300, 300, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]); // 340..350 on both axes
    expect(card().style.visibility).toBe('visible');
    expect(parseFloat(card().style.left)).toBeCloseTo(345, 5);
    expect(headerBottom()).toBeCloseTo(340 - CARD_GAP, 5);
  });

  it('hides when the selection leaves the viewport, or stands behind the camera', () => {
    setActiveView(makeView(-5000, -5000));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(card().style.visibility).toBe('hidden');
    cleanup();
    setActiveView(makeView(300, 300, 10, true));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }, { id: 'b', catalogId: 'sel-hut', x: 6, y: 4 }]);
    expect(card().style.visibility).toBe('hidden');
  });

  it('stays inside the viewport for a selection at every edge', () => {
    for (const view of [makeView(-45, 300), makeView(979, 300), makeView(300, -45), makeView(300, 723)]) {
      setActiveView(view);
      renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
      expect(card().style.visibility).toBe('visible');
      const left = parseFloat(card().style.left);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(window.innerWidth);
      cleanup();
    }
  });

  it('stands above the 3D body instead of the ground footprint', () => {
    const view = makeView(0, 0, 10);
    view.projection.objectScreenBox = () => ({ x: 400, y: 300, w: 50, h: 50 });
    setActiveView(view);
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    expect(parseFloat(card().style.left)).toBeCloseTo(425, 5);
    expect(headerBottom()).toBeCloseTo(300 - CARD_GAP, 5);
  });

  it('keeps terrain controls visible when an orbit reverses a projected axis', () => {
    const view = makeView(0, 0);
    view.projection.cellToScreen = (x, y) => ({ x: 500 - x * 20, y: 300 + y * 10, scale: 20 });
    setActiveView(view);
    const gs = makeState(24, 24);
    gs.cells[4]![4]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
    useEditorStore.setState({ gridState: gs, selection: [{ kind: 'terrain', x: 4, y: 4 }] });
    render(<SelectionCard />, { wrapper: Wrapper });
    expect(card().style.visibility).toBe('visible');
    expect(parseFloat(card().style.left)).toBeCloseTo(420, 5);
  });

  it('holds still while a single object turns in place', () => {
    setActiveView(makeView(300, 300, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    const before = { left: card().style.left, bottom: card().style.bottom };
    fireEvent.click(screen.getByTestId('handle-rotate'));
    expect(useEditorStore.getState().gridState!.objects.get('a')!.rotation).toBe(90);
    expect({ left: card().style.left, bottom: card().style.bottom }).toEqual(before);
  });

  it('holds still when a turn shifts a non-square footprint', () => {
    setActiveView(makeView(300, 300, 10));
    const { gs } = renderWithSelection([{ id: 'a', catalogId: 'sel-long', x: 6, y: 6 }]);
    const before = { left: card().style.left, bottom: card().style.bottom };
    for (let i = 1; i <= 4; i++) {
      fireEvent.click(screen.getByTestId('handle-rotate'));
      expect(gs.objects.get('a')!.rotation).toBe((i * 90) % 360);
      expect({ left: card().style.left, bottom: card().style.bottom }).toEqual(before);
    }
  });
});

describe('SelectionCard: wheel input', () => {
  it('hands a wheel it does not use to the map, so a touchpad pan crosses the card', () => {
    const seen: WheelEvent[] = [];
    const release = setMapWheelSink((e) => seen.push(e));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    const wheel = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    screen.getByTestId('selection-details').dispatchEvent(wheel);
    expect(seen).toEqual([wheel]);
    // Ctrl+wheel (a pinch) is zoomed window-wide by the map itself and is not forwarded.
    screen.getByTestId('selection-details').dispatchEvent(new WheelEvent('wheel', { deltaY: 40, ctrlKey: true, bubbles: true }));
    expect(seen).toHaveLength(1);
    release();
  });
});

describe('SelectionCard: what triggers a re-track', () => {
  it('keeps the card centred while its chrome scale changes', () => {
    setActiveView(makeView(300, 300, 10));
    const { rerender } = renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(parseFloat(card().style.left)).toBeCloseTo(345, 5);
    mockChrome = 2;
    rerender(<SelectionCard />);
    expect(parseFloat(card().style.left) * mockChrome).toBeCloseTo(345, 5);
  });

  it('a 2D↔3D view swap repositions against the NEW projection', () => {
    setActiveView(makeView(0, 0, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(parseFloat(card().style.left)).toBeCloseTo(45, 5);
    act(() => { useEditorStore.setState({ viewMode: '3d' }); setActiveView(makeView(500, 300, 10)); });
    expect(parseFloat(card().style.left)).toBeCloseTo(545, 5);
  });

  it('follows the REGISTERED view, not the mode: a cold 3D scene registers after the flip', () => {
    setActiveView(makeView(0, 0, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    act(() => { useEditorStore.setState({ viewMode: '3d' }); });
    expect(parseFloat(card().style.left)).toBeCloseTo(45, 5);
    act(() => { setActiveView(makeView(500, 300, 10)); });
    expect(parseFloat(card().style.left)).toBeCloseTo(545, 5);
  });

  it('follows a 2D pan as it happens', () => {
    const view = makeView(300, 300, 10);
    setActiveView(view);
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    act(() => {
      view.projection.cellToScreen = (x, y) => ({ x: x * 10 + 340, y: y * 10 + 300, scale: 10 });
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });
    expect(parseFloat(card().style.left)).toBeCloseTo(385, 5);
    expect(card().style.visibility).toBe('visible');
  });

  it('follows a 3D camera as it moves and keeps its side of the selection', () => {
    const view = makeView(300, 300, 10, false, true);
    setActiveView(view);
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    const side = card().dataset.grow;
    act(() => {
      view.projection.cellToScreen = (x, y) => ({ x: x * 10 + 360, y: y * 10 + 300, scale: 10 });
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });
    expect(card().style.visibility).toBe('visible');
    expect(parseFloat(card().style.left)).toBeCloseTo(405, 5);
    expect(card().dataset.grow).toBe(side);
  });

  it('points each facing arrow where the item fronts on screen: south at 0 degrees, turning clockwise', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    fireEvent.click(screen.getByTestId('selection-details'));
    const turn = (facing: string) => (card().querySelector(`[data-facing="${facing}"]`) as SVGElement).style.transform;
    expect(turn('0')).toBe('rotate(180deg)');
    expect(turn('90')).toBe('rotate(-90deg)');
    expect(turn('180')).toBe('rotate(0deg)');
    expect(turn('270')).toBe('rotate(90deg)');
  });
});
