/** The generate shelf's view of the maze's two ends (`editor/editing/maze-ends.ts`). */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GridState, MacroCoord } from '../../../../core/model/types';
import type { ResolvedMazeGates } from '../../../../tools/generation/recipe';
import { createMazeEnds } from '../../../../editor/editing/maze-ends';
import type { EndId, MazeEnds } from './MazeEndpoints';

export interface MazeEndsState {
  /** The session itself, which the shelf's batch reads its gates from and tells of a landed run. */
  session: ReturnType<typeof createMazeEnds>;
  /** Whether the visitor chooses the ends; off, the generator picks its own pair. */
  customEnds: boolean;
  /** The gates every run of the batch receives, or null where the generator picks them. */
  gates: ResolvedMazeGates | null;
  /** The marks to draw over the map, a drag in progress included. */
  shown: MazeEnds | null;
  showWay: boolean;
  setShowWay: (on: boolean) => void;
  /** Turns choosing the ends on, adopting a landed run's pair, or off with the way switch. */
  toggleEnds: () => void;
  /** A mark moved; a drop writes the setting and, where a run stands, re-lands it with the new pair. */
  moveEnd: (which: EndId, cell: MacroCoord, dropped: boolean, reland: (gates: ResolvedMazeGates) => void) => void;
}

/** `scope` is the painted region or null for the whole map. */
export function useMazeEnds(maze: boolean, gridState: GridState | null, scope: MacroCoord[] | null, corridorWidth: number): MazeEndsState {
  const [ends] = useState(createMazeEnds);
  useSyncExternalStore(ends.subscribe, ends.version);
  useEffect(() => ends.start(), [ends]);
  const view = ends.view({ maze, gridState, scope, corridorWidth });
  return {
    ...view, session: ends,
    setShowWay: ends.setShowWay, toggleEnds: ends.toggleEnds, moveEnd: ends.moveEnd,
  };
}
