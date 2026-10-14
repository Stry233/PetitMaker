/** The facts a press is resolved against, gathered one way for every caller. */
import { useEditorStore, type EditorStore } from '../../../state/store';
import { getActiveToolManager, getActiveView } from '../../active-view';
import { resolvePointer, toolDeclares, type ActiveView, type Tool, type ToolContext } from '../../../tools/pointer/runtime';
import { armingOf } from '../../../state/editing/arming';
import { cellAtPoint } from '../../../core/grid/pointer';
import { isCommandHeld } from '../../../state/keymap/held';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { isDraggableObject, pointerTarget, type PointerTarget } from '../selection-hover';
import type { GridState } from '../../../core/model/types';
import type { GridCell, GridId, MapPoint } from '../../../core/grid/grids';
import type { PressFacts } from '../press/press-plan';
import { activeToolOf, armedItemOf } from '../../../state/editing/edit-mode';

/** What is under the pointer at one screen position, resolved once: the hover probe reads it for
 *  its box and its change key, and builds the press facts from it without picking again. */
export interface PointerProbe {
  view: ActiveView;
  store: EditorStore;
  gridState: GridState;
  point: MapPoint;
  /** The placement-grid cell under the pointer. */
  macro: GridCell<typeof PLACEMENT_GRID>;
  target: PointerTarget;
  tool: Tool | undefined;
  /** A copy of the live context: `resolvePointer` writes the probed point into it, and the live one
   *  belongs to whatever stroke is in progress. */
  ctx: ToolContext | null;
  /** The cell the active tool resolves the pointer to, on its own grid. */
  toolCoord: GridCell<GridId>;
}

/** Resolves what is under screen (x, y): one projection, one object pick (a mesh raycast in 3D).
 *  Null without a live view or a loaded map. */
export function probePointer(x: number, y: number): PointerProbe | null {
  const view = getActiveView();
  const store = useEditorStore.getState();
  const gridState = store.gridState;
  if (!view || !gridState) return null;
  const point = view.projection.screenToPoint(x, y);
  const macro = cellAtPoint(point, PLACEMENT_GRID);
  // Mesh-precise pick first (a tree's canopy selects the tree), then the footprint test, which
  // covers flat items and views without mesh picking.
  const target = pointerTarget(gridState, point, view.projection.pickObject?.(x, y) ?? undefined);
  const tools = getActiveToolManager();
  const tool = tools?.getActiveTool();
  const context = tools?.getContext();
  const ctx = context ? { ...context } : null;
  const toolCoord = ctx && tool ? resolvePointer(view, tool, ctx, x, y).cell : macro;
  return { view, store, gridState, point, macro, target, tool, ctx, toolCoord };
}

/**
 * Everything `resolvePress` needs, gathered from the store, the view and the active tool. The
 * press path, the nav tap and the hover probe build it the same way, which is what keeps them one
 * rule.
 *
 * Null without a live view or a loaded map: there is no cell under the pointer to resolve a press
 * against, and nothing on screen for one to act on.
 */
export function buildPressFacts(button: number, x: number, y: number): PressFacts | null {
  const probe = probePointer(x, y);
  return probe ? pressFactsAt(button, probe) : null;
}

/** The press facts for a resolved pointer. */
export function pressFactsAt(button: number, probe: PointerProbe): PressFacts {
  const { store, macro, tool, ctx, toolCoord } = probe;
  const { hit, terrain } = probe.target;
  // Keyed by the store's tool type, as the selection rules are: they hold with no live tool too.
  const declared = toolDeclares(activeToolOf(store));
  const toolGrabs = !!(ctx && (tool?.grabAt?.(macro, ctx) ?? false));
  return {
    button,
    selectMode: declared.selectMode(armingOf(store)),
    brush: declared.brush,
    armedItemId: armedItemOf(store),
    selection: store.selection,
    selectingRegion: store.selectingRegion,
    panDragHeld: isCommandHeld('camera.pan_drag'),
    multiSelectHeld: isCommandHeld('selection.multi'),
    macro,
    terrain,
    hit: hit ? { id: hit.id, draggable: isDraggableObject(hit), locked: !!hit.locked } : null,
    placementAllowed: !tool?.canActAt || !ctx || tool.canActAt(toolCoord, ctx),
    toolGrabs,
    toolSelects: !!(ctx && (tool?.selects?.(ctx) ?? false)),
    toolSelectHit: (ctx && tool?.selectHit) ? tool.selectHit(macro, ctx) : null,
    pendingGesture: (ctx ? tool?.hasPending?.(ctx) : false) ?? false,
    clickOnlyStroke: !!(ctx && tool?.clickOnly?.(macro, ctx)),
  };
}
