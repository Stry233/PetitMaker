/**
 * Feed mapping — pure translation from the existing agent tool surface into
 * Site Log vocabulary (spec §5). No state, no React: the turn engine calls
 * these to build ticket titles, rail ticks, card-back steps, revert copy,
 * vitals bumps and gate decisions; unit-tested in isolation.
 *
 * Copy rules (spec global constraints): human phrasing, never tool names or
 * the raw "REVERTED:" prefix in user-visible text; tiles come from the cozy
 * palette and never use blue.
 *
 * Everything a HUMAN reads here is localized through the caller's `t`. The
 * English that reaches the MODEL (rule text, "REVERTED: …", the (system)
 * nudges) is produced elsewhere and stays English on purpose: the model is
 * prompted in English.
 */
import { WRITE_TOOLS } from './tools';
import { describeToolCall, THEME_KEY, type Translate } from './describe-call';
import type { VerbIcon, Tick, Step, Oversight, Vitals } from './session';

type Input = Record<string, unknown>;
export type { Translate };

/* ── verb icon + tile ────────────────────────────────────────────────── */

const CATALOG_ICON: [RegExp, VerbIcon][] = [
  [/^tree-/, 'tree'],
  [/^flora-/, 'flower'],
  [/^road-/, 'road'],
  [/^(bridge|ramp)-/, 'road'],
  [/^(building|facility)-/, 'build'],
];

export function verbIconFor(toolName: string, input: Input): VerbIcon {
  switch (toolName) {
    case 'paint_terrain':
      return input.terrain === 'water' ? 'water' : 'terrain';
    case 'erase_terrain':
    case 'sculpt_terrace':
    case 'trim_corner':
      return 'terrain';
    case 'carve_river':
      return 'water';
    case 'build_road':
    case 'build_road_network':
    case 'frame_crossing':
      return 'road';
    case 'place_object':
    case 'remove_object':
    case 'rotate_object': {
      const id = String(input.catalogId ?? input.objectId ?? '');
      for (const [re, icon] of CATALOG_ICON) if (re.test(id)) return icon;
      return 'build';
    }
    case 'scatter_objects': {
      const ids = (input.catalogIds as string[] | undefined) ?? [];
      if (ids.some((i) => i.startsWith('tree-'))) return 'tree';
      return 'flower';
    }
    case 'plant_forest':
      return 'tree';
    case 'decorate_zone':
    case 'clear_area':
      return 'build';
    case 'run_generator':
    case 'update_plan':
      return 'plan';
    default:
      return 'eval'; // inspect/evaluate/view/find/skills — read verbs
  }
}

/** Cozy-palette glyph tiles (spec: no blue below the mode row). */
const TILE: Record<VerbIcon, string> = {
  terrain: '#CED779',
  water: '#FFE196',
  tree: '#C7CF68',
  road: '#E8E1D2',
  build: '#FFDA7E',
  flower: '#FFE196',
  eval: '#E8E1D2',
  plan: '#FFE196',
};
export const tileColorFor = (icon: VerbIcon): string => TILE[icon];

/* ── ticket title / sub ──────────────────────────────────────────────── */

const TITLES: Record<string, (i: Input, t: Translate) => string> = {
  paint_terrain: (i, t) => t(i.terrain === 'water' ? 'agent2.tk_water_painted' : 'agent2.tk_terrain_raised'),
  erase_terrain: (_i, t) => t('agent2.tk_ground_cleared'),
  sculpt_terrace: (_i, t) => t('agent2.tk_terraced_hill'),
  carve_river: (_i, t) => t('agent2.tk_river_carved'),
  clear_area: (_i, t) => t('agent2.tk_area_cleared'),
  build_road: (_i, t) => t('agent2.tk_road_laid'),
  build_road_network: (_i, t) => t('agent2.tk_roads_connected'),
  frame_crossing: (_i, t) => t('agent2.tk_crossing_framed'),
  // The item token is the catalog id stripped of its category prefix: an id, so
  // it carries no per-locale form.
  place_object: (i, t) => {
    const item = String(i.catalogId ?? '').replace(/^[a-z]+-/, '').replace(/-/g, ' ');
    return item ? t('agent2.tk_placed', { item }) : t('agent2.tk_placed_generic');
  },
  remove_object: (_i, t) => t('agent2.tk_removed'),
  rotate_object: (_i, t) => t('agent2.tk_rotated'),
  scatter_objects: (i, t) => {
    const n = Number(i.count);
    return n ? t('agent2.tk_scattered', { n }) : t('agent2.tk_scattered_few');
  },
  plant_forest: (_i, t) => t('agent2.tk_forest_planted'),
  decorate_zone: (i, t) => t('agent2.tk_decorated', {
    theme: t(THEME_KEY[String(i.theme ?? '')] ?? 'agent2.theme_zone'),
  }),
  run_generator: (_i, t) => t('agent2.tk_generated'),
  trim_corner: (_i, t) => t('agent2.tk_corner_smoothed'),
  undo: (_i, t) => t('agent2.tk_stepped_back'),
};

/** Human title + sub for a ticket. The sub reuses describe-call's compact
 *  area phrasing so coordinates stay readable without exposing tool names. */
export function ticketTitleFor(call: { name: string; input: Input }, t: Translate): { title: string; sub?: string } {
  const title = TITLES[call.name]?.(call.input ?? {}, t) ?? t('agent2.tk_working');
  const described = describeToolCall({ name: call.name, input: call.input ?? {} }, t);
  const sub = described.includes('·') ? described.split('·').slice(1).join('·').trim() : undefined;
  return { title, sub: sub || undefined };
}

