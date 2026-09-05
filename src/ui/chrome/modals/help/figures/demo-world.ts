/*
 * demo-world.ts — a real, self-contained editor world for a Help Center figure.
 *
 * A demo is not a drawing of the editor, it IS the editor at miniature: a real planet template's
 * `GridState` under a `CommandExecutor` wired to the full rule registry, mutated by the same macros
 * and commands the live tools run. What a figure shows is therefore what the product does — a
 * refusal in a demo is the rules refusing, and its toast text arrives on this world's own
 * `validation-failed` event the way the app's toast reads the live one. The picture is the app's
 * own 2D view (`MapRenderer`) mounted over this world's bus, framed to a crop of the template.
 */
import {
  TerrainType,
  type AutoEdgeCut,
  type EditorEvents,
  type GridState,
  type MacroCoord,
  type MapTemplate,
  type PlacedObject,
  type ValidationError,
} from '../../../../../core/model/types';
import { createGrid, createPlazaObject } from '../../../../../core/model/grid-model';
import { createAnnotationsState, type MapAnnotation } from '../../../../../core/model/annotations';
import { getMapTemplate } from '../../../../../config/maps';
import { CommandExecutor } from '../../../../../core/commands/command-executor';
import { applyAutoEdgeCut } from '../../../../../tools/edge-cut/auto-edge-cut';
import { EdgeCutTool } from '../../../../../tools/edge-cut/edge-cut-tool';
import type { ToolContext } from '../../../../../tools/runtime/types';
import { soleLegalWaterLayer } from '../../../../../tools/paint/water-layers';

import { EventBus } from '../../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../../rules/index';
import { roadLookup } from '../../../../../state/object-index';
import { catalogLoadValue } from '../../../../../state/catalog';
import { objectPlacementCommand } from '../../../../../tools/objects/object-placer';
import { paint } from '../../../../../tools/macros/terrain';
import type { KitContext } from '../../../../../kit/context';

/** A snapshot of the last refusal the rules made in this world, ready for the toast. `tone` is
 *  the live toast's own: a refused command toasts 'error', a reverted stroke 'warning'. */
export interface DemoRefusal {
  message: string;
  params?: Record<string, string | number>;
  tone: 'error' | 'warning';
}

/** What a CLICK of the edge-cut tool reaches for out of a `ToolContext`: the grid, the command
 *  doors and the undo depth. Everything else a live editor threads through that interface belongs
 *  to the hover path (the ghost overlay) or to other tools, which is what makes a pictured trim
 *  cheap. */
type TrimCtx = Pick<
  ToolContext, 'gridState' | 'executeCommand' | 'commitStroke' | 'getUndoStackSize' | 'collapseHistory'
>;

export class DemoWorld {
  readonly state: GridState;
  readonly bus: EventBus<EditorEvents>;
  readonly executor: CommandExecutor;
  readonly kit: KitContext;
  /** Bumped on every cells/objects/history change — the still-mode dirty check. */
  version = 0;
  /** The most recent rule refusal, exactly as the live toast would say it. */
  refusal: DemoRefusal | null = null;
  /** The visitor's own auto-trim setting (`state/slices/edit.ts:autoEdgeCut`), handed in by the
   *  figure at mount: the pictured bar's chip shows it, so the pictured strokes must obey it. */
  autoTrim: AutoEdgeCut = 'off';

  private strokeMark = 0;
  private placeSeq = 0;
  private strokeCells: MacroCoord[] = [];
  private strokeWater = false;

  constructor(templateId?: string) {
    const template: MapTemplate = getMapTemplate(templateId);
    this.state = {
      template,
      cells: createGrid(template),
      objects: new Map(),
      lockedLayers: new Set(),
    };
    // The plaza is a locked object, not a zone; without it the square is bare grass.
    const plaza = createPlazaObject(template);
    if (plaza) this.state.objects.set(plaza.id, plaza);
    this.bus = new EventBus<EditorEvents>();
    this.executor = new CommandExecutor(
      this.state, this.bus, createDefaultRegistry(), roadLookup(this.state), catalogLoadValue,
    );
    this.kit = { state: this.state, executor: this.executor, registry: this.executor.getRegistry() };
    const bump = () => { this.version++; };
    this.bus.on('cells-changed', bump);
    this.bus.on('objects-changed', bump);
    this.bus.on('history-applied', bump);
    this.bus.on('validation-failed', ({ errors }) => {
      const first = errors[0];
      if (first) this.refusal = { message: first.message, params: first.messageParams, tone: 'error' };
    });
  }

  /** Paint terrain through the real macro (and so the real rules). */
  paint(cells: MacroCoord[], type: TerrainType, elevation: number): boolean {
    const took = paint(this.kit, cells, type, elevation);
    if (took) this.strokeCells.push(...cells);
    if (type === TerrainType.Water) this.strokeWater = true;
    return took;
  }

