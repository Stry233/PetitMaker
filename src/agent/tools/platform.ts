/** raise_platform: a rectangle of raised ground with its way up, in one step. */
import { cellSet } from '../../core/grid/grids';
import { TERRAIN_GRID } from '../../core/game/profile';
import { mountainLadder } from '../../core/model/command-build';
import type { MacroCoord, PlacedObject } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { clearBorderNote, clipOccupied, clipPaintable, restingWholly, terrainRectUnder, terrainUnder } from './cells';
import { argError, formatErrors } from './feedback';
import { corners } from './geometry';
import { buildPlaceCmd } from './objects';
import { int, obj, oneOf, req } from './schema';
import { scanRampSites } from './search';
import { defineTool } from './spec';
import { runStrokeBody } from './stroke';

const SIDES = ['north', 'south', 'east', 'west'] as const;

/** The highest platform one call raises: a ramp climbs one layer, so each further layer needs its own step. */
const PLATFORM_MAX = 3;

/**
 * Raises a rectangle of ground and puts a ramp on the side asked for, so the raised ground is
 * reachable the moment it exists. Raised ground with no way up is what keeps a builder on the flat.
 */
export const raisePlatformTool = defineTool({
  description: 'Raise a rectangle of ground x1,y1,x2,y2 to an elevation and place a ramp up to it on one side, in one step: '
    + 'a terrace behind buildings, a platform under a court or pool, a step of a stepped garden. '
    + 'access names the side the ramp goes on (the side the path arrives from); the ramp lands as near the middle of that side as the rules allow. '
    + `For a platform higher than one layer, raise it one layer at a time, each call a smaller rectangle on the last (at most ${PLATFORM_MAX}). `
    + 'Objects stand on top on exactly the cells of the rectangle, and the result names the nearest clear cells around it. Build on top with the usual tools; objects take the elevation under them.',
  input: obj({
    ...corners,
    elevation: req(int({ min: 1, max: PLATFORM_MAX, description: 'The elevation of the top; the ground is 0.' })),
    access: req(oneOf([...SIDES], { description: 'The side the ramp goes on.' })),
  }),
  access: 'write',
  example: 'x1: 20, y1: 30, x2: 31, y2: 37, elevation: 1, access: "south"',
  async run(deps, input) {
    const x1 = Math.min(input.x1, input.x2), x2 = Math.max(input.x1, input.x2);
    const y1 = Math.min(input.y1, input.y2), y2 = Math.max(input.y1, input.y2);
    if (x2 - x1 < 2 || y2 - y1 < 2) return argError('a platform is at least 3 cells on each side, so that something can stand on it.');
    const state = deps.getState();
    const { width, height } = state.template;
    if (x1 < 0 || y1 < 0 || x2 >= width || y2 >= height) {
      return argError(`the rectangle runs off the map, whose cells are (0,0)-(${width - 1},${height - 1}); choose a rectangle wholly on it.`);
    }
    const wanted: MacroCoord[] = [];
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) wanted.push({ x, y });
    const zoned = clipPaintable(terrainUnder(wanted, state), state);
    const { cells } = clipOccupied(zoned.cells, state);
    const inZone = restingWholly(wanted, zoned.cells, state), open = restingWholly(wanted, cells, state);
    if (open < wanted.length) {
      return argError(`${wanted.length - open} of the rectangle's cells are off the buildable ground or touch standing objects`
        + `${inZone > open ? ` (${inZone - open} at objects)` : ''}; choose open ground for the whole platform, a clear cell away from anything standing.`);
    }
    const { elevation, access } = input;
    const exec = deps.getExecutor();
    const landed: { ramp?: PlacedObject } = {};
    // The layers that landed, and why the next one did not.
    let reached = 0, refused = '';
    const stroke = await runStrokeBody(deps, 'the platform', () => {
      for (const layer of mountainLadder(cells, (c) => c, () => 0, () => elevation)) {
        const painted = exec.execute(layer);
        if (!painted.success) { refused = formatErrors(painted.errors); return; }
        reached = layer.elevation;
      }
      // The asked side's edge row or column of the raised ground, and the middle of that side.
      const g = terrainRectUnder({ x1, y1, x2, y2 });
      const alongX = access === 'north' || access === 'south';
      const middle = alongX ? (g.x1 + g.x2) / 2 : (g.y1 + g.y2) / 2;
      const edge = access === 'north' ? g.y1 : access === 'south' ? g.y2 : access === 'west' ? g.x1 : g.x2;
      const onSide = (c: MacroCoord): boolean => (alongX
        ? Math.abs(c.y - edge) <= 1 && c.x >= g.x1 && c.x <= g.x2
        : Math.abs(c.x - edge) <= 1 && c.y >= g.y1 && c.y <= g.y2);
      // A ramp runs from its anchor across its width, so one centred on the side is anchored half its width before the middle.
      const offCentre = (s: { anchor: MacroCoord; rampId: string }): number => {
        const centred = Math.floor(middle - (getCatalogItem(s.rampId)?.width ?? 1) / 2);
        return alongX ? Math.abs(s.anchor.x - centred) + Math.abs(s.anchor.y - edge) : Math.abs(s.anchor.y - centred) + Math.abs(s.anchor.x - edge);
      };
      const near = alongX ? { x: Math.floor(middle), y: edge } : { x: edge, y: Math.floor(middle) };
      const site = scanRampSites(deps, near, 10)
        .filter((s) => s.highElev === elevation && onSide(s.anchor))
        .sort((p, q) => offCentre(p) - offCentre(q))[0];
      if (!site) return;
      const place = buildPlaceCmd(deps, site.rampId, site.anchor, 0);
      // A ramp snaps to its cliff as it lands, so where it stands is read off the map.
      if (typeof place !== 'string' && exec.execute(place).success) landed.ramp = deps.getState().objects.get(place.object.id);
    });
    if ('refusal' in stroke) return stroke.refusal;
    if (reached > 0) deps.onFlash?.([cellSet(TERRAIN_GRID, cells)]);
    if (reached < elevation) {
      return {
        isError: true,
        content: `${reached === 0 ? 'Nothing was raised' : `The ground at (${x1},${y1})-(${x2},${y2}) stands at elevation ${reached}, short of ${elevation}, with no ramp`}`
          + `: the rules refused layer ${reached + 1}.\n${refused}`,
        ...(stroke.detail ? { detail: stroke.detail } : {}),
      };
    }
    const way = landed.ramp
      ? ` A ${landed.ramp.catalogId} stands at (${landed.ramp.position.x},${landed.ramp.position.y}) on the ${access} side; bring the path to its foot.`
      : ` No ramp fits on the ${access} side as the ground stands (a ramp needs level ground at its foot, one layer below the top); use find_ramp_sites near the platform, or raise it one layer at a time.`;
    return {
      isError: false,
      content: `Raised a ${x2 - x1 + 1}x${y2 - y1 + 1} platform to elevation ${elevation} at (${x1},${y1})-(${x2},${y2}).${way} Objects stand on it on exactly those cells.${clearBorderNote(wanted, state)}`,
      ...(stroke.detail ? { detail: stroke.detail } : {}),
    };
  },
});
