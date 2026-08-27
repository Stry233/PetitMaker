import { describe, it, expect } from 'vitest';
import { CURSOR_IDS, FORBIDDABLE, type CursorId } from '../../../core/runtime/cursor-spec';
import { CommandType, ToolType, TerrainType, type EditorEvents } from '../../../core/model/types';
import { ELEVATION_MAX } from '../../../core/model/constants';
import { ToolManager } from '../../../tools/runtime/tool-manager';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import { EraserTool } from '../../../tools/paint/eraser';
import { HandTool } from '../../../tools/runtime/hand';
import { GHOST_VALID, ObjectPlacerTool } from '../../../tools/objects/object-placer';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { getCatalogItem } from '../../../state/catalog';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { makeStubRenderer } from '../_tool-manager';
import { setStoreState } from '../../_store';
import { roadLookup } from '../../../state/object-index';

// registerDefaultTools() (tool-manager.ts) wires up exactly these 5; Scatter/RoadBrush are
// ToolType members with no tool class anywhere in src/ — setActiveTool no-ops for them, so
// looping Object.values(ToolType) through the manager would silently re-assert whatever tool
// was already active for those two, which is not "covering" them.
const REGISTERED_TOOL_TYPES: ToolType[] = [
  ToolType.Hand, ToolType.TerrainBrush, ToolType.Eraser, ToolType.ObjectPlacer, ToolType.EdgeCut,
  ToolType.Macro,
];

describe('every registered tool names a cursor from the catalogue', () => {
  it('covers every REGISTERED ToolType, so a new tool cannot silently skip one', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const manager = new ToolManager(makeStubRenderer(), exec, state);
    for (const type of REGISTERED_TOOL_TYPES) {
      manager.setActiveTool(type);
      const id = manager.getActiveTool().cursor;
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
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    expect(tool.cursor).toBe('mountain');
    tool.contentType = 'water';
    expect(tool.cursor).toBe('water');
    tool.contentType = 'tile';
    expect(tool.cursor).toBe('road');
  });

  it('reports a locked layer as "cannot act here"', () => {
    const state = makeState(10, 10);
    state.lockedLayers.add(1);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(false);
    state.lockedLayers.clear();
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(true);
  });

  it('asks about WATER, not mountain, for the water brush (a rule that genuinely tells them apart)', () => {
    // V-PLACE-BLOCK exempts a road tile only for a MOUNTAIN paint (mountain may rise over a
    // road); water painted on the same cell is NOT exempted, so it stays blocked by the object.
    // ctx.terrainType is left at Mountain here on purpose (it is ToolManager's fixed field,
    // never reassigned) — canActAt must ignore it and read this.contentType instead.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const roadItem = getCatalogItem('path-overgrown-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 4, y: 4 },
        rotation: 0, elevation: 0,
      },
      loadValue: roadItem.loadValue,
    });
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };

    const mountainTool = new DrawingTool();
    mountainTool.contentType = 'mountain';
    expect(mountainTool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true); // mountain may rise over the road

    const waterTool = new DrawingTool();
    waterTool.contentType = 'water';
    expect(waterTool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false); // water gets no such exemption
  });

  it('asks about the AUTO-STACK target for mountain, not the flat elevation field', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2); // already built to elevation 2
    state.lockedLayers.add(3); // the NEXT level up (the real target) is locked; level 1 (ctx.elevation) is not
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    // A probe that used ctx.elevation (1, unlocked) directly would wrongly say true here.
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    state.lockedLayers.delete(3);
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true);
  });

  it('reports FRESH GROUND as actionable under a build floor of 2 or 3, because the click WALKS up', () => {
    // paintCells raises a cell one level at a time (one PaintTerrain per level, 1..target) so
    // every step satisfies V-MTN-02. The probe must therefore ask about the FIRST command the
    // click issues (from + 1), not the final target: the floating-block rule rejects "set elevation 2
    // on a surface of 0", which puts the refusal badge over every fresh cell the click would succeed
    // on. Floor 1 HIDES that (there from+1 == target), which is why these floors are 2 and 3.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    for (const floor of [2, 3]) {
      const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: floor };
      expect(tool.canActAt!({ x: 3, y: 3 }, ctx), `build floor ${floor}`).toBe(true);
      // …and the final target really IS rejected on its own, which is the question a probe must NOT ask:
      // proof that the two differ, not that the rule stopped firing.
      expect(exec.getRegistry().validatePreCommand({
        type: CommandType.PaintTerrain, timestamp: Date.now(),
        cells: [{ x: 3, y: 3 }], terrainType: TerrainType.Mountain, elevation: floor,
      }, state).length, `final target ${floor}`).toBeGreaterThan(0);
    }
  });

  it('reports a capped cell as actionable, since the click issues no command there at all', () => {
    // from >= target: a no-op is not a refusal (the same reading that keeps `select` unbadged).
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, ELEVATION_MAX);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(true);
  });

  it('asks the OBJECT-PLACEMENT question for tile: refused on water, allowed on plain ground', () => {
    const state = makeState(10, 10);
    setTerrain(state, 2, 2, TerrainType.Water, 1);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'tile';
    expect(tool.canActAt!({ x: 2, y: 2 }, ctx)).toBe(false); // placeTileCell also refuses water
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(true); // plain buildable ground
  });

  it('says re-coating an already-tiled cell is legal, matching the click (which strips the old coating first)', () => {
    // EMPIRICAL CHECK: the real click (placeTileCell) calls removeOverlappingCoatings BEFORE
    // validating, so re-painting a cell that already carries a road tile is legal. This probe
    // does NOT strip anything first — it just validates a fresh PlaceObject at that cell. If
    // V-PLACE-OVERLAP did not exempt overlapping an existing COATING, this would wrongly read
    // false (stricter than the click). It does exempt it (see placement-overlap.ts: `if
    // (e.coating) continue;`), so the two agree without any extra tile-branch code.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const roadItem = getCatalogItem('path-overgrown-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 6, y: 6 },
        rotation: 0, elevation: 0,
      },
      loadValue: roadItem.loadValue,
    });
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'tile';
    expect(tool.canActAt!({ x: 6, y: 6 }, ctx)).toBe(true);
  });
});

