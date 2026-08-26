/**
 * SelectionHandles in both modes: the plural (group) corner buttons, and the singular ones they
 * sit alongside (rotatable gates the rotate corner, a locked-with-no-terrain block hides both).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SelectionHandles } from '../../../ui/chrome/floating/SelectionHandles';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { registerCatalogItem } from '../../../state/catalog';
import { CommandType, ItemCategory } from '../../../core/model/types';
import type { EditorEvents, GridState, PlacedObject, ValidationError } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { setActiveView } from '../../../canvas/active-view';
import type { ActiveView } from '../../../canvas/view-projection';
import { groupRowMetrics } from '../../../ui/chrome/floating/selection-handles-layout';
import { roadLookup } from '../../../state/object-index';

// The chrome scale is normally derived from the viewport + the animated uiZoom; here it is a value the
// test owns, so a scale CHANGE can be driven deterministically (the tracking has to survive one).
let mockChrome = 1;
vi.mock('../../../ui/design/scale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ui/design/scale')>();
  return { ...actual, useChromeScale: () => mockChrome };
});

registerCatalogItem({
  id: 'sel-hut', category: ItemCategory.Building, name: { en: 'sel-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});
registerCatalogItem({
  id: 'sel-rot-hut', category: ItemCategory.Building, name: { en: 'sel-rot-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});
// A non-square, non-rotatable footprint: the one shape rotateGroup refuses (a stand-in for a
// bridge/ramp span, without needing the real waterSpan trait — the refusal only reads
// catalog.rotatable and the footprint's own w !== h).
registerCatalogItem({
  id: 'sel-span', category: ItemCategory.Bridge, name: { en: 'sel-span' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

interface Spec { id: string; catalogId: string; x: number; y: number; locked?: boolean }

function placeAll(specs: Spec[]): { gs: GridState; exec: CommandExecutor } {
  const gs = makeState(24, 24);
  const exec = new CommandExecutor(gs, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(gs));
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: s.catalogId, position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
      ...(s.locked ? { locked: true } : {}),
    };
    const res = exec.execute({ type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 0 });
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
  return { gs, exec, ...render(<SelectionHandles />, { wrapper: Wrapper }) };
}

/** A linear ViewProjection double (no camera involved — same test-double idiom
 *  `__tests__/canvas/multi-select.test.tsx` uses), offset by (dx, dy) and scaled, so a fixed macro
 *  layout can be pushed to any screen position and size — standing in for "whatever framing a pan,
 *  orbit or dolly happened to produce". `behind` stands in for a point behind a 3D camera. */
function makeView(dx: number, dy: number, scale = 10, behind = false): ActiveView {
  return {
    projection: {
      cellToScreen: (x: number, y: number) => ({
        x: x * scale + dx, y: y * scale + dy, scale, ...(behind ? { behind: true } : {}),
      }),
      screenToMacro: () => ({ x: 0, y: 0 }),
      screenToMicro: () => ({ x: 0, y: 0 }),
      pan: () => {},
    },
  } as unknown as ActiveView;
}

afterEach(() => {
  cleanup();
  setActiveView(null);
  mockChrome = 1;
  useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [], deletePopover: null, viewMode: '2d' });
});

describe('SelectionHandles: single selection (unchanged)', () => {
  it('shows only delete for a non-rotatable, unlocked object', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(screen.getByTestId('handle-delete')).toBeTruthy();
    expect(screen.queryByTestId('handle-rotate')).toBeNull();
    expect(screen.queryByTestId('selection-count')).toBeNull();
  });

  it('shows both corners for a rotatable object', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    expect(screen.getByTestId('handle-delete')).toBeTruthy();
    expect(screen.getByTestId('handle-rotate')).toBeTruthy();
  });

  it('shows nothing for a locked object (no terrain fallback)', () => {
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4, locked: true }]);
    expect(screen.queryByTestId('handle-delete')).toBeNull();
    expect(screen.queryByTestId('handle-rotate')).toBeNull();
  });
});

