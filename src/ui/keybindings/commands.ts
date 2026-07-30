/*
 * The command registry — the SINGLE SOURCE OF TRUTH for every discrete keyboard operation.
 *
 * Both the shortcut engine (ui/hooks/useEditorShortcuts) and the keyboard page
 * (ui/chrome/keyboard) read this list. Adding an operation is ONE entry here: it becomes runnable,
 * shown on the keyboard, and bindable — no ad-hoc duplication anywhere else.
 *
 * `defaultCombo` seeds the shipped keymap (null = unmapped by default, still bindable by the user).
 * `reserved` = a system chord (undo/redo) that can't be rebound or stolen. `run(ctx)` receives the
 * few React-provided deps; everything else is read from the global store / active view.
 */
import { useEditorStore } from '../../state/store';
import { singleSelection, selectedObjectIds } from '../../state/selection';
import { getActiveView } from '../../canvas/active-view';
import { getCatalogItem } from '../../state/catalog';
import { ELEVATION_MAX } from '../../core/model/constants';
import { petitWindow } from '../../core/runtime/window-bridge';
import { rotateObjectAction } from '../chrome/object-actions';
import { deleteGroup, reportDeleteGroup } from '../chrome/group-actions';
import { rotateGroupAction } from '../chrome/group-rotate-action';
import { translate } from '../../i18n/context';
import { BUILD_TILES, GRID_TILES, FILE_TILES, type TileSpec } from '../menu/metrics';
import type { DesignMode } from '../../core/model/types';

export type CommandCategory =
  | 'surface' | 'tool' | 'brush' | 'layer' | 'selection' | 'camera' | 'view' | 'history' | 'app' | 'overlay';

/** Deps the handlers can't get from the global store — supplied by the engine (from App/menu-nav). */
export interface CommandContext {
  openBuild: (mode: DesignMode) => void;
  handleTileAction: (spec: TileSpec) => void;
  onHelp: () => void;
  /** Pop the Generate region's OWN undo/redo stack (ui/hooks/useRegionBrush) — a painted
   *  region is a scope for a future generate, not a map edit, so it keeps a history
   *  separate from the command executor's. Return false when there was nothing to pop
   *  (see history.undo/redo below for what that means). Undefined only where no region
   *  brush is mounted (e.g. a bare test context) — those callers never set
   *  `selectingRegion`, so it's never reached. */
  regionUndo?: () => boolean;
  regionRedo?: () => boolean;
}

export interface EditorCommand {
  id: string;
  category: CommandCategory;
  labelKey: string;
  defaultCombo: string | null;
  reserved?: boolean;
  /** A HELD-key action (continuous pan), not a discrete one-shot. Shown + rebindable on the keyboard
   *  page, but the discrete engine (useEditorShortcuts) skips it — the held rAF loop in
   *  canvas/interaction/use-view-shortcuts reads its effective key instead. `run` is a no-op. */
  continuous?: boolean;
  run: (ctx: CommandContext) => void;
}

/* ── shared run-helpers (global store / active view) ─────────────────────── */

const store = () => useEditorStore.getState();
const tile = (id: string): TileSpec | undefined =>
  [...BUILD_TILES, ...GRID_TILES, ...FILE_TILES].find((t) => t.id === id);
const doTile = (c: CommandContext, id: string): void => { const s = tile(id); if (s) c.handleTileAction(s); };