describe('the move tool does not track its own grip', () => {
  it('keeps one cursor, leaving any drag reading to the controller\'s drag state', () => {
    // Two owners of "am I panning" drift. The pointer machine reports the pan; the tool only
    // names the mode, and this one holds `move` whether or not a pan is live.
    const tool = new HandTool();
    const state = makeState(10, 10);
    const ctx = makeToolCtx(state, new CommandExecutor(
      state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state)));
    expect(tool.cursor).toBe('move');
    tool.onPointerDown({ x: 1, y: 1 }, { x: 1, y: 1 }, ctx);
    expect(tool.cursor).toBe('move');
    expect(tool.getIsPanning()).toBe(true); // the pan itself still works
  });
});

describe('the eraser answers for what its click removes', () => {
  it('refuses a peel on a locked layer, the one thing that can reject the command it issues', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    state.lockedLayers.add(2); // the cell occupies layer 2, so V-LOCK-01 rejects the peel
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    state.lockedLayers.clear();
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true);
  });

  it('stays silent where the click SKIPS: bare ground and a hidden layer are no-ops, not refusals', () => {
    const state = makeState(10, 10);
    setTerrain(state, 6, 6, TerrainType.Mountain, 3);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 1, y: 1 }, ctx)).toBe(true); // nothing to erase
    const hidden = makeToolCtx(state, exec, 1, 1, { layerVisibility: { 3: false } });
    expect(tool.canActAt!({ x: 6, y: 6 }, hidden)).toBe(true); // eraseAt `continue`s past it
  });

  it('validates the coating REMOVALS in tile mode, and calls a bare cell a no-op', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const roadItem = getCatalogItem('path-overgrown-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 3, y: 3 },
        rotation: 0, elevation: 0,
      },
      loadValue: roadItem.loadValue,
    });
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'tile' });
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(true); // an ordinary coating comes right up
    expect(tool.canActAt!({ x: 9, y: 9 }, ctx)).toBe(true); // no coating: nothing refused
  });
});

