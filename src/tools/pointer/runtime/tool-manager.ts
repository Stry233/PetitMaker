import { ToolType } from '../../../state/editing/vocabulary';
import type { ToolArming } from '../../../state/editing/arming';
import type { GridState } from '../../../core/model/types';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { EditorView } from './view-seam';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { createTools } from './tool-set';
import { resolvePointer } from './pointer';
import { createToolHost, type HostedTool, type HostedToolContext, type ToolHostDeps } from './host';

/** What a manager reads from the editor it serves: the arming before every tool call, and the host
 *  channels (locale, notices, held keys, annotation verbs) its tools reach through the context.
 *  Absent channels are headless, as in `createToolHost`. */
export interface ToolManagerDeps extends Omit<ToolHostDeps, 'state' | 'executor' | 'view'> {
  arming: () => ToolArming;
}

export class ToolManager {
  private readonly tools = new Map<ToolType, HostedTool>();
  private activeTool: HostedTool;
  /** The view on screen; null while no view is attached, when the tools draw nowhere. */
  private view: EditorView | null;
  private readonly executor: CommandExecutor;
  private readonly gridState: GridState;
  private readonly deps: ToolManagerDeps;
  private ctx: HostedToolContext;

  constructor(view: EditorView | null, executor: CommandExecutor, gridState: GridState, deps: ToolManagerDeps) {
    this.view = view;
    this.executor = executor;
    this.gridState = gridState;
    this.deps = deps;

    this.ctx = this.buildCtx();

    const tools = createTools();
    for (const tool of tools) this.tools.set(tool.id, tool);
    this.activeTool = tools[0]!;
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

  /** Activate the tool the bar has armed. Runs on every arming change and on a manager built for a
   *  map that arrives mid-session; every other part of the arming reaches the tools through
   *  `armingOf`, read fresh before each call. */
  syncArming(): void {
    this.setActiveTool(this.deps.arming().tool);
  }

  getActiveTool(): HostedTool {
    return this.activeTool;
  }

  /** The live tool context, for callers that need to ask a tool something without acting — the
   *  cursor's pre-click validity probe, a press's `placementAllowed`. Refreshes first: a caller here
   *  has no pointer event of its own to hang a refresh off (a touch tap's `onPointerDown` never sets
   *  `pointerKnown`, so no `handlePointerMove` precedes it and the mirror would otherwise answer
   *  from whenever the pointer last moved). `refreshCtx` reads one memoized snapshot, so refreshing
   *  per ask is cheap. Read-only by convention: nothing here mutates the arming itself. */
  getContext(): HostedToolContext {
    this.refreshCtx();
    return this.ctx;
  }

  getToolById(type: ToolType): HostedTool | undefined {
    return this.tools.get(type);
  }

  /** Swap the active view (2D map, 3D editor, or none). The host reads the view at each access, so a
   *  tool holding the context (an open stroke, a curve adjust) draws in the view on screen from its
   *  next call on; the ghost it left on the outgoing view's overlay is taken down. */
  setView(view: EditorView | null): void {
    const previous = this.view;
    this.view = view;
    if (previous && previous.overlay !== view?.overlay) previous.overlay.clearGhost();
    if (previous && previous.projection !== view?.projection) previous.projection.releaseSurface?.();
  }

  /** Ends this manager's work on its map before another map's manager takes over: the active tool is
   *  deactivated against this map, taking its ghost and any open gesture down, and Hand is left up. */
  retire(): void {
    const hand = this.tools.get(ToolType.Hand);
    if (!hand || this.activeTool === hand) return;
    this.refreshCtx();
    this.activeTool.onDeactivate(this.ctx);
    this.activeTool = hand;
    this.activeTool.onActivate(this.ctx);
  }

  /** `eventTime` is the pointer event's `timeStamp`; each handler writes it into the context. */
  handlePointerDown(screenX: number, screenY: number, eventTime?: number): void {
    const view = this.view;
    if (!view) return;
    this.refreshCtx();
    this.ctx.eventTime = eventTime;
    view.projection.holdSurface?.();
    const { cell, point } = resolvePointer(view, this.activeTool, this.ctx, screenX, screenY);
    this.activeTool.onPointerDown(cell, point, this.ctx);
  }

  handlePointerMove(screenX: number, screenY: number, eventTime?: number): void {
    const view = this.view;
    if (!view) return;
    this.refreshCtx();
    this.ctx.eventTime = eventTime;
    const { cell, point } = resolvePointer(view, this.activeTool, this.ctx, screenX, screenY);
    this.activeTool.onPointerMove(cell, point, this.ctx);
  }

  /** With no view attached there is no point to release on, so the release cancels the stroke. */
  handlePointerUp(screenX: number, screenY: number, eventTime?: number): void {
    const view = this.view;
    if (!view) { this.handlePointerCancel(); return; }
    this.refreshCtx();
    this.ctx.eventTime = eventTime;
    const { cell, point } = resolvePointer(view, this.activeTool, this.ctx, screenX, screenY);
    try {
      this.activeTool.onPointerUp(cell, point, this.ctx);
    } finally {
      view.projection.releaseSurface?.();
    }
  }

  /** A cancel rolls back what the press committed; a tool with no `onPointerCancel` commits
   *  nothing on a press. */
  handlePointerCancel(): void {
    this.refreshCtx();
    this.activeTool.onPointerCancel?.(this.ctx);
    this.view?.projection.releaseSurface?.();
  }

  /** The live arming, read in before every tool call. A snapshot, not getters: a tool must not
   *  observe an arming change in the middle of a call. */
  private refreshCtx(): void {
    this.ctx.arming = this.deps.arming();
  }

  /** The active tool's cursor, from a context refreshed first (`getContext()`): the push happens on
   *  a store change with no pointer event behind it, so the arming this asks about must be re-read
   *  here. */
  getActiveCursor(): CursorId {
    const ctx = this.getContext();
    return this.activeTool.cursor(ctx);
  }

  private buildCtx(): HostedToolContext {
    const { arming, ...channels } = this.deps;
    const host = createToolHost({ ...channels, state: this.gridState, executor: this.executor, view: () => this.view });
    return Object.assign(host, { arming: arming() });
  }
}
