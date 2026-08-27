/*
 * use-region-brush.ts — the region-selection brush state machine for Generate.
 * While `selectingRegion` is on, it registers on the region-brush channel
 * (core/runtime/region-brush) the pointer machine reports painted cells
 * through, accumulating buildable cells (brush/eraser/rect/circle/line/curve
 * over grass, skipping plaza/non-grass) into a mutable buffer and committing
 * to the store's `region` on pointer-up.
 *
 * OWNS THE REGION'S OWN UNDO/REDO too (`regionUndo`/`regionRedo`), a stack
 * separate from the map's command history: a painted region is a SCOPE for a
 * future generate, not a map edit, so it must never share the executor's undo
 * stack (see kit/commands.ts, which routes Ctrl+Z here while
 * `selectingRegion` is on instead of touching the executor). One snapshot per
 * perceived action — a brush/eraser drag, a shape drag, the whole curve
 * 3-click sequence, or a Clear tap — never per cell, guarded by
 * `strokeActiveRef`. The stack lives on refs (not React state): it is read
 * only imperatively (from the keyboard command, outside render), and letting
 * it survive effect re-runs (which happen on every commit, since the region
 * is a dependency) is exactly what keeps a multi-move drag one entry.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../state/store';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { type GridState, type MacroCoord } from '../../core/model/types';
import { rectCells, circleCells, lineCells, curveCells, snapShapeEnd } from '../../tools/paint';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { host } from '../../kit/host';
import { clampCentre, isRegionSingle, regionMinSide, setRegionBrushHandler, slideOnMap } from '../../core/runtime/region-brush';

/** Whether a cell may be part of a region: buildable ground, placements included — a scoped
 *  generation replaces what stands in its region, so a cell under an object is as scopeable as a
 *  bare one. ONE rule, read by every stroke and by Select all — two answers to "may this cell be
 *  scoped" would show up as a region whose own Select all painted cells its brush refuses. */
function holdsRegion(gs: GridState, x: number, y: number): boolean {
  const cell = getCell(gs.cells, x, y);
  return !!cell && isBuildableZone(cell.zone);
}

