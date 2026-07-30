import { describe, it, expect, beforeEach } from 'vitest';
import { CURSOR_IDS, FORBIDDABLE, type CursorId } from '../../ui/cursors/cursor-spec';
import { CommandType, ToolType, TerrainType, objectCategory, type EditorEvents } from '../../core/model/types';
import { ELEVATION_MAX } from '../../core/model/constants';
import { ToolManager } from '../../tools/tool-manager';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { EraserTool } from '../../tools/paint/eraser';
import { HandTool } from '../../tools/hand';
import { GHOST_VALID, ObjectPlacerTool } from '../../tools/objects/object-placer';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { getCatalogItem } from '../../state/catalog';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { makeStubRenderer } from './_tool-manager';
import { setStoreState } from '../_store';

// registerDefaultTools() (tool-manager.ts) wires up exactly these 5; Scatter/RoadBrush are
// ToolType members with no tool class anywhere in src/ — setActiveTool no-ops for them, so
// looping Object.values(ToolType) through the manager would silently re-assert whatever tool
// was already active for those two, which is not "covering" them.
const REGISTERED_TOOL_TYPES: ToolType[] = [
  ToolType.Hand, ToolType.TerrainBrush, ToolType.Eraser, ToolType.ObjectPlacer, ToolType.EdgeCut,
];

describe('every registered tool names a cursor from the catalogue', () => {
  it('covers every REGISTERED ToolType, so a new tool cannot silently skip one', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const manager = new ToolManager(makeStubRenderer(), exec, state);
    for (const type of REGISTERED_TOOL_TYPES) {
      manager.setActiveTool(type);
      const id = manager.getActiveTool().cursor;
      expect(CURSOR_IDS, `${type} -> ${id}`).toContain(id);
    }
  });

  it('accounts for every ToolType member: registered above, or asserted unregistered here', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const manager = new ToolManager(makeStubRenderer(), exec, state);
    // Scatter/RoadBrush have no tool class today. If one is ever registered, this assertion
    // starts failing — the fix is to move its ToolType into REGISTERED_TOOL_TYPES above, which
    // is what makes the cursor check above start covering it.
    expect(manager.getToolById(ToolType.Scatter)).toBeUndefined();
    expect(manager.getToolById(ToolType.RoadBrush)).toBeUndefined();
    const accounted = new Set<ToolType>([...REGISTERED_TOOL_TYPES, ToolType.Scatter, ToolType.RoadBrush]);
    for (const type of Object.values(ToolType)) {
      expect(accounted.has(type), `${type} is neither registered nor asserted unregistered — update this test`).toBe(true);
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
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
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
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const roadItem = getCatalogItem('road-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 4, y: 4 },
        rotation: 0, category: objectCategory(roadItem.category), elevation: 0,
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
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
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
    // click issues (from + 1), not the final target: validating "set elevation 2 on a surface of
    // 0" is rejected by the floating-block rule, so the badge appeared over every fresh cell
    // while the click succeeded. Floor 1 HIDES the bug (there from+1 == target), which is why
    // these floors are 2 and 3.
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    for (const floor of [2, 3]) {
      const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: floor };
      expect(tool.canActAt!({ x: 3, y: 3 }, ctx), `build floor ${floor}`).toBe(true);
      // …and the final target really IS rejected on its own, which is what the old probe asked:
      // proof that the two questions differ, not that the rule stopped firing.
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
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(true);
  });

  it('asks the OBJECT-PLACEMENT question for tile: refused on water, allowed on plain ground', () => {
    const state = makeState(10, 10);
    setTerrain(state, 2, 2, TerrainType.Water, 1);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
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
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const roadItem = getCatalogItem('road-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 6, y: 6 },
        rotation: 0, category: objectCategory(roadItem.category), elevation: 0,
      },
      loadValue: roadItem.loadValue,
    });
    const ctx = { ...makeToolCtx(state, exec), terrainType: TerrainType.Mountain, elevation: 1 };
    const tool = new DrawingTool();
    tool.contentType = 'tile';
    expect(tool.canActAt!({ x: 6, y: 6 }, ctx)).toBe(true);
  });
});

describe('the hand does not track its own grip', () => {
  it('keeps one cursor, leaving the closed hand to the controller\'s drag state', () => {
    // Two owners of "am I panning" drift. The pointer machine reports the pan; the tool
    // only says which hand it is.
    const tool = new HandTool();
    const ctx = makeToolCtx(makeState(10, 10), new CommandExecutor(
      makeState(10, 10), new EventBus<EditorEvents>(), createDefaultRegistry()));
    expect(tool.cursor).toBe('hand-open');
    tool.onPointerDown({ x: 1, y: 1 }, { x: 1, y: 1 }, ctx);
    expect(tool.cursor).toBe('hand-open');
    expect(tool.getIsPanning()).toBe(true); // the pan itself still works
  });
});

