/** The run dump: a judgeable record of one session, for an offline eval harness. `cells` mirrors
 *  the PETIT_DUMP harnesses' per-cell shape (`_cutdump.test.ts`) unchanged, so the same offline
 *  renderer can turn it into a PNG; `terrainArrays` mirrors the OTHER PETIT_DUMP shape
 *  (`_render_real.test.ts`'s tier/water/objects, what `render-terrain.py` actually parses) for a
 *  bench that wants the coarse picture instead. `transcript` is prose a judge (or a human) reads
 *  directly, grouped per MODEL TURN: op summaries + outcome are folded by `deriveView` (already
 *  `firstLine`-sanitized, never raw JSON) and never re-derived here, but the turn boundaries and
 *  `says` are read straight off the LOG rather than the view (see `turnsForOrder`), since
 *  `deriveView` groups ops per JOB and only keeps a job's most recent live text, dropping it
 *  entirely once the job settles. Browser-safe: no node imports, so it can run inside the
 *  live app as well as an offline vitest harness. */
import { eventsOf } from '../core/log';
import type { SessionLog } from '../core/log';
import { deriveView } from '../core/project-view';
import type { JobView, OpRow } from '../core/project-view';
import { DROPPED_STOPS } from '../core/types';
import type { SessionEvent } from '../core/types';
import { getCell } from '../../core/model/grid-model';
import { CellZone, TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { objectRect } from '../../state/object-geometry';
import { getAllItems, getCatalogItem } from '../../state/catalog';

export interface RunDump {
  cells: unknown;
  transcript: {
    orders: string[];
    /** One entry per MODEL TURN (assistant event), across every order in log order: what that turn
     *  said and the calls it opened. A dropped-stop turn still stands as an entry (it was spent),
     *  with its narration withheld exactly as the replay withholds it. `note` is a `(system)`
     *  message the LOOP addressed to the model right after this turn (the delivery nudge): the
     *  harness's own lean is part of the judgeable record, and it rides a separate field so
     *  nothing loop-authored can be read as the model's words. */
    turns: {
      says: string[];
      /** `image: true` marks a result that carried a rendered picture of the map (the run had
       *  eyes on that call); the base64 itself never enters the dump. */
      ops: { name: string; summary: string; status: string; image?: true }[];
      note?: string;
    }[];
    outcome: string;
  };
  stats: {
    /** Assistant turns, the same count a live block's `turns` reports — never the order count. */
    turns: number; ops: number; writes: number; reverts: number; regionBlocks: number;
    gates: number; steers: number; cells: number; objects: number;
    /** Tool results that carried a rendered image. */
    images: number;
  };
  /** Catalog items the run NAMED in its said lines with no object of that item standing on the
   *  final map — the mechanical side of the groundedness reading. A plain name match (en with
   *  plural, zh as substring) over the says alone: it misses synonyms and paraphrase, and a claimed
   *  structure that is not a catalog item at all never appears here. The judge weighs it; this
   *  field only points. */
  claims: { name: string; catalogId: string }[];
  /** Every plan the run committed (`update_plan` -> the log's `plan` events), with the 1-based
   *  MODEL TURN it followed, so a judge can hold the op sequence against the run's own stages. The
   *  `update_plan` op row itself only says "Plan set." — the stages live here. */
  plans: { revision: number; turn: number; stages: string[] }[];
}

export interface TerrainArrays {
  tier: number[]; water: number[]; w: number; h: number;
  objects: { kind: string; e: number; x: number; y: number; w: number; h: number }[];
}

type DumpOp = RunDump['transcript']['turns'][number]['ops'][number];

/** An op row's judge-facing line: NEVER empty by construction. A row without result text (a call
 *  cut off by the job's end, a result that was all refusal banner, a loaded skill whose summary the
 *  view blanks for its chip) names its status instead, so a transcript reader is never shown a
 *  blank where the one interesting fact was. */
function dumpOp(o: OpRow, withImage: ReadonlySet<string>): DumpOp {
  const summary = o.summary !== ''
    ? o.summary
    : o.skill !== undefined ? o.skill.title : `(${o.status}: no result text)`;
  return { name: o.name, summary, status: o.status, ...(withImage.has(o.callId) ? { image: true as const } : {}) };
}

/** One job's transcript turns: every `assistant` event strictly between its order and the next
 *  (or the log's end), each carrying that turn's finished `TextPart`s (withheld for a
 *  `DROPPED_STOPS` stop, whose text was never resent, so a judge must not see it either) and the
 *  op rows for the calls that turn opened. Reads the log directly rather than `deriveView`'s
 *  `JobView.says`, which only ever holds the CURRENT job's most recent live line and forgets it
 *  once the job settles; the OP ROWS come from the view (summary/status already folded). A row the
 *  walk never attributes to a turn (a result logged with no assistant event carrying its call)
 *  rides the job's last turn rather than vanishing. */
function turnsForOrder(
  events: readonly SessionEvent[], orderSeq: number, ops: readonly OpRow[], withImage: ReadonlySet<string>,
): RunDump['transcript']['turns'] {
  const opByCall = new Map<string, OpRow>();
  for (const o of ops) if (!opByCall.has(o.callId)) opByCall.set(o.callId, o);
  const used = new Set<string>();
  const turns: RunDump['transcript']['turns'] = [];
  for (const e of events) {
    if (e.seq <= orderSeq) continue;
    if (e.kind === 'order') break;
    if (e.kind === 'systemNote') {
      // The loop's note answers the turn before it; a note with no turn to answer (a malformed
      // log) still stands as its own entry rather than vanishing.
      const tail = turns[turns.length - 1];
      if (tail) tail.note = e.text;
      else turns.push({ says: [], ops: [], note: e.text });
      continue;
    }
    if (e.kind !== 'assistant') continue;
    const says: string[] = [];
    if (!DROPPED_STOPS.has(e.stop)) {
      for (const p of e.parts) {
        if (p.kind === 'text' && p.done) says.push(p.text);
      }
    }
    const turnOps: DumpOp[] = [];
    for (const p of e.parts) {
      if (p.kind !== 'tool' || used.has(p.callId)) continue;
      used.add(p.callId);
      const row = opByCall.get(p.callId);
      if (row) turnOps.push(dumpOp(row, withImage));
    }
    turns.push({ says, ops: turnOps });
  }
  const leftovers = ops.filter((o) => !used.has(o.callId)).map((o) => dumpOp(o, withImage));
  if (leftovers.length > 0) {
    const tail = turns[turns.length - 1];
    if (tail) tail.ops.push(...leftovers);
    else turns.push({ says: [], ops: leftovers });
  }
  return turns;
}

/** One entry per cell in raster order, shaped exactly like the PETIT_DUMP cut-dump harness writes
 *  (`x, y, zone, type, e, corners, patch`) so `render-cuts.py` reads it with no adapter. */
function dumpCells(grid: GridState): unknown[] {
  const { width, height } = grid.template;
  const cells: unknown[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = getCell(grid.cells, x, y);
      const t = cell?.terrain ?? null;
      cells.push({
        x, y,
        zone: cell?.zone ?? CellZone.Void,
        type: t ? (t.type === TerrainType.Mountain ? 'm' : t.type === TerrainType.Water ? 'w' : 'n') : 'n',
        e: t ? t.elevation : 0,
        corners: t?.corners ?? null,
        patch: !!t?.patchOnly,
      });
    }
  }
  return cells;
}

