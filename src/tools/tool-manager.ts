import { TerrainType, ToolType } from '../core/model/types';
import type { Command, GridState, ValidationResult } from '../core/model/types';
import type { CommandExecutor } from '../core/commands/command-executor';
import type { MapRenderer } from '../canvas/map2d/map-renderer';
import type { EditorView } from '../canvas/view-projection';
import type { CursorId } from '../core/runtime/cursor-spec';
import { translateFor } from '../i18n/context';
import { useEditorStore } from '../state/store';
import { HandTool } from './hand';
import { DrawingTool } from './paint/drawing-tool';
import { EraserTool } from './paint/eraser';
import { ObjectPlacerTool } from './objects/object-placer';
import { EdgeCutTool } from './edge-cut/edge-cut-tool';
import { MacroTool } from './macros/macro-tool';
import type { Tool, ToolContext } from './types';

export class ToolManager {
  // Public mutable tool parameters
  terrainType: TerrainType = TerrainType.Mountain;
  elevation = 1;
  brushSize = 1;

  private readonly tools = new Map<ToolType, Tool>();
  private activeTool: Tool;
  private view: EditorView;
  private readonly executor: CommandExecutor;
  private readonly gridState: GridState;
  private ctx: ToolContext;

  // Track last screen position for dx/dy calculation
  private lastScreenX = 0;
  private lastScreenY = 0;

