import { describe, expect, it } from 'vitest';
import { readPlanetFile, serializeTemplate, writePlanetFile } from '../../../io/save/planet-codec';
import { ImportError } from '../../../io/save/import-error';
import { classifyImportFile } from '../../../io/import/kind';
import { inspectImportFile } from '../../../io/import/file';
import { MAX_IMPORT_BYTES } from '../../../io/save/limits';
import { PLANET_MAX_CELLS } from '../../../core/model/planet';
import { planetFixture } from '../../_support/planet';

const file = () => writePlanetFile('Bay', planetFixture());

function reason(text: string): string {
  try {
    readPlanetFile(text);
    return 'read';
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).message;
  }
}

describe('a damaged planet file', () => {
  it('is refused at every cut, with a planet file error and never a planet', () => {
    const text = file();
    expect(reason(text)).toBe('read');
    for (let n = 0; n < text.length; n += Math.max(1, Math.floor(text.length / 97))) {
      expect(reason(text.slice(0, n)), `cut at ${n}`).not.toBe('read');
    }
    expect(reason(text.slice(0, -1))).not.toBe('read');
  });

  it.each([
    ['empty', ''],
    ['whitespace', '  \n'],
    ['not JSON', 'petitmaker.planet'],
    ['JSON of another kind', '{"version":3,"cells":""}'],
    ['a null template', JSON.stringify({ format: 'petitmaker.planet', version: 2, name: 'x', template: null })],
  ])('refuses an %s file', (_what, text) => {
    expect(reason(text)).not.toBe('read');
  });

  it('refuses sizes past the planet limit before reading any cell', () => {
    const parsed = JSON.parse(file());
    for (const [width, height] of [[PLANET_MAX_CELLS + 1, 32], [48, PLANET_MAX_CELLS + 1], [0, 32], [-5, 32], [1.5, 32]]) {
      expect(reason(JSON.stringify({ ...parsed, template: { ...parsed.template, width, height } })), `${width} by ${height}`).not.toBe('read');
    }
  });

  it('refuses a run count that would expand past the planet without expanding it', () => {
    const parsed = JSON.parse(file());
    const zones = `${Number.MAX_SAFE_INTEGER}*2`;
    const started = performance.now();
    expect(reason(JSON.stringify({ ...parsed, template: { ...parsed.template, zones } }))).not.toBe('read');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('refuses a template whose content does not hash to its id', () => {
    const t = serializeTemplate(planetFixture());
    const parsed = JSON.parse(file());
    expect(reason(JSON.stringify({ ...parsed, template: { ...t, id: `${t.id}x` } }))).not.toBe('read');
  });

  it('is not classified as a planet once cut short', async () => {
    const text = file();
    expect(await classifyImportFile(new Blob([text]), 'bay.planet')).toBe('planet');
    expect(await classifyImportFile(new Blob([text.slice(0, text.length - 2)]), 'bay.planet')).not.toBe('planet');
    expect(await classifyImportFile(new Blob([]), 'bay.planet')).toBe('unknown');
  });

  it('is never read whole when the file is past the import limit', async () => {
    const head = new Blob([file().slice(0, 64)]);
    const huge = {
      size: MAX_IMPORT_BYTES + 1, type: 'application/json',
      slice: (start?: number, end?: number) => head.slice(start, end),
      text: () => { throw new Error('read whole'); },
      arrayBuffer: () => { throw new Error('read whole'); },
    } as unknown as Blob;
    expect(await classifyImportFile(huge, 'bay.json')).toBe('map');
    const inspected = await inspectImportFile(huge, 'bay.json');
    expect(inspected.status).toBe('failed');
  });
});
