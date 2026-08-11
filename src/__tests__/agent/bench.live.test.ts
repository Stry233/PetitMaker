// @vitest-environment node
/**
 * LIVE closed-loop bench for the agent harness — skipped unless env-gated.
 *
 * Drives the REAL agent loop (runAgentTurn) + REAL tool bridge (executeToolCall)
 * + REAL rule validation against a live OpenAI-compatible endpoint, on a blank
 * map, and measures what the harness delivers end-to-end: scorecard before/after,
 * tool outcome counts, damper/governor activations, and a terrain dump renderable
 * with the maintainers' offline terrain renderer (no browser needed).
 *
 * Run (example — any OpenAI-compatible gateway, gpt-oss:120b):
 *   AGENT_BENCH_URL=https://your-gateway.example.edu/api \
 *   AGENT_BENCH_KEY=sk-… \
 *   AGENT_BENCH_MODEL=gpt-oss:120b \
 *   npx vitest run src/__tests__/agent/bench.live.test.ts
 *
 * Optional: AGENT_BENCH_TURNS (default 28), AGENT_BENCH_MIN_INTERVAL_MS
 * (default 3500 — stays under a typical 20 requests/minute gateway cap), AGENT_BENCH_OUT
 * (report dir, default os.tmpdir()), AGENT_BENCH_TASK (override the scenario).
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore — no @types/node in this browser-SPA project; node-only bench harness
import { writeFileSync, mkdirSync } from 'node:fs';
// @ts-ignore — see above
import { tmpdir } from 'node:os';
// @ts-ignore — see above
import { join } from 'node:path';
import { roadLookup } from '../../state/object-index';

// node global (bench runs in the node environment only; not part of the app bundle)
declare const process: { env: Record<string, string | undefined> };
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import { TerrainType, type EditorEvents } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { createOpenAIAdapter } from '../../agent/providers/openai';
import { buildSystemPrompt } from '../../agent/system-prompt';
import { runAgentTurn } from '../../agent/loop';
import { TOOL_SCHEMAS, executeToolCall, buildMapContext, type AgentToolDeps } from '../../agent/tools';
import { evaluateMap, overallScore } from '../../agent/quality';
import { objectRect } from '../../state/object-geometry';
import { getCatalogItem } from '../../state/catalog';
import type { PlanStage, ProviderAdapter, ToolEvent } from '../../agent/types';

const URL = process.env.AGENT_BENCH_URL;
const KEY = process.env.AGENT_BENCH_KEY;
const MODEL = process.env.AGENT_BENCH_MODEL ?? 'gpt-oss:120b';
const MAX_TURNS = Number(process.env.AGENT_BENCH_TURNS ?? 28);
const MIN_INTERVAL_MS = Number(process.env.AGENT_BENCH_MIN_INTERVAL_MS ?? 3500);
const OUT_DIR = process.env.AGENT_BENCH_OUT ?? tmpdir();

const TASK =
  process.env.AGENT_BENCH_TASK ??
  'Build a cozy lakeside scene on this empty 64x64 map: a lake with a short river, one bridge crossing it, ' +
  'a small village of a few houses connected by roads, a terraced hill with a lookout, and natural planting. ' +
  'Use update_plan to stage the work, and finish with evaluate_map + a short summary.';

/** Pace + retry wrapper: respects the endpoint's requests/minute budget and
 *  retries transient failures (429 / null responses) with backoff. */
function pacedAdapter(inner: ProviderAdapter, minIntervalMs: number): ProviderAdapter {
  let lastStart = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    listModels: () => inner.listModels(),
    async stream(req, cb, signal) {
      for (let attempt = 0; ; attempt++) {
        const wait = lastStart + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastStart = Date.now();
        try {
          return await inner.stream(req, cb, signal);
        } catch (err) {
          if (signal.aborted || attempt >= 3) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          // rate limit / transient gateway hiccup → back off and retry
          if (!/429|rate|limit|timeout|network|fetch|5\d\d|null/i.test(msg)) throw err;
          await sleep(15_000 * (attempt + 1));
        }
      }
    },
  };
}

