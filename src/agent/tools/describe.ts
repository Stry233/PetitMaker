/** Localized approval descriptions with map coordinates and object names. */
import { displayAgentText, toolVerbKey } from './labels';
import type { ToolCall } from './spec';
import type { RoomTheme } from '../../tools/macros';
import { normalizeGeometry, rectInput, type FlatDefault, type PAINT_TERRAINS, type SMOOTH_STYLES, type TRIM_STYLES } from './geometry';
import { TOOL_DEFAULTS, defaultRoadId } from './defaults';
import { isToolName, type ToolName } from './names';
import type { Translate, I18nKey } from '../../i18n/keys';
import type { Infer } from './schema';
import type { TOOLS } from './registry';

type In = Record<string, unknown>;
/** One tool's arguments as its schema declares them. A described call may be one the schema later
 *  refuses, so every field may be absent and the describer still guards what it prints. */
type Args<N extends ToolName> = Partial<Infer<(typeof TOOLS)[N]['input']>>;
type Describer<N extends ToolName> = (input: Args<N>, t: Translate, names: DescribeNames) => string;

interface DescribeNames {
  catalog(id: string): string | undefined;
  object(id: string): string | undefined;
}
const NO_NAMES: DescribeNames = { catalog: () => undefined, object: () => undefined };
const itemName = (id: unknown, t: Translate, names: DescribeNames): string => names.catalog(String(id)) ?? t('agent.object_name');

/** A number to print; an absent or malformed field reads as NaN, which drops the whole line. */
const n = (v: unknown): number => Number(v);

/** decorate_zone's themes named for the panel. */
const THEME_KEY: Record<RoomTheme, I18nKey> = {
  orchard: 'agent.theme_orchard',
  farm: 'agent.theme_farm',
  garden: 'agent.theme_garden',
  hamlet: 'agent.theme_hamlet',
  waterfront: 'agent.theme_waterfront',
  peak: 'agent.theme_peak',
};

const TERRAIN_KEY: Record<(typeof PAINT_TERRAINS)[number], I18nKey> = {
  mountain: 'agent.dc_t_mountain',
  water: 'agent.dc_t_water',
};
const SMOOTH_KEY: Record<(typeof SMOOTH_STYLES)[number], I18nKey> = {
  round: 'agent.dc_sm_round',
  rect: 'agent.dc_sm_rect',
};
const TRIM_KEY: Record<(typeof TRIM_STYLES)[number], I18nKey> = {
  square: 'agent.dc_cs_square',
  fan: 'agent.dc_cs_fan',
  tri: 'agent.dc_cs_tri',
  empty: 'agent.dc_cs_empty',
};
/** Unknown enum values receive the generic operation label. */
const word = <K extends string>(map: Record<K, I18nKey>, v: unknown, t: Translate): string => {
  const key = (map as Record<string, I18nKey | undefined>)[String(v)];
  return key ? t(key) : t('agent.verb_operation');
};

const cellCount = (count: number, t: Translate): string => t('agent.dc_cells', { n: count });

/** Compact area phrase for the shared rect/circle/line/cells shape input, either spelling. */
function shape(rawInput: In, t: Translate, flatDefault: FlatDefault = 'rect'): string {
  const input = normalizeGeometry(rawInput, flatDefault);
  const rect = input.rect as In | undefined;
  const circle = input.circle as In | undefined;
  const line = input.line as In | undefined;
  const cells = input.cells as unknown[] | undefined;
  if (rect) {
    const corners = `(${n(rect.x1)},${n(rect.y1)})→(${n(rect.x2)},${n(rect.y2)})`;
    return input.outline ? t('agent.dc_rect_outline', { rect: corners }) : corners;
  }
  if (circle) return t('agent.dc_circle', { r: n(circle.r), at: `(${n(circle.cx)},${n(circle.cy)})` });
  if (line) {
    const a = `(${n(line.x1)},${n(line.y1)})`, b = `(${n(line.x2)},${n(line.y2)})`;
    return line.width ? t('agent.dc_line_width', { a, b, w: n(line.width) }) : t('agent.dc_line', { a, b });
  }
  if (cells?.length) return cellCount(cells.length, t);
  return '';
}

const at = (input: In): string => `(${n(input.x)},${n(input.y)})`;
const box = (i: In): string => `${at(i)}+${n(i.w)}×${n(i.h)}`;

