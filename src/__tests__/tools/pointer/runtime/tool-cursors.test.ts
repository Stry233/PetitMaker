import { describe, it, expect, beforeEach } from 'vitest';
import { CURSOR_IDS, FORBIDDABLE, type CursorId } from '../../../../assets/cursors/cursor-spec';
import { CommandType, TerrainType } from '../../../../core/model/types';
import { ToolType } from '../../../../state/editing/vocabulary';
import { ToolManager } from '../../../../tools/pointer/runtime/tool-manager';
import { HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { HandTool } from '../../../../tools/pointer/runtime/hand';
import { ObjectPlacerTool } from '../../../../tools/pointer/objects/object-placer';
import type { GhostPaint } from '../../../../tools/pointer/runtime';
import { getCatalogItem } from '../../../../state/catalog';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { makeStubView } from '../../../_support/tool-manager';
import { setStoreState, resetStore, armedEditMode } from '../../../_support/store';
import { ELEVATION_MAX } from '../../../../core/game/profile';
import { cell, point } from '../../../_support/grid';
import { editorToolWiring } from '../../../../editor/session/tool-wiring';

beforeEach(resetStore);

// registerDefaultTools() (tool-manager.ts) wires up exactly these 6; Scatter/RoadBrush are
// ToolType members with no tool class anywhere in src/ — setActiveTool no-ops for them, so
// looping Object.values(ToolType) through the manager would silently re-assert whatever tool
// was already active for those two, which is not "covering" them.
const REGISTERED_TOOL_TYPES: ToolType[] = [
  ToolType.Hand, ToolType.TerrainBrush, ToolType.Eraser, ToolType.ObjectPlacer, ToolType.EdgeCut,
  ToolType.Macro, ToolType.Annotate,
];

describe('every registered tool names a cursor from the catalogue', () => {
  it('covers every REGISTERED ToolType, so a new tool cannot silently skip one', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), exec, state, editorToolWiring());
    for (const type of REGISTERED_TOOL_TYPES) {
      manager.setActiveTool(type);
      const id = manager.getActiveCursor();
      expect(CURSOR_IDS, `${type} -> ${id}`).toContain(id);
    }
  });

  it('accounts for every ToolType member: registered above, or asserted unregistered here', () => {
    // Every ToolType names a tool the manager registers, so the cursor check above covers the
    // whole vocabulary. Adding a ToolType means adding it to REGISTERED_TOOL_TYPES too.
    const accounted = new Set<ToolType>(REGISTERED_TOOL_TYPES);
    for (const type of Object.values(ToolType)) {
      expect(accounted.has(type), `${type} is not registered — add its tool, or drop the ToolType`).toBe(true);
    }
  });
});

