// @vitest-environment node
/**
 * Env-gated live probe for the suggest_reply flow: a turn that ends on an
 * offer must yield a model-authored composer suggestion (the silent sign-off
 * check + the terminal suggest_reply round). Run with SITELOG_LIVE_KEY.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { makeState } from '../rules/_helpers';
import { buildSystemPrompt } from '../../agent/system-prompt';
import { TOOL_SCHEMAS, buildMapContext, type AgentToolDeps } from '../../agent/tools';
import { runSiteLogTurn } from '../../agent/turn-runner';
import { useAgentSession } from '../../agent/session';
import { createOpenAIAdapter } from '../../agent/providers/openai';
import { roadLookup } from '../../state/object-index';

declare const process: { env: Record<string, string | undefined> };

const KEY = process.env.SITELOG_LIVE_KEY;
const MODEL = process.env.SITELOG_LIVE_MODEL ?? 'gpt-5.4-mini';
const d = KEY ? describe : describe.skip;
const t = (k: string) => k;

d('suggest_reply live probe', () => {
  it('an offer-shaped turn produces a model-authored suggestion', async () => {
    const state = makeState(64, 64);
    const bus = new EventBus();
    const executor = new CommandExecutor(state, bus as never, createDefaultRegistry(), roadLookup(state));
    const deps = { getState: () => state, getExecutor: () => executor, getRegion: () => [] } as unknown as AgentToolDeps;
    useAgentSession.setState({ log: [], running: false, thinking: false, gate: null, suggestion: null,
      vitals: { water: 0, tree: 0, build: 0, flower: 0 }, resumeSummary: '' });
    const history = await runSiteLogTurn({
      adapter: createOpenAIAdapter(KEY!), model: MODEL, system: buildSystemPrompt(createDefaultRegistry()),
      tools: TOOL_SCHEMAS, history: [],
      userText: 'Add a small pond near the center. When you are done, offer me ONE natural follow-up you could do next.',
      mapContext: buildMapContext(state, [], deps), deps,
      oversight: 'yolo', signal: new AbortController().signal, t,
    });
    // eslint-disable-next-line no-console
    console.log('[probe] suggestion:', JSON.stringify(useAgentSession.getState().suggestion));
    void history;
    expect(useAgentSession.getState().suggestion).toBeTruthy();
  }, 180000);
});
