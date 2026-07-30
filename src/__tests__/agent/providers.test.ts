import { describe, it, expect, vi } from 'vitest';
import { toAnthropicMessages } from '../../agent/providers/anthropic';
import { toOpenAIMessages } from '../../agent/providers/openai';
import type { AgentMessage } from '../../agent/types';

const history: AgentMessage[] = [
  { role: 'user', content: 'build a lake' },
  {
    role: 'assistant',
    content: 'ok',
    raw: [
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: 't1', name: 'paint_terrain', input: { a: 1 } },
    ],
    toolCalls: [{ id: 't1', name: 'paint_terrain', input: { a: 1 } }],
  },
  { role: 'tool', results: [{ toolCallId: 't1', content: 'Painted 4 cells.', isError: false }] },
];

describe('anthropic conversion', () => {
  it('echoes raw assistant content verbatim and maps tool results to tool_result blocks', () => {
    const msgs = toAnthropicMessages(history);
    // raw echo keeps thinking-block signatures intact for adaptive thinking + tool use
    expect(msgs[1]!.content).toBe((history[1] as { raw: unknown }).raw);
    const last = msgs[2]!;
    expect(last.role).toBe('user');
    expect((last.content as Array<{ type: string; tool_use_id: string }>)[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
    });
  });

  it('falls back to plain text for assistant turns without raw content', () => {
    const msgs = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', toolCalls: [] },
    ]);
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'hello' });
  });
});

describe('openai conversion', () => {
  it('maps assistant toolCalls and emits one role:tool message per result', () => {
    const msgs = toOpenAIMessages('SYS', history);
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'SYS' });
    expect(msgs[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 't1', type: 'function' }] });
    expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: 'Painted 4 cells.' });
  });

  it('omits tool_calls entirely when the assistant turn has none', () => {
    const msgs = toOpenAIMessages('SYS', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', toolCalls: [] },
    ]);
    expect(msgs[2]).not.toHaveProperty('tool_calls');
  });
});

describe('provider detection from API key', () => {
  it('detects each provider from its key format', async () => {
    const { detectProviderFromKey } = await import('../../agent/providers/defaults');
    expect(detectProviderFromKey('sk-ant-api03-AbCdEf123')).toBe('claude');
    expect(detectProviderFromKey('sk-proj-AbCdEf123456')).toBe('openai');
    expect(detectProviderFromKey('sk-svcacct-XyZ987')).toBe('openai');
  });

  it('returns null for ambiguous or invalid keys', async () => {
    const { detectProviderFromKey } = await import('../../agent/providers/defaults');
    expect(detectProviderFromKey('sk-AbCdEfLegacyStyle48CharsMixedCaseXXXXXXXXXXXX')).toBeNull(); // legacy OpenAI: ambiguous
    // sk-<32hex> is DeepSeek's format BUT also Open WebUI/LiteLLM gateway format → ambiguous, probe-resolved
    expect(detectProviderFromKey('sk-0123456789abcdef0123456789abcdef')).toBeNull();
    expect(detectProviderFromKey('sk-0123456789ABCDEF0123456789ABCDEF')).toBeNull();
    expect(detectProviderFromKey('not-a-key')).toBeNull();
    expect(detectProviderFromKey('')).toBeNull();
  });
});

