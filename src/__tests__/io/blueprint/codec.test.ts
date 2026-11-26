import { describe, expect, it } from 'vitest';
import { EXAMPLES_FOLDER, BLUEPRINT_NAME_MAX, decodeBlueprints, encodeBlueprints, type BlueprintRecord } from '../../../io/blueprint';
import { TerrainType } from '../../../core/model/types';

const THUMB = 'data:image/png;base64,AAAA';
function record(id: string, over: Partial<BlueprintRecord> = {}): BlueprintRecord {
  const cells = Array.from({ length: 9 }, (_, i) => (i === 4 ? { type: TerrainType.Water, rise: 0 } : i === 5 ? { type: TerrainType.Mountain, rise: 2, corners: ['fan', 'square', 'square', 'empty'] as never } : null));
  return {
    id, name: `Plot ${id}`, folder: 'Farm', author: 'Ann', origin: null, savedAt: 1700000000000, appVersion: '2.0.0',
    body: { w: 2, h: 2, cells, objects: [{ catalogId: 'house', x: 0.5, y: 1, rotation: 90, rise: 1 }] },
    thumbs: { flat: THUMB, lifted: THUMB }, ...over,
  };
}
const ok = (text: string) => {
  const r = decodeBlueprints(text);
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('blueprint files', () => {
  it('[BLUE-11] round-trips one and many records', () => {
    const one = [record('a')];
    expect(ok(encodeBlueprints(one)).records).toEqual(one);
    const many = [record('a'), record('b', { author: null, origin: 'Bo', folder: 'Barn' }), record('c', { folder: null })];
    expect(ok(encodeBlueprints(many)).records).toEqual(many);
  });

  it('[BLUE-11] reads a version 1 file\'s one folder as every record\'s', () => {
    const v1 = (folder?: string) => JSON.stringify({ format: 'petitmaker.blueprint', version: 1, ...(folder ? { folder } : {}), records: [record('a', { folder: 'Old' }), record('b')] });
    expect(ok(v1('Farm')).records.map((r) => r.folder)).toEqual(['Farm', 'Farm']);
    expect(ok(v1()).records.map((r) => r.folder)).toEqual([null, null]);
  });

  it('[BLUE-11] refuses a file from a newer version', () => {
    const file = JSON.parse(encodeBlueprints([record('a')]));
    file.version = 99;
    expect(decodeBlueprints(JSON.stringify(file))).toEqual({ error: 'too-new' });
  });

  it('[BLUE-11] refuses a planet file', () => {
    expect(decodeBlueprints(JSON.stringify({ format: 'petitmaker.planet', version: 2 }))).toEqual({ error: 'not-blueprint' });
    expect(decodeBlueprints('not json')).toEqual({ error: 'not-blueprint' });
  });

  it('[BLUE-11] keeps records naming unknown catalog items', () => {
    const r = record('a');
    const odd = { ...r, body: { ...r.body, objects: [{ catalogId: 'no-such-item', x: 0, y: 0, rotation: 0 as const, rise: 0 }] } };
    expect(ok(encodeBlueprints([odd])).records[0]!.body.objects[0]!.catalogId).toBe('no-such-item');
  });

  it('[BLUE-11] drops out-of-range numbers', () => {
    const bad = (mutate: (f: any) => void) => {
      const f = JSON.parse(encodeBlueprints([record('a')]));
      mutate(f);
      return decodeBlueprints(JSON.stringify(f));
    };
    expect(bad((f) => { f.records[0].body.w = 999; })).toEqual({ error: 'malformed' });
    expect(bad((f) => { f.records[0].body.cells.pop(); })).toEqual({ error: 'malformed' });
    expect(bad((f) => { f.records[0].body.cells[4].rise = 10; })).toEqual({ error: 'malformed' });
    expect(bad((f) => { f.records[0].body.objects[0].rotation = 45; })).toEqual({ error: 'malformed' });
    expect(bad((f) => { f.records[0].body.cells[5].corners = ['x', 'x', 'x', 'x']; })).toEqual({ error: 'malformed' });
  });

  it('reads every name a file carries within the limit, never half an emoji and never the app\'s own folder', () => {
    const long = `${'a'.repeat(BLUEPRINT_NAME_MAX - 1)}🌸`;
    const file = encodeBlueprints([
      record('a', { name: long, folder: EXAMPLES_FOLDER, author: `  ${long}`, origin: '   ' }), record('b', { folder: ` ${long} ` }),
    ]);
    const back = ok(file);
    const cut = 'a'.repeat(BLUEPRINT_NAME_MAX - 1);
    expect(back.records[0]).toMatchObject({ name: cut, folder: EXAMPLES_FOLDER.trim(), author: cut, origin: null });
    expect(back.records[1]!.folder).toBe(cut);
  });

  it('admits a record without valid thumbnails with empty ones and drops unknown fields', () => {
    const f = JSON.parse(encodeBlueprints([record('a')]));
    f.records[0].thumbs = { flat: 'javascript:alert(1)' };
    f.records[0].extra = 1;
    const r = ok(JSON.stringify(f)).records[0]!;
    expect(r.thumbs).toEqual({ flat: '', lifted: '' });
    expect('extra' in r).toBe(false);
  });
});
