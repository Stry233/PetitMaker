import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAgentSettings, saveAgentSettings } from '../../../agent/security/settings-record';
import { newSealState } from '../../../agent/security/key-storage';

// jsdom 25 under this node version exposes a localStorage descriptor that yields
// undefined, so back the global with a Map-based stub (same Storage surface).
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

describe('agent settings', () => {
  beforeEach(() => backing.clear());

  it('defaults to claude with NO seeded model (a model is only real once a live fetch picks it) and no keys', () => {
    const s = loadAgentSettings();
    expect(s.provider).toBe('claude');
    expect(s.model.claude).toBe('');
    expect(s.keys.claude).toBeUndefined();
  });

  it('survives corrupted storage by falling back to defaults', () => {
    backing.set('petit-agent-settings-v1', '{not json');
    expect(loadAgentSettings().provider).toBe('claude');
  });
});

describe('custom endpoint persistence', () => {
  it('round-trips customBaseUrl (plain, not obfuscated: it is not a secret)', () => {
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, provider: 'custom', customBaseUrl: 'https://genai.example.edu/api' }, newSealState());
    const back = loadAgentSettings();
    expect(back.provider).toBe('custom');
    expect(back.customBaseUrl).toBe('https://genai.example.edu/api');
  });

  it('treats an empty stored customBaseUrl as unset', () => {
    saveAgentSettings({ ...loadAgentSettings(), customBaseUrl: undefined }, newSealState());
    expect(loadAgentSettings().customBaseUrl).toBeUndefined();
  });
});
