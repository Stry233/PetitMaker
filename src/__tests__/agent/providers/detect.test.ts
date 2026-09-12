import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectProviderFromKey, probeAmbiguousKey } from '../../../agent/providers/detect';

describe('providers/detect: detectProviderFromKey', () => {
  it('recognizes OpenRouter keys before the bare sk- prefix would match', () => {
    expect(detectProviderFromKey('sk-or-abc123')).toBe('openrouter');
  });

  it('recognizes Claude keys', () => {
    expect(detectProviderFromKey('sk-ant-abc123')).toBe('claude');
  });

  it('recognizes OpenAI project/service-account/admin keys', () => {
    expect(detectProviderFromKey('sk-proj-abc123')).toBe('openai');
    expect(detectProviderFromKey('sk-svcacct-abc123')).toBe('openai');
    expect(detectProviderFromKey('sk-admin-abc123')).toBe('openai');
  });

  it('recognizes the legacy sk-None- shape as OpenAI too (carried from the legacy regex)', () => {
    expect(detectProviderFromKey('sk-None-abc123')).toBe('openai');
  });

  it('recognizes Google API keys', () => {
    expect(detectProviderFromKey('AIzaSyD-abcdefghijklmnopqrst')).toBe('gemini');
  });

  it('recognizes the Zhipu 32hex.16alnum shape', () => {
    expect(detectProviderFromKey('0123456789abcdef0123456789abcdef.AbCdEfGh12345678')).toBe('zhipu');
  });

  it('returns null for a bare sk-<32hex> key: ambiguous among deepseek/openai/qwen/moonshot/custom', () => {
    expect(detectProviderFromKey('sk-0123456789abcdef0123456789abcdef')).toBeNull();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(detectProviderFromKey('  sk-ant-abc123  ')).toBe('claude');
  });
});

describe('providers/detect: probeAmbiguousKey', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires GET <base>/models with Authorization: Bearer <key> for every default candidate', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return new Promise<Response>(() => {}); // never resolves; we only inspect the calls
    });

    void probeAmbiguousKey('sk-testkey', { fetchFn: fetchFn as unknown as typeof fetch });
    await Promise.resolve();
    await Promise.resolve();

    // deepseek (1 host) + openai (1 default host) + qwen (2 hosts) + moonshot (2 hosts) = 6 attempts
    expect(calls.length).toBe(6);
    for (const call of calls) {
      expect(call.url.endsWith('/models')).toBe(true);
      expect(call.headers.Authorization).toBe('Bearer sk-testkey');
    }
    expect(calls.some((c) => c.url.startsWith('https://api.deepseek.com'))).toBe(true);
    expect(calls.some((c) => c.url.startsWith('https://api.openai.com'))).toBe(true);
    expect(calls.some((c) => c.url.includes('dashscope-intl'))).toBe(true);
    expect(calls.some((c) => c.url.includes('dashscope.aliyuncs.com'))).toBe(true);
    expect(calls.some((c) => c.url.includes('api.moonshot.ai'))).toBe(true);
    expect(calls.some((c) => c.url.includes('api.moonshot.cn'))).toBe(true);
  });

  it('never sends the key to a custom endpoint, even when one is passed in', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn((url: string) => {
      calls.push(url);
      return new Promise<Response>(() => {});
    });

    void probeAmbiguousKey('sk-testkey', {
      fetchFn,
      customBaseUrl: 'https://evil.example/v1',
    } as unknown as Parameters<typeof probeAmbiguousKey>[1]);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls.length).toBe(6); // the built-in candidates alone
    expect(calls.some((u) => u.startsWith('https://evil.example'))).toBe(false);
  });

  it('resolves the first 2xx responder\'s id', async () => {
    const resolvers: Record<string, (r: Response) => void> = {};
    const fetchFn = vi.fn((url: string) => {
      return new Promise<Response>((resolve) => {
        resolvers[url] = resolve;
      });
    });

    const result = probeAmbiguousKey('sk-testkey', {
      candidates: ['deepseek', 'openai'],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await Promise.resolve();
    await Promise.resolve();

    resolvers['https://api.openai.com/v1/models']!({ ok: true } as Response);

    await expect(result).resolves.toBe('openai');
  });

  it('resolves null when every candidate fails', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('deepseek')) return Promise.reject(new Error('network error'));
      return Promise.resolve({ ok: false } as Response);
    });

    const result = probeAmbiguousKey('sk-testkey', {
      candidates: ['deepseek', 'openai'],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it('resolves null when the deadline passes before anyone answers', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {})); // never resolves
    const result = probeAmbiguousKey('sk-testkey', {
      candidates: ['deepseek', 'openai'],
      fetchFn: fetchFn as unknown as typeof fetch,
      deadlineMs: 8000,
    });

    let settled = false;
    result.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await expect(result).resolves.toBeNull();
  });

  it('respects a custom deadline', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    const result = probeAmbiguousKey('sk-testkey', {
      candidates: ['deepseek'],
      fetchFn: fetchFn as unknown as typeof fetch,
      deadlineMs: 100,
    });

    await vi.advanceTimersByTimeAsync(101);
    await expect(result).resolves.toBeNull();
  });

  it('aborts the losing requests\' signals once a winner resolves', async () => {
    const signals: Record<string, AbortSignal> = {};
    const resolvers: Record<string, (r: Response) => void> = {};
    const fetchFn = vi.fn((url: string, init?: RequestInit) => {
      signals[url] = init!.signal!;
      return new Promise<Response>((resolve) => {
        resolvers[url] = resolve;
      });
    });

    const result = probeAmbiguousKey('sk-testkey', {
      candidates: ['deepseek', 'openai'],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(signals['https://api.deepseek.com/models']!.aborted).toBe(false);
    expect(signals['https://api.openai.com/v1/models']!.aborted).toBe(false);

    resolvers['https://api.openai.com/v1/models']!({ ok: true } as Response);
    await expect(result).resolves.toBe('openai');

    expect(signals['https://api.deepseek.com/models']!.aborted).toBe(true);
  });

  it('never throws even if fetchFn throws synchronously', async () => {
    const fetchFn = vi.fn(() => {
      throw new Error('boom');
    });

    const result = probeAmbiguousKey('sk-testkey', {
      candidates: ['deepseek', 'openai'],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(result).resolves.toBeNull();
  });
});
