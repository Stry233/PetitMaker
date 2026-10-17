import type { ToolType } from '../../../state/editing/vocabulary';
import type { HostedTool } from './host';
import type { ToolArming } from '../../../state/editing/arming';
import type { GridId } from '../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { holdsSelection, isBrushTool } from '../../../state/editing/edit-mode';
import { HandTool } from './hand';
import { DrawingTool } from '../paint/drawing-tool';
import { EraserTool } from '../paint/eraser';
import { ObjectPlacerTool } from '../objects/object-placer';
import { EdgeCutTool } from '../edge-cut/edge-cut-tool';
import { MacroTool } from '../macros/macro-tool';
import { AnnotateTool } from '../annotate/annotate-tool';

/** The editor's tool set, one fresh instance each; the Hand tool comes first, as a manager's
 *  initial tool. */
export function createTools(): HostedTool[] {
  return [
    new HandTool(), new DrawingTool(), new EraserTool(), new ObjectPlacerTool(),
    new EdgeCutTool(), new MacroTool(), new AnnotateTool(),
  ];
}

/** What each tool declares about itself, read from one instance per tool and never from its
 *  state; built once per page on first ask. */
let declared: ReadonlyMap<ToolType, HostedTool> | null = null;

/** What the tool of `type` declares, for a caller that knows the store's tool type rather than a
 *  live tool: whether a selection may stand while it is up and whether it is a terrain brush (both
 *  the store's facts, `state/editing/edit-mode.ts`), whether an arming puts it in the map's
 *  select mode, and the grid its cells lie on under an arming. */
export interface ToolDeclaration {
  holdsSelection: boolean;
  brush: boolean;
  selectMode(arming: ToolArming): boolean;
  grid(arming: ToolArming): GridId;
}

export function toolDeclares(type: ToolType): ToolDeclaration {
  declared ??= new Map(createTools().map((tool) => [tool.id, tool]));
  const tool = declared.get(type);
  return {
    holdsSelection: holdsSelection(type),
    brush: isBrushTool(type),
    selectMode: (arming) => tool?.selectMode?.(arming) === true,
    grid: (arming) => tool?.grid({ arming }) ?? PLACEMENT_GRID,
  };
}
