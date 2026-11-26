// @vitest-environment jsdom
/** The pointer tool for an armed blueprint: its ghost under the pointer, a press laying it there, and
 *  E turning it, driven against a spec scene through the tool's own context. */
import { expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { makeToolCtx, type TestToolContext } from '../../_support/tool-ctx';
import { open, scene, shift, blueprintEditor } from '../../spec/blueprints/_blueprints';
import { TerrainType } from '../../spec/_world';
import { captureBlueprint, type BlueprintBody } from '../../../tools/blueprint';
import { BlueprintTool } from '../../../tools/pointer/blueprint';
import { previewBlueprint } from '../../../tools/blueprint/place';
import { toolDeclares } from '../../../tools/pointer/runtime';
import { HEADLESS_OVERLAY } from '../../../tools/pointer/runtime/host';
import { ToolType } from '../../../state/editing/vocabulary';
import { activeToolOf } from '../../../state/editing/edit-mode';
import { useEditorStore } from '../../../state/store';
import { REST_BLUEPRINT_UI } from '../../../state/slices/blueprint';
import { gridCell, mapPoint } from '../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { MacroCoord } from '../../../core/model/types';

// Heard, not replaced: the tool previews through the real placement.
vi.mock('../../../tools/blueprint/place', async (original) => {
  const actual = await original<typeof import('../../../tools/blueprint/place')>();
  return { ...actual, previewBlueprint: vi.fn(actual.previewBlueprint) };
});

blueprintEditor();

function bodyOf(sc: ReturnType<typeof scene>): BlueprintBody {
  const out = captureBlueprint(sc.w.state, sc.frame);
  if ('refusal' in out) throw new Error(`refused: ${out.refusal}`);
  return out.body;
}

/** A context over `sc` with `body` armed at `quarters`, its overlay recording what it is asked to draw. */
function armedCtx(sc: ReturnType<typeof scene>, body: BlueprintBody | null, quarters = 0) {
  const overlay = { ...HEADLESS_OVERLAY, showGhost: vi.fn(), showGroupPlacementGhost: vi.fn(), clearGhost: vi.fn() };
  const ctx: TestToolContext = makeToolCtx(sc.w.state, sc.w.sandbox.executor, 1, {
    overlay, tool: ToolType.Blueprint, setDisplayLayer: vi.fn(),
    blueprint: body ? { ...REST_BLUEPRINT_UI, armed: 'bp', body, quarters } : REST_BLUEPRINT_UI,
  });
  const placed = vi.fn();
  return { ctx: Object.assign(ctx, { blueprintPlaced: placed }), overlay, placed };
}

/** The cell a person points at to hold a `w` by `h` frame with its top-left at `c`: its centre cell. */
const held = (c: MacroCoord, w: number, h: number): MacroCoord => ({ x: c.x + Math.floor((w - 1) / 2), y: c.y + Math.floor((h - 1) / 2) });
const cell = (c: MacroCoord) => gridCell(PLACEMENT_GRID, c);
const point = (c: MacroCoord) => mapPoint({ x: c.x + 0.5, y: c.y + 0.5 });

spec('BLUE-06', "shows the blueprint's footprint and marks cells it will skip", () => {
  const sc = scene();
  const body = bodyOf(sc);
  // A mountain standing higher than the plateau would land keeps its cell.
  sc.w.stroke([shift(sc.free, 1, 1)], TerrainType.Mountain, 1);
  sc.w.stroke([shift(sc.free, 1, 1)], TerrainType.Mountain, 2);
  const { ctx, overlay } = armedCtx(sc, body);
  const tool = new BlueprintTool();
  const at = held(sc.free, body.w, body.h);
  tool.onPointerMove(cell(at), point(at), ctx);

  expect(overlay.showGhost).toHaveBeenCalled();
  const [cells, paint, , losses] = overlay.showGhost.mock.calls.at(-1)!;
  expect(paint).toMatchObject({ placement: true, valid: true });
  // The terrain the body lays, on the terrain grid, minus the one cell it skips, which the ghost marks.
  const terrain = cells.cells.filter((c: { grid?: string }) => c.grid === undefined || c.grid === 'terrain');
  expect(terrain.length).toBeGreaterThan(0);
  expect(losses).toHaveLength(1);
  expect(terrain).not.toContainEqual(expect.objectContaining(losses[0]));
  // Each laid cell is a block at the layer it lands at, the road tiles are laid as their surface,
  // and the objects stand on the terrain the placement builds.
  expect(paint.blocks).toHaveLength(terrain.length);
  for (const b of paint.blocks) expect(b.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 1 });
  expect(paint.tiles).toHaveLength(2);
  const [members, valid, onBuilt] = overlay.showGroupPlacementGhost.mock.calls.at(-1)!;
  expect(members).toHaveLength(0);
  expect(valid).toBe(true);
  expect(onBuilt).toBe(true);
  expect(tool.canActAt(cell(at), ctx)).toBe(true);
  // The layer panel highlights the surface the blueprint stands on, here the ground.
  expect(ctx.setDisplayLayer).toHaveBeenLastCalledWith(0);
  tool.onDeactivate(ctx);
  expect(ctx.setDisplayLayer).toHaveBeenLastCalledWith(null);
});

spec('BLUE-06', 'a press lays the armed blueprint held by its centre, one undo step, and reports it', () => {
  const sc = scene();
  const body = bodyOf(sc);
  const { ctx, placed, overlay } = armedCtx(sc, body);
  const tool = new BlueprintTool();
  const at = held(sc.free, body.w, body.h);
  tool.onPointerDown(cell(at), point(at), ctx);
  expect(overlay.showGhost).not.toHaveBeenCalled();
  tool.onPointerUp(cell(at), point(at), ctx);
  // The ghost comes back under the pointer for the next placement.
  expect(overlay.showGhost).toHaveBeenCalled();

  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(placed).toHaveBeenCalledTimes(1);
  const [p, out] = placed.mock.calls[0]!;
  expect(p).toEqual({ at: sc.free, quarters: 0 });
  expect(out.placed).toHaveLength(2);
  sc.w.undo();
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toBeNull();
});

