// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONT_FILES, installFontFaces, fontFaceRegistered, loadFontFace, __resetFontFaces } from '../../../assets/fonts/faces';
import { INTERFACE_FACE } from '../../../assets/fonts/family';

const dir = resolve(__dirname, '../../../assets/fonts');
const css = readFileSync(resolve(dir, 'fonts.css'), 'utf8');

afterEach(() => {
  __resetFontFaces();
  vi.unstubAllGlobals();
  delete (document as unknown as { fonts?: unknown }).fonts;
});

describe('shipped font faces', () => {
  it('list one face per @font-face block, each naming a file that ships', () => {
    // Counted by plain substring, independently of how the module reads the blocks.
    expect(FONT_FILES).toHaveLength(css.split('@font-face').length - 1);
    for (const { family, weight, url } of FONT_FILES) {
      expect(family).not.toBe('');
      expect(weight).toBeGreaterThan(0);
      const file = url.split('/').pop()!.split('?')[0]!;
      expect(css).toContain(`url('./${file}')`);
      expect(existsSync(resolve(dir, file))).toBe(true);
    }
    expect(new Set(FONT_FILES.map(({ url }) => url)).size).toBe(FONT_FILES.length);
    expect(FONT_FILES.some(({ family }) => family === INTERFACE_FACE)).toBe(true);
  });

  it('register each face once, however often they are installed, and join its running load', async () => {
    const added: FontFace[] = [];
    let loads = 0;
    vi.stubGlobal('FontFace', class {
      private loading?: Promise<this>;
      load(): Promise<this> { return this.loading ??= (loads++, Promise.resolve(this)); }
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (face: FontFace) => added.push(face) } });
    const [first] = FONT_FILES;
    expect(await loadFontFace(first!), 'an unregistered face is not fetched').toBe(false);
    installFontFaces([first!]);
    installFontFaces();
    installFontFaces();
    expect(added).toHaveLength(FONT_FILES.length);
    expect(FONT_FILES.every(fontFaceRegistered)).toBe(true);
    expect(await Promise.all([loadFontFace(first!), loadFontFace(first!)])).toEqual([true, true]);
    expect(loads).toBe(1);
  });
});
