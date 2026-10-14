/**
 * The generation worker judges each job by the rule set the asking map runs under, so a Smart Build
 * preview or build sent from a planet session runs the session's rules, as the main-thread fallback
 * does. The worker's entry is loaded as a module with a stand-in `self`, and the rules it builds are
 * read where it hands them to a detached context.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireGrid } from '../../../../tools/generation/run/candidate-wire';
import { createGridState } from '../../../../core/model/template';
import { makeTemplate } from '../../../_support/map-state';
import type { RuleDispatcher } from '../../../../core/model/rule-dispatcher';

type Scope = { onmessage: ((e: MessageEvent) => void) | null; postMessage: (msg: unknown) => void };

let scope: Scope;
let answers: unknown[];
/** The rule ids of every registry the worker built a detached context over. */
let judgedBy: string[][];

beforeEach(async () => {
  answers = [];
  judgedBy = [];
  scope = { onmessage: null, postMessage: (msg) => { answers.push(msg); } };
  vi.stubGlobal('self', scope);
  vi.resetModules();
  vi.doMock('../../../../tools/macros/runtime/scratch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../../tools/macros/runtime/scratch')>();
    return {
      ...real,
      detachedContext: (state: Parameters<typeof real.detachedContext>[0], registry: RuleDispatcher) => {
        judgedBy.push(registry.getRules().map((r) => r.id));
        return real.detachedContext(state, registry);
      },
    };
  });
  await import('../../../../tools/generation/run/candidate.worker');
});

afterEach(() => {
  vi.doUnmock('../../../../tools/macros/runtime/scratch');
  vi.unstubAllGlobals();
});

async function post(job: Record<string, unknown>): Promise<void> {
  const id = answers.length + 1;
  const grid = wireGrid(createGridState(makeTemplate(8, 8)), true);
  scope.onmessage!({ data: structuredClone({ id, grid, ...job }) } as MessageEvent);
  await vi.waitFor(() => expect(answers).toHaveLength(id));
}

describe('the rules a worker job runs under', () => {
  it.each(['preview', 'macro'])('a %s job from a planet session runs the planet rules', async (kind) => {
    await post({ kind, macro: 'raise', opts: {}, rules: 'planet' });
    expect(judgedBy.length).toBeGreaterThan(0);
    for (const ids of judgedBy) {
      expect(ids).toContain('V-PLANET-01');
      expect(ids).not.toContain('V-GROUND-LOCK');
    }
  });

  it('a job from the ordinary editor runs the default rules', async () => {
    await post({ kind: 'macro', macro: 'raise', opts: {}, rules: 'default' });
    expect(judgedBy.length).toBeGreaterThan(0);
    for (const ids of judgedBy) {
      expect(ids).toContain('V-GROUND-LOCK');
      expect(ids).not.toContain('V-PLANET-01');
    }
  });
});
