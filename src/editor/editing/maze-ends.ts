/*
 * The maze's two ends as recipe settings: the visitor's marks, the pair a landed run opened, and the
 * way between them drawn over the map. The marks are the visitor's own cells: a run opens its gates
 * at them and never moves them, a dropped mark re-lands a standing run with the new pair, and the
 * way drape follows the run's own walk on the terrain grid where the corridor floors are.
 */
import { TERRAIN_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import type { GridState, MacroCoord } from '../../core/model/types';
import type { ResolvedMazeGates } from '../../tools/generation/recipe';
import type { MazeEnd } from '../../tools/generation/maze';
import { host } from '../host/host';
import type { Outcome } from '../operations';
import { defaultGatesOn, mazeFootprintOn, mazeMarks, snapMazeEnd, type MazeMarks } from './generate-batch';

export type MazeEndId = 'entrance' | 'exit';

/** What the shelf draws and asks with this render. */
export interface MazeEndsView {
  /** Whether the visitor chooses the ends; off, the generator picks its own pair. */
  customEnds: boolean;
  /** The gates every run of the batch receives, or null where the generator picks them. */
  gates: ResolvedMazeGates | null;
  /** The marks to draw over the map, a drag in progress included. */
  shown: MazeMarks | null;
  showWay: boolean;
}

/** `scope` is the painted region or null for the whole map. */
export interface MazeEndsInputs { maze: boolean; gridState: GridState | null; scope: MacroCoord[] | null; corridorWidth: number }

export interface MazeEndsController {
  subscribe(listener: () => void): () => void;
  /** Changes whenever the settings do. */
  version(): number;
  /** The view for this render's inputs; the marks re-derive from the grid edited in place. */
  view(inputs: MazeEndsInputs): MazeEndsView;
  setShowWay(on: boolean): void;
  /** Turns choosing the ends on, adopting a landed run's pair, or off with the way switch. */
  toggleEnds(): void;
  /** A mark moved; a drop writes the setting and, where a run stands, re-lands it with the new pair. */
  moveEnd(which: MazeEndId, cell: MacroCoord, dropped: boolean, reland: (gates: ResolvedMazeGates) => void): void;
  /** What a landed run reported about the maze now on the map. */
  landed(outcome: Outcome): void;
  /** The maze on the map is gone (Clear). */
  forgetLanded(): void;
  cancelDrag(): void;
  /** Starts drawing the way; returns the stop, which takes the drape down. */
  start(): () => void;
}

export function createMazeEnds(): MazeEndsController {
  let customEnds = false;
  let chosen: ResolvedMazeGates | null = null;
  let showWay = false;
  let landedGates: ResolvedMazeGates | null = null;
  let walk: MacroCoord[] | null = null;
  let dragging: { which: MazeEndId; end: MazeEnd } | null = null;
  let version = 0;
  let started = false;
  let draped = false;
  const listeners = new Set<() => void>();
  let footprint: { key: readonly unknown[]; value: ReturnType<typeof mazeFootprintOn> } | null = null;
  let last: { inputs: MazeEndsInputs; view: MazeEndsView } | null = null;

  const drape = () => {
    if (!started) return;
    if (!showWay || !walk || walk.length === 0) { host.route.clear(); draped = false; return; }
    host.route.show(cellSet(TERRAIN_GRID, walk));
    draped = true;
  };
  const changed = () => {
    version += 1;
    drape();
    for (const listener of [...listeners]) listener();
  };

  function footprintOf({ maze, gridState, scope, corridorWidth }: MazeEndsInputs) {
    const key = [maze, gridState, scope, corridorWidth];
    if (!footprint || footprint.key.some((v, i) => !Object.is(v, key[i]))) {
      footprint = { key, value: maze ? mazeFootprintOn(gridState, scope, corridorWidth) : null };
    }
    return footprint.value;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
    view(inputs) {
      const fp = footprintOf(inputs);
      const gates = inputs.maze && customEnds ? (chosen ?? (fp ? defaultGatesOn(fp) : null)) : null;
      const marks = gates && fp && inputs.gridState ? mazeMarks(inputs.gridState, fp, gates) : null;
      const shown = marks && dragging ? { ...marks, [dragging.which]: dragging.end } : marks;
      const view = { customEnds, gates, shown, showWay };
      last = { inputs, view };
      return view;
    },
    setShowWay(on) { showWay = on; changed(); },
    toggleEnds() {
      if (customEnds) { customEnds = false; showWay = false; changed(); return; }
      if (landedGates) chosen = landedGates;
      customEnds = true;
      changed();
    },
    moveEnd(which, cell, dropped, reland) {
      const shown = last?.view.shown;
      if (!last || !shown) return;
      const to = snapMazeEnd(last.inputs.scope, last.inputs.corridorWidth, cell);
      if (!to) return;
      if (!dropped) { dragging = { which, end: to }; changed(); return; }
      dragging = null;
      const moved: ResolvedMazeGates = {
        entrance: which === 'entrance' ? to.cell : shown.entrance?.cell ?? null,
        exit: which === 'exit' ? to.cell : shown.exit?.cell ?? null,
      };
      chosen = moved;
      changed();
      reland(moved);
    },
    landed(outcome) {
      const maze = outcome.detail?.kind === 'maze' ? outcome.detail : null;
      landedGates = maze?.gates ?? null;
      walk = maze?.walk ?? null;
      changed();
    },
    forgetLanded() { landedGates = null; walk = null; changed(); },
    cancelDrag() { dragging = null; changed(); },
    start() {
      started = true;
      drape();
      return () => {
        if (draped) host.route.clear();
        draped = false;
        started = false;
      };
    },
  };
}
