/*
 * useRegionBrush.ts — the region-selection brush state machine for Generate.
 * While `selectingRegion` is on, it installs the window callbacks PixiCanvas
 * invokes on pointer move/up, accumulating buildable cells (brush/eraser/rect/
 * circle/line/curve over grass, skipping plaza/non-grass) into a mutable buffer
 * and committing to React state (`setGenRegion`) on pointer-up. Extracted from
 * App.tsx so the orchestrator stays an orchestrator. Behaviour is unchanged.
 *
 * OWNS THE REGION'S OWN UNDO/REDO too (`regionUndo`/`regionRedo`), a stack
 * separate from the map's command history: a painted region is a SCOPE for a
 * future generate, not a map edit, so it must never share the executor's undo
 * stack (see ui/keybindings/commands.ts, which routes Ctrl+Z here while
 * `selectingRegion` is on instead of touching the executor). One snapshot per
 * perceived action — a brush/eraser drag, a shape drag, the whole curve
 * 3-click sequence, or a Clear tap — never per cell, guarded by
 * `strokeActiveRef`. The stack lives on refs (not React state): it is read
 * only imperatively (from the keyboard command, outside render), and letting
 * it survive effect re-runs (which happen on every commit, since `genRegion`
 * is a dependency) is exactly what keeps a multi-move drag one entry.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../state/store';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { buildObjectOccupancy } from '../../state/object-geometry';
import { type MacroCoord } from '../../core/model/types';
import { rectCells, circleCells, lineCells, curveCells, snapShapeEnd } from '../../tools/paint/shapes';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { petitWindow } from '../../core/runtime/window-bridge';

export function useRegionBrush(
  selectingRegion: boolean,
  genRegion: MacroCoord[],
  setGenRegion: (cells: MacroCoord[]) => void,
) {
  // Collect coords in a mutable array during drag, only commit to React state on
  // pointerUp (via __petitRegionBrushDone).
  const brushCoordsRef = useRef<MacroCoord[]>([]);
  const brushSeenRef = useRef(new Set<string>());
  const regionAnchorRef = useRef<MacroCoord | null>(null);
  const regionShapeCellsRef = useRef<MacroCoord[]>([]);
  const regionCurvePointsRef = useRef<MacroCoord[]>([]);

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
    regionUndoStackRef.current.push([...genRegion]);
    regionRedoStackRef.current = [];
  }, [genRegion]);

  // Reset both the mid-shape/curve refs and the stroke-in-progress flag, so whatever
  // gesture was mid-flight is cleanly superseded rather than resuming into stale state.
  const resetInFlightGesture = useCallback(() => {
    regionAnchorRef.current = null;
    regionShapeCellsRef.current = [];
    regionCurvePointsRef.current = [];
    strokeActiveRef.current = false;
  }, []);

  useEffect(() => {
    const win = petitWindow();
    if (selectingRegion) {
      brushCoordsRef.current = [...genRegion];
      brushSeenRef.current = new Set(genRegion.map(c => `${c.x},${c.y}`));

      win.__petitRegionBrushCallback = (coord: MacroCoord) => {
        // One snapshot per stroke, taken before this move's mutation below — a drag
        // fires this many times, but beginRegionStroke is a no-op after the first.
        beginRegionStroke();

        const store = useEditorStore.getState();
        const tool = store.regionTool;
        const size = store.regionBrushSize;
        const showFn = win.__petitShowPreview;

        // Objects don't change during a region selection, so resolve the
        // occupied-cell set once per move instead of scanning all objects per cell.
        const gs = useEditorStore.getState().gridState;
        const occ = gs ? buildObjectOccupancy(gs) : null;
        const buildable = (cx: number, cy: number): boolean => {
          if (!gs) return true; // no map loaded → don't filter (unchanged behavior)
          const cell = getCell(gs.cells, cx, cy);
          return !!cell && isBuildableZone(cell.zone) && !occ!.has(`${cx},${cy}`);
        };

        if (tool === 'brush' || tool === 'eraser') {
          const half = Math.floor((size - 1) / 2);

          if (tool === 'eraser') {
            // Gather the dab's keys, drop them from the seen-set, then filter the
            // coord list ONCE (was an O(N) filter per erased cell).
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
                if (!buildable(cx, cy)) continue; // skip illegal cells
                const key = `${cx},${cy}`;
                if (brushSeenRef.current.has(key)) continue;
                brushSeenRef.current.add(key);
                brushCoordsRef.current.push({ x: cx, y: cy });
              }
            }
          }
          // Update overlay
          showFn?.(brushCoordsRef.current);
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
          showFn?.([...brushCoordsRef.current, ...previewCells]);
        } else {
          // rect/circle/line: anchor on first call, preview on drag
          if (!regionAnchorRef.current) {
            regionAnchorRef.current = coord;
          }
          let shapeCells: MacroCoord[] = [];
          const anchor = regionAnchorRef.current;
          const end = isConstrainHeld() && (tool === 'rect' || tool === 'circle' || tool === 'line')
            ? snapShapeEnd(anchor, coord, tool)
            : coord;
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
          // Filter out illegal cells (non-grass, plaza, beach)
          if (gs) shapeCells = shapeCells.filter(c => buildable(c.x, c.y));
          regionShapeCellsRef.current = shapeCells;
          showFn?.([...brushCoordsRef.current, ...shapeCells]);
        }
      };

      win.__petitRegionBrushDone = () => {
        const store = useEditorStore.getState();
        const tool = store.regionTool;

        if (tool === 'brush' || tool === 'eraser') {
          setGenRegion([...brushCoordsRef.current]);
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
            setGenRegion([...brushCoordsRef.current]);
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
          setGenRegion([...brushCoordsRef.current]);
          strokeActiveRef.current = false; // one drag = one undo entry, already pushed at its start
        }
      };
    } else {
      win.__petitRegionBrushCallback = null;
      win.__petitRegionBrushDone = null;
      // Leaving region-select mode discards the region's undo/redo — it must never fire
      // later, out of the context the user painted it in (see the file banner).
      regionUndoStackRef.current = [];
      regionRedoStackRef.current = [];
      resetInFlightGesture();
    }
    return () => {
      win.__petitRegionBrushCallback = null;
      win.__petitRegionBrushDone = null;
    };
  }, [selectingRegion, genRegion, setGenRegion, beginRegionStroke, resetInFlightGesture]);

  /** Reset the in-progress selection (used by the region panel's Clear button). A clear is
   *  itself an undoable region action — likely the one a misclick most wants back — so it
   *  pushes the same way a stroke does (skipped when already empty: nothing would change). */
  const clearRegion = useCallback(() => {
    if (genRegion.length > 0) {
      regionUndoStackRef.current.push([...genRegion]);
      regionRedoStackRef.current = [];
    }
    setGenRegion([]);
    brushCoordsRef.current = [];
    brushSeenRef.current.clear();
    resetInFlightGesture();
    petitWindow().__petitClearPreview?.();
  }, [genRegion, setGenRegion, resetInFlightGesture]);

  /**
   * Pop the region's own undo stack — see the file banner for why this is separate from
   * the map's command history. Returns false when there is nothing to undo, so the
   * keyboard command (ui/keybindings/commands.ts) can no-op instead of falling through to
   * a map edit: while region-select mode is on, Ctrl+Z means "undo region", full stop.
   */
  const regionUndo = useCallback((): boolean => {
    const stack = regionUndoStackRef.current;
    if (stack.length === 0) return false;
    const prev = stack.pop()!;
    regionRedoStackRef.current.push([...genRegion]);
    setGenRegion(prev);
    petitWindow().__petitShowPreview?.(prev); // the overlay only updates imperatively, never from React state
    resetInFlightGesture();
    return true;
  }, [genRegion, setGenRegion, resetInFlightGesture]);

  /** Mirror of `regionUndo` — see there for the empty-stack contract. */
  const regionRedo = useCallback((): boolean => {
    const stack = regionRedoStackRef.current;
    if (stack.length === 0) return false;
    const next = stack.pop()!;
    regionUndoStackRef.current.push([...genRegion]);
    setGenRegion(next);
    petitWindow().__petitShowPreview?.(next);
    resetInFlightGesture();
    return true;
  }, [genRegion, setGenRegion, resetInFlightGesture]);

  return { clearRegion, regionUndo, regionRedo };
}