describe('the build brush names its material', () => {
  it('follows the content type, not the shape', () => {
    const state = makeState(10, 10);
    const ctx = makeToolCtx(state, makeExecutor(state), 1, 1, { shape: 'rect' });
    const tool = new DrawingTool();
    arm(ctx, { contentType: 'mountain' });
    expect(tool.cursor(ctx)).toBe('mountain');
    arm(ctx, { contentType: 'water' });
    expect(tool.cursor(ctx)).toBe('water');
    arm(ctx, { contentType: 'road' });
    expect(tool.cursor(ctx)).toBe('road');
  });

  it('reports a locked layer as "cannot act here"', () => {
    const state = makeState(10, 10);
    state.lockedLayers.add(1);
    const exec = makeExecutor(state);
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'mountain' });
    const tool = new DrawingTool();
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(false);
    state.lockedLayers.clear();
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(true);
  });

  it('asks about WATER, not mountain, for the water brush (a rule that genuinely tells them apart)', () => {
    // V-PLACE-BLOCK exempts a road tile only for a mountain paint (mountain may rise over a
    // road); water painted on the same cell is not exempted, so it stays blocked by the object.
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const roadItem = getCatalogItem('path-overgrown-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject,       object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 4, y: 4 },
        rotation: 0, elevation: 0,
      },
    });
    const tool = new DrawingTool();
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'mountain' });
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true); // mountain may rise over the road

    arm(ctx, { contentType: 'water' });
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false); // water gets no such exemption
  });

  it('asks about the AUTO-STACK target for mountain, not the flat elevation field', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2); // already built to elevation 2
    state.lockedLayers.add(3); // the next level up (the real target) is locked; level 1 (ctx.arming.floor) is not
    const exec = makeExecutor(state);
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'mountain' });
    const tool = new DrawingTool();
    // A probe that used ctx.arming.floor (1, unlocked) directly would wrongly say true here.
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    state.lockedLayers.delete(3);
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true);
  });

  it('reports FRESH GROUND as actionable under a build floor of 2 or 3, because the click WALKS up', () => {
    // paintCells raises a cell one level at a time (one PaintTerrain per level, 1..target) so
    // every step satisfies V-MTN-02. The probe must therefore ask about the first command the
    // click issues (from + 1), not the final target: the floating-block rule rejects "set elevation 2
    // on a surface of 0", which puts the refusal badge over every fresh cell the click would succeed
    // on. Floor 1 hides that (there from+1 == target), which is why these floors are 2 and 3.
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const tool = new DrawingTool();
    for (const floor of [2, 3]) {
      const ctx = makeToolCtx(state, exec, 1, floor, { contentType: 'mountain' });
      expect(tool.canActAt!({ x: 3, y: 3 }, ctx), `build floor ${floor}`).toBe(true);
      // …and the final target really is rejected on its own, which is the question a probe must not ask:
      // proof that the two differ, not that the rule stopped firing.
      expect(exec.getRegistry().validatePreCommand({
        type: CommandType.PaintTerrain,         cells: [{ x: 3, y: 3 }], terrainType: TerrainType.Mountain, elevation: floor,
      }, state).length, `final target ${floor}`).toBeGreaterThan(0);
    }
  });

  it('reports a capped cell as actionable, since the click issues no command there at all', () => {
    // from >= target: a no-op is not a refusal (the same reading that keeps `select` unbadged).
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, ELEVATION_MAX);
    const exec = makeExecutor(state);
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'mountain' });
    const tool = new DrawingTool();
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(true);
  });

  it('asks the OBJECT-PLACEMENT question for tile: refused on water, allowed on plain ground', () => {
    const state = makeState(10, 10);
    setTerrain(state, 2, 2, TerrainType.Water, 1);
    const exec = makeExecutor(state);
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    arm(ctx, { contentType: 'road' });
    expect(tool.canActAt!({ x: 2, y: 2 }, ctx)).toBe(false); // placeTileCell also refuses water
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(true); // plain buildable ground
  });

  it('says re-coating an already-tiled cell is legal, matching the click (which strips the old coating first)', () => {
    // Empirical check: the real click (placeTileCell) calls removeOverlappingCoatings before
    // validating, so re-painting a cell that already carries a road tile is legal. This probe
    // does not strip anything first — it just validates a fresh PlaceObject at that cell. If
    // V-PLACE-OVERLAP did not exempt overlapping an existing coating, this would wrongly read
    // false (stricter than the click). It does exempt it (see placement-overlap.ts: `if
    // (e.coating) continue;`), so the two agree without any extra tile-branch code.
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const roadItem = getCatalogItem('path-overgrown-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject,       object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 6, y: 6 },
        rotation: 0, elevation: 0,
      },
    });
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    arm(ctx, { contentType: 'road' });
    expect(tool.canActAt!({ x: 6, y: 6 }, ctx)).toBe(true);
  });
});

describe('the move tool does not track its own grip', () => {
  it('keeps one cursor, leaving any drag reading to the controller\'s drag state', () => {
    // Two owners of "am I panning" drift. The pointer machine reports the pan; the tool only
    // names the mode, and this one holds `move` whether or not a pan is live.
    const tool = new HandTool();
    expect(tool.cursor()).toBe('move');
    tool.onPointerDown();
    expect(tool.cursor()).toBe('move');
  });
});

