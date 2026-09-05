/**
 * The generation orchestrator against a fake dialect: capture -> letterbox -> assembled image set
 * -> prompt -> generate -> crop back, plus the one-shot judge/correction pass. No real network, no
 * real map: a fake `EngineDeps.captureMap` and a hand-built `GridState` (`_helpers.ts`'s
 * `makeState`) stand in, and the canvas 2d context is spied the way `normalize.test.ts` and
 * `semantic.test.ts` already do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEngine, type EngineDeps } from '../../../io/stylize/engine/run';
import { resolveRecipe, LAYOUT_CONDITION_ENABLED, type Recipe } from '../../../io/stylize/engine/recipe';
import { StylizeError, type DialectConfig, type StylizeDialect } from '../../../io/stylize/dialects/types';
import { STYLE_PACKS } from '../../../io/stylize/presets';
import { makeState } from '../../rules/_helpers';

const CAPTURED_URL = 'data:image/png;base64,CAPTURED';
const OUTPUT_URL = 'data:image/png;base64,OUTPUT';
const RETRY_URL = 'data:image/png;base64,RETRY';
const PAINTED_URL = 'data:image/png;base64,PAINTED';

function cfg(): DialectConfig {
  return { key: 'test-key', baseUrl: '', model: 'test-model' };
}

/** A dialect whose input frame is a fixed 1:1, so `planNormalize` against the 400x200 captured
 *  fixture below always lands on the same, hand-checkable letterbox plan. */
function fakeDialect(over: Partial<StylizeDialect> = {}): StylizeDialect {
  return {
    aspects: [{ id: '1:1', ratio: 1 }],
    maxEdge: 400,
    maxImages: 4,
    canJudge: true,
    listModels: vi.fn(async () => []),
    generate: vi.fn(async () => OUTPUT_URL),
    ...over,
  } as StylizeDialect;
}

let drawCalls: unknown[][];

/** Fixed dimensions per URL, so the captured source (400x200, a 2:1 map) and the provider's own
 *  output (400x400, matching the letterboxed frame exactly) letterbox and crop predictably. */
