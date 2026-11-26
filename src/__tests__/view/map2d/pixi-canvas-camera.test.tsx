// @vitest-environment jsdom
/**
 * The camera the 2D view takes when the map it draws changes: a map it opens on is fitted, and a
 * swap between a map and its stand-in keeps the camera. The app renders under StrictMode, which
 * mounts the view, takes it down and mounts it again on a fresh renderer, so the view is mounted
 * that way here too.
 */
import '../../_support/pixi-env';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { PixiCanvas } from '../../../view/map2d/PixiCanvas';
import { host } from '../../../editor/host/host';
import { standIn } from '../../../state/map-stand-in';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { resetStore, setStoreState } from '../../_support/store';

/** The box the map plane gives the view; jsdom lays out nothing. */
const BOX = { left: 0, top: 0, x: 0, y: 0, width: 1280, height: 800, right: 1280, bottom: 800 };

beforeEach(() => {
  resetStore();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...BOX, toJSON: () => BOX } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () => render(<StrictMode><PixiCanvas reveal={{ duration: 0 }} /></StrictMode>);

describe('the 2D view\'s camera as the map drawn changes', () => {
  it('opens on the camera Fit lands on for the map', () => {
    setStoreState({ gridState: makeState(60, 40), viewMode: '2d' });
    mount();
    expect(host.camera.get2d()).toEqual(host.camera.fitted2d());
  });

  it('keeps the camera across a swap to the map\'s stand-in and back, and fits another map', () => {
    const live = makeState(60, 40);
    setStoreState({ gridState: live, viewMode: '2d' });
    mount();
    const moved = { ...host.camera.fitted2d()!, x: 120, y: -40 };
    act(() => { host.camera.set2d(moved); });
    act(() => { setStoreState({ mapStandIn: standIn(live, makeState(60, 40)) }); });
    expect(host.camera.get2d()).toEqual(moved);
    act(() => { setStoreState({ mapStandIn: null }); });
    expect(host.camera.get2d()).toEqual(moved);
    act(() => { useEditorStore.setState({ gridState: makeState(30, 30) }); });
    expect(host.camera.get2d()).toEqual(host.camera.fitted2d());
  });
});