describe('the eraser answers for what its click removes', () => {
  it('refuses a peel on a locked layer, the one thing that can reject the command it issues', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    state.lockedLayers.add(2); // the cell occupies layer 2, so V-LOCK-01 rejects the peel
    const exec = makeExecutor(state);
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    state.lockedLayers.clear();
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true);
  });

  it('stays silent where the click SKIPS: bare ground and a hidden layer are no-ops, not refusals', () => {
    const state = makeState(10, 10);
    setTerrain(state, 6, 6, TerrainType.Mountain, 3);
    const exec = makeExecutor(state);
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 1, y: 1 }, ctx)).toBe(true); // nothing to erase
    const hidden = makeToolCtx(state, exec, 1, 1, { layerVisibility: { 3: false } });
    expect(tool.canActAt!({ x: 6, y: 6 }, hidden)).toBe(true); // eraseAt `continue`s past it
  });

  it('validates the coating REMOVALS in tile mode, and calls a bare cell a no-op', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const roadItem = getCatalogItem('path-overgrown-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject,       object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 3, y: 3 },
        rotation: 0, elevation: 0,
      },
    });
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'road' });
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(true); // an ordinary coating comes right up
    expect(tool.canActAt!({ x: 9, y: 9 }, ctx)).toBe(true); // no coating: nothing refused
  });
});

describe('the placer names what the click will do', () => {
  it('is place when armed and select when idle', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const tool = new ObjectPlacerTool();
    expect(tool.cursor(makeToolCtx(state, exec))).toBe('select');
    expect(tool.cursor(makeToolCtx(state, exec, 1, 1, { armedItem: 'tree-apple' }))).toBe('place');
  });

  it('is select over a terrain selection, since a terrain cell cannot be dragged', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const tool = new ObjectPlacerTool();
    setStoreState({ selection: [{ kind: 'terrain', x: 1, y: 1 }] });
    expect(tool.cursor(makeToolCtx(state, exec))).toBe('select');
  });

  it('stays SELECT with an object selected: `move` is positional, not a mode', () => {
    // Drag-to-move arms only on a press over the already-selected object; a drag anywhere else
    // pans the camera. A store-driven getter cannot know where the pointer is, so answering
    // `move` here turned the whole map into a four-arrow cursor after one click. The upgrade
    // now happens in the controller, from the pointer machine's hover state — this only pins that
    // an idle placer answers `select`.
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const tool = new ObjectPlacerTool();
    setStoreState({ selection: [{ kind: 'object', id: 'obj-1' }] });
    expect(tool.cursor(makeToolCtx(state, exec))).toBe('select');
  });

  it('answers with the SAME computation that tints the ghost, cell by cell', () => {
    // One function (planPlacementGhost) feeds both, so this asserts they cannot disagree: the
    // ghost colour and the probe are read for the same cells and must line up everywhere.
    const state = makeState(20, 20);
    const exec = makeExecutor(state);
    // A repeatable item (the stall), so the only thing that can refuse it is the overlap at the
    // occupied cell — a maxCount-1 cabin would read false everywhere and prove nothing.
    const stall = getCatalogItem('building-stall')!;
    exec.execute({
      type: CommandType.PlaceObject,       object: {
        id: 'stall-1', catalogId: stall.id, position: { x: 4, y: 4 },
        rotation: 0, elevation: 0,
      },
    });

    let lastPaint: GhostPaint | null = null;
    const ctx = {
      ...makeToolCtx(state, exec, 1, 1, { armedItem: stall.id }),
      overlay: { ...HEADLESS_OVERLAY, showGhost(_c: unknown, paint: GhostPaint) { lastPaint = paint; }, clearGhost() {} },
    } as never as import('../../../../tools/pointer/runtime/types').ToolContext;
    const tool = new ObjectPlacerTool();

    for (const coord of [{ x: 4, y: 4 }, { x: 12, y: 12 }, { x: 4, y: 4 }, { x: 0, y: 0 }]) {
      tool.onPointerMove(cell(coord), point({ x: coord.x, y: coord.y }), ctx);
      const ghostSaysValid = (lastPaint as GhostPaint | null)?.valid === true;
      expect(tool.canActAt!(coord, ctx), `(${coord.x},${coord.y})`).toBe(ghostSaysValid);
    }
    // …and the two ends of that loop are genuinely different answers, so the agreement is not
    // vacuous: the occupied cell is refused, open ground is not.
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    expect(tool.canActAt!({ x: 12, y: 12 }, ctx)).toBe(true);
  });

  it('refuses a bridge where no legal span exists, matching its red span ghost', () => {
    const state = makeState(12, 12);
    const exec = makeExecutor(state);
    const item = getCatalogItem('bridge-plank')!;
    const ctx = makeToolCtx(state, exec, 1, 1, { armedItem: item.id });
    const tool = new ObjectPlacerTool();
    // Flat grass, no gap to span: detectBridgeSpan finds nothing, so the click would be refused.
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(false);
  });

  it('is silent with nothing armed, since an idle placer\'s click places nothing', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const tool = new ObjectPlacerTool();
    expect(tool.canActAt!({ x: 2, y: 2 }, makeToolCtx(state, exec))).toBe(true);
  });
});

