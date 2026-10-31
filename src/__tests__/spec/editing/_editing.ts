/**
 * The editor's pointer over a spec world: the live tool set behind its tool manager, armed as the
 * bar arms it, pressed, dragged and released at cells, and heard through the toasts a person reads
 * (in English). A cell is pressed at its centre on the grid the active tool reads; the view is
 * headless and puts each screen point on the same map point unless a test hands in a view of its own.
 */
import { ToolManager, type EditorView, type ToolOverlay, type ViewProjection } from '../../../tools/pointer/runtime';
import { CurveSessions } from '../../../tools/pointer/paint';
import { ObjectDragSession } from '../../../tools/pointer/objects';
import { ToolType } from '../../../state/editing/vocabulary';
import type { ToolArming } from '../../../state/editing/arming';
import type { BlockRef } from '../../../state/selection';
import { GRIDS } from '../../../core/game/profile';
import { gridCellCentre, mapPoint, type MapPoint } from '../../../core/grid/grids';
import type { MacroCoord, PlacedObject, Refusal, Rotation, TerrainCell } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { hasHalfStep, snapsOwnPlacement } from '../../../state/object-geometry';
import { translateFor } from '../../../i18n/context';
import type { TextKey } from '../../../i18n/keys';
import { testArming } from '../../_support/tool-ctx';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { SpecWorld } from '../_world';

const noop = (): void => {};

/** An overlay that draws nothing and answers every request. */
const overlay = new Proxy({} as ToolOverlay, { get: () => noop });
const editorView = (view: AimedView): EditorView => ({ projection: view.projection, overlay, ...headlessViewVerbs() });

/** A view's projection with the way to aim at a map point through it: the screen point a person
 *  puts the pointer on to reach map point `p`. */
export interface AimedView {
  projection: ViewProjection;
  aim(p: MapPoint): { x: number; y: number };
}

/** The screen as the map: screen point (sx, sy) is map point (sx, sy), a cell 32 px across. */
const FLAT: AimedView = {
  projection: { screenToPoint: (sx, sy) => mapPoint({ x: sx, y: sy }), cellToScreen: (x, y) => ({ x, y, scale: 32 }) },
  aim: (p) => p,
};

/** Releases fall this far apart unless a double click is asked for: past the double-click window. */
const CLICK_GAP_MS = 1000;

export class Pointer {
  readonly manager: ToolManager;
  /** Every toast the tools raised, in English. */
  readonly toasts: string[] = [];
  /** The held modifiers: constrain (Shift) and multi-select (Ctrl). */
  readonly held = { constrain: false, multiSelect: false };
  readonly curve = new CurveSessions();
  private arming: ToolArming;
  private clock = 0;
  private view: AimedView;

  constructor(readonly world: SpecWorld, arming: Partial<ToolArming> = {}, view: AimedView = FLAT) {
    this.arming = testArming(arming);
    this.view = view;
    const held = this.held;
    this.manager = new ToolManager(editorView(view), world.sandbox.executor, world.state, {
      arming: () => this.arming,
      t: (key: TextKey, params?: Record<string, string | number>) => translateFor('en', key, params as never),
      notify: (text) => { this.toasts.push(text); },
      modifiers: { get constrain() { return held.constrain; }, get multiSelect() { return held.multiSelect; } },
      curve: this.curve,
    });
    this.manager.syncArming();
  }

  /** Change what the bar arms, as picking a tool, shape, surface or layer does. */
  arm(patch: Partial<ToolArming>): void {
    this.arming = { ...this.arming, ...patch };
    this.manager.syncArming();
  }

  /** Bring another view on screen, as switching between the 2D and 3D views does. */
  showView(view: AimedView): void {
    this.view = view;
    this.manager.setView(editorView(view));
  }

  /** The screen point over the centre of cell `c` on the active tool's grid. */
  private at(c: MacroCoord): { x: number; y: number } {
    const tool = this.manager.getActiveTool();
    return this.view.aim(mapPoint(gridCellCentre(GRIDS[tool.grid(this.manager.getContext())], c)));
  }

  press(c: MacroCoord): void { const p = this.at(c); this.manager.handlePointerDown(p.x, p.y, this.clock); }
  move(c: MacroCoord): void { const p = this.at(c); this.manager.handlePointerMove(p.x, p.y, this.clock); }
  release(c: MacroCoord): void {
    this.clock += CLICK_GAP_MS;
    const p = this.at(c);
    this.manager.handlePointerUp(p.x, p.y, this.clock);
  }

  /** A press lost before its release: a second touch, or the browser taking the pointer. */
  cancel(): void { this.manager.handlePointerCancel(); }

  /** Press at the first cell, travel through the rest, release at the last. */
  drag(...path: MacroCoord[]): void {
    const [first, ...rest] = path;
    if (!first) return;
    this.press(first);
    for (const c of rest) this.move(c);
    this.release(rest[rest.length - 1] ?? first);
  }

  click(c: MacroCoord): void { this.press(c); this.release(c); }

  /** Two clicks on one cell inside the double-click window. */
  doubleClick(c: MacroCoord): void {
    this.click(c);
    const p = this.at(c);
    this.manager.handlePointerDown(p.x, p.y, this.clock);
    this.clock += 100;
    this.manager.handlePointerUp(p.x, p.y, this.clock);
  }