describe('the eraser answers for what its click removes', () => {
  beforeEach(() => setStoreState({ contentType: 'mountain', layerVisibility: {} }));

  it('refuses a peel on a locked layer, the one thing that can reject the command it issues', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    state.lockedLayers.add(2); // the cell occupies layer 2, so V-LOCK-01 rejects the peel
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(false);
    state.lockedLayers.clear();
    expect(tool.canActAt!({ x: 4, y: 4 }, ctx)).toBe(true);
  });

  it('stays silent where the click SKIPS: bare ground and a hidden layer are no-ops, not refusals', () => {
    const state = makeState(10, 10);
    setTerrain(state, 6, 6, TerrainType.Mountain, 3);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 1, y: 1 }, ctx)).toBe(true); // nothing to erase
    setStoreState({ layerVisibility: { 3: false } });
    expect(tool.canActAt!({ x: 6, y: 6 }, ctx)).toBe(true); // eraseAt `continue`s past it
  });

  it('validates the coating REMOVALS in tile mode, and calls a bare cell a no-op', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const roadItem = getCatalogItem('road-dirt')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'road-1', catalogId: roadItem.id, position: { x: 3, y: 3 },
        rotation: 0, category: objectCategory(roadItem.category), elevation: 0,
      },
      loadValue: roadItem.loadValue,
    });
    setStoreState({ contentType: 'tile' });
    const ctx = makeToolCtx(state, exec);
    const tool = new EraserTool();
    expect(tool.canActAt!({ x: 3, y: 3 }, ctx)).toBe(true); // an ordinary coating comes right up
    expect(tool.canActAt!({ x: 9, y: 9 }, ctx)).toBe(true); // no coating: nothing refused
  });
});

describe('the placer names what the click will do', () => {
  beforeEach(() => setStoreState({ selectedItemId: null, selection: [] }));

  it('is place when armed and select when idle', () => {
    const tool = new ObjectPlacerTool();
    expect(tool.cursor).toBe('select');
    setStoreState({ selectedItemId: 'tree-apple' });
    expect(tool.cursor).toBe('place');
  });

  it('is select over a terrain selection, since a terrain cell cannot be dragged', () => {
    const tool = new ObjectPlacerTool();
    setStoreState({ selection: [{ kind: 'terrain', x: 1, y: 1 }] });
    expect(tool.cursor).toBe('select');
  });

  it('stays SELECT with an object selected: `move` is positional, not a mode', () => {
    // Drag-to-move arms only on a press over the already-selected object; a drag anywhere else
    // pans the camera. A store-driven getter cannot know where the pointer is, so answering
    // `move` here turned the whole map into a four-arrow cursor after one click. The upgrade
    // now happens in the controller, from the pointer machine's hover state.
    const tool = new ObjectPlacerTool();
    setStoreState({ selection: [{ kind: 'object', id: 'obj-1' }] });
    expect(tool.cursor).toBe('select');
  });

  it('answers with the SAME computation that tints the ghost, cell by cell', () => {
    // One function (planPlacementGhost) feeds both, so this asserts they cannot disagree: the
    // ghost colour and the probe are read for the same cells and must line up everywhere.
    const state = makeState(20, 20);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    // A REPEATABLE item (the stall), so the only thing that can refuse it is the overlap at the
    // occupied cell — a maxCount-1 cabin would read false everywhere and prove nothing.
    const stall = getCatalogItem('building-stall')!;
    exec.execute({
      type: CommandType.PlaceObject, timestamp: Date.now(),
      object: {
        id: 'stall-1', catalogId: stall.id, position: { x: 4, y: 4 },
        rotation: 0, category: objectCategory(stall.category), elevation: 0,
      },
      loadValue: stall.loadValue,
    });
    setStoreState({ selectedItemId: stall.id });

    let lastColor = 0;
    const ctx = {
      ...makeToolCtx(state, exec),
      overlay: { showGhost(_c: unknown, color: number) { lastColor = color; }, clearGhost() {} },
    } as never as import('../../tools/types').ToolContext;
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
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const item = getCatalogItem('bridge-plank')!;
    setStoreState({ selectedItemId: item.id });
    const ctx = makeToolCtx(state, exec);
    const tool = new ObjectPlacerTool();
    // Flat grass, no gap to span: detectBridgeSpan finds nothing, so the click would be refused.
    expect(tool.canActAt!({ x: 5, y: 5 }, ctx)).toBe(false);
  });

  it('is silent with nothing armed, since an idle placer\'s click places nothing', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const tool = new ObjectPlacerTool();
    expect(tool.canActAt!({ x: 2, y: 2 }, makeToolCtx(state, exec))).toBe(true);
  });
});

describe('FORBIDDABLE declares exactly the badges the tools can produce', () => {
  it('every badgeable id is shown by a registered tool that implements canActAt', () => {
    const state = makeState(10, 10);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
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
        sink.add(tool.cursor);
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
