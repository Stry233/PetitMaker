/**
 * The region-select brush: collects the cells a stroke paints into a buffer and commits the buffer
 * as the painted region when the stroke ends. A brush or eraser drag, a shape drag, a curve (the
 * brush's anchor chain: click to drop anchors, drag one to move it, double-click to finish) and a
 * grab of one figure each commit once, so each is one entry of the region's own history
 * (the store's region lane, never the map's command history).
 */
import { getCell } from '../../../core/model/grid-model';
import { isBuildableZone } from '../../../core/game/zones';
import type { GridState, MacroCoord } from '../../../core/model/types';
import type { RegionRequest, RegionTool } from '../../../state/editing/vocabulary';
import type { RegionBrushHandler } from './channel';
import { regionShapeCells } from '../paint/region-shape';
import { AnchorChain } from '../paint/gestures';
import { cellKey } from '../../../core/grid/rect';

/** What the brush reads and writes, supplied by the editor that mounts it. */
export interface RegionBrushPort {
  tool(): RegionTool;
  /** What the screen that armed region selection asks of the brush. */
  request(): RegionRequest;
  size(): number;
  /** Whether the constrain modifier is held, snapping a shape straight, square or round. */
  constrain(): boolean;
  grid(): GridState | null;
  /** The committed region. */
  region(): readonly MacroCoord[];
  /** Commits `cells` as the region, one entry on the region's history. */
  commit(cells: MacroCoord[]): void;
  /** Draws the region being built over the map. */
  show(cells: readonly MacroCoord[]): void;
  /** Draws the footprint the next press would paint, or clears it with an empty list. */
  ghost(cells: readonly MacroCoord[], eraser: boolean): void;
}

export interface RegionBrush extends RegionBrushHandler {
  /** The press in flight never happened: a curve keeps the anchors it had before it, every other
   *  stroke is dropped without a commit. */
  cancel(): void;
  /** Drops the stroke in flight and rereads the committed region, after it changed elsewhere. */
  resync(): void;
  /** Redraws the region with the stroke in flight. */
  redraw(): void;
}

/** A cell may be scoped when its ground is buildable; a scoped generation replaces what stands there. */
function holdsRegion(gs: GridState, x: number, y: number): boolean {
  const cell = getCell(gs.cells, x, y);
  return !!cell && isBuildableZone(cell.zone);
}

const key = (c: MacroCoord): string => cellKey(c.x, c.y);

/** The connected piece of `seen` that holds `start`, joined through the 8-neighbourhood. */
function pieceAt(start: MacroCoord, seen: ReadonlySet<string>): Set<string> {
  const piece = new Set<string>([key(start)]);
  const queue: MacroCoord[] = [start];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const next = { x: c.x + dx, y: c.y + dy };
        const k = key(next);
        if ((!dx && !dy) || piece.has(k) || !seen.has(k)) continue;
        piece.add(k);
        queue.push(next);
      }
    }
  }
  return piece;
}