describe('tools read from the context, not the store', () => {
  it('the eraser ACTS from the context surface, not the store — the click itself proves it', () => {
    // A canActAt probe cannot discriminate the two readings here: a water cell reads `true` from
    // Both a mountain surface (nothing to erase, a no-op) and a water surface (erasable, and
    // legal) — so a probe-only pin would pass against a store-reading eraser too. Driving
    // the real click is what tells them apart: an `erasesHere` reading
    // `useEditorStore.getState().contentType` ('mountain' here) skips a water cell outright
    // (erasesHere(Water, 'mountain') is false), leaving the water standing. Reading ctx.arming.contentType
    // ('water') instead means erasesHere(Water, 'water') is true, so the click acts: the water
    // converts to this layer's mountain (see terrain-peel.ts — water converts, it is not dug out).
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    setTerrain(state, 3, 3, TerrainType.Water, 1);
    setStoreState({
      ...armedEditMode({ content: 'mountain', tool: ToolType.TerrainBrush }),
    });                                 // the store says mountain…
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'water' });       // …the context says water
    const tool = new EraserTool();
    tool.onPointerDown(cell({ x: 3, y: 3 }), point({ x: 3, y: 3 }), ctx);
    tool.onPointerUp(cell({ x: 3, y: 3 }), point({ x: 3, y: 3 }), ctx);
    expect(state.cells[3]![3]!.terrain?.type, 'the ctx (water) reading acted; the store (mountain) reading would have left the water standing').not.toBe(TerrainType.Water);
    setStoreState({ ...armedEditMode({ content: 'mountain', tool: ToolType.TerrainBrush }) });
  });

  it('the placer names its cursor from the context', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    setStoreState({ ...armedEditMode({ item: null, tool: ToolType.ObjectPlacer }) });
    const tool = new ObjectPlacerTool();
    expect(tool.cursor(makeToolCtx(state, exec, 1, 1, { armedItem: 'tree-apple' }))).toBe('place');
    expect(tool.cursor(makeToolCtx(state, exec))).toBe('select');
  });
});

