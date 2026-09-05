/**
 * Persisted stylize settings: provider/model/endpoint/direction/custom prompt in one blob, with
 * the API key sealed inside it. jsdom has no IndexedDB, so every seal here takes the same path a
 * real browser takes with the vault blocked (a private window, an old browser): the key is
 * session-only, never written to disk in any form.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadStylizeSettings,
  saveStylizeSettings,
  loadStylizeKey,
  saveStylizeKey,
  clearStylizeKey,
} from '../../../io/stylize/settings';
import { PREFS, PREF_STORAGE_KEYS } from '../../../core/runtime/prefs';

const STORAGE_KEY = PREFS.stylize.key;

describe('stylize settings — PREFS declaration', () => {
  it('declares its storage key in PREFS, the single enumeration of everything persisted', () => {
    expect(STORAGE_KEY).toBe('petit-planet-stylize-v1');
    expect(PREF_STORAGE_KEYS).toContain('petit-planet-stylize-v1');
  });
});

describe('loadStylizeSettings — defaults', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to gemini, an on-device direction, and empty text fields when nothing persisted', () => {
    const s = loadStylizeSettings();
    expect(s.provider).toBe('gemini');
    expect(s.direction).toBe('aquarelle');
    expect(s.model).toBe('');
    expect(s.customBaseUrl).toBe('');
    expect(s.customPrompt).toBe('');
  });
});

describe('save/load round-trip', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips every field', () => {
    saveStylizeSettings({
      provider: 'siliconflow',
      model: 'Qwen/Qwen-Image-Edit-2509',
      customBaseUrl: '',
      direction: 'autumn',
      customPrompt: 'toasted amber light',
    });
    const back = loadStylizeSettings();
    expect(back.provider).toBe('siliconflow');
    expect(back.model).toBe('Qwen/Qwen-Image-Edit-2509');
    expect(back.direction).toBe('autumn');
    expect(back.customPrompt).toBe('toasted amber light');
  });

  it('falls back to defaults for an unrecognized stored provider or direction', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'not-a-provider', direction: 'not-a-direction' }));
    const s = loadStylizeSettings();
    expect(s.provider).toBe('gemini');
    expect(s.direction).toBe('aquarelle');
  });

  it('survives corrupted storage by falling back to defaults', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadStylizeSettings().provider).toBe('gemini');
  });
});

describe('customBaseUrl sanitizing', () => {
  beforeEach(() => localStorage.clear());

  it('sanitizes a hostile stored value on load', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'custom', customBaseUrl: 'javascript:alert(1)' }));
    expect(loadStylizeSettings().customBaseUrl).toBe('');
  });

  it('upgrades a stored plain http endpoint to https', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'custom', customBaseUrl: 'http://evil.com/api' }));
    expect(loadStylizeSettings().customBaseUrl).toBe('https://evil.com/api');
  });

  it('sanitizes on save too (a typed value round-trips through the same rule)', () => {
    saveStylizeSettings({
      provider: 'custom', model: '', customBaseUrl: 'gateway.example.edu/api', direction: 'watercolor', customPrompt: '',
    });
    expect(loadStylizeSettings().customBaseUrl).toBe('https://gateway.example.edu/api');
  });
});

describe('the sealed key: vault unavailable under jsdom (no IndexedDB)', () => {
  beforeEach(() => localStorage.clear());

  it('loadStylizeKey resolves null when nothing is stored', async () => {
    expect(await loadStylizeKey()).toBeNull();
  });

  it('saveStylizeKey never writes the plain key to storage in any form', async () => {
    await saveStylizeKey('sk-test-super-secret-123');
    const raw = localStorage.getItem(STORAGE_KEY) ?? '';
    expect(raw).not.toContain('sk-test-super-secret-123');
    // base64 of the plaintext would also be a leak; assert the encoded form is absent too.
    expect(raw).not.toContain(btoa('sk-test-super-secret-123'));
  });

  it('saveStylizeKey leaves keySealed unset when the vault cannot seal (session-only, never persisted)', async () => {
    await saveStylizeKey('sk-test-super-secret-123');
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { keySealed?: unknown };
    expect(rec.keySealed ?? null).toBeNull();
    expect(await loadStylizeKey()).toBeNull();
  });

  it('a sealed blob written directly to storage survives a settings save untouched (settings never clobber the key)', () => {
    const blob = { iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZS1jaXBoZXJ0ZXh0' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'gemini', keySealed: blob }));
    saveStylizeSettings({ ...loadStylizeSettings(), model: 'gemini-2.5-flash-image' });
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { keySealed?: unknown };
    expect(rec.keySealed).toEqual(blob);
  });

  it('loadStylizeKey resolves null over a stored blob the vault cannot open here (jsdom), never throwing', async () => {
    const blob = { iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZS1jaXBoZXJ0ZXh0' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'gemini', keySealed: blob }));
    await expect(loadStylizeKey()).resolves.toBeNull();
  });

  it('clearStylizeKey removes a stored sealed blob', async () => {
    const blob = { iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZS1jaXBoZXJ0ZXh0' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'gemini', keySealed: blob }));
    await clearStylizeKey();
    const rec = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { keySealed?: unknown };
    expect(rec.keySealed ?? null).toBeNull();
  });

  it('clearStylizeKey on an empty record is a no-op, not a throw', async () => {
    await expect(clearStylizeKey()).resolves.toBeUndefined();
  });
});