  /** Place a catalog item through the real placement command. Returns the object's id when the
   *  rules took it, null when they refused. `plop` receives the id BEFORE the command executes;
   *  the object layer's squash animation must be requested before the wrapper is created. */
  place(
    catalogId: string, x: number, y: number,
    opts?: { rotation?: 0 | 90 | 180 | 270; elevation?: number; plop?: (id: string) => void },
  ): string | null {
    const id = `help-${catalogId}-${this.placeSeq++}`;
    const candidate: PlacedObject = {
      id, catalogId, position: { x, y }, rotation: opts?.rotation ?? 0, elevation: opts?.elevation ?? 0,
    };
    opts?.plop?.(id);
    return this.executor.execute(objectPlacementCommand(candidate)).success ? id : null;
  }

  /** Ask the rules whether a placement would stand, with no execution and no event. */
  canPlace(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0, elevation = 0): boolean {
    const candidate: PlacedObject = {
      id: 'help-probe', catalogId, position: { x, y }, rotation, elevation,
    };
    return this.executor.validatePre(objectPlacementCommand(candidate)).length === 0;
  }

  /** The object standing at exactly (catalogId, x, y), for scenes that act on what they placed. */
  objectAt(catalogId: string, x: number, y: number): PlacedObject | undefined {
    return [...this.state.objects.values()].find(
      (o) => o.catalogId === catalogId && o.position.x === x && o.position.y === y,
    );
  }

  /** Mark the start of a stroke; `commit()` runs the post-stroke rules back to this mark. */
  beginStroke(): void {
    this.strokeMark = this.executor.getUndoStackSize();
    this.strokeCells = [];
    this.strokeWater = false;
  }

  /** The release of the pointer: post-stroke validation, auto-revert, and the same auto-trim
   *  sweep the live stroke finish runs (`drawing-tool.ts:finishStroke`) at the visitor's own
   *  setting, folded into the stroke's own undo entry the same way. Demo strokes are terrain
   *  only (a pictured road is coating objects), so the tile side of the sweep never applies.
   *  A revert's errors come back as the return value rather than as a bus event, and the app's
   *  toast quotes them — so the demo's refusal snapshot takes them the same way, including the
   *  live toast's one rewrite: a refused water stroke names the sole legal layer where one exists. */
  commit(): ValidationError[] {
    const errors = this.executor.commitStroke(this.strokeMark);
    const first = errors[0];
    if (first) {
      const layer = this.strokeWater
        ? soleLegalWaterLayer(this.strokeCells, this.state, this.executor.getRegistry())
        : null;
      this.refusal = layer !== null
        ? { message: 'error.water_only_layer', params: { layer }, tone: 'warning' }
        : { message: first.message, params: first.messageParams, tone: 'warning' };
    }
    if (this.autoTrim !== 'off' && this.strokeCells.length > 0) {
      const trimStart = this.executor.getUndoStackSize();
      applyAutoEdgeCut(
        {
          gridState: this.state,
          roads: roadLookup(this.state),
          executeCommand: (cmd) => this.executor.execute(cmd),
        },
        this.autoTrim,
        this.strokeCells,
        [],
      );
      if (this.executor.getUndoStackSize() > trimStart) {
        this.executor.collapseHistory(Math.max(this.strokeMark, trimStart - 1));
      }
    }
    this.strokeCells = [];
    return errors;
  }

  /**
   * One click of the REAL edge-cut tool at the intersection (x, y): the tool gathers the cut sites
   * that meet there and advances their shared odometer, so a pictured trim cannot drift from the
   * live cycle. `x`/`y` name the INTERSECTION the click landed on, the way the live tool reads a
   * press: the four cells around that vertex are the sites it may govern. The micro coordinate the
   * tool takes is unread.
   */
  trimClick(x: number, y: number): void {
    const ctx: TrimCtx = {
      gridState: this.state,
      executeCommand: (cmd) => this.executor.execute(cmd),
      commitStroke: (start, opts) => this.executor.commitStroke(start, opts),
      getUndoStackSize: () => this.executor.getUndoStackSize(),
      collapseHistory: (start) => this.executor.collapseHistory(start),
    };
    new EdgeCutTool().onPointerDown({ x, y }, { x, y }, ctx as unknown as ToolContext);
    this.touch();
  }

  undo(): boolean { return this.executor.undo(); }
  redo(): void { this.executor.redo(); }

  /** Append a plan note the way the annotations slice does: the slice's own state ctor, one push. */
  addNote(note: MapAnnotation): void {
    (this.state.annotations ??= createAnnotationsState()).items.push(note);
    this.touch();
  }

  /** Announce an out-of-band state change (annotations, which ride beside the command stream). */
  touch(): void { this.version++; }
}