describe('ToolContext carries the arming', () => {
  it('the manager mirrors the store into the live context', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), exec, state, editorToolWiring());
    setStoreState({
      placementRotation: 90, autoEdgeCut: 'round', layerVisibility: { 3: false },
      tileMaterial: 'path-park-stone', layerPinned: true, drawingBrushSize: 4,
      ...armedEditMode({ tool: ToolType.Macro, content: 'road', macro: 'raise' }),
    });
    manager.setActiveTool(ToolType.Eraser);      // setActiveTool refreshes
    const ctx = manager.getContext();
    expect(ctx.arming.contentType).toBe('road');
    expect(ctx.arming.placementRotation).toBe(90);
    expect(ctx.arming.autoEdgeCut).toBe('round');
    expect(ctx.arming.layerVisibility).toEqual({ 3: false });
    expect(ctx.arming.tileMaterial).toBe('path-park-stone');
    expect(ctx.arming.armedMacro).toBe('raise');
    expect(ctx.arming.brushSize).toBe(4);
    setStoreState(armedEditMode({ tool: ToolType.ObjectPlacer, item: 'tree-apple' }));
    expect(manager.getContext().arming.armedItem).toBe('tree-apple');
    expect(ctx.macroContext.state).toBe(state);
    // Whether a hand chose the build floor is the water brush's per-cell question, so it has to
    // ride the same mirror rather than be read out of the store from inside a tool.
    expect(ctx.arming.layerPinned).toBe(true);

    setStoreState({
      placementRotation: 0, autoEdgeCut: 'off', layerVisibility: {}, tileMaterial: 'path-overgrown-dirt',
      activeLayer: 0, layerPinned: false, displayLayer: null, drawingBrushSize: 1,
      ...armedEditMode({ content: 'mountain', item: null, macro: null, tool: ToolType.TerrainBrush }),
    });
  });

  it('getContext() refreshes on its own: a caller with no pointer event (a touch tap) must not see a stale mirror', () => {
    // `usePointerInteraction`'s press path builds `PressFacts` from `ToolManager.getContext()`, and for
    // a touch tap `onPointerDown` never sets `pointerKnown` — no move ever precedes it, so nothing else
    // resamples the ctx before the press decides `placementAllowed`. This pins the seam directly:
    // `setActiveTool` is the only refresh here, and nothing runs between the store change and
    // `getContext()` that would paper over a plain getter.
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), exec, state, editorToolWiring());
    manager.setActiveTool(ToolType.ObjectPlacer);
    setStoreState({ placementRotation: 90, ...armedEditMode({ item: 'tree-apple', tool: ToolType.ObjectPlacer }) });
    expect(manager.getContext().arming.armedItem).toBe('tree-apple');
    expect(manager.getContext().arming.placementRotation).toBe(90);
    setStoreState({ placementRotation: 0, ...armedEditMode({ item: null, tool: ToolType.ObjectPlacer }) });
  });
});

describe('FORBIDDABLE declares exactly the badges the tools can produce', () => {
  it('every badgeable id is shown by a registered tool that implements canActAt', () => {
    const state = makeState(10, 10);
    const exec = makeExecutor(state);
    const manager = new ToolManager(makeStubView(), exec, state, editorToolWiring());
    const withProbe = new Set<CursorId>();
    const withoutProbe = new Set<CursorId>();
    for (const type of REGISTERED_TOOL_TYPES) {
      manager.setActiveTool(type);
      const tool = manager.getActiveTool();
      const sink = tool.canActAt ? withProbe : withoutProbe;
      if (tool instanceof DrawingTool) {
        for (const ct of ['mountain', 'water', 'road'] as const) {
          setStoreState({ ...armedEditMode({ content: ct, tool: ToolType.TerrainBrush }) });
          sink.add(manager.getActiveCursor());
        }
        setStoreState({ ...armedEditMode({ content: 'mountain', tool: ToolType.TerrainBrush }) });
      } else if (tool instanceof ObjectPlacerTool) {
        setStoreState({ ...armedEditMode({ item: 'tree-apple', tool: ToolType.ObjectPlacer }) });
        sink.add(manager.getActiveCursor());
        setStoreState({ ...armedEditMode({ item: null, tool: ToolType.ObjectPlacer }) });
      } else {
        sink.add(manager.getActiveCursor());
      }
    }
    for (const id of FORBIDDABLE) {
      expect(withProbe.has(id), `${id} is declared badgeable but no probing tool shows it`).toBe(true);
    }
    // And the other direction: a cursor whose tool cannot answer must not claim it can be
    // refused (this is what excludes edge-cut).
    for (const id of withoutProbe) {
      expect(FORBIDDABLE.has(id), `${id} has no probe, so its badge is unreachable`).toBe(false);
    }
  });
});
