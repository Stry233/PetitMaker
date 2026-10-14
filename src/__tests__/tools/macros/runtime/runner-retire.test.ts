/** Pins when the off-thread macro runners retire: only when the runner can no longer answer, never for one failed job. */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../../rules';
import { applyMacroAsync, hasMacroBuildRunner, MacroRunnerUnavailable, type MacroBuild } from '../../../../tools/macros/run';
import type { MacroOffThread } from '../../../../tools/macros/context';
import { previewMacro, previewMacroAsync, type MacroPreview } from '../../../../tools/macros/runtime/preview';
import { detachedContext } from '../../../../tools/macros/runtime/scratch';
import { makeState } from '../../../_support/map-state';

const context = () => detachedContext(makeState(30, 30), createDefaultRegistry());
const at = { x: 10, y: 10 };

describe('macro runner retirement', () => {
  it('keeps the build runner after one failed job and retires it once the runner is unavailable', async () => {
    let calls = 0;
    let failure: Error | null = new Error('job threw');
    const offThread: MacroOffThread = {
      preview: null,
      build: async (): Promise<MacroBuild | null> => {
        calls++;
        if (failure) throw failure;
        return null;
      },
    };
    const ported = () => ({ ...context(), offThread });
    expect(await applyMacroAsync(ported(), 'raise', { seed: 1, at })).toBeTruthy();
    expect(hasMacroBuildRunner(ported())).toBe(true);
    failure = null;
    await applyMacroAsync(ported(), 'raise', { seed: 2, at });
    expect(calls).toBe(2);
    failure = new MacroRunnerUnavailable('pool broken');
    await applyMacroAsync(ported(), 'raise', { seed: 3, at });
    expect(hasMacroBuildRunner(ported())).toBe(false);
  });

  it('keeps the preview runner after one failed job and drops it once the runner is unavailable', async () => {
    let calls = 0;
    let failure: Error | null = new Error('job threw');
    const offThread: MacroOffThread = {
      build: null,
      preview: async (state, id, opts): Promise<MacroPreview> => {
        calls++;
        if (failure) throw failure;
        return previewMacro(detachedContext(state, createDefaultRegistry()), id, opts);
      },
    };
    const ctx = { ...context(), offThread };
    expect(await previewMacroAsync(ctx, 'raise', { seed: 1, at })).toEqual(previewMacro(context(), 'raise', { seed: 1, at }));
    failure = null;
    await previewMacroAsync(ctx, 'raise', { seed: 2, at });
    expect(calls).toBe(2);
    failure = new MacroRunnerUnavailable('pool broken');
    await previewMacroAsync(ctx, 'raise', { seed: 3, at });
    await previewMacroAsync(ctx, 'raise', { seed: 4, at });
    expect(calls).toBe(3);
  });
});
