/**
 * Human-readable one-line descriptions of agent tool calls, for the approval
 * prompt and other user-facing surfaces. Non-professional users cannot parse
 * `place_object {"catalogId":"building-myhouse","x":3,…}` — this renders the
 * same call as `place_object: building-myhouse at (3,4)`.
 *
 * Read by HUMANS only (`feed.ts` → the ticket sub-line and the blueprint's
 * running line), so every connecting word goes through the caller's `t`. The
 * English the MODEL reads — rule text, `REVERTED: …`, the (system) nudges —
 * is produced elsewhere and stays English.
 *
 * Coordinates, arrows, counts and catalog/object ids carry no per-locale form
 * and are printed as-is; enum tokens the model sends (terrain, trim style,
 * algorithm, zone theme) are words on screen, so they get keys.
 */
import type { ToolCall } from './tools/types';
import { normalizeGeometry, rectInput, type FlatDefault } from './tools/geometry';

type In = Record<string, unknown>;

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const n = (v: unknown): number => Number(v);

/** decorate_zone's themes (tools-director THEMES) named for the panel. */
export const THEME_KEY: Record<string, string> = {
  orchard: 'agent2.theme_orchard',
  farm: 'agent2.theme_farm',
  garden: 'agent2.theme_garden',
  hamlet: 'agent2.theme_hamlet',
  waterfront: 'agent2.theme_waterfront',
  peak: 'agent2.theme_peak',
};

const TERRAIN_KEY: Record<string, string> = {
  mountain: 'agent2.dc_t_mountain',
  water: 'agent2.dc_t_water',
};
const SMOOTH_KEY: Record<string, string> = {
  round: 'agent2.dc_sm_round',
  rect: 'agent2.dc_sm_rect',
};
const TRIM_KEY: Record<string, string> = {
  square: 'agent2.dc_cs_square',
  fan: 'agent2.dc_cs_fan',
  tri: 'agent2.dc_cs_tri',
  empty: 'agent2.dc_cs_empty',
};
const ALGO_KEY: Record<string, string> = {
  designed: 'agent2.dc_alg_designed',
  maze: 'agent2.dc_alg_maze',
};

/** A schema enum the model sends: named for the panel, or printed raw when the
 *  schema grows a value this table has not caught up with. */
const word = (map: Record<string, string>, v: unknown, t: Translate): string => {
  const key = map[String(v)];
  return key ? t(key) : String(v);
};

/** Compact area phrase for the shared rect/circle/line/cells shape input, either spelling. */
function shape(rawInput: In, t: Translate, flatDefault: FlatDefault = 'rect'): string {
  const input = normalizeGeometry(rawInput, flatDefault);
  const rect = input.rect as In | undefined;
  const circle = input.circle as In | undefined;
  const line = input.line as In | undefined;
  const cells = input.cells as unknown[] | undefined;
  if (rect) return `(${n(rect.x1)},${n(rect.y1)})→(${n(rect.x2)},${n(rect.y2)})${input.outline ? ` ${t('agent2.dc_outline')}` : ''}`;
  if (circle) return t('agent2.dc_circle', { r: n(circle.r), at: `(${n(circle.cx)},${n(circle.cy)})` });
  if (line) {
    const stroke = t('agent2.dc_line', { a: `(${n(line.x1)},${n(line.y1)})`, b: `(${n(line.x2)},${n(line.y2)})` });
    return line.width ? `${stroke} ${t('agent2.dc_width', { w: n(line.width) })}` : stroke;
  }
  if (cells?.length) return t('agent2.dc_cells', { n: cells.length });
  return '';
}

const at = (input: In): string => `(${n(input.x)},${n(input.y)})`;
const box = (i: In): string => `${at(i)}+${n(i.w)}×${n(i.h)}`;