/** The coarse per-run picture `render-terrain.py` parses (`size`/`cols`/`maps`/`row`/`col`/
 *  `label` are the multi-run montage wrapper around this, and belong to the offline bench, not
 *  here). Mirrors `_render_real.test.ts`'s hand-built dump exactly: `tier`/`water` are flat
 *  raster-order arrays reconstructed from each cell's committed terrain, and `kind` is the
 *  catalog category (never `PlacedObject`'s own `catalogId`), since that is what the renderer's
 *  colour table keys on. Locked objects (the plaza) are excluded, same as that harness. */
export function terrainArrays(grid: GridState): TerrainArrays {
  const w = grid.template.width, h = grid.template.height;
  const tier: number[] = [], water: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = grid.cells[y]?.[x]?.terrain ?? null;
      tier.push(t && t.type === TerrainType.Mountain ? t.elevation : 0);
      water.push(t && t.type === TerrainType.Water ? t.elevation : -1);
    }
  }
  const objects = [...grid.objects.values()]
    .filter((o) => !o.locked)
    .map((o) => ({ kind: getCatalogItem(o.catalogId)?.category ?? 'building', e: o.elevation, ...objectRect(o) }));
  return { tier, water, w, h, objects };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Catalog items the said lines name that stand nowhere on the grid. English names match on word
 *  boundaries with an optional plural `s`; zh names match as substrings (CJK has no word
 *  boundaries). Reads the SAYS only — an order or a tool summary naming an item is not the model
 *  claiming it built one. */
