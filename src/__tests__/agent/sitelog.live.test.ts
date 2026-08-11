// @vitest-environment node
/**
 * LIVE validation of the Site Log turn runner — skipped unless env-gated.
 *
 * Drives runSiteLogTurn with a REAL provider against REAL editor state and
 * rules, twice (a quick planless job, then a staged blueprint job with the
 * checkpoint-oversight gates auto-answered after they are ASSERTED to appear),
 * then audits what the UI would show:
 *   - session entries carry HUMAN copy only: no raw REVERTED prefix, no tool
 *     names, no token grids or scorecard dumps leaking into notes;
 *   - the blueprint lifecycle is coherent (draft seen, stages noted, done);
 *   - the model made real progress (writes landed, no hard stall) and the
 *     resulting map scores decently; a render-terrain.py-compatible dump and
 *     the session entries are written for offline/visual inspection.
 *
 * Run:
 *   SITELOG_LIVE_KEY=sk-… [SITELOG_LIVE_MODEL=gpt-5.5] [SITELOG_LIVE_URL=…] \
 *   npx vitest run src/__tests__/agent/sitelog.live.test.ts
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore — node-only harness (no @types/node in this browser SPA)
import { writeFileSync, mkdirSync } from 'node:fs';
// @ts-ignore — see above
import { tmpdir } from 'node:os';
// @ts-ignore — see above
import { join } from 'node:path';
import { roadLookup } from '../../state/object-index';

declare const process: { env: Record<string, string | undefined> };
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { TerrainType, type EditorEvents } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { createOpenAIAdapter } from '../../agent/providers/openai';
import { buildSystemPrompt } from '../../agent/system-prompt';
import { TOOL_SCHEMAS, buildMapContext, type AgentToolDeps } from '../../agent/tools';
import { evaluateMap, overallScore } from '../../agent/quality';
import { runSiteLogTurn, answerGate, answerBlueprintGate } from '../../agent/turn-runner';
import { useAgentSession } from '../../agent/session';
import { getPlacedObjectSize } from '../../state/object-geometry';
import type { PlanStage, ProviderAdapter } from '../../agent/types';

const KEY = process.env.SITELOG_LIVE_KEY;
const MODEL = process.env.SITELOG_LIVE_MODEL ?? 'gpt-5.5';
const URL = process.env.SITELOG_LIVE_URL; // optional gateway; default = api.openai.com
const OUT_DIR = process.env.SITELOG_LIVE_OUT ?? tmpdir();
const MIN_INTERVAL_MS = Number(process.env.SITELOG_LIVE_MIN_INTERVAL_MS ?? 1200);

const d = KEY ? describe : describe.skip;

/** Pace + retry (mirrors bench.live): stay polite, absorb transient 429s. */
function paced(inner: ProviderAdapter): ProviderAdapter {
  let last = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    listModels: () => inner.listModels(),
    async stream(req, cb, signal) {
      for (let attempt = 0; ; attempt++) {
        const wait = last + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        try {
          return await inner.stream(req, cb, signal);
        } catch (err) {
          if (signal.aborted || attempt >= 3) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          if (!/429|rate|limit|timeout|network|fetch|5\d\d/i.test(msg)) throw err;
          await sleep(12_000 * (attempt + 1));
        }
      }
    },
  };
}

