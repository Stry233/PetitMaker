/**
 * Pro-terraforming write tools: organic multi-tier terraces, banded walls, pool courts and
 * meandering rivers. Each is one stroke group with an auto edge-cut pass folded into the same undo
 * step, like the build brushes. carve_river is Smart Build's river
 * (`tools/macros` `buildRiver`) authored by the model.
 */
import { TerrainType, type Command, type GridState, type MacroCoord } from '../../core/model/types';
import { isInBounds, cellKey } from '../../core/grid/rect';
import { edgeCutGeneratedTerrain } from '../../tools/trim';
import { clamp } from '../../core/base/math';
import { BASE_SUPPORT, ELEVATION_MAX, TERRAIN_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import { TOOL_DEFAULTS } from './defaults';
import type { AgentToolDeps } from './deps';
import { clipBuildable } from './cells';
import { argError } from './feedback';
import { cellItem, coordProps, corners, missingScalars, smoothEdges } from './geometry';
import { bool, int, list, obj, oneOf, req } from './schema';
import { defineTool, type ToolOutcome } from './spec';
import { runStroke, runStrokeBody } from './stroke';
import {
  buildRiver, sculptTerrace as sculptTerraceCells, sculptWall as sculptWallBands, sinkPoolCourt, wallRectAtEdge, RIVER_WIDTH_MAX,
} from '../../tools/macros';
import type { EditContext } from '../../core/commands/edit-context';
import { BUILDABLE_ZONES, bridgeSpanText } from './game-terms';

/**
 * The armed region as a membership test, or null with none armed. The organic generators clip what
 * they grow to it: the spread is the tool's choice rather than the model's, so a whole-call
 * refusal over cells the model never asked for teaches nothing and costs a turn. Coordinates the
 * model chooses itself (waypoints, centers, every other tool's cells) stay under the stroke
 * runners' all-or-nothing region rule.
 */
export function regionClip(deps: AgentToolDeps): Set<string> | null {
  const region = deps.getRegion();
  if (region.length === 0) return null;
  return new Set(region.map((c) => cellKey(c.x, c.y)));
}

export const sculptTerraceTool = defineTool({
  description: 'Sculpt an organic terraced hill: 1-3 stacked tiers of blob-shaped mountain with rounded edge cuts. Use for irregular hills; paint_terrain can make precise or formal shapes. Same seed = same shape.',
  input: obj({
    cx: req(int()),
    cy: req(int()),
    baseRadius: req(int({ min: 3, max: 12, description: 'Footprint radius of tier 1.' })),
    tiers: int({ min: 1, max: 3, description: `Elevation levels (default ${TOOL_DEFAULTS.terraceTiers}).` }),
    smooth: smoothEdges("Cliff corner style (default 'round')."),
    seed: int({ description: 'Shape seed (derived from the site when omitted, so the same call replays).' }),
  }),
  access: 'write',
  example: 'cx: 40, cy: 30, baseRadius: 6',
  run: sculptTerrace,
});

function sculptTerrace(
  deps: AgentToolDeps,
  input: { cx: number; cy: number; baseRadius: number; tiers?: number; smooth?: 'round' | 'rect'; seed?: number },
): ToolOutcome {
  const { cx, cy, baseRadius } = input;
  const tiers = input.tiers ?? TOOL_DEFAULTS.terraceTiers;
  const smooth = input.smooth ?? 'round';
  // The default seed comes from the site itself: the same terrace at the same spot replays
  // exactly, and a terrace elsewhere draws its own shape.
  const seed = input.seed ?? ((cx * 7919 + cy * 104729 + baseRadius * 31) | 0);
  const state = deps.getState();
  const clip = regionClip(deps);
  const { tiers: tierCells, commands, clipped: clippedAny } = sculptTerraceCells(
    state, { cx, cy, baseRadius, tiers, seed }, (cells) => clipBuildable(cells, state).cells, clip,
  );
  if (clip && (tierCells[0]?.length ?? 0) === 0) {
    return argError('the terrace footprint lies entirely outside the selected region, move cx,cy inside it.');
  }
  const all = tierCells[0] ?? [];
  const clipNote = clippedAny ? ', clipped to the selected region' : '';
  return runStroke(
    deps,
    commands,
    () => `Sculpted a ${tierCells.length}-tier organic terrace around (${cx},${cy}) (seed ${seed}, ${all.length} base cells, ${smooth} cliffs${clipNote}).`,
    {
      snapshot: cellSet(TERRAIN_GRID, all),
      afterApply: (exec) => edgeCutGeneratedTerrain({ state: state, execute: (c: Command) => exec.execute(c) }, tierCells.flat(), smooth),
    },
  );
}

/**
 * The expert maps' primary form in one call: a banded backing wall (the reference planet's north
 * wall). Bands rise +3 per step with every higher band inset 2 cells on all sides — the stepping
 * V-MTN-03 accepts by construction — the crest stays flat, and `flood` sinks a crest pool inside a
 * 1-cell ring of the crest's own mountain. One stroke, edge-cut like the build brushes.
 */
export const sculptWallTool = defineTool({
  description: `Raise a banded wall or tall plateau in one call. Bands step up +${BASE_SUPPORT.reach} per inset ring, the crest stays flat and pavable, and flood:true sinks a crest pool inside its own rim. Use when the requested scene needs a tall backdrop; sculpt_terrace builds smaller organic hills.`,
  input: obj({
    ...coordProps,
    edge: oneOf(['N', 'S', 'E', 'W'], { description: `Site the wall AS the map's boundary: abutting this edge of the buildable ${BUILDABLE_ZONES}, spanning it, depth rows deep (overrides the corners). A backing wall is a boundary condition, not a centerpiece.` }),
    depth: int({ min: 7, max: 30, description: `Rows deep when edge is given (default ${TOOL_DEFAULTS.wallDepth}).` }),
    crest: int({ min: 2, max: ELEVATION_MAX, description: `Crest elevation (default ${TOOL_DEFAULTS.wallCrest}; lowered automatically if the rect is too shallow for the insets).` }),
    flood: bool({ description: 'Sink a crest pool (water at crest elevation inside a 1-cell rim).' }),
    smooth: smoothEdges('round (default) trims the outer cliffs organically; rect keeps them crisp.'),
  }),
  access: 'write',
  example: 'edge: "N", depth: 14, crest: 8, flood: true',
  run: sculptWall,
});

function sculptWall(
  deps: AgentToolDeps,
  input: { x1?: number; y1?: number; x2?: number; y2?: number; edge?: 'N' | 'S' | 'E' | 'W'; depth?: number; crest?: number; flood?: boolean; smooth?: 'round' | 'rect' },
): ToolOutcome {
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  let ix1 = input.x1 ?? NaN, iy1 = input.y1 ?? NaN, ix2 = input.x2 ?? NaN, iy2 = input.y2 ?? NaN;
  const { edge } = input;
  if (edge) {
    const sited = wallRectAtEdge(state, edge, input.depth ?? TOOL_DEFAULTS.wallDepth);
    if (!sited) return argError(`the map has no buildable ${BUILDABLE_ZONES} to stand a wall on.`);
    ({ x1: ix1, y1: iy1, x2: ix2, y2: iy2 } = sited);
  } else if (missingScalars(input, ['x1', 'y1', 'x2', 'y2']).length > 0) {
    return argError('sculpt_wall needs the band rect corners x1,y1,x2,y2, or edge ("N"|"S"|"E"|"W") with depth.', 'edge: "N", depth: 14, crest: 8, flood: true');
  }
  const x1 = clamp(Math.min(ix1, ix2), 0, mw - 1);
  const x2 = clamp(Math.max(ix1, ix2), 0, mw - 1);
  const y1 = clamp(Math.min(iy1, iy2), 0, mh - 1);
  const y2 = clamp(Math.max(iy1, iy2), 0, mh - 1);
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  if (w < 7 || h < 7) return argError(`the wall band is ${w}x${h}; it needs at least 7 cells on each side for one inset step.`);
  const askedCrest = input.crest ?? TOOL_DEFAULTS.wallCrest;
  const flood = input.flood === true;
  const wall = sculptWallBands(state, { x1, y1, x2, y2 }, askedCrest, flood, regionClip(deps));
  if (!wall) return argError('the wall band lies entirely outside the selected region, move the rect inside it.');
  const { commands, base, bands, crest, poolCells } = wall;
  const smooth = input.smooth ?? 'round';
  const mountainCells = base;
  return runStroke(
    deps,
    commands,
    () => `Raised a ${bands.length}-band wall (${w}x${h}, crest elevation ${crest}${crest < askedCrest ? `, lowered from ${askedCrest} to fit the band's depth` : ''}${flood ? `, crest pool ${poolCells.length} cells` : ''}). The crest is flat and pavable.`,
    {
      snapshot: cellSet(TERRAIN_GRID, mountainCells),
      afterApply: (exec) => edgeCutGeneratedTerrain({ state: state, execute: (c: Command) => exec.execute(c) }, mountainCells, smooth),
    },
  );
}

/**
 * Build a raised bench and its contained pool in one legal stroke. `islets:true` keeps a step-three
 * lattice of bench cells inside the water for a matching `scatter_objects` grid.
 */
export const sinkPoolTool = defineTool({
  description: 'Sink a POOL COURT in one legal stroke: a 1-cell bench rim (mountain at `elevation`) holding water at the bench\'s own height — the containment the water rules demand, so it cannot revert half-built. islets:true leaves a step-3 lattice of bench islets inside the water (the parterre grid; plant it with scatter_objects pattern "grid" step 3). For terraced pool courts; ground-level lakes stay paint_terrain/draw_figure work.',
  input: obj({
    ...corners,
    elevation: int({ min: 1, max: BASE_SUPPORT.reach, description: `Bench and water height (default ${TOOL_DEFAULTS.poolElevation}).` }),
    islets: bool({ description: 'Leave the step-3 islet lattice inside the water.' }),
    smooth: smoothEdges('round (default) trims the bench corners; rect keeps them crisp.'),
  }),
  access: 'write',
  example: 'x1: 20, y1: 30, x2: 34, y2: 40, elevation: 1',
  run: sinkPool,
});

function sinkPool(
  deps: AgentToolDeps,
  input: { x1: number; y1: number; x2: number; y2: number; elevation?: number; islets?: boolean; smooth?: 'round' | 'rect' },
): ToolOutcome {
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  const { x1: ix1, y1: iy1, x2: ix2, y2: iy2 } = input;
  // 1-cell margin off the literal map edge: V-WTR-02 treats off-map neighbors as uncapped.
  const x1 = clamp(Math.min(ix1, ix2), 1, mw - 2), x2 = clamp(Math.max(ix1, ix2), 1, mw - 2);
  const y1 = clamp(Math.min(iy1, iy2), 1, mh - 2), y2 = clamp(Math.max(iy1, iy2), 1, mh - 2);
  const w = x2 - x1 + 1, h = y2 - y1 + 1;
  if (w < 5 || h < 5) return argError(`the pool rect is ${w}x${h}; it needs at least 5 cells each way for a 1-cell rim around 3x3 of water.`);
  const elevation = input.elevation ?? TOOL_DEFAULTS.poolElevation;
  const islets = input.islets === true;
  const court = sinkPoolCourt({ x1, y1, x2, y2 }, elevation, islets, regionClip(deps));
  if (!court) return argError('the pool rect lies entirely outside the selected region, move it inside.');
  const { commands, cells: inRect, water, islets: isletCount } = court;
  const smooth = input.smooth ?? 'round';
  return runStroke(
    deps,
    commands,
    () => `Sunk a ${w}x${h} pool court at elevation ${elevation}: ${water.length} water cell(s) inside a 1-cell bench rim${islets ? `, ${isletCount} islet(s) on the step-3 lattice (scatter_objects pattern "grid" step 3 plants the parterre)` : ''}.`,
    {
      snapshot: cellSet(TERRAIN_GRID, inRect),
      afterApply: (exec) => edgeCutGeneratedTerrain({ state: state, execute: (c: Command) => exec.execute(c) }, inRect, smooth),
    },
  );
}


export const carveRiverTool = defineTool({
  description: `Carve a MEANDERING river through waypoints (a smooth curve through every waypoint, constant width, rounded banks): Smart Build's river. It runs downhill from its higher end, drops over a terrace step in a framed waterfall, and opens into a small pool at a dry end. Use 3-5 waypoints with sideways offsets for natural bends; straight 2-point calls are for canals. Banks stay bridgeable where the width is ${bridgeSpanText()}.`,
  input: obj({
    points: req(list(cellItem, { minItems: 2, maxItems: 6, description: 'Waypoints from source to mouth.' })),
    width: int({ min: 2, max: RIVER_WIDTH_MAX, description: `Channel width (default ${TOOL_DEFAULTS.riverWidth}).` }),
    smooth: smoothEdges("Bank corner style (default 'round')."),
  }),
  access: 'write',
  example: 'points: [{"x":8,"y":10},{"x":16,"y":14},{"x":24,"y":12}]',
  run: carveRiver,
});

/** Every water cell of the map, as `y * width + x`. */
function waterKeys(state: GridState): Set<number> {
  const out = new Set<number>();
  const { width, height } = state.template;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (state.cells[y]![x]!.terrain?.type === TerrainType.Water) out.add(y * width + x);
  }
  return out;
}