describe('SelectionHandles: plural (group) selection', () => {
  it('shows one box with a count for a group, and both corners', () => {
    renderWithSelection([
      { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'sel-hut', x: 6, y: 4 },
      { id: 'c', catalogId: 'sel-hut', x: 8, y: 4 },
    ]);
    expect(screen.getByTestId('selection-count').textContent).toBe('3');
    expect(screen.getByTestId('handle-delete')).toBeTruthy();
    expect(screen.getByTestId('handle-rotate')).toBeTruthy(); // present even if a member cannot rotate
  });

  it('the rotate corner still shows when a member cannot rotate, and the click surfaces the refusal', () => {
    const { gs } = renderWithSelection([
      { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
      { id: 'span', catalogId: 'sel-span', x: 8, y: 4 },
    ]);
    expect(screen.getByTestId('handle-rotate')).toBeTruthy();
    const seen: ValidationError[] = [];
    useEditorStore.getState().eventBus.on('validation-failed', ({ errors }) => seen.push(...errors));
    fireEvent.click(screen.getByTestId('handle-rotate'));
    expect(seen.some((e) => e.message === 'error.span_no_group_rotate')).toBe(true);
    expect(gs.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
    expect(gs.objects.get('span')!.position).toEqual({ x: 8, y: 4 });
  });

  it('the delete corner applies without a confirm step: it removes what it can, in one undo', () => {
    const { gs, exec } = renderWithSelection([
      { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
      { id: 'b', catalogId: 'sel-hut', x: 6, y: 4 },
      { id: 'plaza', catalogId: 'sel-hut', x: 10, y: 4, locked: true },
    ]);
    expect(useEditorStore.getState().deletePopover).toBeNull();
    const before = exec.getUndoStackSize();
    fireEvent.click(screen.getByTestId('handle-delete'));
    expect(useEditorStore.getState().deletePopover).toBeNull();
    expect(gs.objects.has('a')).toBe(false);
    expect(gs.objects.has('b')).toBe(false);
    expect(gs.objects.has('plaza')).toBe(true); // locked: kept, not confirmed away
    expect(exec.getUndoStackSize()).toBe(before + 1);
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: 'plaza' }]);
  });
});

// The tracked box (boxRef) is handle-delete's parent: its inline style carries the imperatively
// assigned left/top/visibility (jsdom does no real layout, so these are read straight off the element
// rather than a computed bounding rect).
const box = () => screen.getByTestId('handle-delete').parentElement as HTMLElement;

