// @vitest-environment jsdom
/**
 * A capture renders into a GPU texture it owns; a read-back that fails must still release it, or
 * every failed capture leaks a map-sized texture.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi } from 'vitest';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState } from '../../../_support/map-state';
import { MapRenderer } from '../../../../view/map2d/scene/map-renderer';
import { EventBus } from '../../../../core/commands/event-bus';

describe('a capture whose read-back fails', () => {
  it('releases the texture it rendered into', async () => {
    const renderer = new MapRenderer(new EventBus<EditorEvents>(), document.createElement('div'), 64, 64);
    const gl = (renderer as unknown as { app: { renderer: Record<string, unknown> } }).app.renderer;
    const destroy = vi.fn();
    gl.generateTexture = () => ({ destroy });
    gl.extract = { canvas: () => { throw new Error('read-back failed'); } };
    try {
      expect(await renderer.captureState(makeState(10, 10))).toBeNull();
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      renderer.destroy();
    }
  });
});
