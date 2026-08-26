// @vitest-environment node
/**
 * THE PERPLEXITY ROUTER, LIVE — the catalog, one minimal completion, and the unlisted-model
 * refusal, driven through the app's own OpenAI-dialect adapter and its `perplexity` quirks.
 *
 * WHAT IT CONFIRMS that a scripted test cannot: that the base URL, the Bearer header the SDK builds,
 * the `stream_options.include_usage` ask and the `creator/model-name` catalog are what the Router
 * actually answers to, and that a model outside the catalog comes back as a 400 naming itself.
 * `perplexity.test.ts` beside this file asserts the same shapes against payloads copied from the
 * published reference, and runs in CI.
 *
 *   PERPLEXITY_API_KEY=… npx vitest run src/__tests__/agent/providers/perplexity.live.test.ts
 *
 * Optional: PERPLEXITY_LIVE_MODEL (default: the first slug the catalog lists),
 * PERPLEXITY_LIVE_TIMEOUT_MS (default 120000).
 *
 * IT SKIPS LOUDLY AND COSTS NOTHING IDLE: without the key the suite prints what it would need and
 * skips. The key is read from the environment, presence-checked, and never printed — what the run
 * reports is statuses, counts and shapes.
 */
import { describe, expect, it } from 'vitest';

import { baseUrlFor, QUIRKS } from '../../../agent/providers/defaults';
import { detectProviderFromKey } from '../../../agent/providers/detect';
import { createOpenAIAdapter } from '../../../agent/providers/openai';
import type { StreamEvent } from '../../../agent/core/types';
import type { Adapter, AdapterRequest } from '../../../agent/providers/types';

// The node globals this file needs. No `@types/node` in this browser-SPA project, and the live
// tests are the only ones that run outside jsdom.
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void };

const KEY = process.env.PERPLEXITY_API_KEY;
const MODEL_OVERRIDE = process.env.PERPLEXITY_LIVE_MODEL;
const TIMEOUT_MS = Number(process.env.PERPLEXITY_LIVE_TIMEOUT_MS ?? 120_000);
const ARMED = Boolean(KEY);

if (!ARMED) {
  console.log(
    '[live] SKIPPED: the Perplexity Router smoke needs PERPLEXITY_API_KEY in the environment '
    + '(export it yourself; nothing here reads a file or a vault). '
    + '`perplexity.test.ts` covers the same shapes against the documented payloads, without a key.',
  );
}

/** A slug outside any catalog: the Router answers this with a 400 that names it. */
const NOT_IN_CATALOG = 'example/does-not-exist';

function liveAdapter(): Adapter {
  return createOpenAIAdapter({
    apiKey: KEY!,
    baseUrl: baseUrlFor('perplexity', {}),
    quirks: QUIRKS.perplexity,
  });
}

function request(model: string): AdapterRequest {
  return {
    system: 'Answer in one short sentence.',
    messages: [{ role: 'user', text: 'Say hello.' }],
    // One tool, because a function tool on this wire requires a description and an empty offer
    // tells us nothing. The order does not ask for it; a model that calls it anyway still settles.
    tools: [{
      name: 'note',
      description: 'Records a short note.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }],
    model,
    sameModel: true,
    maxOutputTokens: 64,
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe.skipIf(!ARMED)('the Perplexity Router, live', () => {
  it('names the provider from the key it was handed', () => {
    expect(detectProviderFromKey(KEY!)).toBe('perplexity');
  });

  it('lists a catalog of creator/model-name slugs, and answers one of them with usage', async () => {
    const adapter = liveAdapter();
    const models = await adapter.listModels(new AbortController().signal);
    console.log(`[live] catalog: ${models.length} models, e.g. ${models.slice(0, 3).join(', ')}`);
    expect(models.length).toBeGreaterThan(0);
    for (const id of models) expect(id, 'a creator/model-name slug').toMatch(/^[^/\s]+\/[^/\s]+$/);

    const model = MODEL_OVERRIDE ?? models[0]!;
    const events = await collect(adapter.stream(request(model), new AbortController().signal));
    const done = events.find((e) => e.t === 'done');
    const failure = events.find((e) => e.t === 'error');
    if (failure?.t === 'error') console.log(`[live] ${model}: ${failure.error.cls} (${failure.error.status ?? 'no status'})`);
    expect(failure, 'the turn carried no fault').toBeUndefined();
    if (done?.t !== 'done') throw new Error('the stream ended with no done event');

    const text = events.filter((e) => e.t === 'text').length;
    console.log(`[live] ${model}: stop=${done.stop}, ${text} text deltas, ${done.final?.length ?? 0} tool calls, `
      + `usage=${JSON.stringify(done.usage)}`);
    // `stream_options.include_usage` is asked for by the perplexity quirks, so the final chunk
    // carries the token counts. Their absence would mean the ask was dropped or refused.
    expect(done.usage, 'usage arrived with the stream').toBeDefined();
    expect(done.usage!.input).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it('refuses a model outside the catalog with a 400 that names it', async () => {
    const events = await collect(liveAdapter().stream(request(NOT_IN_CATALOG), new AbortController().signal));
    const failure = events.find((e) => e.t === 'error');
    if (failure?.t !== 'error') throw new Error('an unlisted model was not refused');

    console.log(`[live] ${NOT_IN_CATALOG}: ${failure.error.cls} (${failure.error.status ?? 'no status'})`);
    expect(failure.error.status).toBe(400);
    expect(failure.error.detail).toContain(NOT_IN_CATALOG);
  }, TIMEOUT_MS);
});
