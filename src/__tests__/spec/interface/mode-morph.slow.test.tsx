// @vitest-environment jsdom
/**
 * The re-size a mode switch plays, read where it is drawn through the mounted editor root: the frame
 * plane's `zoom` and the morph's animations. jsdom has no layout and no Web Animations, so
 * `_support/web-animations.ts` lays the pieces out from their own lengths and records the animations,
 * which never advance until finished here.
 */
import { afterEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { installWebAnimations } from '../../_support/web-animations';
import { MORPH_ANIMATION } from '../../../ui/primitives/morph';
import { outSeconds } from '../../../ui/design/motion';

// The first mount transforms the whole editor graph, which a loaded machine cannot fit in 5 s.
vi.setConfig({ testTimeout: 60_000 });

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

let waapi: ReturnType<typeof installWebAnimations> | null = null;

afterEach(() => {
  cleanup();
  waapi?.restore();
  waapi = null;
  vi.resetModules();
  sizeWindow(1024, 768);
});

type Mode = 'pc' | 'touch';

/** Mounts the editor root in `mode` at `w` by `h`, the objects open, and waits for it to settle. */
async function mountAt(w: number, h: number, mode: Mode, motion: 'full' | 'reduced' = 'full') {
  vi.resetModules();
  sizeWindow(w, h);
  const { EditorRoot } = await import('../../../ui/app/EditorRoot');
  const { NO_DOCK } = await import('../../../ui/design/scale');
  const { useEditorStore } = await import('../../../state/store');
  act(() => {
    const s = useEditorStore.getState();
    useEditorStore.setState({ locale: 'en' });
    s.setLayoutShape(h > w ? 'portrait' : 'landscape');
    s.setInputMode(mode);
    s.setMotionPref(motion);
    s.setEditMode({ mode: 'object' });
  });
  render(<EditorRoot dockRef={NO_DOCK} onRestoreSession={() => {}}><div /></EditorRoot>);
  await wait(1500);
  return useEditorStore;
}

const morphOf = () => waapi!.animations.filter((a) => a.animation.id === MORPH_ANIMATION);
const frameZoom = () => Number(screen.getByTestId('shell-frame-plane').style.zoom);

/** Opens Settings through the store and waits for its window. */
async function openSettings(store: Awaited<ReturnType<typeof mountAt>>): Promise<HTMLElement> {
  act(() => { store.getState().setModal('settings', true); });
  await wait(1500);
  return screen.getByRole('dialog', { name: 'Settings' });
}

describe('the input-mode morph', () => {
  for (const { w, h, from, to } of [
    { w: 1280, h: 800, from: 'pc', to: 'touch' },
    { w: 1180, h: 820, from: 'touch', to: 'pc' },
    { w: 390, h: 844, from: 'touch', to: 'pc' },
  ] as const) {
    spec('UI-27', `at ${w}x${h} a switch to ${to} mode sizes the frame once, and every move it plays runs out to the new render and leaves nothing behind`, async () => {
      waapi = installWebAnimations('[data-morph], [inert]');
      const store = await mountAt(w, h, from);
      const before = frameZoom();
      const zooms = new Set([before]);
      act(() => { store.getState().setInputMode(to); });
      for (let t = 0; t < 8; t++) { zooms.add(frameZoom()); await wait(16); }
      // The frame takes its new size in one step: there is no size between the two to draw.
      expect(zooms.size, 'the frame plane is sized at most once').toBe(2);
      const morph = morphOf();
      for (const a of morph.filter((m) => m.options.composite === 'add')) {
        expect(a.keyframes.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
        expect(a.options.fill ?? 'none').toBe('none');
      }
      for (const a of morph) a.animation.finish();
      await wait(50);
      expect(document.documentElement.hasAttribute('data-morphing')).toBe(false);
      expect(document.querySelectorAll('[inert][aria-hidden="true"][style*="fixed"]').length, 'no stand-in stays').toBe(0);
    });
  }

  spec('UI-27', 'what Settings shows only in PC mode fades out inside the window on a switch to touch and in on the way back', async () => {
    // Every element is laid out, so the window's scroller shows what it holds.
    waapi = installWebAnimations('*');
    const store = await mountAt(1280, 800, 'pc');
    await openSettings(store);
    const keyboard = screen.getByRole('button', { name: 'Keyboard Shortcuts' });
    act(() => { store.getState().setInputMode('touch'); });
    await wait(100);
    expect(screen.queryByRole('button', { name: 'Keyboard Shortcuts' }), 'touch mode has no keyboard').toBeNull();
    // The window's content re-flows, so it fades out where it stood, inside the window, with the
    // content it stood among, over the motion's first share.
    expect(keyboard.isConnected, 'the live control is gone').toBe(false);
    const copy = [...document.querySelectorAll<HTMLElement>('[data-morph-stand-in]')].find((el) => el.textContent?.includes('Keyboard Shortcuts'))!;
    expect(copy.hasAttribute('inert')).toBe(true);
    expect(copy.closest('[data-morph-shape=card]'), 'inside the window').not.toBeNull();
    const out = morphOf().find((a) => a.target === copy)!;
    expect(out.keyframes.at(-1)).toMatchObject({ opacity: 0 });
    expect(out.options.duration).toBe(outSeconds('shell.mode.resize') * 1000);
    const fades = morphOf().filter((a) => (a.target.contains(copy) || copy.contains(a.target)) && a.keyframes.some((k) => k.opacity !== undefined));
    expect(fades, 'faded once').toEqual([out]);
    for (const a of morphOf()) a.animation.finish();
    await wait(50);
    expect(copy.isConnected, 'gone once faded').toBe(false);

    act(() => { store.getState().setInputMode('pc'); });
    await wait(100);
    const back = screen.getByRole('button', { name: 'Keyboard Shortcuts' });
    const fadeIn = morphOf().find((a) => a.target.contains(back) && a.keyframes[0]?.opacity === 0)!;
    expect(fadeIn.keyframes[0]).toMatchObject({ opacity: 0, offset: 0 });
    // Over the same stretch as what leaves, so no moment shows neither.
    expect(fadeIn.options.delay ?? 0).toBe(0);
    expect(fadeIn.options.duration).toBe(outSeconds('shell.mode.resize') * 1000);
  });

  spec('UI-27', 'under reduced motion a switch re-sizes at once, with no morph', async () => {
    waapi = installWebAnimations('[data-morph], [inert]');
    const store = await mountAt(1280, 800, 'pc', 'reduced');
    const before = frameZoom();
    await openSettings(store);
    act(() => { store.getState().setInputMode('touch'); });
    await wait(100);
    expect(frameZoom()).not.toBe(before);
    expect(morphOf()).toEqual([]);
    // What only PC mode shows is gone at once, with nothing standing in for it.
    expect(screen.queryByRole('button', { name: 'Keyboard Shortcuts' })).toBeNull();
    expect(document.querySelectorAll('[inert][aria-hidden="true"]').length).toBe(0);
  });
});
