/*
 * A self-contained editor world, the one a Help figure pictures: a real template's `GridState` under
 * a `CommandExecutor` with the full rule registry, changed by the live tools' own macros, commands,
 * stroke finish and trim tool, and drawn by the app's own `MapRenderer` over this world's bus. A
 * figure changes it through these verbs only, so what it pictures is what the editor does.
 */
import { placeObjectCommand } from '../../core/model/command-build';
import {
  TerrainType, type Command, type GridState, type MacroCoord, type PlacedObject, type Rotation, type ValidationError, type ValidationResult,
} from '../../core/model/types';
import { type AutoEdgeCut } from '../../state/editing/vocabulary';
import { type EditorEvents } from '../../state/editing/events';
import { createGridState } from '../../core/model/template';
import { annotationsOf, type MapAnnotation } from '../../core/model/annotations';
import { getMapTemplate } from '../../config/maps';
import type { CommandExecutor, Stroke } from '../../core/commands/command-executor';
import { finishPaintStroke } from '../../tools/pointer/paint';
import { peelCommand } from '../../tools/placement';
import { EdgeCutTool } from '../../tools/pointer/edge-cut';
import { createToolHost, type ToolHost, type ToolOverlay } from '../../tools/pointer/runtime';
import { showPlacementHover, type PlacementGhostPlan } from '../../tools/pointer/objects';
import { cellAtPoint } from '../../core/grid/pointer';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { candidateObject, deleteGroup, rotateGroup, rotateObject } from '../../tools/objects';
import { getCatalogItem } from '../../state/catalog';
import { applyMacro, detachedContext, paint, previewMacro, type MacroId, type MacroOpts } from '../../tools/macros';
import type { EditContext } from '../../core/commands/edit-context';
import { gridCell, mapPoint, type MapPoint } from '../../core/grid/grids';
import { PLACEMENT_GRID, layerNumber } from '../../core/game/profile';
import { generateTerrain } from '../../tools/generation';
import { generateDesigned, type DesignedContext } from '../../tools/generation/designer';
import type { GenerateConfig } from '../../tools/generation/recipe';

/** Recipes a figure runs, built as the shelf builds them. */
export { defaultConfig, type GenerateConfig, type MazeGates } from '../../tools/generation/recipe';

/** A snapshot of the last refusal the rules made in this world, ready for the toast. `tone` is
 *  the live toast's own: a refused command toasts 'error', a reverted stroke 'warning'. */
interface DemoRefusal {
  message: string;
  params?: Record<string, string | number>;
  tone: 'error' | 'warning';
}

export class SandboxWorld {
  readonly state: GridState;
  readonly bus: EventBus<EditorEvents>;
  readonly executor: CommandExecutor;
  readonly kit: EditContext;
  /** The editor as the live tools reach it, headless: the pictured stroke finish and trim click
   *  run through the same doors the map's tools do. */
  readonly host: ToolHost;
  /** The most recent rule refusal, exactly as the live toast would say it. */
  refusal: DemoRefusal | null = null;
  /** The visitor's own auto-trim setting (`state/slices/edit.ts:autoEdgeCut`), handed in by the
   *  figure at mount: the pictured bar's chip shows it, so the pictured strokes must obey it. */
  autoTrim: AutoEdgeCut = 'off';

  /** The pictured stroke; until a scene begins one, the history from the map's start. */
  private stroke: Stroke;
  private placeSeq = 0;
  private strokeCells: MacroCoord[] = [];
  private strokeWater = false;

