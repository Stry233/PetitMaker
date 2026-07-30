/*
 * design-mode.ts — the editor's drawing-mode vocabulary + its mapping to tools. It stands on its
 * own, not inside a panel, so any surface that offers drawing modes shares one definition of what
 * the modes are and which tool implements each.
 */
import { ToolType, type DesignMode } from '../../core/model/types';

// DesignMode is declared in core/model/types (sibling to ToolType) so state/store can reference it
// without an inverted state->ui dependency. Re-exported here so UI callers can take it from the
// module that also owns the tool mapping.
export type { DesignMode };

/** A design mode's implementing tool plus, for the modes that appear as Build-panel
 *  tiles, their icon basename + i18n label key. */
export interface ToolDef { toolType: ToolType; icon?: string; labelKey?: string; }

/**
 * The editor's tool vocabulary — the ONE place a design mode's tool mapping and
 * presentation are declared. designModeToToolType and the BuildPanel tile list
 * both derive from this, so adding a mode is a single registry entry (plus its
 * BuildPanel layout coords) rather than a switch case + a separate UI array.
 *
 * The five shape modes (brush/line/curve/rect/circle) all map to ToolType.TerrainBrush
 * — DrawingTool multiplexes the shape internally, so the mode→tool relation is
 * intentionally many-to-one. 'hand' has no Build tile (it is its own phone tile),
 * so it carries no icon/label.
 */
export const TOOL_DEFS: Record<DesignMode, ToolDef> = {
  brush:      { toolType: ToolType.TerrainBrush, icon: 'brush-free',   labelKey: 'design.free_brush' },
  line:       { toolType: ToolType.TerrainBrush, icon: 'brush-line',   labelKey: 'design.line_brush' },
  curve:      { toolType: ToolType.TerrainBrush, icon: 'brush-curve',  labelKey: 'design.curve_brush' },
  rect:       { toolType: ToolType.TerrainBrush, icon: 'brush-rect',   labelKey: 'design.rect_brush' },
  circle:     { toolType: ToolType.TerrainBrush, icon: 'brush-circle', labelKey: 'design.circle_brush' },
  'edge-cut': { toolType: ToolType.EdgeCut,      icon: 'edge-cut',     labelKey: 'design.edge_cut' },
  eraser:     { toolType: ToolType.Eraser,       icon: 'eraser',       labelKey: 'design.eraser' },
  hand:       { toolType: ToolType.Hand },
};

/** Map a UI design mode to the tool that implements it. */
export function designModeToToolType(mode: DesignMode): ToolType {
  return TOOL_DEFS[mode].toolType;
}
