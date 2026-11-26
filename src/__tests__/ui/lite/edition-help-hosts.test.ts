/**
 * Generation in each Lite host's build: both offer Maze, Letter, Picture and Planet, with their Help pages
 * and one Generate copy that names all four. Each build loads Help and the shell afresh, which takes
 * several seconds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// The offline build aliases the edition's Help module to its own (`scripts/edition-build.mts`).
vi.mock('../../../ui/help/edition-help', () => import('../../../ui/lite/edition-help'));

/** The Generate shelf, Help and the welcome tips as the Lite build for `host` evaluates them. */
async function liteBuild(host: string) {
  vi.resetModules();
  vi.stubGlobal('__PETIT_LITE__', true);
  vi.stubGlobal('__PETIT_LITE_HOST__', host);
  vi.stubEnv('PETIT_LITE_HOST', '');
  const { TABS } = await import('../../../ui/shell/bars/generate/generate-shelf');
  const { HELP_PAGES, HELP_PAGE_ORDER } = await import('../../../editor/help/catalog');
  const { tourCards } = await import('../../../ui/chrome/tour/deck');
  const generate = tourCards(true).find((card) => card.kind === 'generate')!;
  return {
    kinds: TABS.map((tab) => tab.id), pages: HELP_PAGE_ORDER, HELP_PAGES,
    tour: { body: generate.bodyKey, kinds: generate.show?.find((step) => step.id === 'kinds')?.textKey },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('[UI-25] generation in each Lite host', () => {
  it.each(['xhs', 'bilibili'])('offers Maze, Letter, Picture and Planet on %s, with their Help pages and copy naming all four', async (host) => {
    const build = await liteBuild(host);
    expect(build.kinds).toEqual(['maze', 'text', 'image', 'island']);
    for (const page of ['gen-letter', 'gen-picture'] as const) {
      expect(build.pages).toContain(page);
      expect(build.HELP_PAGES[page]!.seeAlso.every((id) => build.pages.includes(id))).toBe(true);
      expect(build.HELP_PAGES.generate!.seeAlso).toContain(page);
    }
    expect(build.HELP_PAGES.generate!.ledeKey).toBe('lite.help_generate');
    expect(build.tour).toEqual({ body: 'tour.generate_body', kinds: 'tour.show.generate_kinds' });
  }, 60_000);
});
