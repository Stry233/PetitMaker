/** lay_route: one path between two points, across levels and water, as the editor's own route tool lays it. */
import type { EditContext } from '../../core/commands/edit-context';
import { isCrossing } from '../../core/model/traits';
import { regionBounds } from '../../core/grid/rect';
import { getCatalogItem, getRoadMaterials } from '../../state/catalog';
import { layRoadLink } from '../../tools/macros';
import { argError } from './feedback';
import { corners } from './geometry';
import { int, obj, str } from './schema';
import { defineTool } from './spec';
import { runStrokeBody } from './stroke';

/** The seed of every route: the same two points give the same path. */
const ROUTE_SEED = 0x726f7574;

/**
 * A path that arrives: from one point to another over whatever lies between, with a stair or ramp at
 * each change of level and a bridge over water, or nothing at all. Raised ground and water stop being
 * reasons to stay on the flat.
 */
export const layRouteTool = defineTool({
  description: 'Lay one path from (x1,y1) to (x2,y2) across whatever lies between, in one step: it climbs each change of level with a stair or ramp, '
    + 'crosses water with a bridge, goes round what stands in the way and meets standing pavement squarely. A point on a building means its door. '
    + 'It connects the two points or lays nothing and says where it stopped. Use it for each stretch of the main route, giving the places it should '
    + 'pass as the ends of successive calls, and for the path to each door, so that every level and every door is reached.',
  input: obj({
    ...corners,
    catalogId: str({ description: 'The paving, a road id from the CATALOG (default: the map\'s main paving).' }),
    width: int({ min: 1, max: 3, description: 'Cells wide (default 1).' }),
  }),
  access: 'write',
  example: 'x1: 60, y1: 100, x2: 84, y2: 40, width: 2',
  async run(deps, input) {
    const { catalogId, width } = input;
    if (catalogId !== undefined && !getRoadMaterials().some((road) => road.id === catalogId)) {
      return argError(`"${catalogId}" is not a paving; use a road id from the CATALOG section.`);
    }
    const state = deps.getState();
    const exec = deps.getExecutor();
    const kit: EditContext = { state, executor: exec, registry: exec.getRegistry() };
    const region = deps.getRegion();
    const before = new Set(state.objects.keys());
    const stroke = await runStrokeBody(deps, 'the route', () => layRoadLink(kit, {
      seed: ROUTE_SEED, from: { x: input.x1, y: input.y1 }, to: { x: input.x2, y: input.y2 },
      ...(catalogId !== undefined ? { material: catalogId } : {}), ...(width !== undefined ? { width } : {}),
      ...(region.length > 0 ? { region } : {}),
    }));
    if ('refusal' in stroke) return stroke.refusal;
    const { laid, report } = stroke.result;
    if (laid === 0) {
      const at = report.at ? ` It stopped at (${report.at.x},${report.at.y}).` : '';
      const why = report.code === 'blocked' ? 'what stands on the only line through blocks it'
        : report.code === 'door-unreachable' ? 'the path could not reach the door'
          : report.code === 'unjoined' ? 'the path could not be joined into one piece'
            : 'no route exists between these points: the water may be too wide for a bridge, or a step in the ground more than a ramp climbs';
      const blocked = report.blocked?.length ? ` In the way: ${report.blocked.slice(0, 6).map((c) => `(${c.x},${c.y})`).join(' ')}.` : '';
      return { isError: true, content: `No route was laid: ${why}.${at}${blocked} Nothing was changed. Choose ends on open ground, or shape the ground so a single step separates the levels.` };
    }
    const crossings = [...state.objects.values()].filter((o) => !before.has(o.id) && isCrossing(getCatalogItem(o.catalogId)))
      .map((o) => `${o.catalogId} at (${o.position.x},${o.position.y})`);
    const ends = report.ends ? ` from (${report.ends[0].x},${report.ends[0].y}) to (${report.ends[1].x},${report.ends[1].y})` : '';
    // Where the band actually lies: a width centred on the ends' cells lands half a cell off for an
    // even width, and briefs written from the intended line instead of this miss by a cell or two.
    const laidCells = [...state.objects.values()].filter((o) => !before.has(o.id) && !isCrossing(getCatalogItem(o.catalogId)));
    const paved = regionBounds(laidCells.map((o) => o.position));
    const span = paved ? ` Its paving covers x ${paved.x1}..${paved.x2}, y ${paved.y1}..${paved.y2}.` : '';
    return {
      isError: false,
      content: `Laid the route${ends}: ${laid} objects`
        + (crossings.length > 0 ? `, with ${crossings.join(', ')}` : ', all on one level')
        + (report.narrowedByPlanting ? `; it narrows at ${report.narrowedByPlanting} cell(s) where planting stands` : '') + `.${span}`,
      ...(stroke.detail ? { detail: stroke.detail } : {}),
    };
  },
});