  constructor(renderer: MapRenderer, executor: CommandExecutor, gridState: GridState) {
    this.view = renderer.asEditorView();
    this.executor = executor;
    this.gridState = gridState;

    this.ctx = this.buildCtx();

    const hand = new HandTool();
    this.registerTool(hand);
    this.activeTool = hand;
    this.registerDefaultTools();
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  /** Register the full default editor tool set (HandTool is already registered
   *  in the constructor as the initial active tool). The ONE place the editor's
   *  tools are wired up, so callers just construct the manager. */
  private registerDefaultTools(): void {
    this.registerTool(new DrawingTool());
    this.registerTool(new EraserTool());
    this.registerTool(new ObjectPlacerTool());
    this.registerTool(new EdgeCutTool());
    this.registerTool(new MacroTool());
  }

  setActiveTool(type: ToolType): void {
    if (this.activeTool.id === type) return;

    const next = this.tools.get(type);
    if (!next) return;

    this.refreshCtx();
    this.activeTool.onDeactivate(this.ctx);
    this.activeTool = next;
    this.activeTool.onActivate(this.ctx);
  }

  getActiveTool(): Tool {
    return this.activeTool;
  }

  /** The live tool context, for callers that need to ASK a tool something without acting — the
   *  cursor's pre-click validity probe, a press's `placementAllowed`. Refreshes first: a caller here
   *  has no pointer event of its own to hang a refresh off (a touch tap's `onPointerDown` never sets
   *  `pointerKnown`, so no `handlePointerMove` precedes it and the mirror would otherwise answer from
   *  whenever the pointer last moved — the same staleness `getActiveCursor()` already guards
   *  against). `refreshCtx` is a cheap field copy, so refreshing on every ask costs nothing callers
   *  would notice. Read-only by convention beyond that: nothing here mutates the arming itself. */
  getContext(): ToolContext {
    this.refreshCtx();
    return this.ctx;
  }

  getToolById(type: ToolType): Tool | undefined {
    return this.tools.get(type);
  }

  /** Swap the active view (2D map ↔ 3D editor): tools keep working through the
   *  same ctx, which is rebuilt around the new projection/overlay pair. */
  setView(view: EditorView): void {
    this.view = view;
    this.ctx = this.buildCtx();
  }

  handlePointerDown(screenX: number, screenY: number): void {
    this.lastScreenX = screenX;
    this.lastScreenY = screenY;

    const macro = this.view.projection.screenToMacro(screenX, screenY);
    const micro = this.view.projection.screenToMicro(screenX, screenY);

    this.refreshCtx();
    this.ctx.halfCoord = this.view.projection.screenToHalf?.(screenX, screenY);
    this.activeTool.onPointerDown(macro, micro, this.ctx);
  }

  handlePointerMove(screenX: number, screenY: number): void {
    const dx = screenX - this.lastScreenX;
    const dy = screenY - this.lastScreenY;

    // Recorded before any camera transform is applied: applyCameraTransform can synchronously
    // re-enter this method (the 2D renderer emits 'viewport-changed', which
    // usePointerInteraction's resampler answers with another handlePointerMove call), and that
    // re-entrant call must see the CURRENT position, not the one from before this move, or it
    // recomputes this same dx and pans again, recursing until the stack overflows.
    this.lastScreenX = screenX;
    this.lastScreenY = screenY;

    // If active tool is HandTool, pass raw mouse deltas and update viewport
    // transform — only in views whose left-drag pans HERE (the 2D view). The 3D
    // editor sets leftDragPans=false and pans left-drag in the pointer machine
    // instead (its camera also orbits on right/middle drag, and moves on WASD).
    if (this.activeTool instanceof HandTool && this.view.leftDragPans !== false) {
      // HandTool uses only ctx.viewport (never the tool params refreshCtx copies), and the
      // unconditional refreshCtx() below runs before onPointerMove — so no refresh needed here.
      this.activeTool.handleRawMouseMove(dx, dy, this.ctx);
      if (this.activeTool.getIsPanning()) {
        this.view.applyCameraTransform();
      }
    }

    const macro = this.view.projection.screenToMacro(screenX, screenY);
    const micro = this.view.projection.screenToMicro(screenX, screenY);

    this.refreshCtx();
    this.ctx.halfCoord = this.view.projection.screenToHalf?.(screenX, screenY);
    this.activeTool.onPointerMove(macro, micro, this.ctx);
  }

  handlePointerUp(screenX: number, screenY: number): void {
    const macro = this.view.projection.screenToMacro(screenX, screenY);
    const micro = this.view.projection.screenToMicro(screenX, screenY);

    this.refreshCtx();
    this.ctx.halfCoord = this.view.projection.screenToHalf?.(screenX, screenY);
    this.activeTool.onPointerUp(macro, micro, this.ctx);
  }

  /** The live arming, copied in before every tool call. THE ONE PLACE IN `tools/` THAT KNOWS A
   *  STORE EXISTS (`__tests__/import-direction.test.ts` pins the rest); everything below reads the
   *  context. Values, not getters: the pointer machine can supply every one of them per event, and
   *  a getter would let a tool observe a store change in the middle of a stroke. */
  private refreshCtx(): void {
    const s = useEditorStore.getState();
    this.ctx.terrainType = this.terrainType;
    this.ctx.elevation = this.elevation;
    this.ctx.layerPinned = s.layerPinned;
    this.ctx.brushSize = this.brushSize;
    this.ctx.contentType = s.contentType;
    this.ctx.layerVisibility = s.layerVisibility;
    this.ctx.autoEdgeCut = s.autoEdgeCut;
    this.ctx.eraserShape = s.eraserShape;
    this.ctx.tileMaterial = s.tileMaterial;
    this.ctx.tileMaterialPicked = s.tileMaterialPicked;
    this.ctx.armedItem = s.selectedItemId;
    this.ctx.placementRotation = s.placementRotation;
    this.ctx.armedMacro = s.armedMacro;
    this.ctx.armingEpoch = s.armingEpoch;
  }

  /** The active tool's cursor, from a context refreshed first (`getContext()`): the push happens on
   *  a STORE change with no pointer event behind it, so the arming this asks about must be re-read
   *  here. */
  getActiveCursor(): CursorId {
    const ctx = this.getContext();
    return this.activeTool.cursorFor?.(ctx) ?? this.activeTool.cursor;
  }

  private buildCtx(): ToolContext {
    const s = useEditorStore.getState();
    return {
      gridState: this.gridState,
      viewport: this.view.projection,
      overlay: this.view.overlay,
      executeCommand: (cmd: Command): ValidationResult => this.executor.execute(cmd),
      commitStroke: (startSize: number, opts?: { reconcile?: boolean }) => this.executor.commitStroke(startSize, opts),
      validateCommand: (cmd: Command) => this.executor.getRegistry().validatePreCommand(cmd, this.gridState),
      rules: this.executor.getRegistry(),
      undo: () => this.executor.undo(),
      getUndoStackSize: () => this.executor.getUndoStackSize(),
      collapseHistory: (start: number) => this.executor.collapseHistory(start),
      rollbackTo: (watermark: number) => this.executor.rollbackTo(watermark),
      t: (key: string, params?: Record<string, string | number>) => translateFor(useEditorStore.getState().locale, key, params),
      setDisplayLayer: (layer: number | null) => useEditorStore.getState().setDisplayLayer(layer),
      plopObject: (id: string) => this.view.plopObject?.(id),
      terrainType: this.terrainType,
      elevation: this.elevation,
      layerPinned: s.layerPinned,
      brushSize: this.brushSize,
      contentType: s.contentType,
      layerVisibility: s.layerVisibility,
      autoEdgeCut: s.autoEdgeCut,
      eraserShape: s.eraserShape,
      tileMaterial: s.tileMaterial,
      tileMaterialPicked: s.tileMaterialPicked,
      armedItem: s.selectedItemId,
      placementRotation: s.placementRotation,
      armedMacro: s.armedMacro,
      armingEpoch: s.armingEpoch,
      macroContext: { state: this.gridState, executor: this.executor, registry: this.executor.getRegistry() },
    };
  }
}