describe('SelectionHandles: the group row is anchored to a POINT, not a projected box', () => {
  const GROUP = [
    { id: 'a', catalogId: 'sel-hut', x: 4, y: 4 },
    { id: 'b', catalogId: 'sel-hut', x: 12, y: 4 },
  ];

  it('button size and spacing are IDENTICAL across camera framings; only the position moves', () => {
    // Each framing stands for a camera a projected box mis-serves: pushed to a corner, dollied in
    // (scale 40), orbited until the group projects almost end-on (scale 2, where such a box collapses
    // to a sliver, pulls the two buttons together and then vanishes).
    const framings = [makeView(300, 300, 10), makeView(80, 500, 40), makeView(600, 200, 2)];
    const seen: Array<{ left: string; width: string; height: string; gap: string; rotate: string; del: string }> = [];
    for (const view of framings) {
      setActiveView(view);
      renderWithSelection(GROUP);
      const el = box();
      expect(el.style.visibility).toBe('visible');
      seen.push({
        left: el.style.left,
        width: el.style.width, height: el.style.height, gap: el.style.gap,
        rotate: screen.getByTestId('handle-rotate').style.width,
        del: screen.getByTestId('handle-delete').style.width,
      });
      cleanup();
    }
    const m = groupRowMetrics(GROUP.length);
    for (const s of seen) {
      expect(s.width).toBe(`${m.width}px`);
      expect(s.height).toBe(`${m.height}px`);
      expect(s.gap).toBe(`${m.gap}px`);          // the buttons' distance apart: a constant
      expect(s.rotate).toBe(`${m.btn}px`);
      expect(s.del).toBe(`${m.btn}px`);
    }
    // The camera is allowed to move the row, and did.
    expect(new Set(seen.map((s) => s.left)).size).toBe(framings.length);
  });

  it('is centred over the projected centre of the members and lifted above it', () => {
    setActiveView(makeView(0, 0, 10)); // cell → screen px ×10, no offset
    renderWithSelection(GROUP);        // footprints [4,5) and [12,13) ⇒ centre x = 8.5, y = 4.5
    const m = groupRowMetrics(GROUP.length);
    expect(parseFloat(box().style.left)).toBeCloseTo(85 - m.width / 2, 5);
    expect(parseFloat(box().style.top)).toBeLessThan(45); // lifted clear of the anchor
  });

  it('stays inside the viewport for an anchor at (and past) every edge', () => {
    // jsdom's viewport is 1024x768. Each framing parks the group's centre at or beyond one edge.
    // The group's projected centre is macro (8.5, 4.5) ⇒ (85 + dx, 45 + dy) on screen; each offset
    // below parks it on one edge.
    for (const view of [makeView(-85, 300), makeView(939, 300), makeView(300, -45), makeView(300, 723)]) {
      setActiveView(view);
      renderWithSelection(GROUP);
      const el = box();
      const m = groupRowMetrics(GROUP.length);
      expect(el.style.visibility).toBe('visible');
      expect(parseFloat(el.style.left)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(el.style.left) + m.width).toBeLessThanOrEqual(window.innerWidth);
      expect(parseFloat(el.style.top)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(el.style.top) + m.height).toBeLessThanOrEqual(window.innerHeight);
      cleanup();
    }
  });

  it('hides when the anchor is off-screen, or behind the camera', () => {
    // `show` still gates on `plural`, so the box stays mounted (and Escape deselects via the store
    // regardless); only its visibility toggles off.
    setActiveView(makeView(-5000, -5000));
    renderWithSelection(GROUP);
    expect(box().style.visibility).toBe('hidden');
    cleanup();
    setActiveView(makeView(300, 300, 10, true)); // on-screen coords, but behind the camera plane
    renderWithSelection(GROUP);
    expect(box().style.visibility).toBe('hidden');
  });
});

