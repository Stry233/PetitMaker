import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../../../platform/device/clipboard';

afterEach(() => { vi.unstubAllGlobals(); });

describe('copyText', () => {
  it('writes the text and says it landed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('build 12')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('build 12');
  });

  it('says a refused write did not land', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    expect(await copyText('x')).toBe(false);
  });

  it('says so where the page has no clipboard', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('x')).toBe(false);
  });
});
