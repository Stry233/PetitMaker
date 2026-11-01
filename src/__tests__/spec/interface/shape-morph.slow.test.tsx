// @vitest-environment jsdom
/**
 * The morph a layout-shape flip plays, through the mounted editor root with the page's own shape
 * detector: jsdom has no layout and no Web Animations, so `_support/web-animations.ts` lays the pieces
 * out from their own lengths and records the animations, which never advance until finished here.
 */
import { afterEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { installWebAnimations } from '../../_support/web-animations';
import { MORPH_ANIMATION } from '../../../ui/primitives/morph';

// The first mount transforms the whole editor graph, which a loaded machine cannot fit in 5 s.
vi.setConfig({ testTimeout: 60_000 });

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

let waapi: ReturnType<typeof installWebAnimations> | null = null;
let stopWiring = () => {};

afterEach(() => {
  stopWiring();
  stopWiring = () => {};
  cleanup();
  waapi?.restore();
  waapi = null;
  vi.resetModules();
  sizeWindow(1024, 768);
});

/** Mounts the editor root in touch mode with the objects open at `w` by `h`, the shape detector running. */
async function mountAt(w: number, h: number, motion: 'full' | 'reduced' = 'full') {
  vi.resetModules();
  sizeWindow(w, h);
  const { EditorRoot } = await import('../../../ui/app/EditorRoot');
  const { NO_DOCK } = await import('../../../ui/design/scale');
  const { useEditorStore } = await import('../../../state/store');
  const { installDeviceWiring } = await import('../../../editor/session/device-wiring');
  act(() => {
    const s = useEditorStore.getState();
    useEditorStore.setState({ locale: 'en' });
    s.setLayoutShape(h > w ? 'portrait' : 'landscape');
    s.setInputMode('touch');
    s.setMotionPref(motion);
    s.setEditMode({ mode: 'object' });
  });
  render(<EditorRoot dockRef={NO_DOCK} onRestoreSession={() => {}}><div /></EditorRoot>);
  stopWiring = installDeviceWiring();
  await wait(1500);
}

function turn(w: number, h: number): void {
  sizeWindow(w, h);
  act(() => { window.dispatchEvent(new Event('resize')); });
}

const morphOf = () => waapi!.animations.filter((a) => a.animation.id === MORPH_ANIMATION);
const playing = () => morphOf().filter((a) => a.animation.playState === 'running');
const held = () => morphOf().filter((a) => a.animation.playState === 'paused');

/** Sets the layout shape as a device does when it reports a turn before the window takes the size. */
async function reportTurn(shape: 'portrait' | 'landscape'): Promise<void> {
  const { useEditorStore } = await import('../../../state/store');
  act(() => { useEditorStore.getState().setLayoutShape(shape); });
}

describe('the layout-shape morph', () => {
  spec('UI-28', 'turning the window plays a morph whose every move runs out to the upright render and leaves nothing behind', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    await mountAt(1180, 820);
    turn(820, 1180);
    await wait(100);
    const morph = morphOf();
    expect(morph.length, 'a morph runs').toBeGreaterThan(0);
    // Every move runs out to no transform of its own and keeps nothing once it has run.
    for (const a of morph.filter((m) => m.options.composite === 'add')) {
      expect(a.keyframes.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
      expect(a.options.fill ?? 'none').toBe('none');
    }
    for (const a of morph) a.animation.finish();
    await wait(50);
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(false);
    expect(document.querySelectorAll('[inert][aria-hidden="true"][style*="fixed"]').length, 'no stand-in stays').toBe(0);
  });

  spec('UI-28', 'a resize that keeps the arrangement moves nothing, and the map is never drawn by a morph', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    await mountAt(1180, 820);
    turn(1100, 800);
    await wait(100);
    expect(morphOf(), 'no morph on a resize that keeps the shape').toEqual([]);

    const map = document.querySelector<HTMLElement>('[data-testid="shell-map-plane"]')!;
    const styles = new Set([map.getAttribute('style')]);
    const record = () => { styles.add(map.getAttribute('style')); };
    turn(800, 1100);
    for (let t = 0; t < 10; t++) { record(); await wait(50); }
    record();
    expect(morphOf().length, 'a morph runs').toBeGreaterThan(0);
    // The map takes the new window's size once, and no morph draws it or anything in it.
    expect(styles.size, 'the map plane is resized at most once').toBeLessThanOrEqual(2);
    expect(morphOf().filter((a) => map === a.target || map.contains(a.target))).toEqual([]);
  });

  spec('UI-28', 'a turn reported before the window turns holds the chrome until the window has turned, then plays', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    await mountAt(1180, 820);
    await reportTurn('portrait');
    await wait(50);
    expect(held().length, 'the pieces stand where they stood').toBeGreaterThan(0);
    expect(playing()).toEqual([]);
    // A size on the way that is not yet upright keeps them held.
    turn(1100, 1000);
    await wait(50);
    expect(playing()).toEqual([]);
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(true);
    turn(820, 1180);
    await waitFor(() => expect(playing().length, 'played once the window has turned').toBeGreaterThan(0));
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(false);
  });

  spec('UI-28', 'a turn the window never follows plays the held chrome after a short wait', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    await mountAt(1180, 820);
    await reportTurn('portrait');
    await wait(100);
    expect(playing()).toEqual([]);
    await wait(400);
    expect(playing().length).toBeGreaterThan(0);
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(false);
  });

  spec('UI-28', 'closing the editor while a turn is held leaves no morph behind', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    await mountAt(1180, 820);
    await reportTurn('portrait');
    await wait(50);
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(true);
    stopWiring();
    stopWiring = () => {};
    cleanup();
    await wait(500);
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(false);
    expect(held().concat(playing()), 'every animation of it ended').toEqual([]);
    expect(document.querySelectorAll('[inert][aria-hidden="true"]').length, 'no stand-in stays').toBe(0);
  });

  spec('UI-28', 'under reduced motion turning the window re-arranges the chrome at once, with no morph', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    await mountAt(1180, 820, 'reduced');
    turn(820, 1180);
    await wait(100);
    expect(morphOf()).toEqual([]);
    expect(document.documentElement.hasAttribute('data-morphing')).toBe(false);
  });
});
