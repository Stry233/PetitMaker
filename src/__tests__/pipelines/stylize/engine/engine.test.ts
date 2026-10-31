// @vitest-environment jsdom
/**
 * The generation orchestrator against a fake dialect: capture -> letterbox -> assembled image set
 * -> prompt -> generate -> crop back. No real network, no real map: a fake `EngineDeps.captureMap`
 * and a hand-built `GridState` (`_helpers.ts`'s `makeState`) stand in, and the canvas 2d context is
 * spied the way `normalize.test.ts` and `semantic.test.ts` already do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEngine, type EngineDeps } from '../../../../pipelines/stylize/engine/run';
import { resolveRecipe, type Recipe } from '../../../../pipelines/stylize/engine/recipe';
import { StylizeError, type DialectConfig, type StylizeDialect } from '../../../../pipelines/stylize/dialects/types';
import { STYLE_PACKS } from '../../../../pipelines/stylize/presets';
import { makeState } from '../../../_support/map-state';
import { stubCanvasContext } from '../../../_support/canvas-context';
import { STYLIZE_TRUST } from '../../../../pipelines/stylize/prompt/compile';

const CAPTURED_URL = 'data:image/png;base64,CAPTURED';
const OUTPUT_URL = 'data:image/png;base64,iVBOR09VVFBVVA==';
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
    imageOrder: ['style', 'layout', 'source'],
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
      else if (v === OUTPUT_URL) { this.width = 400; this.height = 400; }
      else { this.width = 400; this.height = 200; }
      queueMicrotask(() => this.onload?.());
    }
  });
  stubCanvasContext({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: (...args: unknown[]) => { drawCalls.push(args); },
  });
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
    expect(req.prompt).toContain('Image 3 is the planning map to redraw.');
    expect(req.prompt).toContain('Image 1 is a style sample');
    expect(req.prompt).toContain('Image 2 is a flat-color layout legend');
    // The trust and policy text travels as the system text a dialect may send apart.
    expect(req.system).toBe(STYLIZE_TRUST);
  });

  it('a maxImages:1 dialect gets the source only, and the prompt carries no style/layout labels', async () => {
    const dialect = fakeDialect({ maxImages: 1 });
    const deps = baseDeps({ dialect, pack: STYLE_PACKS[0]!, styleRef: { url: 'data:image/png;base64,SWATCH', kind: 'pack' as const } });
    const recipe = resolveRecipe(dialect);

    await runEngine(deps, 'watercolor', undefined, recipe);

    const req = vi.mocked(dialect.generate).mock.calls[0]![1];
    expect(req.images).toHaveLength(1);
    expect(req.images[0]!.role).toBe('source');
    expect(req.prompt).toContain('Image 1 is the planning map to redraw.');
    expect(req.prompt).not.toContain('style sample');
    expect(req.prompt).not.toContain('layout legend');
  });

  it('crops the generated result back to the pre-letterbox region', async () => {
    const dialect = fakeDialect({ maxImages: 1 });
    const deps = baseDeps({ dialect });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: false };

    await runEngine(deps, 'watercolor', undefined, recipe);

    // 400x200 captured into a forced 1:1, 400-edge frame: offsetY 100, drawW/H 400x200, which is the exact
    // region `cropBackRect` recovers once the provider hands back a 400x400 (frame-sized) result.
    const cropDraw = drawCalls[drawCalls.length - 1]!;
    expect(cropDraw.slice(1)).toEqual([0, 100, 400, 200, 0, 0, 400, 200]);
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

  it('a capture failure is a device failure, raised before any network call', async () => {
    const dialect = fakeDialect({ maxImages: 1 });
    const deps = baseDeps({ dialect, captureMap: () => null });
    const recipe: Recipe = { conditions: { style: false, layout: false }, judge: false };

    await expect(runEngine(deps, 'watercolor', undefined, recipe)).rejects.toMatchObject({ status: 'device' });
    expect(dialect.generate).not.toHaveBeenCalled();
  });
});

describe('resolveRecipe', () => {
  it('never turns on layout while the layout condition ships off', () => {
    expect(resolveRecipe(fakeDialect({ maxImages: 4 })).conditions.layout).toBe(false);
  });

  it('turns on the style capability once maxImages >= 2', () => {
    expect(resolveRecipe(fakeDialect({ maxImages: 1 })).conditions.style).toBe(false);
    expect(resolveRecipe(fakeDialect({ maxImages: 2 })).conditions.style).toBe(true);
  });
});