describe('the placer names what the click will do', () => {
  it('is place when armed and select when idle', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const tool = new ObjectPlacerTool();
    expect(tool.cursor).toBe('select');
    expect(tool.cursorFor!(makeToolCtx(state, exec, 1, 1, { armedItem: 'tree-apple' }))).toBe('place');
  });

  it('is select over a terrain selection, since a terrain cell cannot be dragged', () => {
    // `tool.cursor` alone is now the static literal `'select'` and can never fail; asking
    // `cursorFor` (the live answer) with nothing armed is what actually exercises the tool.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const tool = new ObjectPlacerTool();
    setStoreState({ selection: [{ kind: 'terrain', x: 1, y: 1 }] });
    expect(tool.cursorFor!(makeToolCtx(state, exec))).toBe('select');
  });

  it('stays SELECT with an object selected: `move` is positional, not a mode', () => {
    // Drag-to-move arms only on a press over the already-selected object; a drag anywhere else
    // pans the camera. A store-driven getter cannot know where the pointer is, so answering
    // `move` here turned the whole map into a four-arrow cursor after one click. The upgrade
    // now happens in the controller, from the pointer machine's hover state — this only pins that
    // an idle placer's LIVE answer (`cursorFor`, not the static `cursor` field) is `select`.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const tool = new ObjectPlacerTool();
    setStoreState({ selection: [{ kind: 'object', id: 'obj-1' }] });
    expect(tool.cursorFor!(makeToolCtx(state, exec))).toBe('select');
  });

  it('answers with the SAME computation that tints the ghost, cell by cell', () => {
    // One function (planPlacementGhost) feeds both, so this asserts they cannot disagree: the
    // ghost colour and the probe are read for the same cells and must line up everywhere.
    const state = makeState(20, 20);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    // A REPEATABLE item (the stall), so the only thing that can refuse it is the overlap at the
    // occupied cell — a maxCount-1 cabin would read false everywhere and prove nothing.
    const stall = getCatalogItem('building-stall')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'stall-1', catalogId: stall.id, position: { x: 4, y: 4 },
        rotation: 0, elevation: 0,
      },
      loadValue: stall.loadValue,
    });

    let lastColor = 0;
    const ctx = {
      ...makeToolCtx(state, exec, 1, 1, { armedItem: stall.id }),
      overlay: { showGhost(_c: unknown, color: number) { lastColor = color; }, clearGhost() {} },
    } as never as import('../../../tools/runtime/types').ToolContext;
    const tool = new ObjectPlacerTool();

    for (const coord of [{ x: 4, y: 4 }, { x: 12, y: 12 }, { x: 4, y: 4 }, { x: 0, y: 0 }]) {
      tool.onPointerMove(coord, { x: coord.x, y: coord.y }, ctx);
      const ghostSaysValid = lastColor === GHOST_VALID;
      expect(tool.canActAt!(coord, ctx), `(${coord.x},${coord.y})`).toBe(ghostSaysValid);
    }
    // …and the two ends of that loop are genuinely different answers, so the agreement is not
    // vacuous: the occupied cell is refused, open ground is not.
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    expect(tool.canActAt!({ x: 12, y: 12 }, ctx)).toBe(true);
  });

  it('refuses a bridge where no legal span exists, matching its red span ghost', () => {
    const state = makeState(12, 12);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const item = getCatalogItem('bridge-plank')!;
    const ctx = makeToolCtx(state, exec, 1, 1, { armedItem: item.id });
    const tool = new ObjectPlacerTool();
    // Flat grass, no gap to span: detectBridgeSpan finds nothing, so the click would be refused.
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(false);
  });

  it('is silent with nothing armed, since an idle placer\'s click places nothing', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const tool = new ObjectPlacerTool();
    expect(tool.canActAt!({ x: 2, y: 2 }, makeToolCtx(state, exec))).toBe(true);
  });
});

describe('tools read from the context, not the store', () => {
  it('the eraser ACTS from the context surface, not the store — the click itself proves it', () => {
    // A canActAt probe cannot discriminate the two readings here: a water cell reads `true` from
    // BOTH a mountain surface (nothing to erase, a no-op) and a water surface (erasable, and
    // legal) — so a probe-only pin would pass against a store-reading eraser too. Driving
    // the real click is what tells them apart: an `erasesHere` reading
    // `useEditorStore.getState().contentType` ('mountain' here) SKIPS a water cell outright
    // (erasesHere(Water, 'mountain') is false), leaving the water standing. Reading ctx.contentType
    // ('water') instead means erasesHere(Water, 'water') is true, so the click ACTS: the water
    // converts to this layer's mountain (see terrain-peel.ts — water CONVERTS, it is not dug out).
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    setTerrain(state, 3, 3, TerrainType.Water, 1);
    setStoreState({ contentType: 'mountain' });                                 // the store says mountain…
    const ctx = makeToolCtx(state, exec, 1, 1, { contentType: 'water' });       // …the context says water
    const tool = new EraserTool();
    tool.onPointerDown({ x: 3, y: 3 }, { x: 3, y: 3 }, ctx);
    tool.onPointerUp({ x: 3, y: 3 }, { x: 3, y: 3 }, ctx);
    expect(state.cells[3]![3]!.terrain?.type, 'the ctx (water) reading acted; the store (mountain) reading would have left the water standing').not.toBe(TerrainType.Water);
    setStoreState({ contentType: 'mountain' });
  });

  it('the placer names its cursor from the context', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    setStoreState({ selectedItemId: null });
    const tool = new ObjectPlacerTool();
    expect(tool.cursorFor!(makeToolCtx(state, exec, 1, 1, { armedItem: 'tree-apple' }))).toBe('place');
    expect(tool.cursorFor!(makeToolCtx(state, exec))).toBe('select');
  });
});

