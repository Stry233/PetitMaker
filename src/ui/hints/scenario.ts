/*
 * Which hint scenario the editor is in. Pure and ordered: the first match wins, so the order IS
 * the specificity rule (an open curve session outranks the tool that opened it, a selection
 * outranks the brush it interrupted).
 */
import { ToolType, type DesignMode } from '../../core/model/types';

export type HintScenarioId =
  | 'curve-adjust' | 'curve-draw' | 'region' | 'span-placer' | 'placer'
  | 'selection-many' | 'selection-one' | 'selection-terrain' | 'eraser' | 'edge-cut' | 'build'
  | 'map-3d' | 'map-2d';

/** What the ONE selected block is, as far as the selection rows are concerned. 'inert' is a block
 *  that offers none of them: a LOCKED object (V-LOCK-02 refuses every edit they name) or a bare
 *  ground cell (nothing to remove). Null unless exactly one thing is selected. */
export type SingleSelectionKind = 'object' | 'terrain' | 'inert';

export interface HintFacts {
  /** The ACTIVE VIEW's own camera capability, never the store's `viewMode`: the 3D scene builds
   *  lazily, so the flag flips a frame or more before the view that answers a drag registers. */
  canOrbit: boolean;
  activeTool: ToolType;
  designMode: DesignMode;
  selectionCount: number;
  singleKind: SingleSelectionKind | null;
  armedItemId: string | null;
  /** The armed item carries a waterSpan or heightDrop trait (snaps its own position and rotation). */
  armedSpans: boolean;
  curveSessionOpen: boolean;
  selectingRegion: boolean;
}

export function resolveHintScenario(f: HintFacts): HintScenarioId {
  if (f.curveSessionOpen) return 'curve-adjust';
  if (f.activeTool === ToolType.TerrainBrush && f.designMode === 'curve') return 'curve-draw';
  if (f.selectingRegion) return 'region';
  if (f.activeTool === ToolType.ObjectPlacer && f.armedItemId) return f.armedSpans ? 'span-placer' : 'placer';
  if (f.selectionCount >= 2) return 'selection-many';
  // An inert single selection falls PAST the selection clauses: rows a selected thing cannot act
  // on are worse than the tool rows they displaced.
  if (f.selectionCount === 1 && f.singleKind === 'object') return 'selection-one';
  if (f.selectionCount === 1 && f.singleKind === 'terrain') return 'selection-terrain';
  if (f.activeTool === ToolType.Eraser) return 'eraser';
  if (f.activeTool === ToolType.EdgeCut) return 'edge-cut';
  if (f.activeTool === ToolType.TerrainBrush) return 'build';
  return f.canOrbit ? 'map-3d' : 'map-2d';
}
