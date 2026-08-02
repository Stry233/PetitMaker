import { TerrainType, ToolType } from '../core/model/types';
import type { Command, GridState, ValidationResult } from '../core/model/types';
import type { CommandExecutor } from '../core/commands/command-executor';
import type { MapRenderer } from '../canvas/map2d/map-renderer';
import type { EditorView } from '../canvas/view-projection';
import { translations } from '../i18n/translations';
import { useEditorStore } from '../state/store';
import { HandTool } from './hand';
import { DrawingTool } from './paint/drawing-tool';
import { EraserTool } from './paint/eraser';
import { ObjectPlacerTool } from './objects/object-placer';
import { EdgeCutTool } from './edge-cut/edge-cut-tool';
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

  /** The live tool context, for callers that need to ASK a tool something without acting —
   *  the cursor's pre-click validity probe. Read-only by convention: nothing here mutates it. */
  getContext(): ToolContext {
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
    this.activeTool.onPointerMove(macro, micro, this.ctx);
  }

  handlePointerUp(screenX: number, screenY: number): void {
    const macro = this.view.projection.screenToMacro(screenX, screenY);
    const micro = this.view.projection.screenToMicro(screenX, screenY);

    this.refreshCtx();
    this.activeTool.onPointerUp(macro, micro, this.ctx);
  }

  private refreshCtx(): void {
    this.ctx.terrainType = this.terrainType;
    this.ctx.elevation = this.elevation;
    this.ctx.brushSize = this.brushSize;
  }

  private buildCtx(): ToolContext {
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
      t: (key: string) => {
        const locale = useEditorStore.getState().locale;
        return translations[locale]?.[key] ?? translations['en'][key] ?? key;
      },
      setDisplayLayer: (layer: number | null) => useEditorStore.getState().setDisplayLayer(layer),
      plopObject: (id: string) => this.view.plopObject?.(id),
      terrainType: this.terrainType,
      elevation: this.elevation,
      brushSize: this.brushSize,
    };
  }
}
