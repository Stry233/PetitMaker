/*
 * A self-contained editor world, the one a Help figure pictures: a real template's `GridState` under
 * a `CommandExecutor` with the full rule registry, changed by the live tool set under a pictured
 * pointer and by the live macros, commands and stroke finish, and drawn by the app's own
 * `MapRenderer` over this world's bus. A figure changes it through these verbs only, so what it
 * pictures is what the editor does.
 */
import { placeObjectCommand } from '../../core/model/command-build';
import {
  TerrainType, type Command, type GridState, type MacroCoord, type PlacedObject, type Rotation, type ValidationError, type ValidationResult,
} from '../../core/model/types';
import { type AutoEdgeCut } from '../../state/editing/vocabulary';
import { type EditorEvents } from '../../state/editing/events';
import { createGridState } from '../../core/model/template';
import { cloneGridState } from '../../core/model/grid-model';
import { annotationsOf, isEmptyNote, noteStepCell, type MapAnnotation, type MeasureNote } from '../../core/model/annotations';
import { resizeMeasurementOn } from '../../core/model/annotation/dimensions';
import { REFERENCE_CELL_PX } from '../../core/model/annotation/route-fit';
import { flippedNotes, recordNotes, repointedMeasure, stepNotes, toolForDraft, type NoteLane } from '../../state/note-lane';
import { ToolType } from '../../state/editing/vocabulary';
import type { AnnotationEditVerbs } from '../../tools/pointer/annotate';
import { noteTagLabel } from '../../view/shared/annotation/draw-options';
import { getMapTemplate } from '../../config/maps';
import type { CommandExecutor, Stroke } from '../../core/commands/command-executor';
import { finishPaintStroke } from '../../tools/pointer/paint';
import { peelCommand } from '../../tools/placement';
import { CurveSessions } from '../../tools/pointer/paint';
import { ToolManager, createToolHost, type EditorView, type ToolHost, type ToolOverlay } from '../../tools/pointer/runtime';
import { ObjectDragSession, showPlacementHover, type PlacementGhostPlan } from '../../tools/pointer/objects';
import type { BlockRef } from '../../state/selection';
import { cellAtPoint } from '../../core/grid/pointer';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import {
  candidateObject, copyArrangement, deleteGroup, pasteArrangement, pasteAt, rotateGroup, rotateObject,
  type CopyResult, type PasteAim, type PasteDoor, type PasteOutcome, type PasteResult,
} from '../../tools/objects';
import type { Arrangement } from '../../state/clipboard';
import { getCatalogItem } from '../../state/catalog';
import { applyMacro, detachedContext, paint, previewMacro, type MacroId, type MacroOpts } from '../../tools/macros';
import type { EditContext } from '../../core/commands/edit-context';
import { mapPoint, type MapPoint } from '../../core/grid/grids';
import { PLACEMENT_GRID, layerNumber } from '../../core/game/profile';
import type { CurveAnchor } from '../../core/base/spline';
import { armingOf, type NoteDocument, type ToolArming } from '../../state/editing/arming';
import { useEditorStore } from '../../state/store';
import type { TextKey, Translate } from '../../i18n/keys';
import { generateTerrain } from '../../tools/generation';
import { generateDesigned, type DesignedContext } from '../../tools/generation/designer';
import type { GenerateConfig } from '../../tools/generation/recipe';
import { createRegionBrush, type RegionBrush } from '../../tools/pointer/region';
import type { HoldClock } from '../../tools/pointer/macros';
import { laneRecord, laneStep, type HistoryLane } from '../../state/history-lane';
import { DEFAULT_REGION_REQUEST, type RegionRequest, type RegionTool } from '../../state/editing/vocabulary';
import { cellSet } from '../../core/grid/grids';
import { TERRAIN_GRID } from '../../core/game/profile';
import { turnRotation } from '../../core/model/types';
import { reportRefusal } from '../../core/commands/refusal';
import { pasteKeyAim, type GroupRotation } from '../../tools/objects';
import { resolvePointer, toolDeclares } from '../../tools/pointer/runtime';
import { holdsSelection, isBrushTool } from '../../state/editing/edit-mode';
import { sameRef, selectedObjectIds } from '../../state/selection';
import { layerNumbersShown } from '../../state/layer-utils';
import { resolvePress, type PressFacts, type PressIntent, type PressPlan } from '../../view/interaction/press/press-plan';
import { PRIMARY_BUTTON } from '../../view/interaction/press/pointer-buttons';
import { isDraggableObject, pointerTarget } from '../../view/interaction/selection-hover';
import { macroRect, objectsInBand } from '../../view/interaction/marquee';
import { paintSelection } from '../../view/shared/overlay/selection-paint';
import { copyNotices, groupDeleteNotices, pasteNotices, type CopyNotice } from '../../i18n/terms/copy-notices';
import { placingFilledCap } from '../editing/object-shelf';

/** Recipes a figure runs, built as the shelf builds them. */
export { defaultConfig, type GenerateConfig, type MazeGates } from '../../tools/generation/recipe';

/** A snapshot of the last refusal the rules made in this world, ready for the toast. `tone` is
 *  the live toast's own: a refused command toasts 'error', a reverted stroke 'warning'. */
interface DemoRefusal {
  message: string;
  params?: Record<string, string | number>;
  tone: 'error' | 'warning';
}

const noop = (): void => {};

/** An overlay that draws nothing, for a world no figure has handed one. */
const SILENT_OVERLAY = new Proxy({} as ToolOverlay, { get: () => noop });

