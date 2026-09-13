/** Localized approval descriptions with map coordinates and object names. */
import { displayAgentText, toolVerbKey } from './tool-labels';
import type { ToolCall } from './tools/types';
import { normalizeGeometry, rectInput, type FlatDefault } from './tools/geometry';

type In = Record<string, unknown>;

export interface DescribeNames {
  catalog(id: string): string | undefined;
  object(id: string): string | undefined;
}
const NO_NAMES: DescribeNames = { catalog: () => undefined, object: () => undefined };
const itemName = (id: unknown, t: Translate, names: DescribeNames): string => names.catalog(String(id)) ?? t('agent3.object_name');

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
/** Unknown enum values receive the generic operation label. */
const word = (map: Record<string, string>, v: unknown, t: Translate): string => {
  const key = map[String(v)];
  return key ? t(key) : t('agent3.verb_operation');
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

/** Arguments worth reviewing before a map operation. */
const DESCRIBERS: Record<string, (input: In, t: Translate, names: DescribeNames) => string> = {
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
  place_object: (i, t, names) => {
    const placed = t('agent2.dc_at', { what: itemName(i.catalogId, t, names), at: at(i) });
    return i.rotation ? `${placed} ${t('agent2.dc_rot', { deg: n(i.rotation) })}` : placed;
  },
  remove_object: (i, t, names) => names.object(String(i.objectId)) ?? t('agent3.object_name'),
  rotate_object: (i, t, names) => `${names.object(String(i.objectId)) ?? t('agent3.object_name')} → ${n(i.rotation)}°`,
  trim_corner: (i, t) => t('agent2.dc_corner', {
    corner: ({ TL: '\u2196', TR: '\u2197', BL: '\u2199', BR: '\u2198' } as Record<string, string>)[String(i.corner)] ?? '',
    at: at(i),
    style: word(TRIM_KEY, i.style, t),
  }),
  build_road: (i, t, names) => t('agent2.dc_along', { what: itemName(i.catalogId ?? 'path-rustic-dirt', t, names), area: shape(i, t, 'line') }),
  scatter_objects: (i, t, names) => {
    const ids = ((i.catalogIds as string[] | undefined) ?? []).map((id) => itemName(id, t, names));
    const pool = ids.length > 2 ? `${ids.slice(0, 2).join(', ')} +${ids.length - 2}` : ids.join(', ');
    const rect = rectInput(i);
    return t('agent2.dc_scatter', {
      n: n(i.count),
      pool,
      where: rect ? shape({ rect }, t) : t('agent2.dc_selection'),
    });
  },
  sculpt_wall: (i, t) => t('agent2.dc_wall', {
    w: Math.abs(n(i.x2) - n(i.x1)) + 1,
    h: Math.abs(n(i.y2) - n(i.y1)) + 1,
    crest: n(i.crest) || 6,
    flood: i.flood === true ? t('agent2.dc_wall_flood') : '',
  }),
  draw_figure: (i, t) => t('agent2.dc_figure', {
    shape: t('agent3.figure_name'),
    size: n(i.size),
    at: `(${n(i.cx)},${n(i.cy)})`,
    ring: typeof i.ringId === 'string' ? t('agent2.dc_figure_ring', { ring: t('agent3.object_name') }) : '',
  }),
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
export function describeToolArgs(call: Pick<ToolCall, 'name' | 'input'>, t: Translate, names: DescribeNames = NO_NAMES): string | undefined {
  const input = call.input ?? {};
  const d = DESCRIBERS[call.name];
  if (d) {
    try {
      const detail = d(input, t, names);
      return /NaN|Infinity|undefined/.test(detail) ? undefined : displayAgentText(detail, t);
    } catch {
      /* Invalid arguments receive the localized operation name. */
    }
  }
  return undefined;
}

export function describeToolCall(call: Pick<ToolCall, 'name' | 'input'>, t: Translate, names?: DescribeNames): string {
  const args = describeToolArgs(call, t, names);
  const label = t(toolVerbKey(call.name));
  return args ? `${label} (${args})` : label;
}
