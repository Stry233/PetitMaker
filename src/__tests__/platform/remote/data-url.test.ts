import { describe, expect, it } from 'vitest';
import { dataUrlToBlob, parseDataUrl, parseRasterDataUrl } from '../../../platform/remote/data-url';

describe('parseDataUrl', () => {
  it('splits a base64 data URL into its media type and payload', () => {
    expect(parseDataUrl('data:image/jpeg;base64,AAEC')).toEqual({ mime: 'image/jpeg', base64: 'AAEC' });
  });

  it('is null for a URL that is not base64 data', () => {
    expect(parseDataUrl('data:text/plain,hello')).toBeNull();
    expect(parseDataUrl('https://example.com/a.png')).toBeNull();
    expect(parseDataUrl('AAEC')).toBeNull();
  });
});

describe('parseRasterDataUrl', () => {
  it('accepts the three raster types with padded base64', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(parseRasterDataUrl(`data:${mime};base64,AAE=`)).toEqual({ mime, base64: 'AAE=' });
    }
  });

  it('refuses other types, an empty payload and malformed padding', () => {
    expect(parseRasterDataUrl('data:image/svg+xml;base64,AAEC')).toBeNull();
    expect(parseRasterDataUrl('data:image/png;base64,')).toBeNull();
    expect(parseRasterDataUrl('data:image/png;base64,AA===')).toBeNull();
    expect(parseRasterDataUrl('data:image/png;base64,AA E')).toBeNull();
  });
});

// 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL to a Blob with the right MIME and non-empty bytes', () => {
    const blob = dataUrlToBlob(PNG);
    expect(blob.type).toBe('image/png');
    // atob of the payload yields the real PNG bytes (magic 89 50 4E 47 + more).
    expect(blob.size).toBe(atob(PNG.slice(PNG.indexOf(',') + 1)).length);
    expect(blob.size).toBeGreaterThan(4);
  });

  it('decodes a plain (non-base64) text data URL', () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20world');
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe('hello world'.length); // 11
  });
});