/** Per-tool phrasing; unknown tools fall back to compact key=value pairs. */
const DESCRIBERS: Record<string, (input: In, t: Translate) => string> = {
  paint_terrain: (i, t) => {
    const painted = t('agent2.dc_paint', {
      terrain: word(TERRAIN_KEY, i.terrain, t),
      elev: n(i.elevation),
      area: shape(i, t),
    });
    return i.smooth ? `${painted}${t('agent2.dc_smooth', { style: word(SMOOTH_KEY, i.smooth, t) })}` : painted;
  },
  erase_terrain: (i, t) => t('agent2.dc_erase', { area: shape(i, t) }),
  clear_area: (i, t) => t('agent2.dc_clear', { area: shape(i, t) }),
  place_object: (i, t) => {
    const placed = t('agent2.dc_at', { what: String(i.catalogId), at: at(i) });
    return i.rotation ? `${placed} ${t('agent2.dc_rot', { deg: n(i.rotation) })}` : placed;
  },
  remove_object: (i) => String(i.objectId),
  rotate_object: (i) => `${String(i.objectId)} → ${n(i.rotation)}°`,
  trim_corner: (i, t) => t('agent2.dc_corner', {
    corner: String(i.corner),
    at: at(i),
    style: word(TRIM_KEY, i.style, t),
  }),
  build_road: (i, t) => t('agent2.dc_along', { what: String(i.catalogId ?? 'path-overgrown-dirt'), area: shape(i, t, 'line') }),
  scatter_objects: (i, t) => {
    const ids = (i.catalogIds as string[] | undefined) ?? [];
    const pool = ids.length > 2 ? `${ids.slice(0, 2).join(', ')} +${ids.length - 2}` : ids.join(', ');
    const rect = rectInput(i);
    return t('agent2.dc_scatter', {
      n: n(i.count),
      pool,
      where: rect ? shape({ rect }, t) : t('agent2.dc_selection'),
    });
  },
  sculpt_terrace: (i, t) => t('agent2.dc_terrace', {
    tiers: n(i.tiers) || 2,
    r: n(i.baseRadius),
    at: `(${n(i.cx)},${n(i.cy)})`,
  }),
  carve_river: (i, t) => {
    const pts = (i.points as In[] | undefined) ?? [];
    const course = t('agent2.dc_river', { w: n(i.width) || 4, n: pts.length });
    if (pts.length < 2) return course;
    return `${course} (${n(pts[0]!.x)},${n(pts[0]!.y)})→(${n(pts[pts.length - 1]!.x)},${n(pts[pts.length - 1]!.y)})`;
  },
  run_generator: (i, t) => {
    const rect = rectInput(i);
    return [
      word(ALGO_KEY, i.algorithm ?? 'designed', t),
      i.seed !== undefined ? t('agent2.dc_seed', { n: n(i.seed) }) : '',
      rect ? t('agent2.dc_in', { area: shape({ rect }, t) }) : '',
    ].filter(Boolean).join(' ');
  },
  decorate_zone: (i, t) => t('agent2.dc_zone', {
    theme: t(THEME_KEY[String(i.theme ?? '')] ?? 'agent2.theme_zone'),
    area: box(i),
  }),
  plant_forest: (i, t) => (i.density !== undefined
    ? `${box(i)} ${t('agent2.dc_density', { d: n(i.density) })}`
    : box(i)),
  build_road_network: (_i, t) => t('agent2.dc_connect'),
  frame_crossing: (i, t) => t('agent2.dc_crossing', { at: at(i) }),
  undo: (i, t) => t('agent2.dc_steps', { n: n(i.steps) || 1 }),
  delegate_task: (i) => String(i.label ?? i.task ?? '').slice(0, 90),
  update_plan: (i, t) => {
    const stages = Array.isArray(i.stages) ? (i.stages as In[]) : undefined;
    if (!stages || stages.length === 0) return '';
    const labels = stages.map((s) => String(s.label ?? '')).filter(Boolean);
    const list = labels.slice(0, 3).join(', ') + (labels.length > 3 ? ` +${labels.length - 3}` : '');
    return t('agent2.dc_plan', { n: labels.length, list });
  },
};

/** What the call is ABOUT, without the tool's own name: the half a ticket shows as its sub-line.
 *  Undefined when there is nothing to say beyond the name. Read directly rather than split back out
 *  of the line below, so the two can never disagree about where one half ends. */
export function describeToolArgs(call: Pick<ToolCall, 'name' | 'input'>, t: Translate): string | undefined {
  const input = call.input ?? {};
  const d = DESCRIBERS[call.name];
  if (d) {
    try {
      return d(input, t);
    } catch {
      /* fall through to the generic form */
    }
  }
  const pairs = Object.entries(input)
    .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return pairs || undefined;
}

export function describeToolCall(call: Pick<ToolCall, 'name' | 'input'>, t: Translate): string {
  const args = describeToolArgs(call, t);
  return args ? `${call.name}: ${args}` : call.name;
}