spec('BLUE-09', 'the ghost follows a turn of the armed blueprint', () => {
  const sc = scene();
  const body = bodyOf(sc);
  const tool = new BlueprintTool();
  const at = held(sc.free, body.h, body.w);
  const turned = armedCtx(sc, body, 1);
  tool.onPointerMove(cell(at), point(at), turned.ctx);
  const [, paint] = turned.overlay.showGhost.mock.calls.at(-1)!;
  // Two road tiles side by side along the frame's foot stand one above the other after a clockwise turn.
  const xs = new Set(paint.tiles.map((m: { position: { x: number } }) => m.position.x));
  const ys = new Set(paint.tiles.map((m: { position: { y: number } }) => m.position.y));
  expect(xs.size).toBe(1);
  expect(ys.size).toBe(2);
});

spec('BLUE-06', 'Blueprint mode with nothing armed leaves the map as it is at rest', () => {
  const sc = scene();
  open(sc.w);
  const s = useEditorStore.getState();
  expect(activeToolOf(s)).toBe(ToolType.Blueprint);
  const { ctx, overlay } = armedCtx(sc, null);
  const declared = toolDeclares(ToolType.Blueprint);
  expect(declared.selectMode(ctx.arming)).toBe(true);
  expect(declared.holdsSelection).toBe(true);
  const tool = new BlueprintTool();
  const at = held(sc.free, 2, 2);
  const before = sc.w.fingerprint();
  tool.onPointerMove(cell(at), point(at), ctx);
  tool.onPointerDown(cell(at), point(at), ctx);
  tool.onPointerUp(cell(at), point(at), ctx);
  expect(overlay.showGhost).not.toHaveBeenCalled();
  expect(sc.w.fingerprint()).toBe(before);
});

spec('BLUE-06', 'a press reaches the map\'s listeners as one change of objects, however many it lays', () => {
  const sc = scene();
  const body = bodyOf(sc);
  const { ctx, placed } = armedCtx(sc, body);
  const tool = new BlueprintTool();
  const at = held(sc.free, body.w, body.h);
  let changes = 0;
  sc.w.sandbox.bus.on('objects-changed', () => { changes++; });
  tool.onPointerDown(cell(at), point(at), ctx);
  tool.onPointerUp(cell(at), point(at), ctx);
  expect(placed.mock.calls[0]![1].placed).toHaveLength(2);
  expect(changes).toBe(1);
});

spec('BLUE-06', 'a pointer move works out the ghost once, and again after the map changes', () => {
  const sc = scene();
  const body = bodyOf(sc);
  const { ctx } = armedCtx(sc, body);
  const tool = new BlueprintTool();
  const at = held(sc.free, body.w, body.h);
  const previews = vi.mocked(previewBlueprint);
  previews.mockClear();
  tool.onPointerMove(cell(at), point(at), ctx);
  expect(tool.canActAt(cell(at), ctx)).toBe(true);
  expect(previews).toHaveBeenCalledTimes(1);

  // A block standing higher than the plateau would land, so the ghost marks its cell.
  for (const e of [1, 2]) sc.w.stroke([shift(sc.free, 1, 1)], TerrainType.Mountain, e);
  tool.onPointerMove(cell(at), point(at), ctx);
  tool.canActAt(cell(at), ctx);
  expect(previews).toHaveBeenCalledTimes(2);
  expect(previews.mock.results.at(-1)!.value.blocked).toHaveLength(1);
});

spec('BLUE-06', 'a map edit between the cursor check and the next move shows in the ghost', () => {
  const sc = scene();
  const body = bodyOf(sc);
  const { ctx, overlay } = armedCtx(sc, body);
  const tool = new BlueprintTool();
  const at = held(sc.free, body.w, body.h);
  expect(tool.canActAt(cell(at), ctx)).toBe(true);

  // A block standing higher than the plateau would land, so the ghost marks its cell.
  for (const e of [1, 2]) sc.w.stroke([shift(sc.free, 1, 1)], TerrainType.Mountain, e);
  tool.onPointerMove(cell(at), point(at), ctx);
  const [, , , losses] = overlay.showGhost.mock.calls.at(-1)!;
  expect(losses).toHaveLength(1);
});

spec('UI-69', "the blueprint ghost's outline follows the corner cuts its terrain lands with", () => {
  const sc = scene();
  const plain = bodyOf(sc);
  const k = plain.cells.findIndex((c) => c !== null && c.type === TerrainType.Mountain);
  expect(k).toBeGreaterThanOrEqual(0);
  const cells = plain.cells.map((c, i) => (i === k ? { ...c!, corners: ['fan', 'square', 'square', 'square'] as const } : c));
  const body = { ...plain, cells } as BlueprintBody;
  const { ctx, overlay } = armedCtx(sc, body);
  const tool = new BlueprintTool();
  tool.onPointerMove(cell(held(sc.free, body.w, body.h)), point(held(sc.free, body.w, body.h)), ctx);
  const [, paint, trim] = overlay.showGhost.mock.calls.at(-1)!;
  const cut = paint.blocks.find((b: { terrain: { corners?: string[] } }) => b.terrain.corners?.[0] === 'fan');
  expect(cut).toBeDefined();
  expect(trim).toContainEqual(expect.objectContaining({ x: cut.x, y: cut.y, corners: ['fan', 'square', 'square', 'square'], patch: false }));
});
