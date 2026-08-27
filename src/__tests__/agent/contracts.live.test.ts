// @vitest-environment node
/**
 * THE V3 LIVE HARNESS — one small job through the REAL loop, against a REAL model, env-gated.
 *
 * WHY IT EXISTS. This is the tree's one path by which a real model can be driven: without it the
 * loop, the tool surface, the rules and the six model-copy contracts are verifiable only against
 * scripted output. `llm-actor.test.ts` beside this file is the scripted twin — the same job shape, the same
 * assertions, running in CI — and this is the half that confirms them against a model that has not
 * been told what to say.
 *
 * GATEWAY-FIRST. It reads an OpenAI-compatible endpoint through the CUSTOM adapter
 * (vLLM, Ollama, LiteLLM, a campus gateway — the same adapter and quirks the app's own `custom`
 * provider uses), because that is the key a gateway user has. Nothing here is provider-specific:
 * point it at api.openai.com and it works the same way.
 *
 *   AGENT_LIVE_BASE_URL=https://gateway.example/v1 \
 *   AGENT_LIVE_KEY=sk-… \
 *   AGENT_LIVE_MODEL=Qwen3-32B \
 *   npx vitest run src/__tests__/agent/contracts.live.test.ts
 *
 * Optional: AGENT_LIVE_TURNS (default 10), AGENT_LIVE_TIMEOUT_MS (default 240000),
 * AGENT_LIVE_ORDER (override the order), AGENT_LIVE_STRICT=1 (a contract finding FAILS the run
 * rather than being reported — off by default, since a real model is allowed to be imperfect and the
 * run is evidence either way).
 *
 * IT SKIPS LOUDLY AND COSTS NOTHING IDLE. Without the env triple the suite prints what it would
 * need and skips — the house idiom for an env-gated test — so a CI run neither fails nor quietly
 * pretends to have verified anything.
 *
 * WHAT IT ASSERTS. Not the map: a model is free to build the rise however it likes, and a harness
 * that graded the design would fail on taste. It asserts that the job REACHED the map through the
 * real rules (something was written, and the projection can see it), that it SETTLED rather than
 * ending in an incident, and that every model-authored string the panel would render wears the shape
 * the interface was drawn for (`_llm-contracts.ts`, the same reader the scripted twin uses).
 */
import { describe, expect, it } from 'vitest';

import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules';
import { roadLookup } from '../../state/object-index';
import { append, createLog, eventsOf } from '../../agent/core/log';
import { runJob, type LoopDeps } from '../../agent/core/loop';
import { deriveView } from '../../agent/core/project-view';
import { createExecutor, wireSchemas } from '../../agent/exec/executor';
import { QUIRKS } from '../../agent/providers/defaults';
import { createOpenAIAdapter } from '../../agent/providers/openai';
import { buildSystemPrompt } from '../../agent/system-prompt';
import { buildMapContext, type AgentToolDeps } from '../../agent/tools';
import { makeState } from '../rules/_helpers';
import { checkContracts, reportContracts } from './_llm-contracts';

// The node globals this file needs. No `@types/node` in this browser-SPA project, and the live
// harness is the only test that runs outside jsdom.
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void };

const BASE_URL = process.env.AGENT_LIVE_BASE_URL;
const KEY = process.env.AGENT_LIVE_KEY;
const MODEL = process.env.AGENT_LIVE_MODEL;
const MAX_TURNS = Number(process.env.AGENT_LIVE_TURNS ?? 10);
const TIMEOUT_MS = Number(process.env.AGENT_LIVE_TIMEOUT_MS ?? 240_000);
const STRICT = process.env.AGENT_LIVE_STRICT === '1';

/** THE SAME ORDER THE SCRIPTED TWIN IS GIVEN, so the two runs are comparable. Small on purpose: the
 *  subject is the shape of what comes back, and a large build only buys more of the same strings. */
const ORDER = process.env.AGENT_LIVE_ORDER
  ?? 'Terrace the little rise at the north end of the plaza and put a lookout on top of it. '
  + 'File a short plan first, and finish with one or two sentences about what you built.';

const ARMED = Boolean(BASE_URL && KEY && MODEL);

if (!ARMED) {
  console.log(
    '[live] SKIPPED: the v3 live harness needs AGENT_LIVE_BASE_URL, AGENT_LIVE_KEY and '
    + 'AGENT_LIVE_MODEL (any OpenAI-compatible endpoint, through the CUSTOM adapter). '
    + 'The scripted twin `llm-actor.test.ts` covers the same assertions without a key.',
  );
}

describe.skipIf(!ARMED)('one small job against a live model', () => {
  it('settles, reaches the map through the real rules, and writes strings the panel can hold', async () => {
    const state = makeState(24, 24);
    const bus = new EventBus<EditorEvents>();
    const executor = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
    const toolDeps: AgentToolDeps = {
      getState: () => state,
      getExecutor: () => executor,
      getRegion: () => [],
    };

    const registry = createDefaultRegistry();
    const log = createLog();
    append(log, { kind: 'order', text: ORDER, mapContext: buildMapContext(state, []) });
    append(log, { kind: 'checkpoint', undoIndex: 0, label: 'job' });

    const deps: LoopDeps = {
      // The CUSTOM provider's own adapter and quirks: whatever the gateway speaks, it speaks it the
      // way the app's `custom` provider does.
      adapter: createOpenAIAdapter({ apiKey: KEY!, baseUrl: BASE_URL!, quirks: QUIRKS.custom }),
      model: MODEL!,
      system: buildSystemPrompt(registry),
      tools: wireSchemas(),
      executor: createExecutor(toolDeps),
      // No human is watching, so nothing may block on a gate: `yolo` is the only honest oversight
      // for an unattended run, and the region lock is unset for the same reason.
      oversight: 'yolo',
      sameModel: true,
      budgetTokens: 120_000,
      maxTurns: MAX_TURNS,
      signal: new AbortController().signal,
      undoStackSize: () => executor.getUndoStackSize(),
    };

    const outcome = await runJob(log, deps);
    const view = deriveView(log);
    const job = view.jobs[view.jobs.length - 1]!;

    console.log(`[live] ${MODEL} at ${BASE_URL}: ${outcome} in ${job.ops.length} ops`
      + ` (${view.vitals.cells} cells, ${view.vitals.objects} objects, ${view.vitals.reverts} reverts)`);
    for (const ev of eventsOf(log)) {
      if (ev.kind === 'incident') console.log(`[live] incident (${ev.error.cls}): ${ev.error.detail}`);
    }

    // IT SETTLED. An incident is the one outcome that says nothing about the contracts: the job never
    // got far enough to write the strings under test.
    expect(outcome, 'the job ended without an incident').not.toBe('incident');
    // AND IT REACHED THE MAP. Not what it built — a model may lay the rise however it likes — only
    // that the real tool path, with the real rules behind it, applied something.
    expect(view.vitals.cells + view.vitals.objects, 'the job wrote something to the map')
      .toBeGreaterThan(0);

    const findings = checkContracts(log);
    console.log(`[live] contracts: ${reportContracts(findings)}`);
    if (STRICT) expect(findings, reportContracts(findings)).toEqual([]);
  }, TIMEOUT_MS);
});