export function createRegionBrush(port: RegionBrushPort): RegionBrush {
  let coords: MacroCoord[] = [];
  let seen = new Set<string>();
  let anchor: MacroCoord | null = null;
  let shape: MacroCoord[] = [];
  const chain = new AnchorChain();
  /** A curve press is down, and where the pointer last was: the release lands there. */
  let pressing = false;
  let last: MacroCoord | null = null;
  /** A grabbed figure: where it was picked up, its cells, and the rest of the region. */
  let moving: { from: MacroCoord; base: MacroCoord[]; rest: MacroCoord[] } | null = null;
  /** A stroke has started and not yet committed; a curve stays in one stroke across its clicks. */
  let stroking = false;

  const load = (cells: readonly MacroCoord[]) => {
    coords = [...cells];
    seen = new Set(cells.map(key));
  };
  const resetGesture = () => {
    anchor = null;
    shape = [];
    chain.clear();
    pressing = false;
    last = null;
    moving = null;
    stroking = false;
    port.ghost([], false);
  };
  const add = (cells: readonly MacroCoord[]) => {
    for (const c of cells) {
      if (seen.has(key(c))) continue;
      seen.add(key(c));
      coords.push(c);
    }
  };
  const commit = () => {
    stroking = false;
    port.commit([...coords]);
  };

  /** The anchors the curve runs through with the pointer at `coord`: a held anchor follows the
   *  pointer; otherwise the pointer is where the next anchor would drop. */
  const curveThrough = (coord: MacroCoord): readonly MacroCoord[] =>
    chain.length === 0 ? [] : chain.dragging ? chain.points : [...chain.points, coord];

  const footprint = (coord: MacroCoord, curve = curveThrough(coord)): MacroCoord[] => {
    const gs = port.grid();
    return regionShapeCells(port.tool(), coord, port.size(), {
      anchor, curve, constrain: port.constrain(), minSide: port.request().minSide,
      map: gs ? { w: gs.template.width, h: gs.template.height } : null,
    }).filter((c) => !gs || holdsRegion(gs, c.x, c.y));
  };

  const preview = (coord: MacroCoord) => port.ghost(footprint(coord), port.tool() === 'erase');

  const paint = (coord: MacroCoord) => {
    const tool = port.tool();
    // A shape press inside the region grabs the figure under it; judged before a single-figure reset.
    if (!stroking && (tool === 'rect' || tool === 'circle') && seen.has(key(coord)) && coords.length > 0) {
      const piece = pieceAt(coord, seen);
      moving = {
        from: coord,
        base: coords.filter((c) => piece.has(key(c))),
        rest: coords.filter((c) => !piece.has(key(c))),
      };
    }
    if (!stroking) {
      stroking = true;
      // Where the generator fills one figure, a new stroke replaces the region rather than adding to it.
      if (port.request().single && !moving) load([]);
    }
    if (moving) {
      const { from, base, rest } = moving;
      const gs = port.grid();
      load(rest);
      add(base
        .map((c) => ({ x: c.x + coord.x - from.x, y: c.y + coord.y - from.y }))
        .filter((m) => !gs || holdsRegion(gs, m.x, m.y)));
      port.show(coords);
      return;
    }
    if (tool === 'rect' || tool === 'circle' || tool === 'line') anchor ??= coord;
    if (tool === 'curve') {
      if (pressing) chain.move(coord); else chain.down(coord);
      pressing = true;
      last = coord;
    }
    const cells = footprint(coord);
    preview(coord);
    if (tool === 'erase') {
      const gone = new Set(cells.map(key));
      coords = coords.filter((c) => !gone.has(key(c)));
      for (const k of gone) seen.delete(k);
      port.show(coords);
    } else if (tool === 'free') {
      add(cells);
      port.show(coords);
    } else {
      shape = cells;
      port.show([...coords, ...cells]);
    }
  };

  const done = (time?: number) => {
    if (!stroking) return;
    const tool = port.tool();
    if (moving) {
      moving = null;
      commit();
      return;
    }
    if (tool === 'free' || tool === 'erase') { commit(); return; }
    if (tool === 'curve') {
      pressing = false;
      if (!last || chain.up(last, time) !== 'finish') return;
      shape = footprint(last, chain.points);
      chain.clear();
    }
    add(shape);
    shape = [];
    anchor = null;
    commit();
  };

  /** Drops the stroke in flight, standing curve anchors included, and rereads the committed region. */
  const abandon = () => {
    load(port.region());
    resetGesture();
    port.show(coords);
  };

  /** Redraws a standing curve through the anchors it has left, or abandons it when none is left. */
  const standCurve = () => {
    pressing = false;
    last = null;
    port.ghost([], false);
    const tip = chain.points[chain.length - 1];
    if (!tip) { abandon(); return; }
    shape = footprint(tip, chain.points);
    port.show([...coords, ...shape]);
  };

  const curveStanding = () => port.tool() === 'curve' && !moving && chain.length > 0;

  const cancel = () => {
    if (!curveStanding()) { abandon(); return; }
    chain.cancelPress();
    standCurve();
  };

  load(port.region());
  return {
    paint,
    preview,
    done,
    cancel,
    cancelPending: () => {
      if (!curveStanding()) return false;
      abandon();
      return true;
    },
    undoPendingStep: () => {
      if (!curveStanding()) return false;
      chain.undoStep();
      standCurve();
      return true;
    },
    clear: () => {
      load([]);
      resetGesture();
      port.show([]);
      port.commit([]);
    },
    resync: abandon,
    redraw: () => port.show([...coords, ...shape]),
  };
}