export function useRegionBrush(selectingRegion: boolean) {
  const region = useEditorStore((s) => s.region);
  const setRegion = useEditorStore((s) => s.setRegion);

  // Collect coords in a mutable array during drag, only commit to the store on
  // pointerUp (the channel's `done`).
  const brushCoordsRef = useRef<MacroCoord[]>([]);
  const brushSeenRef = useRef(new Set<string>());
  const regionAnchorRef = useRef<MacroCoord | null>(null);
  const regionShapeCellsRef = useRef<MacroCoord[]>([]);
  const regionCurvePointsRef = useRef<MacroCoord[]>([]);
  /** A grab of ONE FIGURE of the standing region: where it was picked up, the cells of the piece
   *  under the press, and the rest of the region, which stands still. The drag translates `base`;
   *  the release commits the remainder plus wherever the piece was carried. */
  const regionMoveRef = useRef<{ from: MacroCoord; base: MacroCoord[]; rest: MacroCoord[] } | null>(null);

  // The region's own undo/redo — see the file banner. `strokeActiveRef` marks a stroke
  // in progress so a drag's many move callbacks snapshot only once, at the start.
  const strokeActiveRef = useRef(false);
  const regionUndoStackRef = useRef<MacroCoord[][]>([]);
  const regionRedoStackRef = useRef<MacroCoord[][]>([]);

  // Push the pre-stroke region once per stroke (no-op on a repeat call while the same
  // stroke is still in progress). A fresh action always clears the redo stack, matching
  // the map history's own undo/redo contract.
  const beginRegionStroke = useCallback(() => {
    if (strokeActiveRef.current) return;
    strokeActiveRef.current = true;
    regionUndoStackRef.current.push([...region]);
    regionRedoStackRef.current = [];
    // ONE FIGURE, where the generator fills the region rather than reading it as an area: this stroke
    // replaces what was there instead of adding a second patch to it. Undo still has the old one,
    // pushed just above, so replacing is not losing.
    if (isRegionSingle()) {
      brushCoordsRef.current = [];
      brushSeenRef.current = new Set();
    }
  }, [region]);

  // Reset both the mid-shape/curve refs and the stroke-in-progress flag, so whatever
  // gesture was mid-flight is cleanly superseded rather than resuming into stale state.
  const resetInFlightGesture = useCallback(() => {
    regionAnchorRef.current = null;
    regionShapeCellsRef.current = [];
    regionCurvePointsRef.current = [];
    regionMoveRef.current = null;
    strokeActiveRef.current = false;
  }, []);

  /** Empty the selection, from the scope screen's own Clear. A clear is itself an undoable region
   *  action — likely the one a misclick most wants back — so it pushes the same way a stroke does
   *  (skipped when already empty: nothing would change). */
  const clearRegion = useCallback(() => {
    if (region.length > 0) {
      regionUndoStackRef.current.push([...region]);
      regionRedoStackRef.current = [];
    }
    setRegion([]);
    brushCoordsRef.current = [];
    brushSeenRef.current.clear();
    resetInFlightGesture();
    host.buildableRegion.clear();
  }, [region, setRegion, resetInFlightGesture]);

  useEffect(() => {
    if (!selectingRegion) {
      // Leaving region-select mode discards the region's undo/redo — it must never fire
      // later, out of the context the user painted it in (see the file banner).
      regionUndoStackRef.current = [];
      regionRedoStackRef.current = [];
      resetInFlightGesture();
      return;
    }

    brushCoordsRef.current = [...region];
    brushSeenRef.current = new Set(region.map(c => `${c.x},${c.y}`));

    const paint = (coord: MacroCoord) => {
      const store = useEditorStore.getState();
      const tool = store.regionTool;
      const size = store.regionBrushSize;

      /*
       * A SHAPE-TOOL PRESS INSIDE THE STANDING REGION GRABS THE FIGURE UNDER IT — the connected
       * piece the press landed on, not the whole selection: a region drawn as two rectangles is two
       * objects, and a grab moves the one being held while the other stands. The drag translates
       * the piece and the release commits where it was carried. Judged on the stroke's FIRST cell,
       * before the single-figure reset below can empty the very region being grabbed; the brush and
       * eraser keep their own meaning, since a dab inside the region is how a blob is grown and
       * trimmed. Pieces are joined through their 8-neighbourhood, so a one-cell diagonal stroke is
       * still one piece.
       */
      const firstOfStroke = !strokeActiveRef.current;
      if (
        firstOfStroke && (tool === 'rect' || tool === 'circle')
        && brushSeenRef.current.has(`${coord.x},${coord.y}`) && brushCoordsRef.current.length > 0
      ) {
        const all = brushCoordsRef.current;
        const inPiece = new Set<string>([`${coord.x},${coord.y}`]);
        const queue: MacroCoord[] = [coord];
        for (let q = 0; q < queue.length; q++) {
          const c = queue[q]!;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const k = `${c.x + dx},${c.y + dy}`;
              if (inPiece.has(k) || !brushSeenRef.current.has(k)) continue;
              inPiece.add(k);
              queue.push({ x: c.x + dx, y: c.y + dy });
            }
          }
        }
        regionMoveRef.current = {
          from: coord,
          base: all.filter((c) => inPiece.has(`${c.x},${c.y}`)),
          rest: all.filter((c) => !inPiece.has(`${c.x},${c.y}`)),
        };
      }

      // One snapshot per stroke, taken before this move's mutation below — a drag
      // fires this many times, but beginRegionStroke is a no-op after the first.
      beginRegionStroke();

      if (regionMoveRef.current) {
        const { from, base, rest } = regionMoveRef.current;
        const dx = coord.x - from.x, dy = coord.y - from.y;
        const gsm = useEditorStore.getState().gridState;
        const seen = new Set(rest.map((c) => `${c.x},${c.y}`));
        const next = [...rest];
        for (const c of base) {
          const m = { x: c.x + dx, y: c.y + dy };
          const k = `${m.x},${m.y}`;
          if (seen.has(k)) continue;   // carried onto another piece: the cells merge, never double
          if (gsm && !holdsRegion(gsm, m.x, m.y)) continue;
          seen.add(k);
          next.push(m);
        }
        brushCoordsRef.current = next;
        brushSeenRef.current = seen;
        host.buildableRegion.show(next);
        return;
      }

      const gs = useEditorStore.getState().gridState;
      const buildable = (cx: number, cy: number): boolean => (
        gs ? holdsRegion(gs, cx, cy) : true   // no map loaded → don't filter
      );

      if (tool === 'brush' || tool === 'eraser') {
        const half = Math.floor((size - 1) / 2);

        if (tool === 'eraser') {
          // Gather the dab's keys, drop them from the seen-set, then filter the
          // coord list ONCE rather than once per erased cell.
          const toDelete = new Set<string>();
          for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
              const key = `${coord.x - half + dx},${coord.y - half + dy}`;
              if (brushSeenRef.current.delete(key)) toDelete.add(key);
            }
          }
          if (toDelete.size > 0) {
            brushCoordsRef.current = brushCoordsRef.current.filter(c => !toDelete.has(`${c.x},${c.y}`));
          }
        } else {
          for (let dy = 0; dy < size; dy++) {
            for (let dx = 0; dx < size; dx++) {
              const cx = coord.x - half + dx;
              const cy = coord.y - half + dy;
              if (!buildable(cx, cy)) continue;
              const key = `${cx},${cy}`;
              if (brushSeenRef.current.has(key)) continue;
              brushSeenRef.current.add(key);
              brushCoordsRef.current.push({ x: cx, y: cy });
            }
          }
        }
        host.buildableRegion.show(brushCoordsRef.current);
      } else if (tool === 'curve') {
        // Curve uses 3-click pattern (not click-drag):
        // Click 1: start point, Click 2: control point, Click 3: end point
        regionAnchorRef.current = coord;
        let previewCells: MacroCoord[] = [];
        const pts = regionCurvePointsRef.current;
        if (pts.length === 0) {
          previewCells = [coord];
        } else if (pts.length === 1) {
          const e = isConstrainHeld() ? snapShapeEnd(pts[0]!, coord, 'line') : coord;
          previewCells = lineCells(pts[0]!, e, size);
        } else if (pts.length >= 2) {
          previewCells = curveCells(pts[0]!, pts[1]!, coord, size);
        }
        if (gs) previewCells = previewCells.filter(c => buildable(c.x, c.y));
        regionShapeCellsRef.current = previewCells;
        host.buildableRegion.show([...brushCoordsRef.current, ...previewCells]);
      } else {
        // rect/circle/line: anchor on first call, preview on drag
        if (!regionAnchorRef.current) {
          regionAnchorRef.current = coord;
        }
        let shapeCells: MacroCoord[] = [];
        let anchor = regionAnchorRef.current;
        let end = isConstrainHeld() && (tool === 'rect' || tool === 'circle' || tool === 'line')
          ? snapShapeEnd(anchor, coord, tool)
          : coord;
        /*
         * THE FLOOR IS HARD AT THE DRAG. With a minimum side declared (`setRegionMinSide`, the
         * picture generators), the extent clamps to it in the drag's own direction, so a figure
         * below the floor cannot be drawn at all — the preview never shrinks past it, which says
         * the limit without a refusal to read.
         *
         * AND IT GROWS THE OTHER WAY AT A MARGIN. Growing in the drag's own direction alone runs a
         * figure started near an edge off the map, where the cells are dropped and the region comes
         * back SHORT of the very floor that pushed it there — a drag that cannot reach the minimum
         * however far it is pulled. There is only one direction left at an edge, so the whole figure
         * slides back onto the map instead, keeping the size the floor asked for.
         */
        const floor = regionMinSide();
        if (floor !== null && (tool === 'rect' || tool === 'circle')) {
          const least = tool === 'rect' ? floor - 1 : Math.ceil((floor - 1) / 2);
          const grow = (from: number, to: number): number => {
            const d = to - from;
            if (Math.abs(d) >= least) return to;
            return from + (d < 0 ? -least : least);
          };
          const grown = { x: grow(anchor.x, end.x), y: grow(anchor.y, end.y) };
          const limit = gs ? { w: gs.template.width, h: gs.template.height } : null;
          if (!limit) {
            end = grown;
          } else if (tool === 'rect') {
            const slid = slideOnMap(anchor, grown, limit);
            anchor = slid.anchor;
            end = slid.end;
          } else {
            // A circle is drawn from its CENTRE, so what moves is the centre: far enough in that a
            // radius fits on both sides, or as far as the map allows when it cannot.
            const rx = Math.abs(grown.x - anchor.x), ry = Math.abs(grown.y - anchor.y);
            anchor = { x: clampCentre(anchor.x, rx, limit.w), y: clampCentre(anchor.y, ry, limit.h) };
            end = { x: anchor.x + rx, y: anchor.y + ry };
          }
        }
        switch (tool) {
          case 'rect':
            shapeCells = rectCells(anchor, end);
            break;
          case 'circle': {
            const rx = Math.abs(end.x - anchor.x);
            const ry = Math.abs(end.y - anchor.y);
            shapeCells = circleCells(anchor, rx, ry);
            break;
          }
          case 'line':
            shapeCells = lineCells(anchor, end, size);
            break;
        }
        if (gs) shapeCells = shapeCells.filter(c => buildable(c.x, c.y));
        regionShapeCellsRef.current = shapeCells;
        host.buildableRegion.show([...brushCoordsRef.current, ...shapeCells]);
      }
    };

    const done = () => {
      const store = useEditorStore.getState();
      const tool = store.regionTool;

      // A carried region lands where the drag left it. One undo entry, pushed when it was grabbed.
      if (regionMoveRef.current) {
        regionMoveRef.current = null;
        setRegion([...brushCoordsRef.current]);
        strokeActiveRef.current = false;
        return;
      }

      if (tool === 'brush' || tool === 'eraser') {
        setRegion([...brushCoordsRef.current]);
        strokeActiveRef.current = false; // one drag = one undo entry, already pushed at its start
      } else if (tool === 'curve') {
        // Curve: 3-click pattern. Each pointerUp adds the last coord as a point.
        const pts = regionCurvePointsRef.current;
        if (pts.length < 2) {
          // First or second click — store point and wait. The undo snapshot taken at
          // click 1 covers the WHOLE 3-click gesture, so strokeActiveRef stays true
          // (do not re-arm it: click 2/3 must not push a second snapshot).
          if (regionAnchorRef.current) {
            regionCurvePointsRef.current.push(regionAnchorRef.current);
          }
        } else {
          // Third click — commit the curve cells
          const cells = regionShapeCellsRef.current;
          for (const c of cells) {
            const key = `${c.x},${c.y}`;
            if (!brushSeenRef.current.has(key)) {
              brushSeenRef.current.add(key);
              brushCoordsRef.current.push(c);
            }
          }
          regionCurvePointsRef.current = [];
          regionShapeCellsRef.current = [];
          setRegion([...brushCoordsRef.current]);
          strokeActiveRef.current = false; // the 3-click curve gesture is now complete
        }
        regionAnchorRef.current = null;
      } else {
        // rect/circle/line: commit the shape cells
        const cells = regionShapeCellsRef.current;
        for (const c of cells) {
          const key = `${c.x},${c.y}`;
          if (!brushSeenRef.current.has(key)) {
            brushSeenRef.current.add(key);
            brushCoordsRef.current.push(c);
          }
        }
        regionShapeCellsRef.current = [];
        regionAnchorRef.current = null;
        setRegion([...brushCoordsRef.current]);
        strokeActiveRef.current = false; // one drag = one undo entry, already pushed at its start
      }
    };

    return setRegionBrushHandler({ paint, done, clear: clearRegion });
  }, [selectingRegion, region, setRegion, beginRegionStroke, resetInFlightGesture, clearRegion]);

  /**
   * Pop the region's own undo stack — see the file banner for why this is separate from
   * the map's command history. Returns false when there is nothing to undo, so the
   * keyboard command (kit/commands.ts) can no-op instead of falling through to
   * a map edit: while region-select mode is on, Ctrl+Z means "undo region", full stop.
   */
  const regionUndo = useCallback((): boolean => {
    const stack = regionUndoStackRef.current;
    if (stack.length === 0) return false;
    const prev = stack.pop()!;
    regionRedoStackRef.current.push([...region]);
    setRegion(prev);
    host.buildableRegion.show(prev); // the overlay only updates imperatively, never from React state
    resetInFlightGesture();
    return true;
  }, [region, setRegion, resetInFlightGesture]);

  /** Mirror of `regionUndo` — see there for the empty-stack contract. */
  const regionRedo = useCallback((): boolean => {
    const stack = regionRedoStackRef.current;
    if (stack.length === 0) return false;
    const next = stack.pop()!;
    regionUndoStackRef.current.push([...region]);
    setRegion(next);
    host.buildableRegion.show(next);
    resetInFlightGesture();
    return true;
  }, [region, setRegion, resetInFlightGesture]);

  return { clearRegion, regionUndo, regionRedo };
}
