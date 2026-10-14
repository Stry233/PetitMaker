import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { MAP_CHECK_DATA, NSFW_MODEL } from '../../../../pipelines/moderation/map/assets';
import { walkFiles } from '../../../_support/source-graph';

const FOLDER = resolve(__dirname, '../../../../../public/moderation');

const files = (dir: string): string[] => walkFiles(dir, { accept: /./ }).map((path) => relative(FOLDER, path));

describe('the map check data', () => {
  it('names every model and OCR file in the moderation folder, so the prefetch misses none', () => {
    const shipped = files(FOLDER).filter((file) => file !== 'provenance.json').sort();
    expect([...MAP_CHECK_DATA].sort()).toEqual(shipped);
  });

  it('lists the weights the model manifest names', () => {
    const manifest = JSON.parse(readFileSync(join(FOLDER, NSFW_MODEL), 'utf8')) as { weightsManifest: { paths: string[] }[] };
    const weights = manifest.weightsManifest.flatMap((group) => group.paths).map((path) => `nsfw/${path}`);
    for (const path of weights) expect(MAP_CHECK_DATA).toContain(path);
  });
});
