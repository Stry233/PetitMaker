/** A planning zone as the area of an edit: the area tools take a zone number and keep to its cells,
 *  so a build follows the annotation it implements. */
import type { GridState, MacroCoord } from '../../core/model/types';
import type { ZoneNote } from '../../core/model/annotations';
import { int } from './schema';
import { zoneWholeCells } from './annotation-survey';

export const zoneArg = {
  zone: int({ min: 1, description: "A planning zone's number (get_annotations): the call keeps to that zone's cells, and to the given area as well when one is given." }),
};

/** The cells of zone `num`, within `area` when given; or why there are none. */
export function zoneArea(state: GridState, num: number, area?: readonly MacroCoord[]): MacroCoord[] | string {
  const zone = state.annotations?.items.find((n): n is ZoneNote => n.kind === 'zone' && n.num === num);
  if (!zone) return `zone #${num} is not on the map; read get_annotations for the zone numbers.`;
  const W = state.template.width;
  const cells = zoneWholeCells(zone, W, state.template.height);
  const within = area ? new Set(area.map((c) => c.y * W + c.x)) : null;
  const out = [...cells].filter((i) => !within || within.has(i)).sort((a, b) => a - b).map((i) => ({ x: i % W, y: Math.floor(i / W) }));
  return out.length ? out : `zone #${num} has no cells inside the given area.`;
}
