/** The prose-tools adapter over the scripted adapter: the CI twin of a live prose-mode bench run.
 *  Schemas are injected into the system prompt, the model's fenced blocks come back as tool
 *  calls, a malformed block rides the loop's own reissue correction, and a blockless reply is a
 *  finishing turn. */
import { describe, expect, it } from 'vitest';
import { createAssembler } from '../../../agent/core/assembler';
import { createLog, append, eventsOf } from '../../../agent/core/log';
import { runJob, type ExecutedResult, type LoopDeps, type ToolExecutor } from '../../../agent/core/loop';
import type { ProviderMessage } from '../../../agent/core/project-messages';
import type { StreamEvent } from '../../../agent/core/types';
import {
  createProseToolsAdapter, parseProseTurn, proseMessages,
  MALFORMED_ARGS_PREFIX, PROSE_CALL_TAG, PROSE_RESULT_TAG,
} from '../../../agent/eval/prose-tools-adapter';
import { createScriptedAdapter, type ScriptedTurn } from '../../../agent/eval/scripted-adapter';
import type { AdapterRequest } from '../../../agent/providers/types';

const TOOLS = [
  { name: 'ping', description: 'Answers pong.', parameters: { type: 'object', properties: { x: { type: 'number' } } } },
  { name: 'paint', description: 'Paints one cell.', parameters: { type: 'object', properties: {}, required: [] } },
];

function baseRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return { system: 'You are the builder.', messages: [], tools: TOOLS, model: 'm', sameModel: true, ...overrides };
}

function textTurn(text: string, stop: 'stop' | 'length' = 'stop'): ScriptedTurn {
  return { events: [{ t: 'text', delta: text }, { t: 'done', stop }] };
}

function block(tag: string, body: string): string {
  return '```' + tag + '\n' + body + '\n```';
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function doneOf(events: StreamEvent[]): Extract<StreamEvent, { t: 'done' }> {
  const done = events[events.length - 1];
  if (done?.t !== 'done') throw new Error('no done event');
  return done;
}

describe('request side', () => {
  it('injects the schemas into the system prompt and offers the wire no tools', async () => {
    const inner = createScriptedAdapter([textTurn('ok')]);
    const adapter = createProseToolsAdapter(inner);
    await collect(adapter.stream(baseRequest(), new AbortController().signal));

    const sent = inner.requests[0]!;
    expect(sent.tools).toEqual([]);
    expect(sent.system).toContain('You are the builder.');
    expect(sent.system).toContain('```' + PROSE_CALL_TAG);
    expect(sent.system).toContain('```' + PROSE_RESULT_TAG);
    expect(sent.system).toContain('### ping');
    expect(sent.system).toContain('Paints one cell.');
    expect(sent.system).toContain(JSON.stringify(TOOLS[0]!.parameters));
    expect(sent.sameModel).toBe(false);
  });

  it('folds tool history into the text protocol', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', text: 'build it' },
      { role: 'assistant', text: 'On it.', toolCalls: [{ callId: 'c1', name: 'ping', args: { x: 1 } }], raw: { secret: true } },
      { role: 'tool', results: [{ callId: 'c1', name: 'ping', content: 'pong', isError: false, image: 'data:image/png;base64,AAA' }] },
    ];
    const folded = proseMessages(messages);
    expect(folded[0]).toEqual(messages[0]);
    expect(folded[1]).toEqual({
      role: 'assistant',
      text: 'On it.\n\n' + block(PROSE_CALL_TAG, '{"tool":"ping","args":{"x":1}}'),
      toolCalls: [],
    });
    expect(folded[2]).toEqual({
      role: 'user',
      text: block(PROSE_RESULT_TAG, '{"tool":"ping","ok":true,"content":"pong"}'),
      images: ['data:image/png;base64,AAA'],
    });
  });

  it('marks an errored result ok:false', () => {
    const folded = proseMessages([
      { role: 'tool', results: [{ callId: 'c1', name: 'ping', content: 'no', isError: true }] },
    ]);
    expect(folded[0]).toEqual({ role: 'user', text: block(PROSE_RESULT_TAG, '{"tool":"ping","ok":false,"content":"no"}') });
  });
});