  /** Escape, as the command keys hand it to the tool's pending gesture. */
  escape(): boolean { return this.manager.getActiveTool().cancelPending?.(this.manager.getContext()) ?? false; }

  /** Delete or Backspace while a gesture is pending. */
  deleteStep(): boolean { return this.manager.getActiveTool().undoPendingStep?.(this.manager.getContext()) ?? false; }
}

/** A pointer armed with the terrain brush on `world`. */
export function brush(world: SpecWorld, arming: Partial<ToolArming> = {}, view?: AimedView): Pointer {
  return new Pointer(world, { tool: ToolType.TerrainBrush, ...arming }, view);
}

/** A pointer armed with the eraser on `world`. */
export function eraser(world: SpecWorld, arming: Partial<ToolArming> = {}): Pointer {
  return new Pointer(world, { tool: ToolType.Eraser, ...arming });
}

/** Lock or unlock a layer (by its elevation) on the world's map, as the layer panel's lock does
 *  (`state/slices/edit.ts:setLayerLocked`): the map owns its locks. */
export const setLayerLocked = (w: SpecWorld, elevation: number, locked: boolean): void => w.lockLayer(elevation, locked);

/** The terrain at a cell as drawn, corners included; null for bare ground. */
export function terrainCell(world: SpecWorld, c: MacroCoord): TerrainCell | null {
  return world.state.cells[c.y]?.[c.x]?.terrain ?? null;
}

/** Every placed object of one catalog item. */
export function objectsOf(world: SpecWorld, catalogId: string): PlacedObject[] {
  return [...world.state.objects.values()].filter((o) => o.catalogId === catalogId);
}

/** Drag-to-move as the map's pointer machine drives it, over `selection`: grab `id` at map point
 *  `from`, drop at `to`. Returns the refusal the drop reported, if any. */
export function dragObject(world: SpecWorld, selection: readonly string[], id: string, from: MapPoint, to: MapPoint): Refusal | null {
  let reported: Refusal | null = null;
  let selected: BlockRef[] = selection.map((s) => ({ kind: 'object', id: s }));
  const session = new ObjectDragSession({
    state: () => world.state,
    executor: () => world.sandbox.executor,
    selection: () => selected,
    setSelection: (blocks) => { selected = blocks; },
    report: (refusal) => { reported = refusal ?? null; },
    notify: noop,
    t: (key) => key,
  });
  const view = { overlay, plopObject: noop };
  session.begin(id, from, from);
  session.preview(view, to);
  session.commit(view, to);
  return reported;
}

/** Map point (x, y), for a pointer read at a sub-cell position. */
export const pointAt = (x: number, y: number): MapPoint => mapPoint({ x, y });

/** The cells among `cells` that hold terrain or water, as `x,y` keys. */
export function heldCells(world: SpecWorld, cells: readonly MacroCoord[]): Set<string> {
  return new Set(cells.filter((c) => world.state.cells[c.y]?.[c.x]?.terrain).map((c) => `${c.x},${c.y}`));
}

/** A w-by-h block of mountain built to `elevation` with one rectangle of the brush, top-left at `at`. */
export function plateau(world: SpecWorld, at: MacroCoord, w: number, h: number, elevation: number): void {
  brush(world, { shape: 'rect', floor: elevation }).drag(at, { x: at.x + w - 1, y: at.y + h - 1 });
}

/** The cell a person points at to lay `item`, turned by `rotation`, with its footprint's top-left
 *  cell at `c`: the footprint's centre cell, left of or above the middle on an even side (EDIT-51).
 *  A bridge or ramp is aimed by the gap or cliff, so it is pointed at `c` itself. A halfStep item
 *  that does not snap (the station, a landmark) centres on a half point, which a cell centre cannot
 *  name, so it is refused here. */
export function heldCell(item: string, c: MacroCoord, rotation: Rotation = 0): MacroCoord {
  const it = getCatalogItem(item);
  if (!it || snapsOwnPlacement(it)) return c;
  if (hasHalfStep(it)) throw new Error(`heldCell covers items laid on whole cells; ${item} centres on a half point`);
  const turned = it.rotatable && (rotation === 90 || rotation === 270);
  const w = turned ? it.height : it.width, h = turned ? it.width : it.height;
  return { x: c.x + Math.floor((w - 1) / 2), y: c.y + Math.floor((h - 1) / 2) };
}

/** Click `item` onto the map with the object placer so its footprint's top-left lands on cell `c`, as
 *  a person does with its card armed; the object that landed, or null when the placement was refused. */
export function placeItem(world: SpecWorld, item: string, c: MacroCoord, arming: Partial<ToolArming> = {}): PlacedObject | null {
  const before = new Set(world.state.objects.keys());
  new Pointer(world, { tool: ToolType.ObjectPlacer, armedItem: item, ...arming }).click(heldCell(item, c, arming.placementRotation));
  return [...world.state.objects.values()].find((o) => !before.has(o.id)) ?? null;
}

/** The map as a person sees it, as one comparable string (`SpecWorld.fingerprint`). */
export const picture = (w: SpecWorld): string => w.fingerprint();
