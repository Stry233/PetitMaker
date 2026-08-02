/*
 * Which editing modes can select, and which paint.
 *
 * Pure functions of the active tool, read by the press resolver, the pointer machine, the hover
 * preview and the store subscription that drops a selection the current tool cannot hold. One
 * owner, because a press that selects and a cursor that promises a selection must agree.
 */
import { ToolType } from '../model/types';

/**
 * Modes where an UNMODIFIED click selects whatever is under it (and a press on the already-selected
 * object arms a drag): the Hand tool, and the object placer with nothing armed.
 */
export function inSelectMode(activeTool: ToolType, selectedItemId: string | null): boolean {
  return activeTool === ToolType.Hand
    || (activeTool === ToolType.ObjectPlacer && !selectedItemId);
}

/**
 * Modes where a selection can EXIST. Wider than `inSelectMode`: with an item armed, the multi-select
 * modifier still selects and a click on an existing object selects it for an ad-hoc rotate or
 * delete, so the placer keeps a selection armed or not. The paint tools cannot select, so they drop
 * it.
 */
export function canHoldSelection(activeTool: ToolType): boolean {
  return activeTool === ToolType.Hand || activeTool === ToolType.ObjectPlacer;
}

/**
 * The terrain-editing tools: a build brush (mountain/river/tile), the eraser, and the edge cutter.
 * None of these can hold a selection, but the multi-select modifier reaches the selection path from
 * them exactly as it does from an armed placer.
 */
export function isBrushTool(activeTool: ToolType): boolean {
  return activeTool === ToolType.TerrainBrush || activeTool === ToolType.Eraser || activeTool === ToolType.EdgeCut;
}