function rotateSelected(delta: 90 | -90): void {
  const s = store();
  if (!s.gridState || !s.commandExecutor) return;
  // A PLURAL selection is a rigid-body transform, not N spins in place: route it through the exact
  // call path the SelectionHandles rotate button uses (`group-rotate-action.ts`), so the arc
  // animation and any refusal (a locked member, a non-square span, an illegal destination) are
  // identical whether the turn came from a click or this shortcut.
  if (s.selection.length > 1) {
    rotateGroupAction(s.commandExecutor, s.gridState, s.eventBus, selectedObjectIds(s.selection), delta === 90 ? 1 : -1);
    return;
  }
  const sel = singleSelection(s.selection);
  if (sel?.kind !== 'object') return;
  const cur = s.gridState.objects.get(sel.id);
  if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
  const to = ((((cur.rotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  rotateObjectAction(s.commandExecutor, s.gridState, s.eventBus, cur, to, { from: cur.rotation, to: cur.rotation + delta });
}

/** Turn the ARMED item's pending placement (its ghost, not yet on the map) — the shortcut fires
 *  only with nothing selected (see `rotateArmedOrSelected`). Silently a no-op for a non-rotatable
 *  item: pressing a rotate key on a thing that doesn't rotate isn't a mistake worth a toast for,
 *  and it must never write a rotation a later placement could pick up. */
function rotatePendingPlacement(delta: 90 | -90): void {
  const s = store();
  if (!s.selectedItemId || !getCatalogItem(s.selectedItemId)?.rotatable) return;
  const to = ((((s.placementRotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  s.setPlacementRotation(to);
}

/**
 * Rotate shortcut dispatch. A non-empty SELECTION always wins over the armed item's ghost: it is a
 * deliberate act with a visible result (the orange ring), and clicking an object while an item is
 * armed exists precisely so it can be rotated or deleted without losing that armed item — the
 * shortcut has to reach the selection, or that whole affordance is a trap. The ghost only turns
 * when there is truly nothing selected to apply it to instead.
 */
function rotateArmedOrSelected(delta: 90 | -90): void {
  const s = store();
  if (s.selection.length > 0) rotateSelected(delta);
  else rotatePendingPlacement(delta);
}

function deleteSelected(): void {
  const s = store();
  if (s.deletePopover) return;
  // The delete popover confirms ONE block, so a single selection still routes through it.
  const sel = singleSelection(s.selection);
  if (sel) {
    if (sel.kind === 'terrain' && !s.gridState?.cells[sel.y]?.[sel.x]?.terrain) return;
    s.setDeletePopover(sel);
    return;
  }
  // A plural selection has no confirm step: `deleteGroup` applies to what it can and keeps the rest.
  const gridState = s.gridState;
  if (!gridState || !s.commandExecutor) return;
  const ids = selectedObjectIds(s.selection);
  if (ids.length === 0) return;
  const result = deleteGroup(s.commandExecutor, gridState, ids);
  s.setSelection(ids.filter((id) => gridState.objects.has(id)).map((id) => ({ kind: 'object', id }) as const));
  reportDeleteGroup(s.eventBus, translate, result);
}

function deselect(): void {
  const s = store();
  if (s.contextMenu || s.deletePopover) return; // those own their own dismiss
  s.clearSelection();
}

function selectAllObjects(): void {
  const s = store();
  if (!s.gridState) return;
  // Every object, INCLUDING locked ones (refusing to modify one is the rule's job, not
  // selection's). Terrain is never part of a select-all.
  s.setSelection([...s.gridState.objects.keys()].map((id) => ({ kind: 'object', id }) as const));
}

function zoom(dir: 1 | -1): void {
  const cam = getActiveView()?.camera;
  if (!cam) return;
  if (cam.zoomStepAnimated) cam.zoomStepAnimated(dir);
  else cam.zoomStep(dir, window.innerWidth / 2, window.innerHeight / 2);
}

function fitToMap(): void {
  const cam = getActiveView()?.camera;
  if (cam?.fitToMap) cam.fitToMap();
  else petitWindow().__petitFitMap?.();
}

/* ── the registry ────────────────────────────────────────────────────────── */

export const COMMANDS: EditorCommand[] = [
  // Build surface (opens the Build panel on that surface)
  { id: 'surface.mountain', category: 'surface', labelKey: 'menu.build_mountain', defaultCombo: '1', run: (c) => doTile(c, 'mountain') },
  { id: 'surface.river',    category: 'surface', labelKey: 'menu.build_river',    defaultCombo: '2', run: (c) => doTile(c, 'river') },
  { id: 'surface.road',     category: 'surface', labelKey: 'menu.build_road',     defaultCombo: '3', run: (c) => doTile(c, 'road') },

  // Tools
  { id: 'tool.move',    category: 'tool', labelKey: 'menu.move',          defaultCombo: 'v', run: (c) => doTile(c, 'move') },
  { id: 'tool.brush',   category: 'tool', labelKey: 'design.free_brush',  defaultCombo: 'b', run: (c) => c.openBuild('brush') },
  { id: 'tool.eraser',  category: 'tool', labelKey: 'design.eraser',      defaultCombo: 'e', run: (c) => c.openBuild('eraser') },
  { id: 'tool.rect',    category: 'tool', labelKey: 'design.rect_brush',  defaultCombo: 'r', run: (c) => c.openBuild('rect') },
  { id: 'tool.circle',  category: 'tool', labelKey: 'design.circle_brush', defaultCombo: 'c', run: (c) => c.openBuild('circle') },
  { id: 'tool.line',    category: 'tool', labelKey: 'design.line_brush',  defaultCombo: 'f', run: (c) => c.openBuild('line') },
  { id: 'tool.curve',   category: 'tool', labelKey: 'design.curve_brush', defaultCombo: 'g', run: (c) => c.openBuild('curve') },
  { id: 'tool.edgecut', category: 'tool', labelKey: 'design.edge_cut',    defaultCombo: 'x', run: (c) => c.openBuild('edge-cut') },

  // Shape-drag constrain (HELD): snaps line/rect/circle drags to straight/square/round. Default
  // Shift, rebindable. Continuous — the shape tools read modifier-state.isConstrainHeld, so `run` is
  // a no-op and the discrete engine skips it. Its key drives setConstrainKey (see useEditorShortcuts).
  { id: 'tool.constrain', category: 'tool', labelKey: 'shortcut.shape_constrain', defaultCombo: 'shift', continuous: true, run: () => {} },

  // Brush size + active layer
  { id: 'brush.bigger',  category: 'brush', labelKey: 'a11y.brush_increase', defaultCombo: ']', run: () => { const s = store(); s.setBrushSize(Math.min(5, s.brushSize + 1)); } },
  { id: 'brush.smaller', category: 'brush', labelKey: 'a11y.brush_decrease', defaultCombo: '[', run: () => { const s = store(); s.setBrushSize(Math.max(1, s.brushSize - 1)); } },
  { id: 'layer.up',      category: 'layer', labelKey: 'shortcut.layer_up',   defaultCombo: 'q', run: () => { const s = store(); s.setActiveLayer(Math.min(ELEVATION_MAX, s.activeLayer + 1)); } },
  { id: 'layer.down',    category: 'layer', labelKey: 'shortcut.layer_down', defaultCombo: 'z', run: () => { const s = store(); s.setActiveLayer(Math.max(0, s.activeLayer - 1)); } },

  // Selection
  { id: 'selection.rotate_cw',  category: 'selection', labelKey: 'shortcut.rotate_cw',  defaultCombo: '.',      run: () => rotateArmedOrSelected(90) },
  { id: 'selection.rotate_ccw', category: 'selection', labelKey: 'shortcut.rotate_ccw', defaultCombo: ',',      run: () => rotateArmedOrSelected(-90) },
  { id: 'selection.delete',     category: 'selection', labelKey: 'shortcut.delete',     defaultCombo: 'delete', run: () => deleteSelected() },
  { id: 'selection.deselect',   category: 'selection', labelKey: 'shortcut.deselect',   defaultCombo: 'escape', run: () => deselect() },

  // Multi-select (HELD): Ctrl turns a click into a membership toggle and a drag into a rubber
  // band. Continuous, so the pointer machine reads `modifier-state.isMultiSelectHeld` and the
  // discrete engine skips `run`. Declared here to be listed in the keyboard modal and rebindable.
  { id: 'selection.multi', category: 'selection', labelKey: 'shortcut.multi_select', defaultCombo: 'ctrl', continuous: true, run: () => {} },
  { id: 'selection.all',   category: 'selection', labelKey: 'shortcut.select_all',   defaultCombo: 'ctrl+a', run: () => selectAllObjects() },

  // Camera / view
  { id: 'camera.zoom_in',  category: 'camera', labelKey: 'shortcut.zoom_in',    defaultCombo: '=',      run: () => zoom(1) },
  { id: 'camera.zoom_out', category: 'camera', labelKey: 'shortcut.zoom_out',   defaultCombo: '-',      run: () => zoom(-1) },
  { id: 'camera.fit',      category: 'camera', labelKey: 'a11y.fit_view',       defaultCombo: 'ctrl+0', run: () => fitToMap() },

  // Continuous camera pan (HELD keys) — the rAF loop in use-view-shortcuts reads these keys; `run` is
  // a no-op so the discrete engine never fires them. Rebindable + shown on the keyboard page.
  { id: 'camera.pan_up',    category: 'camera', labelKey: 'kbd.pan_up',    defaultCombo: 'w', continuous: true, run: () => {} },
  { id: 'camera.pan_left',  category: 'camera', labelKey: 'kbd.pan_left',  defaultCombo: 'a', continuous: true, run: () => {} },
  { id: 'camera.pan_down',  category: 'camera', labelKey: 'kbd.pan_down',  defaultCombo: 's', continuous: true, run: () => {} },
  { id: 'camera.pan_right', category: 'camera', labelKey: 'kbd.pan_right', defaultCombo: 'd', continuous: true, run: () => {} },
  { id: 'view.toggle',     category: 'view',   labelKey: 'shortcut.toggle_view', defaultCombo: '`',     run: () => { const s = store(); s.setViewMode(s.viewMode === '2d' ? '3d' : '2d'); } },

  // History (reserved — not rebindable/stealable). While painting a Generate region,
  // Ctrl+Z/Y undo the region stroke instead of a map edit (see CommandContext.regionUndo):
  // the region is a scope for a future generate, not a change to the map, so undoing twice
  // after painting one must never reach back and revert a real edit the user never meant to
  // touch. Scoped to the region for the FULL duration of region-select mode, even once its
  // own stack empties (regionUndo/Redo return false then) — falling through to the map
  // history at that point would be the same surprise one step later, so it stays a no-op
  // instead, exactly like pressing undo on an empty map history already does.
  { id: 'history.undo', category: 'history', labelKey: 'shortcut.undo', defaultCombo: 'ctrl+z',       reserved: true,
    run: (c) => { if (store().selectingRegion) c.regionUndo?.(); else store().commandExecutor?.undo(); } },
  { id: 'history.redo', category: 'history', labelKey: 'shortcut.redo', defaultCombo: 'ctrl+shift+z', reserved: true,
    run: (c) => { if (store().selectingRegion) c.regionRedo?.(); else store().commandExecutor?.redo(); } },

  // App actions
  { id: 'app.generate', category: 'app', labelKey: 'menu.generate', defaultCombo: 'ctrl+g', run: (c) => doTile(c, 'generate') },
  { id: 'app.new',      category: 'app', labelKey: 'menu.new',      defaultCombo: 'ctrl+n', run: (c) => doTile(c, 'new') },
  { id: 'app.help',     category: 'app', labelKey: 'menu.help',     defaultCombo: 'shift+?', run: (c) => c.onHelp() },

  // Overlay toggles
  { id: 'overlay.grid',    category: 'overlay', labelKey: 'shortcut.toggle_grid',        defaultCombo: 'shift+g', run: () => { const s = store(); s.setShowGrid(!s.showGrid); } },
  { id: 'overlay.numbers', category: 'overlay', labelKey: 'a11y.toggle_layer_numbers',   defaultCombo: 'shift+n', run: () => { const s = store(); s.setShowLayerNumbers(!s.showLayerNumbers); } },
  { id: 'overlay.chunks',  category: 'overlay', labelKey: 'shortcut.toggle_chunks',      defaultCombo: 'shift+c', run: () => { const s = store(); s.setShowChunkBounds(!s.showChunkBounds); } },
];

/** Fixed secondary bindings — a command has ONE registry combo, but the engine also wires these
 *  aliases so conventional alternates work. Not shown as separate rows / not user-editable. */
export const ALIASES: { combo: string; commandId: string }[] = [
  { combo: 'ctrl+y',    commandId: 'history.redo' },      // Windows-muscle-memory redo
  { combo: 'backspace', commandId: 'selection.delete' },  // Mac laptops' "Delete" key
  // Arrow keys pan alongside WASD (the arrows are the secondary binding; WASD is the editable
  // primary). Listed here so they SHOW on the keyboard + drive the held-pan loop from one source.
  { combo: 'arrowup',    commandId: 'camera.pan_up' },
  { combo: 'arrowdown',  commandId: 'camera.pan_down' },
  { combo: 'arrowleft',  commandId: 'camera.pan_left' },
  { combo: 'arrowright', commandId: 'camera.pan_right' },
];

export const COMMAND_BY_ID: ReadonlyMap<string, EditorCommand> = new Map(COMMANDS.map((c) => [c.id, c]));
