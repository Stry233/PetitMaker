/**
 * Every in-app picture of a map is taken by `thumbnail.ts` through the renderer's detached capture,
 * which draws the plan notes as the map shows them; the planet painter places that picture and the
 * two planet surfaces (the pannable preview the planet switch and the repair choice share, and the
 * still) are its only callers. A second map painter would be a picture without the map's notes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { moduleBindings, resolveModule, sourceFiles, sourceText, srcRelative } from '../../../_support/source-graph';

const FILES = sourceFiles();
// Each file's imports resolved once: the whole tree is scanned for every question asked of it.
let resolved: { file: string; uses: { module: string; names: readonly string[] | null }[] }[] | undefined;
const resolvedUses = () => resolved ??= FILES.map((file) => ({
  file,
  uses: moduleBindings(file).uses.flatMap((u) => {
    const target = resolveModule(file, u.spec);
    return target === null ? [] : [{ module: srcRelative(target), names: u.names }];
  }),
}));
const users = (module: string, name: string): string[] => resolvedUses()
  .filter(({ uses }) => uses.some((u) => u.module === module && (u.names === null || u.names.includes(name))))
  .map(({ file }) => srcRelative(file)).sort();

describe('one map picture', () => {
  // Reading the whole tree is setup, timed as a hook rather than inside the first question.
  beforeAll(() => { resolvedUses(); });

  it('is taken by thumbnail.ts alone, through the detached capture', () => {
    expect(FILES.filter((file) => /\.captureState\(/.test(sourceText(file))).map(srcRelative)).toEqual(['view/map2d/capture/thumbnail.ts']);
    expect(users('view/map2d/capture/detached-capture.ts', 'captureDetachedState')).toEqual(['view/map2d/scene/map-renderer.ts']);
  });

  it('is placed by the planet painter for the preview and the still alone', () => {
    expect(users('view/map2d/capture/thumbnail.ts', 'mapPicture')).toEqual(['view/map2d/capture/planet-painter.ts']);
    expect(users('view/map2d/capture/planet-painter.ts', 'paintPlanet')).toEqual([
      'ui/chrome/modals/planet/PlanetPreview.tsx', 'ui/chrome/modals/planet/PlanetStill.tsx',
    ]);
  });
});