/** Arguments worth reviewing before a map operation. */
const DESCRIBERS: { [N in ToolName]?: Describer<N> } = {
  set_annotation: (i, t) => {
    const kind = ({ zone: 'annot.layer', chip: 'annot.chip', route: 'annot.route', measure: 'annot.measure' } as Partial<Record<string, I18nKey>>)[String(i.kind)];
    return [kind ? t(kind) : t('annot.layer'), Array.isArray(i.cells) ? cellCount(i.cells.length, t) : ''].filter(Boolean).join(' ');
  },
  remove_annotation: (_i, t) => t('annot.layer'),
  paint_terrain: (i, t) => {
    const terrain = word(TERRAIN_KEY, i.terrain, t);
    const elev = n(i.elevation);
    const area = shape(i, t);
    return i.smooth
      ? t('agent.dc_paint_smooth', { terrain, elev, area, style: word(SMOOTH_KEY, i.smooth, t) })
      : t('agent.dc_paint', { terrain, elev, area });
  },
  erase_terrain: (i, t) => t('agent.dc_erase', { area: shape(i, t) }),
  clear_area: (i, t) => t('agent.dc_clear', { area: shape(i, t) }),
  place_object: (i, t, names) => {
    const what = itemName(i.catalogId, t, names), where = at(i);
    return i.rotation ? t('agent.dc_at_rot', { what, at: where, deg: n(i.rotation) }) : t('agent.dc_at', { what, at: where });
  },
  remove_object: (i, t, names) => names.object(String(i.objectId)) ?? t('agent.object_name'),
  rotate_object: (i, t, names) => `${names.object(String(i.objectId)) ?? t('agent.object_name')} → ${n(i.rotation)}°`,
  trim_corner: (i, t) => t('agent.dc_corner', {
    corner: ({ TL: '\u2196', TR: '\u2197', BL: '\u2199', BR: '\u2198' } as Record<string, string>)[String(i.corner)] ?? '',
    at: at(i),
    style: word(TRIM_KEY, i.style, t),
  }),
  build_road: (i, t, names) => t('agent.dc_along', { what: itemName(i.catalogId ?? defaultRoadId(), t, names), area: shape(i, t, 'line') }),
  scatter_objects: (i, t, names) => {
    const ids = (i.catalogIds ?? []).map((id) => itemName(id, t, names));
    const pool = ids.length > 2 ? `${ids.slice(0, 2).join(', ')} +${ids.length - 2}` : ids.join(', ');
    const rect = rectInput(i);
    return t('agent.dc_scatter', {
      n: n(i.count),
      pool,
      where: rect ? shape({ rect }, t) : t('agent.dc_selection'),
    });
  },
  sculpt_wall: (i, t) => t('agent.dc_wall', {
    w: Math.abs(n(i.x2) - n(i.x1)) + 1,
    h: Math.abs(n(i.y2) - n(i.y1)) + 1,
    crest: n(i.crest) || TOOL_DEFAULTS.wallCrest,
    flood: i.flood === true ? t('agent.dc_wall_flood') : '',
  }),
  draw_figure: (i, t, names) => t('agent.dc_figure', {
    shape: t('agent.figure_name'),
    size: n(i.size),
    at: `(${n(i.cx)},${n(i.cy)})`,
    ring: typeof i.ringId === 'string' ? t('agent.dc_figure_ring', { ring: itemName(i.ringId, t, names) }) : '',
  }),
  sink_pool: (i, t) => shape(i, t),
  sculpt_terrace: (i, t) => t('agent.dc_terrace', {
    tiers: n(i.tiers) || TOOL_DEFAULTS.terraceTiers,
    r: n(i.baseRadius),
    at: `(${n(i.cx)},${n(i.cy)})`,
  }),
  carve_river: (i, t) => {
    const pts = i.points ?? [];
    const course = t('agent.dc_river', { w: n(i.width) || TOOL_DEFAULTS.riverWidth, n: pts.length });
    if (pts.length < 2) return course;
    return `${course} (${n(pts[0]!.x)},${n(pts[0]!.y)})→(${n(pts[pts.length - 1]!.x)},${n(pts[pts.length - 1]!.y)})`;
  },
  decorate_zone: (i, t) => t('agent.dc_zone', {
    theme: t((THEME_KEY as Partial<Record<string, I18nKey>>)[String(i.theme ?? '')] ?? 'agent.theme_zone'),
    area: box(i),
  }),
  plant_forest: (i, t) => (i.density !== undefined
    ? t('agent.dc_area_density', { area: box(i), d: n(i.density) })
    : box(i)),
  build_road_network: (_i, t) => t('agent.dc_connect'),
  frame_crossing: (i, t) => t('agent.dc_crossing', { at: at(i) }),
  undo: (i, t) => t('agent.dc_steps', { n: n(i.steps) || TOOL_DEFAULTS.historySteps }),
  redo: (i, t) => t('agent.dc_steps', { n: n(i.steps) || TOOL_DEFAULTS.historySteps }),
  delegate_task: (i) => String(i.label ?? i.task ?? '').slice(0, 90),
  update_plan: (i, t) => {
    const stages = Array.isArray(i.stages) ? i.stages : undefined;
    if (!stages || stages.length === 0) return '';
    const labels = stages.map((s) => String(s.label ?? '')).filter(Boolean);
    const list = labels.slice(0, 3).join(', ') + (labels.length > 3 ? ` +${labels.length - 3}` : '');
    return t('agent.dc_plan', { n: labels.length, list });
  },
};

/** What the call is about, without the tool's own name: the half a ticket shows as its sub-line.
 *  Undefined when there is nothing to say beyond the name. Read directly rather than split back out
 *  of the line below, so the two can never disagree about where one half ends. */
export function describeToolArgs(call: Pick<ToolCall, 'name' | 'input'>, t: Translate, names: DescribeNames = NO_NAMES): string | undefined {
  const input = call.input ?? {};
  const d = isToolName(call.name) ? DESCRIBERS[call.name] as Describer<ToolName> | undefined : undefined;
  if (d) {
    try {
      const detail = d(input as Args<ToolName>, t, names);
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
