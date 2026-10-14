import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Viewport } from '../../../../view/map2d/camera/viewport';
import { Projection3D } from '../../../../view/map3d/camera/projection';
import { GROUND_SLAB_Y, layerToY, mapCenterOffset } from '../../../../view/map3d/geometry/coords';
import type { EditorView, ViewProjection } from '../../../../tools/pointer/runtime';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { ToolType } from '../../../../state/editing/vocabulary';
import { ToolManager } from '../../../../tools/pointer/runtime/tool-manager';
import { cellUnder } from '../../../../core/grid/pointer';
import { setStoreState, armedEditMode } from '../../../_support/store';
import { headlessViewVerbs, makeStubView } from '../../../_support/tool-manager';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { editorToolWiring } from '../../../../editor/session/tool-wiring';

function camera(view: '2d' | '3d', state: GridState): { projection: ViewProjection; point: (height: number) => { x: number; y: number } } {
  if (view === '2d') {
    const projection = new Viewport(800, 600);
    projection.setZoom(1.5, 0, 0);
    projection.pan(17, 29);
    return { projection, point: () => projection.macroToScreen({ x: 4.7, y: 4.7 }) };
  }
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(0, 22, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const projection = new Projection3D({
    camera, state: () => state,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
    pickObjectAt: () => null, objectBoundingBox: () => null,
  });
  const off = mapCenterOffset(state.template.width, state.template.height);
  return {
    projection,
    point: (height) => {
      const p = new THREE.Vector3(4.7 - off.x, height, 4.7 - off.z).project(camera);
      return { x: (p.x + 1) * 400, y: (1 - p.y) * 300 };
    },
  };
}

beforeEach(() => setStoreState({
  autoEdgeCut: 'off', layerPinned: false, layerVisibility: {}, eraserShape: 'free',
  ...armedEditMode({ content: 'mountain', tool: ToolType.TerrainBrush }),
}));

describe.each(['2d', '3d'] as const)('%s terrain pointer alignment', (view) => {
  it.each(['build', 'raise', 'erase'] as const)('keeps the %s ghost and edit on the terrain beneath the pointer', (action) => {
    const state = makeState(20, 20);
    if (action !== 'build') setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const executor = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
    const { projection, point } = camera(view, state);
    const showGhost = vi.fn();
    manager.setView({
      projection,
      overlay: { showGhost, clearGhost() {}, flashCommit() {} } as unknown as EditorView['overlay'],
      ...headlessViewVerbs(),
    });
    manager.setActiveTool(action === 'erase' ? ToolType.Eraser : ToolType.TerrainBrush);
    setStoreState({ activeLayer: action === 'raise' ? 2 : 1 });
    const p = point(action === 'build' ? GROUND_SLAB_Y : layerToY(1));
    expect(cellUnder(projection, p.x, p.y, 'object')).toEqual({ x: 4, y: 4 });
    manager.handlePointerMove(p.x, p.y);
    expect(showGhost.mock.calls[showGhost.mock.calls.length - 1]?.[0]).toEqual({ grid: 'terrain', cells: [{ x: 5, y: 5 }] });
    manager.handlePointerDown(p.x, p.y);
    manager.handlePointerUp(p.x, p.y);
    expect(state.cells[4]![4]!.terrain).toBeNull();
    expect(state.cells[5]![5]!.terrain?.elevation ?? 0).toBe(action === 'erase' ? 0 : action === 'raise' ? 2 : 1);
    expect(executor.historyDepth()).toBe(1);
    executor.undo();
    expect(state.cells[5]![5]!.terrain?.elevation ?? 0).toBe(action === 'build' ? 0 : 1);
  });

  it('keeps road painting on the object grid', () => {
    const state = makeState(20, 20);
    const executor = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
    const { projection, point } = camera(view, state);
    const showGhost = vi.fn();
    manager.setView({ projection, overlay: { showGhost, clearGhost() {} } as unknown as EditorView['overlay'], ...headlessViewVerbs() });
    setStoreState({ ...armedEditMode({ content: 'road', tool: ToolType.TerrainBrush }) });
    manager.setActiveTool(ToolType.TerrainBrush);
    const p = point(GROUND_SLAB_Y);
    manager.handlePointerMove(p.x, p.y);
    expect(showGhost.mock.calls[showGhost.mock.calls.length - 1]?.[0]).toEqual({ grid: 'object', cells: [{ x: 4, y: 4 }] });
  });
});

describe('3d press at a grazing camera', () => {
  it('lays one brush stamp for a click, however low the camera looks', () => {
    const state = makeState(60, 60);
    const executor = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
    const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
    // Eight degrees above the ground: one layer of new terrain hides several cells behind it.
    camera.position.set(0, 4.2, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const projection = new Projection3D({
      camera, state: () => state,
      canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
      pickObjectAt: () => null, objectBoundingBox: () => null,
    });
    manager.setView({
      projection,
      overlay: { showGhost() {}, clearGhost() {}, flashCommit() {} } as unknown as EditorView['overlay'],
      ...headlessViewVerbs(),
    });
    setStoreState({ activeLayer: 1, drawingBrushSize: 3 });
    manager.setActiveTool(ToolType.TerrainBrush);
    manager.handlePointerDown(400, 300);
    for (let i = 0; i < 8; i++) manager.handlePointerMove(400, 300);
    manager.handlePointerUp(400, 300);
    const raised = state.cells.flatMap((row, y) => row.flatMap((c, x) => (c.terrain ? [{ x, y }] : [])));
    expect(raised).toHaveLength(9);
  });
});