async function carveRiver(deps: AgentToolDeps, input: { points: MacroCoord[]; width?: number; smooth?: 'round' | 'rect' }): Promise<ToolOutcome> {
  const { points } = input;
  const width = input.width ?? TOOL_DEFAULTS.riverWidth;
  const smooth = input.smooth ?? 'round';
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  if (points.every((c) => !isInBounds(c.x, c.y, mw, mh))) {
    return argError(`the river path lies entirely off the ${mw}x${mh} map, pass points inside it.`);
  }
  const from = points[0]!, to = points[points.length - 1]!;
  const exec = deps.getExecutor();
  const kit: EditContext = { state, executor: exec, registry: exec.getRegistry() };
  const region = deps.getRegion();
  const before = waterKeys(state);
  const stroke = await runStrokeBody(deps, 'the river', () => buildRiver(kit, {
    from, to, anchors: points, width, trim: smooth, ...(region.length > 0 ? { region } : {}),
  }));
  if ('refusal' in stroke) return stroke.refusal;
  const { result, detail } = stroke;
  if (result.code) {
    const at = (result.blocked ?? []).slice(0, 3).map((c) => `(${c.x},${c.y})`).join(', ');
    const within = region.length > 0 ? ' inside the selected region' : '';
    return {
      isError: true,
      content: `No river was carved: no ${width}-wide channel runs downhill from one end to the other between (${from.x},${from.y}) and (${to.x},${to.y})${within}${at ? `, blocked at ${at}` : ''}. Keep both ends and the course on open buildable ground clear of objects, or narrow the river.`,
    };
  }
  const carved: MacroCoord[] = [];
  for (const k of waterKeys(state)) if (!before.has(k)) carved.push({ x: k % mw, y: Math.floor(k / mw) });
  const levels = new Set(carved.map((c) => state.cells[c.y]![c.x]!.terrain?.elevation ?? 0)).size;
  deps.onFlash?.([cellSet(TERRAIN_GRID, carved)]);
  return {
    isError: false,
    content: `Carved a width-${width} river through ${points.length} waypoint(s): ${carved.length} water cell(s), ${smooth} banks${levels > 1 ? `, over ${levels - 1} waterfall step(s)` : ''}.`,
    detail,
  };
}