function stubBrowser(): void {
  vi.stubGlobal('Image', class {
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(v: string) {
      if (v === CAPTURED_URL) { this.width = 400; this.height = 200; }
      else if (v === OUTPUT_URL || v === RETRY_URL) { this.width = 400; this.height = 400; }
      else { this.width = 400; this.height = 200; }
      queueMicrotask(() => this.onload?.());
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: (...args: unknown[]) => { drawCalls.push(args); },
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PAINTED_URL);
}

function baseDeps(over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    captureMap: () => CAPTURED_URL,
    state: makeState(4, 4),
    dialect: fakeDialect(),
    cfg: cfg(),
    pack: null,
    ...over,
  };
}

beforeEach(() => {
  drawCalls = [];
  stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runEngine', () => {
  it('sends the letterboxed source last among the role-tagged images, and the prompt names every sent role', async () => {
    const dialect = fakeDialect({ maxImages: 4 });
    const deps = baseDeps({ dialect, pack: STYLE_PACKS[0]!, styleRef: { url: 'data:image/png;base64,SWATCH', kind: 'pack' as const } });
    const recipe: Recipe = { conditions: { style: true, layout: true }, judge: false };

    await runEngine(deps, 'watercolor', undefined, recipe);

    const req = vi.mocked(dialect.generate).mock.calls[0]![1];
    expect(req.images[req.images.length - 1]!.role).toBe('source');
    expect(req.images.some((i) => i.role === 'style')).toBe(true);
    expect(req.images.some((i) => i.role === 'layout')).toBe(true);
    expect(req.prompt).toContain('The last image is the planning map to redraw.');
    expect(req.prompt).toContain('Image 1 is a style sample');
    expect(req.prompt).toContain('flat-color layout legend');
  });

  it('a maxImages:1 dialect gets the source only, and the prompt carries no style/layout labels', async () => {
    const dialect = fakeDialect({ maxImages: 1 });
    const deps = baseDeps({ dialect, pack: STYLE_PACKS[0]!, styleRef: { url: 'data:image/png;base64,SWATCH', kind: 'pack' as const } });
    const recipe = resolveRecipe(dialect);

    await runEngine(deps, 'watercolor', undefined, recipe);

    const req = vi.mocked(dialect.generate).mock.calls[0]![1];
    expect(req.images).toHaveLength(1);
    expect(req.images[0]!.role).toBe('source');
    expect(req.prompt).not.toContain('style swatch');
    expect(req.prompt).not.toContain('layout legend');
  });

  it('crops the generated result back to the pre-letterbox region', async () => {
    const dialect = fakeDialect({ maxImages: 1 });
    const deps = baseDeps({ dialect });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: false };

    await runEngine(deps, 'watercolor', undefined, recipe);

    // 400x200 captured into a forced 1:1, 400-edge frame: offsetY 100, drawW/H 400x200 — the exact
    // region `cropBackRect` recovers once the provider hands back a 400x400 (frame-sized) result.
    const cropDraw = drawCalls[drawCalls.length - 1]!;
    expect(cropDraw.slice(1)).toEqual([0, 100, 400, 200, 0, 0, 400, 200]);
  });

  it('a judge returning clauses triggers exactly one corrective retry, re-anchored on the original images', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(OUTPUT_URL)
      .mockResolvedValueOnce(RETRY_URL);
    const judge = vi.fn(async () => ['fix the bridge position']);
    const dialect = fakeDialect({ maxImages: 1, generate, judge });
    const deps = baseDeps({ dialect });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: true };

    await runEngine(deps, 'watercolor', undefined, recipe);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(2);
    const firstImages = generate.mock.calls[0]![1].images;
    const secondReq = generate.mock.calls[1]![1];
    expect(secondReq.images).toEqual(firstImages);
    expect(secondReq.prompt).toContain('Corrections: ');
    expect(secondReq.prompt).toContain('fix the bridge position');
  });

  it('a judge returning no clauses causes no retry', async () => {
    const generate = vi.fn().mockResolvedValueOnce(OUTPUT_URL);
    const judge = vi.fn(async () => []);
    const dialect = fakeDialect({ maxImages: 1, generate, judge });
    const deps = baseDeps({ dialect });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: true };

    await runEngine(deps, 'watercolor', undefined, recipe);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('an aborted dialect call propagates rather than being swallowed', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const dialect = fakeDialect({ maxImages: 1, generate: vi.fn(async () => { throw abortError; }) });
    const deps = baseDeps({ dialect });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: false };

    await expect(runEngine(deps, 'watercolor', undefined, recipe)).rejects.toBe(abortError);
  });

  it('a StylizeError from the dialect surfaces unchanged', async () => {
    const refusal = new StylizeError('refused');
    const dialect = fakeDialect({ maxImages: 1, generate: vi.fn(async () => { throw refusal; }) });
    const deps = baseDeps({ dialect });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: false };

    await expect(runEngine(deps, 'watercolor', undefined, recipe)).rejects.toBe(refusal);
  });

  it('a capture failure throws StylizeError(bad_response) before any network call', async () => {
    const dialect = fakeDialect({ maxImages: 1 });
    const deps = baseDeps({ dialect, captureMap: () => null });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: false };

    await expect(runEngine(deps, 'watercolor', undefined, recipe)).rejects.toMatchObject({ status: 'bad_response' });
    expect(dialect.generate).not.toHaveBeenCalled();
  });
});

describe('resolveRecipe', () => {
  it('never turns on layout while LAYOUT_CONDITION_ENABLED is false', () => {
    expect(LAYOUT_CONDITION_ENABLED).toBe(false);
    expect(resolveRecipe(fakeDialect({ maxImages: 4 })).conditions.layout).toBe(false);
  });

  it('turns on the style capability once maxImages >= 2', () => {
    expect(resolveRecipe(fakeDialect({ maxImages: 1 })).conditions.style).toBe(false);
    expect(resolveRecipe(fakeDialect({ maxImages: 2 })).conditions.style).toBe(true);
  });

  it('gates judge on both the caller asking and the dialect supporting it', () => {
    expect(resolveRecipe(fakeDialect({ canJudge: false }), { judge: true }).judge).toBe(false);
    expect(resolveRecipe(fakeDialect({ canJudge: true }), { judge: true }).judge).toBe(true);
    expect(resolveRecipe(fakeDialect({ canJudge: true })).judge).toBe(false);
  });
});