describe.skipIf(!URL || !KEY)('LIVE agent bench (env-gated)', () => {
  it('closed-loop build on a blank map produces a scored, rule-valid scene', async () => {
    const state = makeState(64, 64);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    let plan: PlanStage[] = [];
    const deps: AgentToolDeps = {
      getState: () => state,
      getExecutor: () => exec,
      getRegion: () => [],
      setPlan: (p) => { plan = p; },
      getPlan: () => plan,
    };

    const before = evaluateMap(state);
    const adapter = pacedAdapter(createOpenAIAdapter(KEY!, URL!), MIN_INTERVAL_MS);
    const system = buildSystemPrompt(exec.getRegistry());
    const tools = TOOL_SCHEMAS.filter((t) => t.name !== 'delegate_task' && t.name !== 'view_map');

    const events: ToolEvent[] = [];
    const assistantTexts: string[] = [];
    const t0 = Date.now();
    const history = await runAgentTurn({
      adapter,
      model: MODEL,
      system,
      tools,
      history: [],
      userText: TASK,
      mapContext: buildMapContext(state, [], deps),
      execTool: (c) => executeToolCall(c, deps),
      onTextDelta: () => {},
      onToolEvent: (ev) => events.push(ev),
      onAssistantDone: (text) => { if (text) assistantTexts.push(text); },
      signal: new AbortController().signal,
      maxTurns: MAX_TURNS,
    });
    const durationMs = Date.now() - t0;

    // ── measurements ──
    const after = evaluateMap(state);
    const results = events.filter((e): e is Extract<ToolEvent, { kind: 'result' }> => e.kind === 'result');
    const byStatus = { ok: 0, error: 0, reverted: 0 };
    const byTool = new Map<string, { ok: number; error: number; reverted: number }>();
    for (const r of results) {
      byStatus[r.status]++;
      const t = byTool.get(r.name) ?? { ok: 0, error: 0, reverted: 0 };
      t[r.status]++;
      byTool.set(r.name, t);
    }
    const toolContents = history
      .filter((m) => m.role === 'tool')
      .flatMap((m) => (m as Extract<typeof m, { role: 'tool' }>).results.map((r) => r.content));
    const damper = {
      verbatimRetry: toolContents.filter((c) => c.includes('(system) This exact')).length,
      revertStrategy: toolContents.filter((c) => c.includes('rolled back') && c.includes('Change strategy')).length,
      budgetWarned: toolContents.some((c) => c.includes('Turn budget:')),
      stageScorecards: toolContents.filter((c) => c.includes('Scorecard: overall')).length,
    };
    let mountains = 0, waterCells = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const t = state.cells[y]![x]!.terrain;
      if (t?.type === TerrainType.Mountain) mountains++;
      if (t?.type === TerrainType.Water) waterCells++;
    }

    const report = {
      endpoint: URL, model: MODEL, maxTurns: MAX_TURNS, durationMs,
      apiTurns: history.filter((m) => m.role === 'assistant').length,
      toolCalls: results.length, byStatus, byTool: Object.fromEntries(byTool),
      damper,
      plan,
      overallBefore: overallScore(before), overallAfter: overallScore(after),
      scoreAfter: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.score])),
      mountains, waterCells, objects: state.objects.size,
      finalReport: assistantTexts[assistantTexts.length - 1] ?? '',
    };

    // ── artifacts: JSON report + offline-renderable terrain dump ──
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'agent-bench-report.json'), JSON.stringify(report, null, 2));
    const tier: number[] = [], water: number[] = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const c = state.cells[y]![x]!.terrain;
      tier.push(c && c.type === TerrainType.Mountain ? c.elevation : 0);
      water.push(c && c.type === TerrainType.Water ? c.elevation : -1);
    }
    const objects = [...state.objects.values()].filter((o) => !o.locked)
      .map((o) => ({ kind: getCatalogItem(o.catalogId)?.category ?? 'building', e: o.elevation, ...objectRect(o) }));
    writeFileSync(
      join(OUT_DIR, 'agent-bench-map.json'),
      JSON.stringify({ size: 64, w: 64, h: 64, cols: 1, maps: [{ label: `${MODEL} bench`, row: 0, col: 0, tier, water, objects }] }),
    );
    // eslint-disable-next-line no-console
    console.log(`bench report -> ${join(OUT_DIR, 'agent-bench-report.json')}\n${JSON.stringify(report, null, 2)}`);

    // Soft floor (live LLM output is nondeterministic): the loop must have
    // actually built something legal, not just chatted.
    expect(byStatus.ok).toBeGreaterThan(0);
    expect(state.objects.size + mountains + waterCells).toBeGreaterThan(0);
  }, 1_800_000);
});
