/**
 * dataUrlToBlob decodes a data: URL WITHOUT fetch() — the app's CSP forbids
 * fetching data: URLs, so the 3D capture download must not round-trip through
 * fetch(url).blob() (which threw a CSP connect-src violation).
 */
import { describe, it, expect } from 'vitest';
import { dataUrlToBlob } from '../../io/image-export';

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
