/** The offline edition cannot link out to a licence, so it carries the texts of `licenses/` itself. */
import { describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../platform/build/edition', async (original) => ({
  ...(await original<typeof import('../../platform/build/edition')>()),
  BUNDLES_LICENSE_TEXTS: true,
}));

describe('the licence texts an edition bundles', () => {
  it('carries a text for every package the repository keeps a licence for', async () => {
    const { BUNDLED_LICENSES } = await import('../../legal/bundled-licenses');
    const kept = readdirSync(resolve(__dirname, '..', '..', '..', 'licenses'));
    expect(kept.length).toBeGreaterThan(0);
    const carried = new Set(BUNDLED_LICENSES.map((text) => text.name.split('/')[0]));
    expect(kept.filter((name) => !carried.has(name))).toEqual([]);
    expect(BUNDLED_LICENSES.every((text) => text.body.trim().length > 0)).toBe(true);
  });
});
