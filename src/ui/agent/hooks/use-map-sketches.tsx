/*
 * Sketch suggestions for an idle panel, recomputed once map edits have been quiet for a moment.
 * A picked sketch is handed to the composer as a fill, never sent.
 */
import { useCallback, useState, type ReactNode } from 'react';
import type { GridState } from '../../../core/model/types';
import { useSettledRevision } from '../../session/use-map-derived';
import { useVersioned } from '../../primitives/use-versioned';
import { Sketchbook } from '../sketchbook/Sketchbook';
import { proposeSketches } from '../sketchbook/propose';

/** Debounce before recomputing map sketch suggestions, in ms. */
const MAP_QUIET_MS = 400;

export function useMapSketches(grid: GridState | null | undefined, want: boolean): {
  sketchbook?: ReactNode;
  fill?: { text: string; seq: number };
} {
  const settledEpoch = useSettledRevision(grid, MAP_QUIET_MS);
  // A replacement grid must recompute even when its version counters match.
  const sketches = useVersioned(() => (want && grid ? proposeSketches(grid) : []), [want, grid, settledEpoch]);

  const [fill, setFill] = useState<{ text: string; seq: number } | undefined>(undefined);
  const handOrder = useCallback((text: string) => {
    setFill((last) => ({ text, seq: (last?.seq ?? 0) + 1 }));
  }, []);
  return {
    ...(sketches.length > 0 ? { sketchbook: <Sketchbook ideas={sketches} onOrder={handOrder} mapVersion={settledEpoch} /> } : {}),
    ...(fill ? { fill } : {}),
  };
}
