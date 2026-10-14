// @vitest-environment jsdom
/**
 * With nothing armed, the grey hover box shows what a click selects. Over a grid of screen points in
 * the real 2D viewport and the real 3D surface pick, the real pointer machine draws a box that holds
 * the map point under the pointer. Over an object it is the object's footprint and a click selects
 * the object; over ground it is a 1×1 box on the half-cell lattice, sliding in half-cell steps, and a
 * click selects the terrain cell holding its centre.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import * as THREE from 'three';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { Viewport } from '../../../view/map2d/camera/viewport';
import { Projection3D } from '../../../view/map3d/camera/projection';
import type { ActiveView, ViewProjection } from '../../../tools/pointer/runtime';
import { TerrainType, type GridState, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { type Rect } from '../../../core/grid/rect';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { GRIDS } from '../../../core/game/profile';
import { mapPoint, type GridId } from '../../../core/grid/grids';
import { cellAtPoint, halfPoint } from '../../../core/grid/pointer';
import { pointerTarget } from '../../../view/interaction/selection-hover';
import { __setCatalogItem } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState, setTerrain } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { ItemCategory } from '../../../config/catalog/categories';

__setCatalogItem({
  id: 'idle-hover-shed', category: ItemCategory.Building, name: { en: 'Idle Hover Shed' },
  width: 3, height: 2, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});

const W = 30, H = 24;

/** Terraces of mountain and water, and two flat bodies, one of them on the half grid. */
function world(): GridState {
  const s = makeState(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ((x * 5 + y * 3) % 9) < 4 ? 0 : 1 + ((x + y) % 3);
    if (e > 0) setTerrain(s, x, y, (x + 2 * y) % 11 === 0 ? TerrainType.Water : TerrainType.Mountain, e);
  }
  const objects: PlacedObject[] = [
    { id: 'whole', catalogId: 'idle-hover-shed', position: { x: 8, y: 6 }, rotation: 0, elevation: 0 },
    { id: 'half', catalogId: 'idle-hover-shed', position: { x: 15.5, y: 11.5 }, rotation: 0, elevation: 0 },
  ];
  for (const o of objects) s.objects.set(o.id, o);
  bumpObjectsVersion(s, { added: objects });
  return s;
}

function projection(view: '2d' | '3d', state: GridState): ViewProjection {
  if (view === '2d') {
    const p = new Viewport(800, 600);
    p.setZoom(0.41, 0, 0);
    p.pan(-37.3, -21.9);
    return p;
  }
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(2, 24, 19);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return new Projection3D({
    camera, state: () => state,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
    pickObjectAt: () => null, objectBoundingBox: () => null,
  });
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 800, height: 600 }} />;
}

function pointer(type: string, init: MouseEventInit): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}

/** The area `rect` of `grid` covers, in map cells. */
function onMap(rect: Rect, grid: GridId): Rect {
  const o = GRIDS[grid].offset;
  return { x: rect.x + o.x, y: rect.y + o.y, w: rect.w, h: rect.h };
}

let el: HTMLElement;

beforeEach(() => {
  __resetCursorController();
  el = render(<Host />).getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

/** The real pointer machine over `view`, with nothing armed; returns the projection, the map and
 *  the recorded hover boxes. */
function mount(view: '2d' | '3d') {
  const gs = world();
  const proj = projection(view, gs);
  const showHover = vi.fn();
  const overlay = { ...makeStubView().overlay, showHover, clearHover: vi.fn() };
  setActiveView({ projection: proj, overlay } as unknown as ActiveView);
  const executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  registerToolManager(tm);
  tm.setActiveTool(ToolType.Hand);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    ...armedEditMode({ tool: ToolType.Hand, item: null }),
  });
  /** The box drawn for the pointer at (sx, sy), on the map, or null for none. */
  const hoverAt = (sx: number, sy: number): Rect | null => {
    showHover.mockClear();
    el.dispatchEvent(pointer('pointermove', { clientX: sx, clientY: sy }));
    const call = showHover.mock.calls[showHover.mock.calls.length - 1] as [Rect, GridId] | undefined;
    return call ? onMap(call[0], call[1]) : null;
  };
  return { gs, proj, hoverAt };
}