describe('image tool results', () => {
  const msgs: AgentMessage[] = [
    { role: 'user' as const, content: 'look' },
    { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'view_map', input: {} }] },
    {
      role: 'tool' as const,
      results: [{ toolCallId: 'c1', content: 'Rendered view attached.', isError: false, image: { dataUrl: 'data:image/png;base64,QUJD' } }],
    },
  ];

  it('anthropic encodes the image inside the tool_result block', async () => {
    const { toAnthropicMessages } = await import('../../agent/providers/anthropic');
    const out = toAnthropicMessages(msgs);
    const toolMsg = out[out.length - 1] as { content: Array<{ type: string; content?: unknown }> };
    const block = toolMsg.content[0]!;
    expect(block.type).toBe('tool_result');
    const parts = block.content as Array<{ type: string }>;
    expect(parts.some((p) => p.type === 'image')).toBe(true);
    expect(parts.some((p) => p.type === 'text')).toBe(true);
  });

  it('openai-compatible appends a follow-up user message with image_url', async () => {
    const { toOpenAIMessages } = await import('../../agent/providers/openai');
    const out = toOpenAIMessages('sys', msgs);
    const last = out[out.length - 1] as { role: string; content: Array<{ type: string }> };
    expect(last.role).toBe('user');
    expect(last.content.some((p) => p.type === 'image_url')).toBe(true);
    // the tool message itself stays text-only
    const toolMsg = out[out.length - 2] as { role: string; content: string };
    expect(toolMsg.role).toBe('tool');
    expect(typeof toolMsg.content).toBe('string');
  });

  it('openai image label uses the self-describing "(tool attachment: …)" string', async () => {
    const { toOpenAIMessages } = await import('../../agent/providers/openai');
    const out = toOpenAIMessages('sys', msgs);
    const userMsg = out[out.length - 1] as { role: string; content: Array<{ type: string; text?: string }> };
    const textBlock = userMsg.content.find((p) => p.type === 'text');
    expect(textBlock?.text).toBe('(tool attachment: rendered map image from view_map)');
  });

  it('openai: two tool results both with images emit tool(c1) tool(c2) user without interleaving', async () => {
    const { toOpenAIMessages } = await import('../../agent/providers/openai');
    const twoResultMsgs: AgentMessage[] = [
      { role: 'user', content: 'look' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'view_map', input: {} },
          { id: 'c2', name: 'view_map', input: {} },
        ],
      },
      {
        role: 'tool',
        results: [
          { toolCallId: 'c1', content: 'Rendered c1.', isError: false, image: { dataUrl: 'data:image/png;base64,QQ==' } },
          { toolCallId: 'c2', content: 'Rendered c2.', isError: false, image: { dataUrl: 'data:image/png;base64,Rg==' } },
        ],
      },
    ];
    const out = toOpenAIMessages('sys', twoResultMsgs);
    // out = [system, user, assistant, tool(c1), tool(c2), user(img c1), user(img c2)]
    // Collect roles after the assistant message (index 3 onward).
    const roles = out.slice(3).map((m) => m.role);
    // Both tool replies must appear before any user message.
    const firstUser = roles.indexOf('user');
    const lastTool = roles.lastIndexOf('tool');
    expect(firstUser).toBeGreaterThan(lastTool);
    // The two tool messages come consecutively (no user interleaved between them).
    expect(roles[0]).toBe('tool');
    expect(roles[1]).toBe('tool');
  });

  it('anthropic: two tool results both with images land in ONE user message content array', async () => {
    const { toAnthropicMessages } = await import('../../agent/providers/anthropic');
    const twoResultMsgs: AgentMessage[] = [
      { role: 'user', content: 'look' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'view_map', input: {} },
          { id: 'c2', name: 'view_map', input: {} },
        ],
      },
      {
        role: 'tool',
        results: [
          { toolCallId: 'c1', content: 'Rendered c1.', isError: false, image: { dataUrl: 'data:image/png;base64,QQ==' } },
          { toolCallId: 'c2', content: 'Rendered c2.', isError: false, image: { dataUrl: 'data:image/png;base64,Rg==' } },
        ],
      },
    ];
    const out = toAnthropicMessages(twoResultMsgs);
    // The tool message maps to exactly one user message with both tool_result blocks.
    const lastMsg = out[out.length - 1]!;
    expect(lastMsg.role).toBe('user');
    const blocks = lastMsg.content as Array<{ type: string; tool_use_id?: string }>;
    const toolResults = blocks.filter((b) => b.type === 'tool_result');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]!.tool_use_id).toBe('c1');
    expect(toolResults[1]!.tool_use_id).toBe('c2');
  });
});