/** What the bar arms before a figure picks anything: the store's own initial arming, so a figure's
 *  tools paint at the size and floor a fresh editor does, whatever the visitor has set. */
export function sandboxArming(): ToolArming {
  return armingOf(useEditorStore.getInitialState());
}

/** A drag the sandbox runs through the map's own drag session (`SandboxWorld.drag`). */
interface WorldDrag {
  begin(anchorId: string, at: MacroCoord, copy?: boolean): boolean;
  preview(at: MacroCoord): void;
  commit(at: MacroCoord): void;
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

  /** The editor's own tool set behind its tool manager, on a view whose screen is the map: a screen
   *  point is the map point there, so the tools resolve the cell under the pictured pointer. */
  private readonly tools: ToolManager;
  private arming: ToolArming = sandboxArming();
  private overlay: ToolOverlay = SILENT_OVERLAY;
  /** The pointer while a press of the tools is down, null between presses. */
  private pressAt: MapPoint | null = null;
  /** What the tools' last notice translated, read back into `refusal` by key and params. */
  private said: Array<{ key: TextKey; params?: Record<string, string | number> }> = [];
  /** The held modifier commands (`ToolModifiers`): constrain snaps a shape drag, multi-select
   *  toggles a click. */
  readonly held = { constrain: false, multiSelect: false };
  /** This world's curve adjust phase: the anchors a finished curve leaves standing, which the
   *  pictured handles stand at and drag through. */
  readonly curve = new CurveSessions();

  /** A world on a fresh map of `templateId`, or with `base` on a copy of that map, its history
   *  empty: an undo never reaches past what the world started from. */
  constructor(templateId?: string, opts: { base?: GridState } = {}) {
    this.state = opts.base ? cloneGridState(opts.base) : createGridState(getMapTemplate(templateId));
    this.bus = new EventBus<EditorEvents>();
    this.kit = detachedContext(this.state, createDefaultRegistry(), this.bus);
    this.executor = this.kit.executor;
    this.host = createToolHost(this.kit);
    this.stroke = this.executor.beginStroke();
    this.bus.on('validation-failed', ({ errors }) => {
      const first = errors[0];
      if (first) this.refusal = { message: first.message, params: first.messageParams, tone: 'error' };
    });
    const world = this;
    const view: EditorView = {
      // A cell reports the size a headless route fit assumes, so the notes tool's press slop and fit
      // read the lengths they read on a map at that zoom.
      projection: { screenToPoint: (sx, sy) => mapPoint({ x: sx, y: sy }), cellToScreen: (x, y) => ({ x, y, scale: REFERENCE_CELL_PX }) },
      get overlay() { return world.overlay; },
      plopObject: (id) => { this.feedback.plop(id); }, animateRotation: noop, animateGroupRotation: noop,
      rendersState: () => this.state, onNextPaint: (cb) => cb(), showLoupe: noop, hideLoupe: noop,
    };
    const held = this.held;
    this.tools = new ToolManager(view, this.executor, this.state, {
      arming: () => this.armed(),
      t: ((key: TextKey, params?: Record<string, string | number>) => { this.said.push({ key, params }); return key; }) as Translate,
      notify: (_text, tone) => {
        const reason = this.said[0];
        this.said = [];
        if (reason && tone !== 'info') this.refusal = { message: reason.key, params: reason.params, tone };
      },
      // The latch counts as the held command, as `state/keymap/held.ts` reads it.
      modifiers: { get constrain() { return held.constrain; }, get multiSelect() { return held.multiSelect || world.multiSelectLatched; } },
      curve: this.curve,
      annotationEdit: this.noteEdits,
      tagLabel: noteTagLabel(this.state),
      holdClock: this.clock,
      dealSeed: () => this.dealt.shift() ?? null,
    });
    this.toolView = view;
    this.bus.on('objects-changed', ({ added, cause }) => this.objectsChanged(added, cause));
  }

  /** The arming the tools read, carrying the visitor's auto-trim setting the pictured chip shows. */
  private armed(): ToolArming {
    if (this.arming.autoEdgeCut !== this.autoTrim) this.arming = { ...this.arming, autoEdgeCut: this.autoTrim };
    if (this.arming.notes !== this.noteDoc) this.arming = { ...this.arming, notes: this.noteDoc };
    return this.arming;
  }

  /** Pick a tool in the bar: the editor's initial arming with `patch` over it, the tool taken up
   *  afresh, so a curve left standing closes and no gesture carries over. */
  pick(patch: Partial<ToolArming>): void {
    this.tools.retire();
    const was = this.arming;
    this.arming = { ...sandboxArming(), ...patch };
    this.rearmed(was);
    this.picked = Object.keys(patch).length > 0;
    this.tools.syncArming();
  }

  /** Whether a scene has picked a tool, whose own hover and ghost then stand under the pointer. */
  get toolPicked(): boolean { return this.picked || this.selecting !== null; }
  private picked = false;

  /** Where the picked tools draw their ghosts; a world handed none draws nowhere. */
  drawToolsOn(overlay: ToolOverlay): void {
    this.overlay = overlay;
  }

  /** Whether a press of the tools is down. */
  get pressing(): boolean { return this.pressAt !== null; }

  /** The pointer pressed at map point `p` (cells, unrounded), through the tool manager as the map's
   *  pointer machine hands it a press; while region selection is on, the region brush takes it. */
  pointerDown(p: MacroCoord): void {
    this.said = [];
    this.pressAt = mapPoint(p);
    if (this.selecting) { this.selecting.brush.paint(cellAtPoint(this.pressAt, TERRAIN_GRID)); return; }
    this.tools.handlePointerDown(p.x, p.y);
  }