describe('ToolContext carries the arming', () => {
  it('the manager mirrors the store into the live context', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const manager = new ToolManager(makeStubRenderer(), exec, state);
    // brushSize is NOT a store read inside refreshCtx — PixiCanvas syncs it onto the manager's own
    // field (`tm.brushSize = brushSize`), so mirroring it here means setting the manager's field.
    manager.brushSize = 4;
    setStoreState({
      contentType: 'tile', selectedItemId: 'tree-apple', placementRotation: 90, autoEdgeCut: 'round',
      layerVisibility: { 3: false }, tileMaterial: 'path-park-stone', armedMacro: 'raise',
      layerPinned: true,
    });
    manager.setActiveTool(ToolType.Eraser);      // setActiveTool refreshes
    const ctx = manager.getContext();
    expect(ctx.contentType).toBe('tile');
    expect(ctx.armedItem).toBe('tree-apple');
    expect(ctx.placementRotation).toBe(90);
    expect(ctx.autoEdgeCut).toBe('round');
    expect(ctx.layerVisibility).toEqual({ 3: false });
    expect(ctx.tileMaterial).toBe('path-park-stone');
    expect(ctx.armedMacro).toBe('raise');
    expect(ctx.brushSize).toBe(4);
    expect(ctx.macroContext.state).toBe(state);
    // Whether a hand chose the build floor is the water brush's per-cell question, so it has to
    // ride the same mirror rather than be read out of the store from inside a tool.
    expect(ctx.layerPinned).toBe(true);

    setStoreState({
      contentType: 'mountain', selectedItemId: null, placementRotation: 0, autoEdgeCut: 'off',
      layerVisibility: {}, tileMaterial: 'path-overgrown-dirt', armedMacro: null, activeLayer: 0,
      layerPinned: false, displayLayer: null,
    });
  });

  it('getContext() refreshes on its own: a caller with no pointer event (a touch tap) must not see a stale mirror', () => {
    // `usePointerInteraction`'s press path builds `PressFacts` from `ToolManager.getContext()`, and for
    // a TOUCH tap `onPointerDown` never sets `pointerKnown` — no move ever precedes it, so nothing else
    // resamples the ctx before the press decides `placementAllowed`. This pins the seam directly:
    // `setActiveTool` is the only refresh here, and nothing runs between the store change and
    // `getContext()` that would paper over a plain getter.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const manager = new ToolManager(makeStubRenderer(), exec, state);
    manager.setActiveTool(ToolType.ObjectPlacer);
    setStoreState({ selectedItemId: 'tree-apple', placementRotation: 90 });
    expect(manager.getContext().armedItem).toBe('tree-apple');
    expect(manager.getContext().placementRotation).toBe(90);
    setStoreState({ selectedItemId: null, placementRotation: 0 });
  });
});

describe('FORBIDDABLE declares exactly the badges the tools can produce', () => {
  it('every badgeable id is shown by a registered tool that implements canActAt', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const manager = new ToolManager(makeStubRenderer(), exec, state);
    const withProbe = new Set<CursorId>();
    const withoutProbe = new Set<CursorId>();
    for (const type of REGISTERED_TOOL_TYPES) {
      manager.setActiveTool(type);
      const tool = manager.getActiveTool();
      const sink = tool.canActAt ? withProbe : withoutProbe;
      if (tool instanceof DrawingTool) {
        for (const ct of ['mountain', 'water', 'tile'] as const) {
          tool.contentType = ct;
          sink.add(tool.cursor);
        }
      } else if (tool instanceof ObjectPlacerTool) {
        setStoreState({ selectedItemId: 'tree-apple' });
        sink.add(manager.getActiveCursor());
        setStoreState({ selectedItemId: null });
      } else {
        sink.add(tool.cursor);
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