const onLattice = (v: number): boolean => Number.isInteger(v * 2);

describe.each(['2d', '3d'] as const)('the %s idle hover box', (view) => {
  it('holds the pointer, sits on the half-cell lattice, and shows what a click selects', () => {
    const { gs, proj, hoverAt } = mount(view);
    let checked = 0;
    const kinds = new Set<string>();
    // An irregular lattice, so the samples land at every phase of a cell, edges included.
    for (let sy = 11; sy < 600; sy += 17.3) {
      for (let sx = 9; sx < 800; sx += 19.7) {
        const point = proj.screenToPoint(sx, sy);
        const area = hoverAt(sx, sy);
        const ground = cellAtPoint(mapPoint(halfPoint(point)), 'terrain');
        if (!area) {
          expect(ground.x >= 0 && ground.y >= 0 && ground.x < W && ground.y < H, `no box at map point ${point.x},${point.y}`).toBe(false);
          continue;
        }
        expect(point.x >= area.x && point.x < area.x + area.w && point.y >= area.y && point.y < area.y + area.h,
          `box ${JSON.stringify(area)} misses map point ${point.x},${point.y}`).toBe(true);

        setStoreState({ selection: [] });
        el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
        window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: sx, clientY: sy }));
        const selected = useEditorStore.getState().selection;
        expect(selected).toHaveLength(1);
        const block = selected[0]!;
        if (block.kind === 'object') {
          const obj = gs.objects.get(block.id)!;
          expect({ x: area.x, y: area.y }).toEqual(obj.position);
        } else {
          expect(area.w).toBe(1);
          expect(area.h).toBe(1);
          expect(onLattice(area.x) && onLattice(area.y), `box origin ${area.x},${area.y} off the half-cell lattice`).toBe(true);
          const centre = mapPoint({ x: area.x + 0.5, y: area.y + 0.5 });
          expect({ x: block.x, y: block.y }).toEqual(cellAtPoint(centre, 'terrain'));
        }
        kinds.add(block.kind === 'object' ? block.id : 'terrain');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect([...kinds].sort()).toEqual(['half', 'terrain', 'whole']);
  });

  it('slides in half-cell steps as the pointer sweeps over ground', () => {
    const { gs, proj, hoverAt } = mount(view);
    const steps = new Set<number>();
    for (const sy of [131, 287, 433]) {
      let last: { area: Rect; point: { x: number; y: number } } | null = null;
      for (let sx = 9; sx < 800; sx += 1.5) {
        const point = proj.screenToPoint(sx, sy);
        const area = hoverAt(sx, sy);
        if (!area || area.w !== 1 || pointerTarget(gs, point).hit) { last = null; continue; }
        // A 3D pick jumps where a cliff hides the ground behind it; only a continuous slide counts.
        if (last && Math.abs(point.x - last.point.x) < 0.2 && Math.abs(point.y - last.point.y) < 0.2) {
          for (const d of [area.x - last.area.x, area.y - last.area.y]) {
            expect(Math.abs(d) === 0 || Math.abs(d) === 0.5, `the box jumped ${d} cells`).toBe(true);
            if (d !== 0) steps.add(Math.abs(d));
          }
        }
        last = { area, point };
      }
    }
    expect([...steps]).toEqual([0.5]);
  });
});

describe('an idle move', () => {
  it('picks objects once, also when the cell changes and the press facts are rebuilt', () => {
    const { proj } = mount('3d');
    const pickObject = vi.fn(() => null);
    (proj as { pickObject?: unknown }).pickObject = pickObject;
    for (const [sx, sy] of [[100, 100], [300, 220], [500, 400]] as const) {
      pickObject.mockClear();
      el.dispatchEvent(pointer('pointermove', { clientX: sx, clientY: sy }));
      expect(pickObject).toHaveBeenCalledTimes(1);
    }
  });
});
