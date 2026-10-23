/** What Import says when it refuses a file: words about the file it was given, never about an image
 *  it was not, and for a share image, whether the code is absent, damaged or newer than this build. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { translateFor } from '../../../i18n/context';
import { inspectImportFile, type ImportInspection } from '../../../io/import/file';
import { MAX_IMPORT_BYTES } from '../../../io/save/limits';
import { buildHeaderBytes, encodeGlyph } from '../../../io/share/glyph/encode';
import { HEADER_NSYM, HEADER_SYMBOL_BITS, HEADER_VERSION, headerModuleAt } from '../../../io/share/glyph/geometry';
import { PRODUCT_HEADER_LEVELS } from '../../../io/share/glyph/palette';
import { rsEncode } from '../../../io/share/glyph/rs';
import { bytesToSymbols } from '../../../io/share/glyph/bitpack';
import { builtMap, exportJson, importCode, importToasts } from './_files';

const en = (key: Parameters<typeof translateFor>[1], params?: Record<string, string | number>): string => translateFor('en', key, params);

/** The toasts Import shows for a file that went no further than inspection. */
async function refusalOf(body: BlobPart, name: string, type = ''): Promise<string[]> {
  const inspection: ImportInspection = await inspectImportFile(new File([body], name, { type }), name);
  if (inspection.status === 'ready') throw new Error(`${name} was accepted`);
  return importToasts(inspection).map((t) => t.text);
}

/** The toasts Import shows for a share image whose pixels are `code`. */
async function imageRefusalOf(code: { rgba: Uint8Array; width: number; height: number }): Promise<string[]> {
  const result = await importCode(code);
  if (result.ok) throw new Error('the image imported');
  return importToasts({ status: 'failed', code: result.error.code, source: 'raster' }).map((t) => t.text);
}

describe('a map file Import cannot open', () => {
  spec('FILE-12', 'says the file is damaged or not a map file, never that it is an image', async () => {
    const shown = await refusalOf('{"version": 9, "cells": [', 'broken.json', 'application/json');
    expect(shown).toEqual([en('import.fail_file')]);
    expect(shown[0]).not.toMatch(/image/i);
  });

  spec('FILE-12', 'says a map made for a planet this version lacks is for an unknown planet', async () => {
    const saved = JSON.parse(exportJson(builtMap().state, []));
    saved.templateId = 'a-planet-no-release-has';
    const shown = await refusalOf(JSON.stringify(saved), 'elsewhere.json', 'application/json');
    expect(shown).toEqual([en('import.fail_planet')]);
  });

  spec('FILE-13', 'refuses a file over the import limit and says it is too large', async () => {
    const huge = { type: 'application/json', size: MAX_IMPORT_BYTES + 1, text: async () => '{}' } as unknown as File;
    const inspection = await inspectImportFile(huge, 'huge.json');
    expect(importToasts(inspection as Exclude<ImportInspection, { status: 'ready' }>).map((t) => t.text))
      .toEqual([en('import.fail_too_large', { size: MAX_IMPORT_BYTES / (1024 * 1024) })]);
  });

  spec('FILE-28', 'refuses a file that is neither a map nor a share image as unsupported', async () => {
    const shown = await refusalOf('shopping list', 'notes.txt', 'text/plain');
    expect(shown).toEqual([en('import.fail_unsupported')]);
  });
});

describe('a share image Import cannot read', () => {
  const MB = 10;
  const data = new Uint8Array(900).map((_, i) => (i * 37 + 11) & 0xff);
  const glyph = encodeGlyph(data, MB)!;

  /** The glyph with its protected header repainted as a valid codeword for `header`. */
  function withHeader(header: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
    const rgba = new Uint8Array(glyph.rgba);
    const symbols = bytesToSymbols(rsEncode(header, HEADER_NSYM), HEADER_SYMBOL_BITS);
    for (let k = 0; k < symbols.length; k++) {
      const { col, row } = headerModuleAt(k);
      const c = PRODUCT_HEADER_LEVELS[symbols[k]!]!;
      for (let y = row * MB + 1; y < (row + 1) * MB - 1; y++) for (let x = col * MB + 1; x < (col + 1) * MB - 1; x++) {
        const i = (y * glyph.width + x) * 4;
        rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
      }
    }
    return { rgba, width: glyph.width, height: glyph.height };
  }

  spec('FILE-23', 'says a code whose contents cannot be recovered is too damaged', async () => {
    const header = buildHeaderBytes(HEADER_VERSION, glyph.profile.id, data);
    header[4]! ^= 0xff; // the payload no longer matches the checksum its header promises
    expect(await imageRefusalOf(withHeader(header))).toEqual([en('import.fail_corrupt')]);
  });

  spec('FILE-23', 'asks to update for a code a newer version wrote', async () => {
    const header = buildHeaderBytes(HEADER_VERSION + 1, glyph.profile.id, data);
    expect(await imageRefusalOf(withHeader(header))).toEqual([en('import.fail_future')]);
  });

  spec('FILE-23', 'says an image with no code in it holds no map data', async () => {
    const blank = { rgba: new Uint8Array(400 * 300 * 4).fill(255), width: 400, height: 300 };
    expect(await imageRefusalOf(blank)).toEqual([en('import.fail_none')]);
  });
});