  /** The pointer at map point `p`, pressed or hovering. */
  pointerMove(p: MacroCoord): void {
    this.said = [];
    if (this.pressAt) this.pressAt = mapPoint(p);
    if (this.selecting) { this.regionPointer(p); return; }
    this.tools.handlePointerMove(p.x, p.y);
  }

  /** The pointer released at `p`, by default where it last stood. */
  pointerUp(p: MacroCoord | null = this.pressAt): void {
    const at = p ?? { x: 0, y: 0 };
    this.said = [];
    const pressed = this.pressAt !== null;
    this.pressAt = null;
    if (this.selecting) { if (pressed) this.selecting.brush.done(); return; }
    this.tools.handlePointerUp(at.x, at.y);
  }

  /** A press and its release at `p`. */
  click(p: MacroCoord): void {
    this.pointerDown(p);
    this.pointerUp(p);
  }

  /** The anchors of the curve standing in its adjust phase, or null. */
  curveAnchors(): CurveAnchor[] | null {
    return this.curve.get()?.anchors.map((a) => ({ ...a })) ?? null;
  }

  /** Drag anchor `index` of the standing curve to map point `p`, as its handle does: the cell under
   *  the point on the curve's grid, previewed until `commit` re-lays the curve. */
  dragAnchor(index: number, p: MacroCoord, commit: boolean): void {
    const live = this.curve.get();
    if (!live) return;
    const cell = cellAtPoint(mapPoint(p), live.grid);
    this.curve.moveAnchor(index, cell.x, cell.y, commit);
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

  /** The release of the pointer. A press of the tools is released through its tool, which reports
   *  its refusal into `refusal` and returns nothing here; otherwise the `paint` stroke finishes
   *  through the live stroke finish at the visitor's trim setting, its violations returned and the
   *  first kept for the figure's toast snapshot. */
  commit(): ValidationError[] {
    if (this.pressAt) { this.pointerUp(); return []; }
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

  /** One step back through the history: the region's own lane while region selection is on, the
   *  notes' lane while the notes tool is armed, as the undo key steps it, else the map's; a rewind
   *  past the map's start walks the notes' lane too. A press still down is cancelled first, as the
   *  browser taking the pointer does, so its tool rolls back what the press laid. */
  undo(): boolean {
    if (this.selecting) return this.undoRegion();
    if (this.pressAt) { this.pressAt = null; this.tools.handlePointerCancel(); }
    if (this.arming.tool === ToolType.Annotate && this.stepNotes('undo')) return true;
    return this.executor.undo() || this.stepNotes('undo');
  }
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

  /**
   * The map's own object drag over this world: a press on a member of `selected` begins it (a copy
   * drag with `copy`, EDIT-60), each pointer move previews the drop on the figure's overlay, and the
   * release lands it as one undo step, refused whole as a move is (EDIT-27). `onSelect` hears what
   * the drop leaves selected; `plop` plays each landing.
   */
  drag(selected: () => readonly string[], onSelect: (ids: string[]) => void, plop: (id: string) => void): WorldDrag {
    const session = new ObjectDragSession({
      state: () => this.state,
      executor: () => this.executor,
      selection: () => selected().map((id): BlockRef => ({ kind: 'object', id })),
      setSelection: (blocks) => onSelect(blocks.flatMap((b) => (b.kind === 'object' ? [b.id] : []))),
      report: (refusal) => {
        const first = refusal?.errors[0];
        if (first) this.refusal = { message: first.message, params: first.messageParams, tone: 'error' };
      },
      notify: noop,
      t: ((key: TextKey) => key) as Translate,
    });
    const view = () => ({ overlay: this.overlay, plopObject: plop });
    return {
      begin: (anchorId, at, copy = false) => session.begin(anchorId, mapPoint(at), cellAtPoint(mapPoint(at), PLACEMENT_GRID), copy),
      preview: (at) => session.preview(view(), mapPoint(at)),
      commit: (at) => session.commit(view(), mapPoint(at)),
    };
  }

  /** Copy `ids` as the editor's Copy takes them (EDIT-53). */
  copy(ids: readonly string[]): CopyResult {
    return copyArrangement(this.state, ids);
  }

  /** Paste `a` where `aim` asks, as Ctrl+V and the menu's Paste place it (EDIT-54, EDIT-57);
   *  `onWillPlace` hears each member before it lands. */
  paste(a: Arrangement, aim: PasteAim, onWillPlace?: (obj: PlacedObject) => void): PasteOutcome {
    return pasteAt(this.pasteDoor(), a, aim, onWillPlace);
  }

  /** Place `a` with its outline at `at` whole or not at all, as a Ctrl+drag copy drops (EDIT-60). */
  pasteWhole(a: Arrangement, at: MacroCoord, onWillPlace?: (obj: PlacedObject) => void): PasteResult {
    return pasteArrangement(this.pasteDoor(), a, at, onWillPlace);
  }

  private pasteDoor(): PasteDoor {
    return { state: this.state, registry: this.kit.registry, execute: (cmd) => this.executor.execute(cmd), beginStroke: () => this.executor.beginStroke() };
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
    this.notesChanged();
  }

  /* ── Plan notes: the notes tool's host channels over this world's notes ─────────────────── */

  /** The selection, the draft and the lane epoch the notes tool reads (`ToolArming.notes`); a new
   *  object on every change, as the store's state is. */
  private noteDoc: NoteDocument = { selection: [], draft: null, historyEpoch: 0, discardPending: false };
  private noteLane: NoteLane = { undo: [], redo: [] };
  private readonly noteWatchers = new Set<() => void>();
  /** A measurement end held by its handle: the note as the grab began, and whether a move landed. */
  private measureGrab: { original: MeasureNote; endpoint: 0 | 1; began: boolean } | null = null;

  /** The note the notes tool is drawing, as both views draw it. */
  get annotationDraft(): MapAnnotation | null { return this.noteDoc.draft; }
  /** The selected notes' ids, in the order they were picked. */
  get annotationSelection(): readonly string[] { return this.noteDoc.selection; }

  /** Hear every change to the notes, the draft or the selection; returns the unsubscribe. */
  watchNotes(listener: () => void): () => void {
    this.noteWatchers.add(listener);
    return () => this.noteWatchers.delete(listener);
  }

  /** Done on the notes bar: the standing draft becomes a note, selected. False when nothing commits. */
  doneNotes(): boolean {
    return this.noteEdits.commitDraft();
  }

  /** Flip on the note card: the measurements among `ids` draw their numbers on the other side. */
  flipNotes(ids: readonly string[]): void {
    const flipped = flippedNotes(annotationsOf(this.state), ids);
    if (!flipped) return;
    this.noteEdits.begin();
    this.noteEdits.apply((d) => { d.items = flipped; });
  }

  /** Drag end `endpoint` of the selected measurement `id` to map point `p`, as its endpoint handle
   *  does: the step cell under the point, kept on the map, the first move that lands opening the
   *  lane entry the rest join. `release` lets the handle go. */
  dragMeasureEnd(id: string, endpoint: 0 | 1, p: MacroCoord, release = false): void {
    const note = annotationsOf(this.state).items.find((n) => n.id === id);
    if (this.measureGrab?.original.id !== id || this.measureGrab.endpoint !== endpoint) {
      this.measureGrab = note?.kind === 'measure' ? { original: note, endpoint, began: false } : null;
    }
    const grab = this.measureGrab;
    if (grab && this.noteDoc.selection.includes(id)) {
      const points = resizeMeasurementOn(this.state.template, grab.original.points, endpoint, noteStepCell(p));
      const moved = repointedMeasure(annotationsOf(this.state), id, points);
      if (moved) {
        if (!grab.began) this.noteEdits.begin();
        grab.began = true;
        this.noteEdits.apply((d) => { d.items = d.items.map((n) => (n.id === id ? moved : n)); });
      }
    }
    if (release) this.measureGrab = null;
  }

  /** The annotations slice's verbs (`tool-wiring.ts:annotationEdit`) over this world's notes. */
  private readonly noteEdits: AnnotationEditVerbs = {
    begin: () => {
      this.noteLane = recordNotes(this.noteLane, annotationsOf(this.state), this.noteDoc.draft);
    },
    apply: (fn) => {
      fn(annotationsOf(this.state));
      this.notesChanged();
    },
    add: (a) => {
      this.noteEdits.begin();
      this.noteEdits.apply((d) => { d.items.push(a); });
    },
    remove: (id) => {
      this.noteEdits.begin();
      this.noteEdits.apply((d) => { d.items = d.items.filter((n) => n.id !== id); });
      this.setNoteDoc({ selection: this.noteDoc.selection.filter((i) => i !== id) });
    },
    select: (ids) => { this.setNoteDoc({ selection: ids }); },
    setDraft: (a) => { this.setNoteDoc({ draft: a }); },
    commitDraft: () => {
      const d = this.noteDoc.draft;
      if (!d) return false;
      if (isEmptyNote(d)) { this.setNoteDoc({ draft: null, historyEpoch: this.noteDoc.historyEpoch + 1 }); return false; }
      this.noteEdits.begin();
      annotationsOf(this.state).items.push(d);
      this.setNoteDoc({ draft: null, selection: [d.id] });
      return true;
    },
  };

  /** One step of the notes' lane, as the slice's undo and redo take it: the selection dropped, the
   *  draft restored with its verb armed, and the tool's gestures invalidated. */
  private stepNotes(dir: 'undo' | 'redo'): boolean {
    const step = stepNotes(this.noteLane, annotationsOf(this.state), this.noteDoc.draft, dir);
    if (!step) return false;
    this.curve.end();
    this.noteLane = step.lane;
    if (step.draft) this.arming = { ...this.arming, annotationTool: toolForDraft(step.draft, this.arming.annotationTool) };
    this.setNoteDoc({ selection: [], draft: step.draft, historyEpoch: this.noteDoc.historyEpoch + 1 });
    return true;
  }

  private setNoteDoc(patch: Partial<NoteDocument>): void {
    this.noteDoc = { ...this.noteDoc, ...patch };
    this.notesChanged();
  }

  private notesChanged(): void {
    for (const listener of this.noteWatchers) listener();
  }

  /* ── Region selection and the held-press clock ─────────────────────────────────────────────── */

  /** The figure's own time, which a held Smart Build press ticks on. */
  private readonly clock = new StepClock();
  /** Seeds dealt to the Smart Build tool, the next first. */
  private readonly dealt: number[] = [];

  /** Let `ms` of the figure's time pass: a held press's bursts fire on it as on the page's timers. */
  advance(ms: number): void {
    this.clock.advance(ms);
  }

  /** Deal `seed` to the Smart Build tool: its next pointer call continues its seed sequence from it,
   *  so its ghost and its press answer for that seed. */
  dealSeed(seed: number): void {
    this.dealt.push(seed);
  }

  /** Region selection while it is on: the editor's region brush, what it paints with, and the
   *  region's own lane. */
  private selecting: {
    brush: RegionBrush;
    tool: RegionTool;
    size: number;
    request: RegionRequest;
    lane: HistoryLane<MacroCoord[]>;
  } | null = null;
  private regionCells: MacroCoord[] = [];

  /** The painted region, as the store's `region` holds it. */
  get region(): readonly MacroCoord[] { return this.regionCells; }

  /**
   * Arm region selection as the scope screen does: the editor's region brush takes the pointer
   * verbs, painting `tool` at the store's initial brush size unless `size` says otherwise, and
   * `undo` steps the region's own lane, never the map's. It starts from no region, since a template
   * carries none and the figure's loop rewinds only the map. `show` draws the region with the
   * figure being drawn, empty for none, as the live overlay does.
   */
  selectRegion(opts: { tool: RegionTool; size?: number; request?: RegionRequest; show: (cells: readonly MacroCoord[]) => void }): void {
    this.endRegionSelection();
    this.regionCells = [];
    const sel = {
      tool: opts.tool,
      size: opts.size ?? useEditorStore.getInitialState().regionBrushSize,
      request: opts.request ?? DEFAULT_REGION_REQUEST,
      lane: { undo: [], redo: [] } as HistoryLane<MacroCoord[]>,
    };
    const brush: RegionBrush = createRegionBrush({
      tool: () => sel.tool,
      request: () => sel.request,
      size: () => sel.size,
      constrain: () => this.held.constrain,
      grid: () => this.state,
      region: () => this.regionCells,
      // The store's `commitRegion`: an empty region over an empty one records nothing, and a
      // recorded change rereads the brush, as the store's subscription does.
      commit: (cells) => {
        if (this.regionCells.length === 0 && cells.length === 0) return;
        sel.lane = laneRecord(sel.lane, this.regionCells);
        this.regionCells = cells;
        brush.resync();
      },
      show: opts.show,
      ghost: (cells, eraser) => {
        if (cells.length) this.overlay.showGhost(cellSet(TERRAIN_GRID, [...cells]), { icon: eraser ? 'eraser' : null, valid: true });
        else this.overlay.clearGhost();
      },
    });
    this.selecting = Object.assign(sel, { brush });
  }

  /** Done on the scope screen: selection ends and its lane with it; the region stays painted. */
  endRegionSelection(): void {
    if (!this.selecting) return;
    if (this.pressAt) { this.pressAt = null; this.selecting.brush.cancel(); }
    this.selecting = null;
    this.overlay.clearGhost();
  }

  /** The region brush hearing the pointer at `p`: a press paints the cell under it and a hover
   *  previews it, as `view/interaction/pointer/region-pointer.ts` hands them on. */
  private regionPointer(p: MacroCoord): void {
    const cell = cellAtPoint(mapPoint(p), TERRAIN_GRID);
    if (this.pressAt) this.selecting!.brush.paint(cell);
    else this.selecting!.brush.preview?.(cell);
  }

  /** One step back on the region's lane, a press still down cancelled first; false when the lane is
   *  empty, which leaves the map as it is. */
  private undoRegion(): boolean {
    const sel = this.selecting!;
    if (this.pressAt) { this.pressAt = null; sel.brush.cancel(); }
    const step = laneStep(sel.lane, this.regionCells, 'undo');
    if (!step) return false;
    sel.lane = step.lane;
    this.regionCells = step.restored;
    sel.brush.resync();
    return true;
  }

  /* ── end of region selection and the held-press clock ──────────────────────────────────────── */

  /* ── The map's press, the selection and the verbs' notices ──────────────────────────────────
   * A figure's press on the map runs the editor's own press rule (`press-plan.ts:resolvePress`)
   * over facts gathered as `press-facts.ts:pressFactsAt` gathers them, and this world carries out
   * its intents as the pointer machine does: the selection writes, the band, the drag session, the
   * long-press menu and the tool stroke. The selection is painted by the live painter
   * (`selection-paint.ts:paintSelection`) on this world's overlay; the copy, paste and delete verbs
   * report the notices the live verbs toast. */

  /** The selection, as the store's `selection` holds it. */
  selection: readonly BlockRef[] = [];
  /** Touch multi-select's latch, as the store's `multiSelectLatched` holds it: set by the long-press
   *  menu's Multi-select, it holds the multi-select command down until the selection is cleared or
   *  the tool changes. */
  multiSelectLatched = false;
  private readonly selectionWatchers = new Set<(cause?: string) => void>();
  /** The picked block, the paste key's top-left (EDIT-54). */
  pickedCell: MacroCoord | null = null;
  /** The copy the paste verbs place (the store's `clipboard`). */
  clipboard: Arrangement | null = null;
  /** The long-press menu standing open, on the block and at the point its hold landed. */
  menu: { block: BlockRef; at: MacroCoord } | null = null;
  /** The last word a copy, paste or group delete said, as the live verb toasts it; null when it said
   *  nothing. A refusal goes to `refusal` instead, as the live verbs report it on the bus. */
  notice: SandboxNotice | null = null;
  /** Where the object layer's feedback plays: the placer's plop and the selection verbs' poofs and
   *  spins. A scene hands in its view's. */
  feedback: SandboxFeedback = SILENT_FEEDBACK;

  private toolView!: EditorView;
  private mapPress: MapPress | null = null;

  /** Hear every write of the selection, every change of the latch and every object edit, with the
   *  edit's cause; returns the unsubscribe. */
  watchSelection(listener: (cause?: string) => void): () => void {
    this.selectionWatchers.add(listener);
    return () => this.selectionWatchers.delete(listener);
  }

  /** Back to a fresh editor's session over whatever the map holds: nothing selected, picked, copied,
   *  latched or armed, and no press or menu. A figure's loop starts here. */
  restart(feedback: SandboxFeedback = SILENT_FEEDBACK): void {
    this.feedback = feedback;
    this.mapPress = null;
    this.menu = null;
    this.clipboard = null;
    this.notice = null;
    this.held.multiSelect = false;
    this.multiSelectLatched = false;
    this.pick({});
    this.writeSelection([]);
  }

  /** The selected objects' ids. */
  selectedIds(): string[] {
    return selectedObjectIds(this.selection);
  }

  /** The map pressed at `p` by a mouse or, with `touch`, a finger. */
  pressMap(p: MacroCoord, touch = false): void {
    this.menu = null;
    const plan = resolvePress(this.pressFacts(p, touch));
    const press: MapPress = { at: p, touch, plan, dragged: false, held: false, band: null, drag: null, tool: false, previewing: false };
    this.mapPress = press;
    if (!plan.pending) this.runIntents(press, plan.down, p);
  }

  /** The pointer at `p`: a press's drag, or with none down the tool's hover. A figure's pointer moves
   *  only on purpose, so any travel from the press point is a drag. */
  moveMap(p: MacroCoord): void {
    const press = this.mapPress;
    if (!press) { this.pointerMove(p); return; }
    if (!press.dragged && (p.x !== press.at.x || p.y !== press.at.y)) {
      press.dragged = true;
      if (!press.held) this.runIntents(press, press.plan.onDrag, press.at);
    }
    if (press.band) this.overlay.showBand(macroRect(press.band, cellAtPoint(mapPoint(p), PLACEMENT_GRID)));
    if (press.drag) press.drag.preview(p);
    if (press.previewing || press.tool) this.pointerMove(p);
  }

  /** A waiting press held until its hold time ran out: its hold arms run (the object's menu, the
   *  armed item's preview), and its release then does nothing more. */
  holdMap(): void {
    const press = this.mapPress;
    if (!press?.plan.pending || press.dragged || press.held) return;
    press.held = true;
    this.runIntents(press, press.plan.onHold ?? [], press.at);
  }

  /** The press released at `p`: a tap runs its tap arms, a band adds what it covers, a drag lands,
   *  a carried item drops as one press and release of the tool, a tool stroke ends. */
  releaseMap(p: MacroCoord): void {
    const press = this.mapPress;
    if (!press) return;
    this.mapPress = null;
    if (!press.dragged && !press.held) this.runIntents(press, press.plan.onTap, p, true);
    if (press.band) {
      this.overlay.clearBand();
      const covered = objectsInBand(this.state, macroRect(press.band, cellAtPoint(mapPoint(p), PLACEMENT_GRID)));
      const additions = covered.filter((id) => !this.selection.some((r) => r.kind === 'object' && r.id === id));
      if (additions.length > 0) this.writeSelection([...this.selection, ...additions.map((id) => ({ kind: 'object', id }) as const)]);
    }
    if (press.drag) { press.drag.commit(p); this.overlay.clearGhost(); }
    if (press.previewing) this.click(p);
    if (press.tool) this.pointerUp(p);
    // A still mouse is sampled again once the map under it changed, so the tool's hover answers for
    // what now stands there; a finger off the glass has no hover.
    if (!press.touch && this.picked) this.pointerMove(p);
  }

  /** Nothing selected or picked and the multi-select latch off, as the store's `clearSelection`
   *  leaves it (the multi-select bar's Done, Escape). */
  clearSelection(): void {
    this.held.multiSelect = false;
    this.multiSelectLatched = false;
    this.writeSelection([]);
  }

  /** The menu's Multi-select (`editing/object-menu.ts:latchMultiSelect`): its object selected alone
   *  and the latch on, so taps add and remove and a drag bands. */
  menuMultiSelect(): void {
    const menu = this.takeMenu();
    if (menu?.block.kind !== 'object') return;
    this.multiSelectLatched = true;
    this.writeSelection([menu.block]);
  }

  /** The menu's Rotate (`object-menu.ts:turnObjectQuarter`): its object selected alone and turned a
   *  quarter clockwise; the menu stays for the next turn. */
  menuRotate(): void {
    const menu = this.menu;
    if (menu?.block.kind !== 'object') return;
    this.writeSelection([menu.block]);
    this.rotateSelection(90);
  }

  /** The menu's Delete on an object. */
  menuDelete(): void {
    const menu = this.takeMenu();
    if (menu?.block.kind === 'object') this.deleteConfirmed(menu.block.id);
  }

  /** One object's delete once confirmed, by the Delete key's popover or the menu
   *  (`group-edit.ts:deleteObjectConfirmed`): reported as a group delete is, the selection emptied. */
  deleteConfirmed(id: string): void {
    this.deleteSelection([id]);
    this.clearSelection();
  }

  /** The menu's Paste: one copy with its top-left on the placement cell the hold landed on. */
  menuPaste(): void {
    const menu = this.takeMenu();
    if (menu) this.pasteCopy({ kind: 'cell', cell: cellAtPoint(mapPoint(menu.at), PLACEMENT_GRID) });
  }

  /** The rotate key and the selection card's Rotate (`group-edit.ts:rotateSelection`): a plural
   *  selection turns as one body, a rotatable object in place; a refusal goes to `refusal`. */
  rotateSelection(delta: 90 | -90): void {
    const turn = delta === 90 ? 1 : -1;
    const ids = this.selectedIds();
    if (this.selection.length > 1) {
      reportRefusal(this.bus, this.rotateGroup(ids, turn, (spin) => this.feedback.groupSpin(spin)).refusal);
      return;
    }
    const cur = ids.length === 1 ? this.state.objects.get(ids[0]!) : undefined;
    if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
    const res = this.rotateObject(cur, turnRotation(cur.rotation, turn), { from: cur.rotation, to: cur.rotation + delta });
    if (res.ok) this.feedback.spin(cur.id, res.spin!.from, res.spin!.to);
    else reportRefusal(this.bus, res.refusal);
  }

  /** The delete key and the selection card's Delete (`group-edit.ts:deleteSelection`): the unlocked
   *  members go with their poofs, the selection keeps whoever survived, and the result is reported
   *  as the live verb reports it, a refusal on the bus and a partial delete as a notice. */
  deleteSelection(ids: readonly string[] = this.selectedIds()): void {
    const result = this.deleteGroup(ids, (obj) => this.feedback.poof(obj.id));
    this.writeSelection(ids.filter((id) => this.state.objects.has(id)).map((id) => ({ kind: 'object', id }) as const));
    reportRefusal(this.bus, result.refusal);
    this.hear((t) => groupDeleteNotices(t, result));
  }

  /** The copy key and the selection card's Copy (`clipboard.ts:copyObjects`): the selection taken
   *  as an arrangement, and what it took said. */
  copySelection(): void {
    const taken = this.copy(this.selectedIds());
    if (taken.arrangement === null && taken.leftOut === 0) { this.notice = null; return; }
    if (taken.arrangement) this.clipboard = taken.arrangement;
    this.hear((t) => copyNotices(t, { copied: taken.arrangement?.members.length ?? 0, leftOut: taken.leftOut }));
  }

  /** The paste key (`clipboard.ts:pasteFromKey`), aimed where the key aims (`pasteKeyAim`). */
  pasteKey(): void {
    if (!this.clipboard) return;
    this.pasteCopy(pasteKeyAim(this.clipboard, { pickedCell: this.pickedCell, region: [], template: this.state.template }));
  }

  /** One copy placed where `aim` asks or nearby, what it came to said, and what it placed selected
   *  (`clipboard.ts:pasteAt`). */
  private pasteCopy(aim: PasteAim): void {
    if (!this.clipboard) return;
    const outcome = this.paste(this.clipboard, aim, (obj) => this.feedback.plop(obj.id));
    this.hear((t) => pasteNotices(t, outcome));
    if (outcome.placed.length === 0) return;
    if (this.arming.armedItem || this.arming.armedMacro || !holdsSelection(this.arming.tool)) this.pick({});
    this.writeSelection(outcome.placed.map((id) => ({ kind: 'object', id }) as const));
  }

  /** Keeps the first notice `say` makes, by key and params, as the live toast would show it. */
  private hear(say: (t: Translate) => readonly CopyNotice[]): void {
    const keys: Array<{ key: TextKey; params?: Record<string, string | number> }> = [];
    const t = ((key: TextKey, params?: Record<string, string | number>) => { keys.push({ key, params }); return String(keys.length - 1); }) as Translate;
    const first = say(t)[0];
    const said = first ? keys[Number(first.text)] : undefined;
    this.notice = said && first ? { key: said.key, ...(said.params ? { params: said.params } : {}), tone: first.tone } : null;
  }

  private takeMenu(): SandboxWorld['menu'] {
    const menu = this.menu;
    this.menu = null;
    return menu;
  }

  /** The press facts at `p`, gathered as the live press gathers them from the store and the tool. */
  private pressFacts(p: MacroCoord, touch: boolean): PressFacts {
    const point = mapPoint(p);
    const macro = cellAtPoint(point, PLACEMENT_GRID);
    const { hit, terrain, pick } = pointerTarget(this.state, point);
    const arming = this.armed();
    const declared = toolDeclares(arming.tool);
    const tool = this.tools.getActiveTool();
    const ctx = { ...this.tools.getContext() };
    const toolCoord = resolvePointer(this.toolView, tool, ctx, p.x, p.y).cell;
    return {
      button: PRIMARY_BUTTON,
      inputMode: touch ? 'touch' : 'pc',
      selectMode: declared.selectMode(arming),
      brush: declared.brush,
      armedItemId: arming.armedItem,
      copyHeld: this.clipboard !== null,
      selection: this.selection,
      selectingRegion: false,
      panDragHeld: false,
      multiSelectHeld: this.held.multiSelect || this.multiSelectLatched,
      moveLatched: false,
      macro,
      terrain,
      pick,
      hit: hit ? { id: hit.id, draggable: isDraggableObject(hit), locked: !!hit.locked } : null,
      placementAllowed: !tool.canActAt || tool.canActAt(toolCoord, ctx),
      toolGrabs: tool.grabAt?.(macro, ctx) ?? false,
      toolSelects: tool.selects?.(ctx) ?? false,
      toolSelectHit: tool.selectHit ? tool.selectHit(macro, ctx) : null,
      pendingGesture: tool.hasPending?.(ctx) ?? false,
      clickOnlyStroke: !!tool.clickOnly?.(macro, ctx),
      armedStrokes: !!tool.strokes?.(ctx),
    };
  }

  /** Carries out `intents` of `press` at `p` as the pointer machine does; `tap` names a tap's arms,
   *  whose tool stroke is one press and release there. */
  private runIntents(press: MapPress, intents: readonly PressIntent[], p: MacroCoord, tap = false): void {
    for (const intent of intents) {
      switch (intent.kind) {
        case 'tool-stroke':
          if (tap) this.click(p);
          else { press.tool = true; this.pointerDown(p); }
          break;
        case 'select': this.writeSelection([intent.block], intent.pick ?? null); break;
        case 'pick-cell': this.writeSelection([], intent.cell); break;
        case 'toggle-select':
        case 'toggle-on-release': {
          const block = intent.block;
          const has = this.selection.some((r) => sameRef(r, block));
          this.writeSelection(has ? this.selection.filter((r) => !sameRef(r, block)) : [...this.selection, block]);
          break;
        }
        case 'deselect': this.writeSelection([]); break;
        case 'collapse-select': this.writeSelection([{ kind: 'object', id: intent.id }]); break;
        case 'move-selection':
        case 'copy-selection': {
          const drag = this.drag(
            () => this.selectedIds(),
            (ids) => this.writeSelection(ids.map((id) => ({ kind: 'object', id }) as const)),
            (id) => this.feedback.plop(id),
          );
          if (drag.begin(intent.anchorId, press.at, intent.kind === 'copy-selection')) press.drag = drag;
          break;
        }
        case 'band-select': press.band = intent.from; break;
        case 'context-menu': this.menu = { block: intent.block, at: press.at }; break;
        case 'preview-placement': press.previewing = true; this.pointerMove(p); break;
        // The camera is the figure's own; no region brush or pending tool gesture stands in a figure.
        case 'pan-camera': case 'zoom-in': case 'cancel-pending': case 'paint-region': break;
      }
    }
  }

  /** A selection write, as the store takes it (`slices/engine.ts:selectionFields`): it drops the
   *  picked block, puts a brush away for the map's select mode, and is refused under any other tool
   *  that holds no selection; then the ring is painted. */
  private writeSelection(next: readonly BlockRef[], picked: MacroCoord | null = null): void {
    if (next.length > 0 && !holdsSelection(this.arming.tool)) {
      if (!isBrushTool(this.arming.tool)) return;
      this.pick({});
    }
    this.selection = next;
    this.pickedCell = picked;
    this.paintSelection();
    this.tellSelection();
  }

  /** A change of arming, as the store takes it (`slices/edit.ts:editModeFields`): a tool that holds
   *  no selection drops it, and re-arming drops the picked block and the multi-select latch. */
  private rearmed(was: ToolArming): void {
    const now = this.arming;
    if (this.selection.length > 0 && !holdsSelection(now.tool)) this.selection = [];
    if (now.tool !== was.tool || now.armedItem !== was.armedItem) {
      this.pickedCell = null;
      this.held.multiSelect = false;
      this.multiSelectLatched = false;
    }
    this.paintSelection();
    this.tellSelection();
  }

  private tellSelection(cause?: string): void {
    for (const listener of [...this.selectionWatchers]) listener(cause);
  }

  /** The ring the live selection view sync paints for this selection. */
  private paintSelection(): void {
    paintSelection(this.overlay, this.state, this.selection, layerNumbersShown(useEditorStore.getInitialState()), this.pickedCell);
  }

  /** The editor's own reactions to a map change: the ring follows moved geometry, and an item placed
   *  up to its limit is put down (`object-shelf.ts:watchCappedArming`). */
  private objectsChanged(added: readonly PlacedObject[] | undefined, cause: string | undefined): void {
    if (this.selection.some((r) => r.kind === 'object')) this.paintSelection();
    if (placingFilledCap(this.state, this.arming.armedItem, added)) this.pick({});
    this.tellSelection(cause);
  }
}

/** A clock that runs only when told: each repeat fires once per period passed, in time order. */
class StepClock implements HoldClock {
  private now = 0;
  private readonly repeats = new Set<{ due: number; ms: number; tick: () => void }>();

  every(ms: number, tick: () => void): () => void {
    const repeat = { due: this.now + ms, ms, tick };
    this.repeats.add(repeat);
    return () => { this.repeats.delete(repeat); };
  }

  advance(ms: number): void {
    const end = this.now + Math.max(0, ms);
    for (;;) {
      let next: { due: number; ms: number; tick: () => void } | null = null;
      for (const r of this.repeats) if (r.due <= end && (!next || r.due < next.due)) next = r;
      if (!next) break;
      this.now = next.due;
      next.due += next.ms;
      next.tick();
    }
    this.now = end;
  }

}

/** A notice a selection verb said, by key, in the live toast's tone. */
export interface SandboxNotice {
  key: TextKey;
  params?: Record<string, string | number>;
  tone: 'info' | 'warning';
}

/** The object layer's feedback a world's verbs play: a Help figure's view supplies it. */
interface SandboxFeedback {
  plop(id: string): void;
  poof(id: string): void;
  spin(id: string, fromDeg: number, toDeg: number): void;
  groupSpin(turn: GroupRotation): void;
}

const SILENT_FEEDBACK: SandboxFeedback = { plop: noop, poof: noop, spin: noop, groupSpin: noop };

/** One press of the map in progress: its plan and what its arms have started. */
interface MapPress {
  at: MacroCoord;
  touch: boolean;
  plan: PressPlan;
  /** The press has travelled, so its drag arms ran. */
  dragged: boolean;
  /** A waiting press's hold ran out, so its hold arms ran and its release is spent. */
  held: boolean;
  /** The band's first cell, while the press draws one. */
  band: MacroCoord | null;
  drag: WorldDrag | null;
  /** The press is a stroke of the tool. */
  tool: boolean;
  /** The press carries the armed item's preview, dropping it on release. */
  previewing: boolean;
}
/* ── end of the map's press ─────────────────────────────────────────────────────────────────── */