describe('SelectionHandles: single selection layout (unchanged)', () => {
  it('keeps its exact box-derived position, never clamped, even pushed off-screen', () => {
    // Pushed 5000px left/up of the origin — any clamp would pull this back toward 0; the
    // single-selection path must not, so left/top stay strongly negative.
    setActiveView(makeView(-5000, -5000));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    const el = box();
    expect(parseFloat(el.style.left)).toBeLessThan(-1000);
    expect(parseFloat(el.style.top)).toBeLessThan(-1000);
    expect(el.style.visibility).toBe('visible');
  });

  it('lands on the footprint box exactly, with corner-pinned buttons (no row layout)', () => {
    setActiveView(makeView(0, 0, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    const el = box();
    expect(el.style.left).toBe('40px');   // cell 4 × 10
    expect(el.style.top).toBe('40px');
    expect(el.style.width).toBe('10px');  // the 1×1 footprint's projected size
    expect(el.style.display).toBe('block');
    expect(screen.getByTestId('handle-delete').style.position).toBe('absolute');
  });

  it('(3D body-box anchor): position is never clamped either', () => {
    // objectScreenBox present ⇒ the single-object path anchors to the 3D body box, not the flat
    // footprint idiom — a separate branch from the one above, and it must stay unclamped too.
    const view = {
      projection: {
        cellToScreen: () => ({ x: 0, y: 0, scale: 10 }),
        screenToMacro: () => ({ x: 0, y: 0 }),
        screenToMicro: () => ({ x: 0, y: 0 }),
        pan: () => {},
        objectScreenBox: () => ({
          x: -9000, y: -9000, w: 50, h: 50, scale: 10,
          anchors: { left: { x: -9000, y: -9000 }, right: { x: -8950, y: -9000 } },
        }),
      },
    } as unknown as ActiveView;
    setActiveView(view);
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    const el = box();
    expect(parseFloat(el.style.left)).toBeLessThan(-1000);
    expect(parseFloat(el.style.top)).toBeLessThan(-1000);
    expect(el.style.visibility).toBe('visible');
  });
});

describe('SelectionHandles: what triggers a re-track', () => {
  it('a UI-scale change repositions, and the VISUAL position is unchanged by the rescale', () => {
    // The box renders inside a `zoom: chrome` subtree, so its css coords are visual px DIVIDED by the
    // scale. Nothing emits an event when the scale moves, so without a re-track the old coords stay
    // and the buttons slide off the object as the subtree rescales around them.
    setActiveView(makeView(0, 0, 10));
    const { rerender } = renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(box().style.left).toBe('40px');
    mockChrome = 2;
    rerender(<SelectionHandles />); // RTL re-wraps in the same provider
    // Recomputed (the value CHANGED, so a reposition ran) and still over the same visual pixel.
    expect(box().style.left).toBe('20px');
    expect(parseFloat(box().style.left) * mockChrome).toBe(40);
    expect(parseFloat(box().style.top) * mockChrome).toBe(40);
    expect(parseFloat(box().style.width) * mockChrome).toBe(10);
  });

  it('a 2D↔3D view swap repositions against the NEW projection', () => {
    setActiveView(makeView(0, 0, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(box().style.left).toBe('40px');
    // The registry is re-pointed at the other view on a mode switch; the switch emits no
    // viewport-changed, so only the active-view signal can make the handles follow.
    act(() => { useEditorStore.setState({ viewMode: '3d' }); setActiveView(makeView(500, 500, 10)); });
    expect(box().style.left).toBe('540px');
  });

  it('follows the REGISTERED view, not the mode: a cold 3D scene registers after the flip', () => {
    // The switch to 3D flips the store first and registers the scene a lazy import later. Keying the
    // re-track on `viewMode` projected through the outgoing 2D view and stranded the buttons at its
    // coordinates; the signal is what says the projection is 3D's now.
    setActiveView(makeView(0, 0, 10));
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(box().style.left).toBe('40px');
    act(() => { useEditorStore.setState({ viewMode: '3d' }); });
    expect(box().style.left).toBe('40px'); // still the 2D framing: nothing else is registered yet
    act(() => { setActiveView(makeView(500, 500, 10)); }); // the scene, once built
    expect(box().style.left).toBe('540px');
  });

  it('re-tracks on the way back to 2D, where the registration lands after every layout effect', () => {
    // 3D → 2D: PixiCanvas re-registers from a PASSIVE effect, which runs after all layout effects, so
    // a layout effect keyed on `viewMode` read the 3D projection. The signal arrives with the swap.
    setActiveView(makeView(500, 500, 10));
    useEditorStore.setState({ viewMode: '3d' });
    renderWithSelection([{ id: 'a', catalogId: 'sel-hut', x: 4, y: 4 }]);
    expect(box().style.left).toBe('540px');
    act(() => { useEditorStore.setState({ viewMode: '2d' }); });
    act(() => { setActiveView(makeView(0, 0, 10)); });
    expect(box().style.left).toBe('40px');
  });
});

describe('the rotate handle is a button, not a camera control', () => {
  it('sets no cursor of its own, so the global clickable rule applies', () => {
    // `orbit` means the 3D CAMERA turning. Turning an OBJECT is a press on a button, so overriding
    // this handle's cursor to `orbit` promises a drag gesture it never has.
    renderWithSelection([{ id: 'a', catalogId: 'sel-rot-hut', x: 4, y: 4 }]);
    const rotate = screen.getByTestId('handle-rotate');
    const del = screen.getByTestId('handle-delete');
    expect(rotate.tagName).toBe('BUTTON');
    // The clickable pointer, exactly like its delete sibling: an override to `orbit` here would
    // promise a drag gesture the handle never has.
    expect(rotate.style.cursor).toContain('--pw-cursor-clickable');
    expect(rotate.style.cursor).toBe(del.style.cursor);
  });
});
