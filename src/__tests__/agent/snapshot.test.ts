import { describe, it, expect, afterEach } from 'vitest';
import { registerMapSnapshotter, takeMapSnapshot } from '../../agent/snapshot';

afterEach(() => registerMapSnapshotter(null));

describe('map snapshot registry', () => {
  it('returns null when no snapshotter is registered', async () => {
    expect(await takeMapSnapshot()).toBeNull();
  });
  it('delegates to the registered snapshotter', async () => {
    registerMapSnapshotter(async () => 'data:image/png;base64,AAAA');
    expect(await takeMapSnapshot()).toBe('data:image/png;base64,AAAA');
  });
});