describe('expanded provider detection', () => {
  it('detects the distinctly-prefixed providers', async () => {
    const { detectProviderFromKey } = await import('../../agent/providers/defaults');
    expect(detectProviderFromKey('sk-or-v1-abcdef123')).toBe('openrouter');
    expect(detectProviderFromKey('AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6')).toBe('gemini');
    expect(detectProviderFromKey('0123456789abcdef0123456789abcdef.AbCdEf0123456789')).toBe('zhipu');
    expect(detectProviderFromKey('sk-ant-api03-xyz')).toBe('claude');
  });

  it('leaves bare sk- keys ambiguous (resolved by probe / chooser)', async () => {
    const { detectProviderFromKey, AMBIGUOUS_CANDIDATES } = await import('../../agent/providers/defaults');
    expect(detectProviderFromKey('sk-abcDEF123456legacyOpenAIorQwenOrMoonshot')).toBeNull();
    // ambiguous candidates are the bare-sk providers we probe between
    // (deepseek first: its sk-<32hex> format is shared with self-hosted gateways)
    expect(AMBIGUOUS_CANDIDATES[0]).toBe('deepseek');
    expect(AMBIGUOUS_CANDIDATES).toContain('openai');
    expect(AMBIGUOUS_CANDIDATES).toContain('qwen');
    expect(AMBIGUOUS_CANDIDATES).toContain('moonshot');
  });

  it('every provider has metadata, an accent, and a logo entry', async () => {
    const { PROVIDER_IDS, PROVIDER_META, PROVIDER_ACCENT } = await import('../../agent/providers/defaults');
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_META[id].label).toBeTruthy();
      // custom has no meaningful default model — it adopts the endpoint's live list
      if (id !== 'custom') expect(PROVIDER_META[id].defaultModel).toBeTruthy();
      expect(PROVIDER_ACCENT[id]).toMatch(/^#/);
    }
    expect(PROVIDER_IDS).toHaveLength(9);
  });
});

describe('supportsVision capability heuristic', () => {
  it('supportsVision: per-provider model heuristic', async () => {
    const { supportsVision } = await import('../../agent/providers/defaults');
    expect(supportsVision('claude', 'claude-opus-4-8')).toBe(true);
    expect(supportsVision('gemini', 'gemini-2.5-pro')).toBe(true);
    expect(supportsVision('openai', 'gpt-5.5')).toBe(true);
    expect(supportsVision('openai', 'o4')).toBe(true);
    expect(supportsVision('qwen', 'qwen-vl-max')).toBe(true);
    expect(supportsVision('qwen', 'qwen-turbo')).toBe(false);
    expect(supportsVision('openrouter', 'anthropic/claude-opus-4-8')).toBe(true);
    expect(supportsVision('openrouter', 'deepseek/deepseek-v4-pro')).toBe(false);
    expect(supportsVision('deepseek', 'deepseek-v4-pro')).toBe(false);
    expect(supportsVision('zhipu', 'glm-4.6')).toBe(false);
    expect(supportsVision('moonshot', 'moonshot-v1-32k')).toBe(false);
  });
});

describe('identifyProviderByProbe deadline', () => {
  it('resolves null within the deadline when every probe endpoint hangs', async () => {
    vi.useFakeTimers();
    const { PROVIDERS, identifyProviderByProbe } = await import('../../agent/providers');
    const hanging = { listModels: () => new Promise<string[]>(() => {}), stream: () => Promise.reject(new Error('n/a')) };
    const spies = (['deepseek', 'openai', 'qwen', 'moonshot'] as const).map((id) =>
      vi.spyOn(PROVIDERS[id], 'create').mockReturnValue(hanging),
    );
    try {
      const probe = identifyProviderByProbe('sk-0123456789abcdef0123456789abcdef');
      await vi.advanceTimersByTimeAsync(8001);
      await expect(probe).resolves.toBeNull(); // deadline, not a hang
    } finally {
      spies.forEach((sp) => sp.mockRestore());
      vi.useRealTimers();
    }
  });

  it('a configured custom endpoint joins the probe and can win', async () => {
    const { PROVIDERS, identifyProviderByProbe } = await import('../../agent/providers');
    const hanging = { listModels: () => new Promise<string[]>(() => {}), stream: () => Promise.reject(new Error('n/a')) };
    const winning = { listModels: () => Promise.resolve(['gpt-oss:120b']), stream: () => Promise.reject(new Error('n/a')) };
    const spies = (['deepseek', 'openai', 'qwen', 'moonshot'] as const).map((id) =>
      vi.spyOn(PROVIDERS[id], 'create').mockReturnValue(hanging),
    );
    spies.push(vi.spyOn(PROVIDERS.custom, 'create').mockReturnValue(winning));
    try {
      await expect(
        identifyProviderByProbe('sk-0123456789abcdef0123456789abcdef', undefined, 'https://genai.example.edu/api'),
      ).resolves.toBe('custom');
    } finally {
      spies.forEach((sp) => sp.mockRestore());
    }
  });
});
