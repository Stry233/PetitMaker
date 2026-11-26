/** Pins when the off-thread macro runners retire: only when the runner can no longer answer, never for one failed job. */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../../rules';
import { buildMacroThen, MacroRunnerUnavailable, type MacroBuild } from '../../../../tools/macros/run';
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
    const builds: (MacroBuild | null)[] = [];
    const press = (seed: number) => buildMacroThen(ported(), 'raise', { seed, at }, {
      land: (built) => { builds.push(built); },
      failed: (error) => { throw error; },
    });
    await press(1);
    expect(builds.at(-1)?.run.commands.length).toBeGreaterThan(0);
    expect(offThread.build).not.toBeNull();
    failure = null;
    await press(2);
    expect(calls).toBe(2);
    failure = new MacroRunnerUnavailable('pool broken');
    await press(3);
    expect(offThread.build).toBeNull();
    expect(press(4)).toBeNull();
    expect(calls).toBe(3);
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