describe('response side', () => {
  it('parses several blocks as calls in order, keeps the narration, and marks the quirk', async () => {
    const text = 'First I look around.\n\n'
      + block(PROSE_CALL_TAG, '{"tool": "ping", "args": {"x": 1}}')
      + '\nThen I paint.\n'
      + block(PROSE_CALL_TAG, '{"tool": "paint", "args": {}}');
    const adapter = createProseToolsAdapter(createScriptedAdapter([textTurn(text)]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events[0]).toEqual({ t: 'text', delta: 'First I look around.\n\nThen I paint.' });
    expect(events.filter((e) => e.t === 'tool-start').map((e) => e.t === 'tool-start' && e.name)).toEqual(['ping', 'paint']);
    const done = doneOf(events);
    expect(done.stop).toBe('tool-calls');
    expect(done.final).toEqual([
      { callId: 'prose-1-0', name: 'ping', args: { x: 1 }, rawArgs: '{"x":1}' },
      { callId: 'prose-1-1', name: 'paint', args: {}, rawArgs: '{}' },
    ]);
    expect(done.quirks).toEqual(['tool-call-as-prose']);
  });

  it('accepts the wire spelling {"name", "arguments"} inside a block', async () => {
    const adapter = createProseToolsAdapter(createScriptedAdapter([
      textTurn(block(PROSE_CALL_TAG, '{"name": "ping", "arguments": {"x": 2}}')),
    ]));
    const done = doneOf(await collect(adapter.stream(baseRequest(), new AbortController().signal)));
    expect(done.final).toEqual([{ callId: 'prose-1-0', name: 'ping', args: { x: 2 }, rawArgs: '{"x":2}' }]);
  });

  it('recognizes a bare whole-body call through the same reader the OpenAI dialect uses', async () => {
    const adapter = createProseToolsAdapter(createScriptedAdapter([
      textTurn('{"name": "ping", "arguments": {"x": 3}}'),
    ]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(events.some((e) => e.t === 'text')).toBe(false);
    const done = doneOf(events);
    expect(done.stop).toBe('tool-calls');
    expect(done.final?.[0]).toMatchObject({ name: 'ping', args: { x: 3 } });
  });

  it('delivers a malformed block as a call with unparseable args, which the assembler marks bad', async () => {
    // Parses as JSON but is not one call ("args" is an array): handing the raw block down bare
    // would let parseArgs re-derive the {tool,args} wrapper as the tool's own arguments.
    const body = '{"tool": "ping", "args": [1, 2]}';
    const adapter = createProseToolsAdapter(createScriptedAdapter([textTurn(block(PROSE_CALL_TAG, body))]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    const done = doneOf(events);
    expect(done.final).toEqual([{ callId: 'prose-1-0', name: 'ping', rawArgs: MALFORMED_ARGS_PREFIX + body }]);

    const assembler = createAssembler();
    for (const e of events) assembler.push(e);
    expect(assembler.finish().badCalls).toEqual(['prose-1-0']);
  });

  it('salvages the tool name out of broken JSON so the reissue correction can reach the model', () => {
    const body = '{"tool": "ping", "args": {"x": 1,,}';
    const { calls, narration } = parseProseTurn(block(PROSE_CALL_TAG, body), new Set(['ping']));
    expect(narration).toBe('');
    expect(calls).toEqual([{ name: 'ping', rawArgs: MALFORMED_ARGS_PREFIX + body }]);
  });

  it('leaves a block naming no tool in the narration verbatim', async () => {
    const text = 'A sketch:\n' + block(PROSE_CALL_TAG, 'not a call at all');
    const adapter = createProseToolsAdapter(createScriptedAdapter([textTurn(text)]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(events[0]).toEqual({ t: 'text', delta: text.trim() });
    const done = doneOf(events);
    expect(done.stop).toBe('stop');
    expect(done.final).toBeUndefined();
    expect(done.quirks).toBeUndefined();
  });

  it('treats a blockless reply as the finishing turn', async () => {
    const adapter = createProseToolsAdapter(createScriptedAdapter([textTurn('All done here.')]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(events).toEqual([
      { t: 'text', delta: 'All done here.' },
      { t: 'done', stop: 'stop' },
    ]);
  });

  it('passes a truncated turn through unparsed', async () => {
    const cut = block(PROSE_CALL_TAG, '{"tool": "ping", "args": {"x":').slice(0, -8);
    const adapter = createProseToolsAdapter(createScriptedAdapter([textTurn(cut, 'length')]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(events).toEqual([
      { t: 'text', delta: cut },
      { t: 'done', stop: 'length' },
    ]);
  });

  it('streams reasoning live and passes an error turn through', async () => {
    const adapter = createProseToolsAdapter(createScriptedAdapter([
      { events: [{ t: 'reasoning', delta: 'hmm' }, { t: 'error', error: { cls: 'overloaded', detail: 'busy' } }] },
    ]));
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(events).toEqual([
      { t: 'reasoning', delta: 'hmm' },
      { t: 'error', error: { cls: 'overloaded', detail: 'busy' } },
    ]);
  });
});

describe('through the real loop (the scripted twin of a live prose run)', () => {
  function makeExecutor(): ToolExecutor & { calls: { name: string; args: Record<string, unknown> }[] } {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    return {
      calls,
      async execute(call): Promise<ExecutedResult> {
        calls.push({ name: call.name, args: call.args });
        return { content: 'pong', isError: false };
      },
      isWrite: () => false,
      isWide: () => false,
      describe: (call) => `run ${call.name}`,
    };
  }

  it('drives calls, the reissue correction, and the finish through fenced blocks alone', async () => {
    const inner = createScriptedAdapter([
      textTurn('Reading the map.\n' + block(PROSE_CALL_TAG, '{"tool": "ping", "args": {"x": 1}}')),
      textTurn(block(PROSE_CALL_TAG, '{"tool": "ping", "args": {"x": 2,,}')),
      textTurn(block(PROSE_CALL_TAG, '{"tool": "ping", "args": {"x": 2}}')),
      textTurn('Done: the ping answered twice.'),
    ]);
    const executor = makeExecutor();
    const log = createLog();
    append(log, { kind: 'order', text: 'ping twice', mapContext: 'a map' });
    const deps: LoopDeps = {
      adapter: createProseToolsAdapter(inner),
      model: 'm',
      system: 'You are the builder.',
      tools: TOOLS,
      executor,
      oversight: 'yolo',
      sameModel: true,
      budgetTokens: 100_000,
      signal: new AbortController().signal,
      undoStackSize: () => 0,
    };

    const outcome = await runJob(log, deps);
    expect(outcome).toBe('done');
    expect(executor.calls).toEqual([
      { name: 'ping', args: { x: 1 } },
      { name: 'ping', args: { x: 2 } },
    ]);

    // The malformed second turn earned the loop's own reissue result, not a crash and not a run.
    const results = eventsOf(log).filter((e) => e.kind === 'toolResult');
    const reissue = results.find((e) => e.kind === 'toolResult' && e.isError);
    expect(reissue && reissue.kind === 'toolResult' && reissue.content).toContain('Reissue the calls');

    // The replayed history speaks the protocol: the model's own past call is a fenced block again,
    // and the result reached it as a tool_result block in a user message.
    const lastReq = inner.requests[inner.requests.length - 1]!;
    const assistant = lastReq.messages.find((m) => m.role === 'assistant');
    expect(assistant && assistant.role === 'assistant' && assistant.text).toContain('```' + PROSE_CALL_TAG);
    expect(assistant && assistant.role === 'assistant' && assistant.toolCalls).toEqual([]);
    const resultMsg = lastReq.messages.find((m) => m.role === 'user' && m.text.includes('```' + PROSE_RESULT_TAG));
    expect(resultMsg && resultMsg.role === 'user' && resultMsg.text).toContain('"ok":true');
    expect(lastReq.tools).toEqual([]);
  });
});