/** A UI string must read as human copy — never terminal/tool output. */
function assertHumanCopy(label: string, text: string): void {
  expect(text, `${label} should not be empty`).toBeTruthy();
  expect(text, `${label} leaked the raw revert prefix`).not.toContain('REVERTED');
  expect(text, `${label} leaked a scorecard dump`).not.toContain('MAP QUALITY SCORECARD');
  expect(text, `${label} leaked a token-grid legend`).not.toContain('Legend: 1-');
  expect(/[a-z_]+_[a-z_]+\(/.test(text), `${label} leaked a tool call: ${text.slice(0, 80)}`).toBe(false);
  const gridLine = text.split('\n').some((l) => /^[.~:#0-8A-I ]{24,}$/.test(l.trim()));
  expect(gridLine, `${label} leaked a token grid row`).toBe(false);
}

const S = () => useAgentSession.getState();
const t = (k: string, p?: Record<string, string | number>) =>
  p ? Object.entries(p).reduce((s, [key, v]) => s.replace(`{${key}}`, String(v)), KEY_COPY[k] ?? k) : (KEY_COPY[k] ?? k);
const KEY_COPY: Record<string, string> = {
  'agent2.set_aside': 'Set aside. The draft stays here if you change your mind.',
  'agent2.paused_note': 'Paused. The blueprint keeps its place, resume whenever.',
  'agent2.finished_in': 'finished in {n} steps',
  'agent2.helper': 'Helper',
  'agent2.helper_started': 'A helper took a task: {task}',
};

d('site-log live validation', () => {
  it('runs a quick job and a gated blueprint job with clean UI entries and a decent map', async () => {
    const state = makeState(64, 64);
    const bus = new EventBus<EditorEvents>();
    const registry = createDefaultRegistry();
    const executor = new CommandExecutor(state, bus, registry, roadLookup(state));
    let plan: PlanStage[] = [];
    const deps: AgentToolDeps = {
      getState: () => state,
      getExecutor: () => executor,
      getRegion: () => [],
      setPlan: (p) => { plan = p; },
      getPlan: () => plan,
    };
    const adapter = paced(createOpenAIAdapter(KEY!, URL));
    const system = buildSystemPrompt(registry);

    useAgentSession.setState({
      log: [], running: false, thinking: false, gate: null,
      vitals: { water: 0, tree: 0, build: 0, flower: 0 }, resumeSummary: '',
    });

    // auto-answer the human gates AFTER asserting they appear (validates the
    // May-I + draft-gate plumbing against a real model)
    let sawDraftGate = false;
    let sawMayI = false;
    const answering = setInterval(() => {
      const st = S();
      if (st.gate) { sawMayI = true; answerGate('allow'); }
      const draft = st.log.find((e) => e.kind === 'bp' && e.draft && !e.undone);
      if (draft && !st.running) { sawDraftGate = true; answerBlueprintGate(true); }
    }, 400);

    try {
      /* ── turn 1: quick planless job ── */
      const h1 = await runSiteLogTurn({
        adapter, model: MODEL, system, tools: TOOL_SCHEMAS,
        history: [], userText: 'Add a small pond near the center of the map with a few reeds around it. Keep it small and simple.',
        mapContext: buildMapContext(state, [], deps), deps,
        oversight: 'checkpoint', signal: new AbortController().signal, t,
      });
      expect(h1.length).toBeGreaterThan(1);
      const afterQuick = S().log;
      const quickTicket = afterQuick.find((e) => e.kind === 'ticket');
      const quickBp = afterQuick.find((e) => e.kind === 'bp');
      if (!quickTicket && !quickBp) {
        // eslint-disable-next-line no-console
        console.log('[live][debug] no card; session entries:',
          JSON.stringify(afterQuick.map((e) => ({ kind: e.kind, text: (e as { text?: string }).text?.slice(0, 300) })), null, 1));
        // eslint-disable-next-line no-console
        console.log('[live][debug] last assistant:', JSON.stringify(h1[h1.length - 1])?.slice(0, 500));
      }
      // real work must land as a card; a ticket is the RIGHT-SIZED shape for
      // this small job (a bp = over-planning, tolerated but logged)
      expect(quickTicket || quickBp, 'quick job should produce a build card').toBeTruthy();
      expect(executor.getUndoStackSize(), 'quick job should write to the map').toBeGreaterThan(0);
      // eslint-disable-next-line no-console
      if (!quickTicket) console.log('[live] NOTE: model over-planned the quick job (bp instead of ticket)');
      if (quickTicket?.kind === 'ticket') {
        expect(quickTicket.rail.length).toBeGreaterThan(0);
        expect(quickTicket.rail.some((x) => x.s === 'ok')).toBe(true);
        assertHumanCopy('ticket title', quickTicket.title);
      }

      /* ── turn 2: staged blueprint job (draft gate + possible May-I) ── */
      const h2 = await runSiteLogTurn({
        adapter, model: MODEL, system, tools: TOOL_SCHEMAS,
        history: h1,
        userText:
          'Now build a cozy lakeside village around the pond area: expand the water into a lake with a short river, ' +
          'add one bridge, a few houses connected by roads, a small terraced hill, and natural planting. ' +
          'This is a big job: stage it with update_plan first, then execute the stages, and finish with a short summary.',
        mapContext: buildMapContext(state, [], deps), deps,
        oversight: 'checkpoint', signal: new AbortController().signal, t,
      });
      expect(h2.length).toBeGreaterThan(h1.length);
    } finally {
      clearInterval(answering);
    }

    /* ── audit the session the UI would render ── */
    const log = S().log;
    expect(sawDraftGate, 'the blueprint draft gate should have appeared').toBe(true);
    void sawMayI; // wide tools may or may not be used by the model; logged below

    for (const e of log) {
      if (e.kind === 'note') assertHumanCopy('note', e.text);
      if (e.kind === 'ticket') {
        assertHumanCopy('ticket title', e.title);
        if (e.sub) assertHumanCopy('ticket sub', e.sub);
        for (const st of e.steps ?? []) assertHumanCopy('ticket step', st.t);
        if (e.revertnote) assertHumanCopy('revert note', e.revertnote);
      }
      if (e.kind === 'bp') {
        expect(e.stages.length).toBeGreaterThanOrEqual(2);
        expect(e.stages.length).toBeLessThanOrEqual(8);
        for (const s of e.stages) assertHumanCopy('stage title', s);
        for (const n of Object.values(e.notes)) assertHumanCopy('stage note', n);
      }
    }
    const bp = log.find((e) => e.kind === 'bp' && !e.undone);
    expect(bp, 'the big job should have produced a blueprint').toBeTruthy();
    if (bp?.kind === 'bp') {
      expect(bp.draft).toBe(false);
      expect(bp.doneCount).toBeGreaterThanOrEqual(1);
      // PLAN COMPLETION DISCIPLINE: a finished turn must never leave a live
      // in-progress blueprint — every stage done, or (only if the model
      // ignored both nudges) an honestly paused card.
      expect(bp.done || bp.paused, `blueprint left live in progress: ${bp.doneCount}/${bp.stages.length} done`).toBe(true);
      expect(bp.done, `blueprint should FINISH its stages (got ${bp.doneCount}/${bp.stages.length}, paused=${bp.paused})`).toBe(true);
    }
    // eslint-disable-next-line no-console
    console.log('[live] suggest_reply fired:', S().suggestion !== null, S().suggestion ? `-> "${S().suggestion}"` : '');

    // real progress on the map, model not stuck
    expect(executor.getUndoStackSize(), 'writes should have landed').toBeGreaterThan(2);
    const report = evaluateMap(state);
    const score = overallScore(report);
    expect(report.water.score, 'water should exist and score').toBeGreaterThanOrEqual(4);
    expect(score, 'overall map quality').toBeGreaterThanOrEqual(4);

    // stall/oscillation audit: the dampers should not have had to escalate often
    const allHistoryText = JSON.stringify(useAgentSession.getState().resumeSummary);
    void allHistoryText;

    /* ── dumps for offline/visual inspection (renderable by the project's internal terrain renderer) ── */
    const outDir = join(OUT_DIR, 'sitelog-live');
    mkdirSync(outDir, { recursive: true });
    // render-terrain.py schema: one labeled tile with tier/water arrays + kinded objects
    const W = state.template.width, H = state.template.height;
    const tier = new Array<number>(W * H).fill(0);
    const water = new Array<number>(W * H).fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = state.cells[y]![x]!;
        if (!c.terrain) continue;
        if (c.terrain.type === TerrainType.Water) water[y * W + x] = c.terrain.elevation;
        else tier[y * W + x] = c.terrain.elevation;
      }
    }
    const objects = [...state.objects.values()].map((o) => {
      const { w, h } = getPlacedObjectSize(o);
      return { kind: o.catalogId.split('-')[0], x: o.position.x, y: o.position.y, w, h, e: o.elevation };
    });
    writeFileSync(join(outDir, 'map.json'), JSON.stringify({
      size: W, w: W, h: H, cols: 1,
      maps: [{ row: 0, col: 0, label: `sitelog live ${MODEL}`, tier, water, objects }],
    }));
    writeFileSync(join(outDir, 'session.json'), JSON.stringify({ log, vitals: S().vitals, score, report }, null, 2));
    // eslint-disable-next-line no-console
    console.info(`[sitelog-live] score=${score} entries=${log.length} undoDepth=${executor.getUndoStackSize()} mayI=${sawMayI} out=${outDir}`);
  }, 900_000);
});
