/** check_build: the faults of what stands in an area that can be found without judgment. */
import { clamp } from '../../core/base/math';
import { auditBuild } from './audit';
import { corners } from './geometry';
import { obj } from './schema';
import { defineTool } from './spec';

/** The one read that answers "what would a careful builder still fix here" by computation (`audit.ts`). */
export const checkBuildTool = defineTool({
  description: 'Check what stands in the rectangle x1,y1,x2,y2 for faults a careful builder would fix, found by computation, not by looking: '
    + 'a door with no path, a path cut off or leading nowhere, water left in two pieces, sides meant to match that do not '
    + '(objects, paving, water and raised ground alike), a row with uneven gaps, planting off-centre on its bed. '
    + 'Each finding names the cells. Call it once when a part is built, before you move on, while a fix is still one step.',
  input: obj(corners),
  access: 'read',
  example: 'x1: 104, y1: 60, x2: 137, y2: 86',
  run(deps, input) {
    const state = deps.getState();
    // The audit walks every cell of its box, so the box is cut to the map.
    const cx = (v: number): number => clamp(v, 0, state.template.width - 1);
    const cy = (v: number): number => clamp(v, 0, state.template.height - 1);
    const box = {
      x1: cx(Math.min(input.x1, input.x2)), y1: cy(Math.min(input.y1, input.y2)),
      x2: cx(Math.max(input.x1, input.x2)), y2: cy(Math.max(input.y1, input.y2)),
    };
    const found = auditBuild(state, box);
    return { isError: false, content: found.length === 0 ? 'No fault found: the paths join up and what is meant to match does.' : found.join('\n') };
  },
});
