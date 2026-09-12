import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Viewport } from '../../../canvas/map2d/viewport';
import { Projection3D } from '../../../canvas/map3d/interaction/projection';
import { GROUND_SLAB_Y, layerToY, mapCenterOffset } from '../../../canvas/map3d/core/coords';
import type { EditorView, ViewProjection } from '../../../canvas/view-projection';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { TerrainType, ToolType, type EditorEvents, type GridState } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import { ToolManager } from '../../../tools/runtime/tool-manager';
import { setStoreState } from '../../_store';
import { makeStubRenderer } from '../_tool-manager';
import { makeState, setTerrain } from '../../rules/_helpers';

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
    panCamera() {}, pickObjectAt: () => null, objectBoundingBox: () => null,
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
  contentType: 'mountain', autoEdgeCut: 'off', layerPinned: false, layerVisibility: {}, eraserShape: 'dot',
}));

describe.each(['2d', '3d'] as const)('%s terrain pointer alignment', (view) => {
  it.each(['build', 'raise', 'erase'] as const)('keeps the %s ghost and edit on the terrain beneath the pointer', (action) => {
    const state = makeState(20, 20);
    if (action !== 'build') setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const manager = new ToolManager(makeStubRenderer(), executor, state);
    const { projection, point } = camera(view, state);
    const showGhost = vi.fn();
    manager.setView({
      projection,
      overlay: { showGhost, clearGhost() {}, flashCommit() {} } as unknown as EditorView['overlay'],
      applyCameraTransform() {},
    });
    manager.setActiveTool(action === 'erase' ? ToolType.Eraser : ToolType.TerrainBrush);
    manager.elevation = action === 'raise' ? 2 : 1;
    const p = point(action === 'build' ? GROUND_SLAB_Y : layerToY(1));
    expect(projection.screenToMacro(p.x, p.y)).toEqual({ x: 4, y: 4 });
    manager.handlePointerMove(p.x, p.y);
    expect(showGhost.mock.calls[showGhost.mock.calls.length - 1]?.slice(0, 3)).toEqual([[{ x: 5, y: 5 }], expect.anything(), true]);
    manager.handlePointerDown(p.x, p.y);
    manager.handlePointerUp(p.x, p.y);
    expect(state.cells[4]![4]!.terrain).toBeNull();
    expect(state.cells[5]![5]!.terrain?.elevation ?? 0).toBe(action === 'erase' ? 0 : action === 'raise' ? 2 : 1);
    expect(executor.getUndoStackSize()).toBe(1);
    executor.undo();
    expect(state.cells[5]![5]!.terrain?.elevation ?? 0).toBe(action === 'build' ? 0 : 1);
  });

  it('keeps road painting on the object grid', () => {
    const state = makeState(20, 20);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const manager = new ToolManager(makeStubRenderer(), executor, state);
    const { projection, point } = camera(view, state);
    const showGhost = vi.fn();
    manager.setView({ projection, overlay: { showGhost, clearGhost() {} } as unknown as EditorView['overlay'], applyCameraTransform() {} });
    setStoreState({ contentType: 'tile' });
    (manager.getToolById(ToolType.TerrainBrush) as DrawingTool).contentType = 'tile';
    manager.setActiveTool(ToolType.TerrainBrush);
    const p = point(GROUND_SLAB_Y);
    manager.handlePointerMove(p.x, p.y);
    expect(showGhost.mock.calls[showGhost.mock.calls.length - 1]?.slice(0, 3)).toEqual([[{ x: 4, y: 4 }], expect.anything(), false]);
  });
});
