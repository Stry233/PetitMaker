/**
 * Two capabilities are genuinely 2D-only: capturing the whole map, and reconciling the object
 * layer with state. They reach the renderer through a registry rather than a closure, so a caller
 * outside the React tree can use them and a teardown can revoke them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getMapRenderer, setMapRenderer } from '../../canvas/map2d/renderer-registry';
import type { MapRenderer } from '../../canvas/map2d/map-renderer';

const stub = (): MapRenderer => ({} as MapRenderer);

afterEach(() => setMapRenderer(null));

describe('renderer registry', () => {
  it('is empty before a canvas mounts', () => {
    expect(getMapRenderer()).toBeNull();
  });

  it('serves the registered renderer', () => {
    const r = stub();
    setMapRenderer(r);
    expect(getMapRenderer()).toBe(r);
  });

  it('empties on teardown', () => {
    setMapRenderer(stub());
    setMapRenderer(null);
    expect(getMapRenderer()).toBeNull();
  });
});