function claimsSweep(turns: RunDump['transcript']['turns'], grid: GridState): RunDump['claims'] {
  const said = turns.flatMap((t) => t.says).join('\n');
  if (!said.trim()) return [];
  const lower = said.toLowerCase();
  const standing = new Set<string>();
  for (const o of grid.objects.values()) if (!o.locked) standing.add(o.catalogId);
  const claims: RunDump['claims'] = [];
  for (const item of getAllItems()) {
    if (standing.has(item.id)) continue;
    const en = item.name.en.trim();
    const enHit = en !== '' && new RegExp(`\\b${escapeRegExp(en.toLowerCase())}s?\\b`).test(lower);
    const zh = item.name.zh?.trim();
    const zhHit = zh !== undefined && zh !== '' && said.includes(zh);
    if (enHit || zhHit) claims.push({ name: en, catalogId: item.id });
  }
  claims.sort((a, b) => a.catalogId.localeCompare(b.catalogId));
  return claims;
}

/** The committed plans in log order, each stamped with the 1-based model turn it followed (the
 *  same turn count `turnsForOrder` produces, dropped-stop turns included). */
function plansOf(events: readonly SessionEvent[]): RunDump['plans'] {
  const plans: RunDump['plans'] = [];
  let turn = 0;
  for (const e of events) {
    if (e.kind === 'assistant') turn++;
    else if (e.kind === 'plan') plans.push({ revision: e.revision, turn, stages: e.stages.map((s) => s.label) });
  }
  return plans;
}

export function dumpRun(log: SessionLog, grid: GridState): RunDump {
  const view = deriveView(log);
  const jobs: JobView[] = view.current ? [...view.jobs, view.current] : view.jobs;
  const events = eventsOf(log);

  const orders = jobs.map((j) => j.orderText);
  const withImage = new Set<string>();
  let images = 0;
  for (const e of events) {
    if (e.kind === 'toolResult' && e.image !== undefined) { withImage.add(e.callId); images++; }
  }
  const turns = jobs.flatMap((j) => turnsForOrder(events, j.orderSeq, j.ops, withImage));
  const last = jobs[jobs.length - 1];
  const outcome = last === undefined ? 'no orders'
    : last.outcome === undefined ? 'in progress'
    : last.summary ? `${last.outcome}: ${last.summary}` : last.outcome;

  const ops = jobs.flatMap((j) => j.ops);
  const writes = ops.filter((o) => o.status === 'ok' && (o.detail?.cells !== undefined || o.detail?.objects !== undefined)).length;
  const reverts = ops.filter((o) => o.status === 'revert').length;
  const regionBlocks = ops.filter((o) => o.status === 'blocked').length;
  const gates = events.filter((e) => e.kind === 'gateAsked').length;
  const steers = events.filter((e) => e.kind === 'steerDelivered').length;

  return {
    cells: dumpCells(grid),
    transcript: { orders, turns, outcome },
    stats: {
      turns: turns.length, ops: ops.length, writes, reverts, regionBlocks,
      gates, steers, cells: view.vitals.cells, objects: view.vitals.objects, images,
    },
    claims: claimsSweep(turns, grid),
    plans: plansOf(events),
  };
}
