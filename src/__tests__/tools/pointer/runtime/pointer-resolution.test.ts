/**
 * Every tool resolves a screen point to the same cell in both views, through one path. The golden
 * fixture holds the cells each tool received for a grid of screen points over a terraced map, in
 * the 2D view and through the 3D surface pick; the tool manager, a direct `resolvePointer` (what
 * the pointer machine's press facts and hover probe call) and `cellUnder` must all reproduce it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Viewport } from '../../../../view/map2d/camera/viewport';
import { Projection3D } from '../../../../view/map3d/camera/projection';
import type { EditorView, ViewProjection } from '../../../../tools/pointer/runtime';
import { TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { ToolType } from '../../../../state/editing/vocabulary';
import type { GridId } from '../../../../core/grid/grids';
import { useEditorStore, type EditorStore } from '../../../../state/store';
import { resolvePointer } from '../../../../tools/pointer/runtime/pointer';
import { cellUnder, halfPoint } from '../../../../core/grid/pointer';
import { ToolManager } from '../../../../tools/pointer/runtime/tool-manager';
import type { ToolContext } from '../../../../tools/pointer/runtime/types';
import { setStoreState, armedEditMode, type ArmedAs } from '../../../_support/store';
import { makeStubView } from '../../../_support/tool-manager';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import golden from '../../../fixtures/pointer/pointer-resolution.json';
import { contentTypeOf } from '../../../../state/editing/edit-mode';
import { editorToolWiring } from '../../../../editor/session/tool-wiring';

type View = '2d' | '3d';
interface GoldenView { grids: Record<string, GridId>; object: number[][]; terrain: number[][]; half: number[][] }
const GOLDEN = golden.views as Record<View, GoldenView>;

/** A 40×30 map of mixed mountain and water tiers, so the 3D pick lands on raised surfaces. */
function world(): GridState {
  const s = makeState(40, 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
    const e = ((x * 7 + y * 3) % 11) < 4 ? 0 : 1 + ((x + 2 * y) % 3);
    if (e > 0) setTerrain(s, x, y, (x + y) % 9 === 0 ? TerrainType.Water : TerrainType.Mountain, e);
  }
  return s;
}

function projection(view: View, state: GridState): ViewProjection {
  if (view === '2d') {
    const p = new Viewport(800, 600);
    p.setZoom(0.37, 0, 0);
    p.pan(-13.3, -7.9);
    return p;
  }
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(3, 26, 22);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return new Projection3D({
    camera, state: () => state,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
    pickObjectAt: () => null, objectBoundingBox: () => null,
  });
}

/** Every other point of a 28 × 26 lattice over the 800 × 600 canvas. */
function screenPoints(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0, sy = 7; sy < 600; sy += 23, r++) for (let c = 0, sx = 5; sx < 800; sx += 29, c++) {
    if (r % 2 === 0 && c % 2 === 0) out.push([sx, sy]);
  }
  return out;
}

const armed = (arming: ArmedAs): Partial<EditorStore> => armedEditMode(arming);

const ARMINGS: Array<{ name: string; tool: ToolType; store: Partial<EditorStore> }> = [
  { name: 'mountain', tool: ToolType.TerrainBrush, store: armed({ tool: ToolType.TerrainBrush, content: 'mountain' }) },
  { name: 'water', tool: ToolType.TerrainBrush, store: armed({ tool: ToolType.TerrainBrush, content: 'water' }) },
  { name: 'road', tool: ToolType.TerrainBrush, store: armed({ tool: ToolType.TerrainBrush, content: 'road' }) },
  { name: 'erase-mountain', tool: ToolType.Eraser, store: armed({ tool: ToolType.Eraser, content: 'mountain' }) },
  { name: 'erase-road', tool: ToolType.Eraser, store: armed({ tool: ToolType.Eraser, content: 'road' }) },
  { name: 'object', tool: ToolType.ObjectPlacer, store: armed({ tool: ToolType.ObjectPlacer, item: 'ramp-grassy' }) },
  { name: 'edge-cut', tool: ToolType.EdgeCut, store: armed({ tool: ToolType.EdgeCut, content: 'mountain' }) },
  { name: 'macro-raise', tool: ToolType.Macro, store: armed({ tool: ToolType.Macro, macro: 'raise' }) },
  { name: 'macro-stream', tool: ToolType.Macro, store: armed({ tool: ToolType.Macro, macro: 'stream' }) },
  { name: 'macro-road-link', tool: ToolType.Macro, store: armed({ tool: ToolType.Macro, macro: 'road-link' }) },
  { name: 'macro-patch-tree', tool: ToolType.Macro, store: armed({ tool: ToolType.Macro, macro: 'patch-tree' }) },
  { name: 'macro-none', tool: ToolType.Macro, store: armed({ tool: ToolType.Macro, macro: null }) },
  { name: 'annotate', tool: ToolType.Annotate, store: { annotationTool: 'zone' } },
  { name: 'hand', tool: ToolType.Hand, store: {} },
];

/** As JSON holds it: the fixture cannot tell -0 from 0. */
const pair = (c: MacroCoord): number[] => [c.x + 0, c.y + 0];

describe.each(['2d', '3d'] as const)('%s pointer resolution', (view) => {
  const state = world();
  const proj = projection(view, state);
  const points = screenPoints();
  const expected = GOLDEN[view];

  it('reads the object and terrain cells under every point', () => {
    expect(points.map(([sx, sy]) => pair(cellUnder(proj, sx, sy, 'object')))).toEqual(expected.object);
    expect(points.map(([sx, sy]) => pair(cellUnder(proj, sx, sy, 'terrain')))).toEqual(expected.terrain);
    expect(points.map(([sx, sy]) => pair(halfPoint(proj.screenToPoint(sx, sy))))).toEqual(expected.half);
  });

  it.each(ARMINGS)('hands the $name tool the cell it always got', ({ name, tool: type, store }) => {
    useEditorStore.setState(useEditorStore.getInitialState());
    setStoreState(store);
    const executor = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
    const editorView = { projection: proj, overlay: makeStubView().overlay } as EditorView;
    manager.setView(editorView);
    manager.setActiveTool(type);
    const tool = manager.getActiveTool();
    if ('contentType' in tool) (tool as { contentType: unknown }).contentType = contentTypeOf(useEditorStore.getState());
    const grid = expected.grids[name]!;
    expect(tool.grid(manager.getContext())).toBe(grid);

    const received: number[][] = [];
    const halves: number[][] = [];
    tool.onPointerMove = (cell: MacroCoord, point: MacroCoord, ctx: ToolContext) => {
      received.push(pair(cell));
      halves.push(pair(halfPoint(ctx.point!)));
      expect(ctx.point).toEqual(point);
    };
    const probed: number[][] = [];
    for (const [sx, sy] of points) {
      manager.handlePointerMove(sx, sy);
      probed.push(pair(resolvePointer(editorView, tool, { ...manager.getContext() }, sx, sy).cell));
    }
    expect(received).toEqual(expected[grid]);
    expect(probed).toEqual(expected[grid]);
    expect(halves).toEqual(expected.half);
  });
});
