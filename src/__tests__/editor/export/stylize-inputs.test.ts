/** The direction the illustration studio opens on: the stored one, where the studio still offers it. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let simdAnswer = true;
vi.mock('wasm-feature-detect', () => ({ simd: () => Promise.resolve(simdAnswer) }));

/** The studio's inputs with `direction` stored, on an engine whose probe has answered. */
async function storedWith(direction: string) {
  vi.resetModules();
  const { loadStylizeSettings, saveStylizeSettings } = await import('../../../io/storage/stylize-settings');
  const { neuralPacksUsable, offeredDirections, storedStylizeInputs } = await import('../../../editor/export/stylize');
  saveStylizeSettings({ ...loadStylizeSettings(), direction: direction as ReturnType<typeof loadStylizeSettings>['direction'] });
  await neuralPacksUsable();
  return { offered: offeredDirections(), stored: storedStylizeInputs() };
}

beforeEach(() => { simdAnswer = true; localStorage.clear(); });

describe('the stored illustration direction', () => {
  it('is handed back where the engine can run it', async () => {
    const { offered, stored } = await storedWith('neural-watercolor');
    expect(offered).toContain('neural-watercolor');
    expect(stored.direction).toBe('neural-watercolor');
  });

  it('gives way to the first direction on offer where the engine cannot run it', async () => {
    simdAnswer = false;
    const { offered, stored } = await storedWith('neural-watercolor');
    expect(offered).not.toContain('neural-watercolor');
    expect(stored.direction).toBe(offered[0]);
  });
});