/* ── result → tick / step / revert copy ──────────────────────────────── */

/** Marker content for a write the USER declined at the gate. Sentinel, never
 *  displayed: it travels in a locally built ToolResult that only ever reaches
 *  the copy below (the model is told DENIAL instead). A denial is not a revert
 *  either — nothing was applied and nothing was undone, so it must never wear
 *  the revert copy. */
export const USER_SKIP = 'Skipped by the user.';

export function resultToTick(name: string, r: { isError: boolean; content: string }, input: Input, t: Translate): Tick {
  const skipped = r.isError && r.content.startsWith(USER_SKIP);
  return {
    s: r.isError ? 'revert' : 'ok',
    i: verbIconFor(name, input),
    t: r.isError ? t(skipped ? 'agent2.tk_skipped' : 'agent2.tk_adjusted') : ticketTitleFor({ name, input }, t).title,
  };
}

/** One short reason per rule, in the user's language. The rule text the MODEL
 *  gets (formatErrors: `[id] message at (x,y). Hint: …`) is English by design
 *  and full of coordinates and model-only coaching, so the panel is told which
 *  rule fired and says it in its own words rather than quoting that line. */
const RULE_REASON: Record<string, string> = {
  'V-ZONE-01': 'agent2.rv_zone',
  'V-MTN-01': 'agent2.rv_elev',
  'V-MTN-02': 'agent2.rv_float',
  'V-MTN-03': 'agent2.rv_base',
  'V-WTR-01': 'agent2.rv_float_water',
  'V-WTR-02': 'agent2.rv_water',
  'V-WTR-03': 'agent2.rv_waterfall',
  'V-PLACE-TRAIT': 'agent2.rv_place',
  'V-PLACE-OVERLAP': 'agent2.rv_overlap',
  'V-PLACE-MAX': 'agent2.rv_maxcount',
  'V-PLACE-BLOCK': 'agent2.rv_blocked',
  'V-LOCK-01': 'agent2.rv_locked_layer',
  'V-LOCK-02': 'agent2.rv_locked',
  'V-CHUNK-01': 'agent2.rv_chunk',
};

/** "REVERTED: …" (or any rule failure) → one short, human sentence. The rule
 *  tag, the raw prefix and cell coordinates never reach the user. A user denial
 *  gets its own copy — claiming an undo happened would attribute the user's
 *  choice to the agent. */
export function revertCopy(content: string, t: Translate): string {
  if (content.startsWith(USER_SKIP)) return t('agent2.rv_skipped');
  const ruleKey = RULE_REASON[content.match(/\[(V-[A-Z0-9-]+)\]/)?.[1] ?? ''];
  return ruleKey ? t('agent2.rv_undid', { reason: t(ruleKey) }) : t('agent2.rv_generic');
}

export function stepFromResult(name: string, r: { isError: boolean; content: string }, input: Input, t: Translate): Step {
  if (r.isError) {
    return { s: 'revert', t: revertCopy(r.content, t) };
  }
  // A success step quotes the tool's own result line, which is the same English
  // the model reads; only its fallback is localized.
  const first = r.content.split('\n')[0]?.trim() ?? '';
  return { s: 'ok', t: first || ticketTitleFor({ name, input }, t).title };
}

/* ── vitals ──────────────────────────────────────────────────────────── */

export function vitalsDelta(name: string, input: Input, ok: boolean, resultContent?: string): Partial<Vitals> {
  if (!ok) return {};
  switch (name) {
    case 'carve_river':
      return { water: 1 };
    case 'paint_terrain':
      return input.terrain === 'water' ? { water: 1 } : {};
    case 'place_object': {
      const id = String(input.catalogId ?? '');
      if (id.startsWith('tree-')) return { tree: 1 };
      if (id.startsWith('flora-')) return { flower: 1 };
      if (id.startsWith('building-') || id.startsWith('facility-')) return { build: 1 };
      return {};
    }
    case 'scatter_objects': {
      // The requested count routinely overshoots what the rules let land ("Scattered
      // 3/50 …"); the result carries the real number, so the vitals count that.
      const landed = resultContent?.match(/Scattered (\d+)\//);
      const n = landed ? Number(landed[1]) : Number(input.count) || 1;
      const ids = (input.catalogIds as string[] | undefined) ?? [];
      return ids.some((i) => i.startsWith('tree-')) ? { tree: n } : { flower: n };
    }
    case 'plant_forest':
      return { tree: 8, flower: 6 };  // representative bump; exact counts live in results prose
    case 'decorate_zone':
      return { build: 2, flower: 4 };
    default:
      return {};
  }
}

/* ── the oversight gate matrix ───────────────────────────────────────── */

/** Wide/destructive tools: gated by default (checkpoint mode) even without a
 *  plan; an approved plan covers them, "Always" covers everything this run. */
export const WIDE_TOOLS: ReadonlySet<string> = new Set(['run_generator', 'clear_area', 'build_road_network']);

export function shouldGate(
  toolName: string,
  oversight: Oversight,
  ctx: { planApproved: boolean; allowAll: boolean },
): boolean {
  if (ctx.allowAll) return false;
  if (!WRITE_TOOLS.has(toolName)) return false;
  if (oversight === 'yolo') return false;
  if (oversight === 'strict') return true;
  // checkpoint: only the wide/destructive shapes ask, and an approved plan covers them
  return WIDE_TOOLS.has(toolName) && !ctx.planApproved;
}
