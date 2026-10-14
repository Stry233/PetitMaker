// @vitest-environment node
/**
 * The live harness: one small job through the real loop against a real model, the unscripted twin
 * of `llm-actor.test.ts`, through the `custom` adapter. Without the env triple it prints what it
 * needs and skips:
 *
 *   AGENT_LIVE_BASE_URL=https://gateway.example/v1 AGENT_LIVE_KEY=sk-… AGENT_LIVE_MODEL=Qwen3-32B \
 *   npx vitest run src/__tests__/agent/contracts.live.test.ts
 *
 * Optional: AGENT_LIVE_TURNS (10), AGENT_LIVE_TIMEOUT_MS (240000), AGENT_LIVE_ORDER, AGENT_LIVE_STRICT=1
 * (a contract finding fails the run). It asserts the job reached the map through the real rules and
 * settled, and that every model-authored string has the shape `_llm-contracts.ts` reads.
 */
import { describe, expect, it } from 'vitest';

import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../state/editing/events';
import { createDefaultRegistry } from '../../rules';
import { append, createLog, eventsOf } from '../../agent/core/log';
import { runJob, type LoopDeps } from '../../agent/core/loop';
import { deriveView } from '../../agent/core/project-view';
import { createExecutor } from '../../agent/exec/executor';
import { wireSchemas } from '../../agent/tools';
import { QUIRKS } from '../../agent/providers/defaults';
import { createOpenAIAdapter } from '../../agent/providers/openai';
import { buildSystemPrompt } from '../../agent/prompts';
import { buildMapContext, type AgentToolDeps } from '../../agent/tools';
import { makeState } from '../_support/map-state';
import { checkContracts, reportContracts } from './_llm-contracts';
import { createExecutor as createCommandExecutor } from '../../state/executor';

const BASE_URL = process.env.AGENT_LIVE_BASE_URL;
const KEY = process.env.AGENT_LIVE_KEY;
const MODEL = process.env.AGENT_LIVE_MODEL;
const MAX_TURNS = Number(process.env.AGENT_LIVE_TURNS ?? 10);
const TIMEOUT_MS = Number(process.env.AGENT_LIVE_TIMEOUT_MS ?? 240_000);
const STRICT = process.env.AGENT_LIVE_STRICT === '1';

/** The same order the scripted twin is given, so the two runs are comparable. Small on purpose: the
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
    const executor = createCommandExecutor(state, createDefaultRegistry(), bus);
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
      // The custom provider's own adapter and quirks: whatever the gateway speaks, it speaks it the
      // way the app's `custom` provider does.
      adapter: createOpenAIAdapter({ apiKey: KEY!, baseUrl: BASE_URL!, providerId: 'custom', quirks: QUIRKS.custom }),
      model: MODEL!,
      system: buildSystemPrompt(registry),
      tools: wireSchemas(),
      executor: createExecutor(toolDeps),
      // No human is watching, so nothing may block on a gate: `yolo` is the only honest oversight
      // for an unattended run, and the region lock is unset for the same reason.
      oversight: 'yolo',
      sameModel: true,
      maxTurns: MAX_TURNS,
      signal: new AbortController().signal,
      undoStackSize: () => executor.historyDepth(),
    };

    const outcome = await runJob(log, deps);
    const view = deriveView(log);
    const job = view.jobs[view.jobs.length - 1]!;

    console.log(`[live] ${MODEL} at ${BASE_URL}: ${outcome} in ${job.ops.length} ops`
      + ` (${view.vitals.cells} cells, ${view.vitals.objects} objects, ${view.vitals.reverts} reverts)`);
    for (const ev of eventsOf(log)) {
      if (ev.kind === 'incident') console.log(`[live] incident (${ev.error.cls}): ${ev.error.detail}`);
    }

    // It settled. An incident is the one outcome that says nothing about the contracts: the job never
    // got far enough to write the strings under test.
    expect(outcome, 'the job ended without an incident').not.toBe('incident');
    // And it reached the map. Not what it built — a model may lay the rise however it likes — only
    // that the real tool path, with the real rules behind it, applied something.
    expect(view.vitals.cells + view.vitals.objects, 'the job wrote something to the map')
      .toBeGreaterThan(0);

    const findings = checkContracts(log);
    console.log(`[live] contracts: ${reportContracts(findings)}`);
    if (STRICT) expect(findings, reportContracts(findings)).toEqual([]);
  }, TIMEOUT_MS);
});