  constructor(templateId?: string) {
    this.state = createGridState(getMapTemplate(templateId));
    this.bus = new EventBus<EditorEvents>();
    this.kit = detachedContext(this.state, createDefaultRegistry(), this.bus);
    this.executor = this.kit.executor;
    this.host = createToolHost(this.kit);
    this.stroke = this.executor.beginStroke();
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
   *  rules took it, null when they refused. `plop` receives the id before the command executes;
   *  the object layer's squash animation must be requested before the wrapper is created. */
  place(
    catalogId: string, x: number, y: number,
    opts?: { rotation?: Rotation; elevation?: number; plop?: (id: string) => void },
  ): string | null {
    const id = `help-${catalogId}-${this.placeSeq++}`;
    const candidate = candidateObject(getCatalogItem(catalogId)!, { x, y }, opts?.rotation ?? 0, this.state, { id, elevation: opts?.elevation ?? 0 });
    opts?.plop?.(id);
    return this.executor.execute(placeObjectCommand(candidate)).success ? id : null;
  }

  /** The placement tool's own hover with `catalogId` armed at `rotation` and the pointer at map
   *  point `point`: the same cell, anchor, span and validity, drawn on `overlay` as the tool draws
   *  it. Null, with the ghost cleared, for an unknown item. */
  hoverPlacement(overlay: ToolOverlay, catalogId: string, point: MapPoint, rotation: Rotation = 0): PlacementGhostPlan | null {
    const probe = { state: this.state, registry: this.host.registry, validateCommand: this.host.validateCommand, point };
    return showPlacementHover(overlay, catalogId, cellAtPoint(point, PLACEMENT_GRID), probe, rotation);
  }

  /** Ask the rules whether a placement would stand, with no execution and no event. */
  canPlace(catalogId: string, x: number, y: number, rotation: Rotation = 0, elevation = 0): boolean {
    const candidate = candidateObject(getCatalogItem(catalogId)!, { x, y }, rotation, this.state, { id: 'help-probe', elevation });
    return this.executor.validatePre(placeObjectCommand(candidate)).length === 0;
  }

  /** The object standing at exactly (catalogId, x, y), for scenes that act on what they placed. */
  objectAt(catalogId: string, x: number, y: number): PlacedObject | undefined {
    return [...this.state.objects.values()].find(
      (o) => o.catalogId === catalogId && o.position.x === x && o.position.y === y,
    );
  }

  /** Mark the start of a stroke; `commit()` runs the post-stroke rules back to this mark. */
  beginStroke(): void {
    this.stroke = this.executor.beginStroke();
    this.strokeCells = [];
    this.strokeWater = false;
  }

  /** The release of the pointer, through the live tool's own stroke finish at the visitor's trim
   *  setting. Demo strokes are terrain only; the refusal is kept for the figure's toast snapshot. */
  commit(): ValidationError[] {
    const { violations, waterLayer } = finishPaintStroke(
      this.host, { stroke: this.stroke, terrainCells: this.strokeCells, water: this.strokeWater, trim: this.autoTrim },
    );
    const first = violations[0];
    if (first) {
      this.refusal = waterLayer !== null
        ? { message: 'error.water_only_layer', params: { layer: layerNumber(waterLayer) }, tone: 'warning' }
        : { message: first.message, params: first.messageParams, tone: 'warning' };
    }
    this.strokeCells = [];
    return violations;
  }

  /**
   * One click of the real edge-cut tool at the intersection (x, y): the tool gathers the cut sites
   * that meet there and advances their shared odometer, so a pictured trim cannot drift from the
   * live cycle. `x`/`y` name the intersection the click landed on, the way the live tool reads a
   * press: the four cells around that vertex are the sites it may govern. The map point the tool
   * takes is unread.
   */
  trimClick(x: number, y: number): void {
    new EdgeCutTool().onPointerDown(gridCell(PLACEMENT_GRID, { x, y }), mapPoint({ x, y }), this.host);
  }

  undo(): boolean { return this.executor.undo(); }
  redo(): void { this.executor.redo(); }

  /** Run one command through the world's rules, as the live tools issue it. */
  execute(cmd: Command): ValidationResult {
    return this.executor.execute(cmd);
  }

  /** Peel one terrain layer at `c`, the command the live eraser issues per cell it crosses. */
  peel(c: MacroCoord, waterEraser: boolean): void {
    const cmd = peelCommand(c.x, c.y, this.state.cells[c.y]?.[c.x] ?? null, { waterEraser });
    if (cmd) this.execute(cmd);
  }

  /** Run a Smart Build macro, as its tool does on release. */
  applyMacro<K extends MacroId>(id: K, opts: MacroOpts<K>): ReturnType<typeof applyMacro<K>> {
    return applyMacro(this.kit, id, opts);
  }

  /** What a Smart Build macro would add, as its tool's hover preview reads it. */
  previewMacro<K extends MacroId>(id: K, opts: MacroOpts<K>): ReturnType<typeof previewMacro<K>> {
    return previewMacro(this.kit, id, opts);
  }

  /** Turn one object to `angle` with its spin, as the rotate verb does. */
  rotateObject(obj: PlacedObject, angle: Rotation, spin: { from: number; to: number }): ReturnType<typeof rotateObject> {
    return rotateObject(this.executor, this.state, obj, angle, spin);
  }

  /** Turn a group as one body; `onRotate` hears the turn the group made. */
  rotateGroup(
    ids: readonly string[], quarterTurns: Parameters<typeof rotateGroup>[3], onRotate?: Parameters<typeof rotateGroup>[4],
  ): ReturnType<typeof rotateGroup> {
    return rotateGroup(this.executor, this.state, ids, quarterTurns, onRotate);
  }

  /** Delete a group's unlocked members; `onWillRemove` hears each before it goes. */
  deleteGroup(ids: readonly string[], onWillRemove?: (obj: PlacedObject) => void): ReturnType<typeof deleteGroup> {
    return deleteGroup(this.executor, this.state, ids, onWillRemove);
  }

  /** Design a planet on this world, as Generate does; `onCommand` hears each command it lands. */
  generateDesigned(
    recipe: Omit<DesignedContext, 'state' | 'execute' | 'reg'>, onCommand?: (cmd: Command) => void,
  ): ReturnType<typeof generateDesigned> {
    return generateDesigned({
      state: this.state,
      execute: (cmd) => { onCommand?.(cmd); return this.execute(cmd); },
      reg: this.kit.registry,
      ...recipe,
    });
  }

  /** Run a maze or stencil recipe on this world, as Generate does. */
  generateTerrain(config: GenerateConfig): ReturnType<typeof generateTerrain> {
    return generateTerrain({ state: this.state, execute: (cmd) => this.execute(cmd), reg: this.kit.registry }, config);
  }

  /** Append a plan note the way the annotations slice does: the slice's own state ctor, one push. */
  addNote(note: MapAnnotation): void {
    annotationsOf(this.state).items.push(note);
  }
}
