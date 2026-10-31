// @vitest-environment jsdom
/**
 * What a switch costs the editor's React tree, counted by a Profiler around the app root in jsdom. A
 * mode switch commits its new sizes once and the chrome's morph carries them on Web Animations past
 * React (`ui/shell/ChromeMorph.tsx`), as it does a layout-shape flip, and the readers of the window
 * size hear a resize in one commit. The morph runs here on the stand-in in
 * `_support/web-animations.ts`. jsdom runs no `ResizeObserver`, so a re-park the character's planes
 * hear is not counted here; `scripts/internal/perf/perf-bench.mts mode-switch` counts the browser's
 * commits.
 */
import { afterEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { spec } from '../../_support/spec';
import { installWebAnimations } from '../../_support/web-animations';
import { MORPH_ANIMATION } from '../../../ui/primitives/morph';

// The first mount transforms the whole editor graph, which a loaded machine cannot fit in 5 s.
vi.setConfig({ testTimeout: 60_000 });

/** Measured 3 and 4 (the switch and the surfaces that re-measure their own boxes after it); a re-size
 *  committed on every frame takes about twenty. */
const MODE_SWITCH_COMMITS = 6;
/** Measured 3 each way, the layout-shape flip included: the one commit every window reader shares,
 *  the re-plan, and the surfaces that re-measure their own boxes on a resize (the Show me spotlight,
 *  the layer step); the morph adds none, and the character re-parks without one while no chip stands
 *  at her shoulder. A reading per reader takes dozens. */
const RESIZE_COMMITS = 5;

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

/** Mounts the editor root from a reset graph, counts its commits, and returns once it has gone quiet. */
async function mountEditor() {
  vi.resetModules();
  sizeWindow(1180, 820);
  const { EditorRoot } = await import('../../../ui/app/EditorRoot');
  const { NO_DOCK } = await import('../../../ui/design/scale');
  const { touchSizing } = await import('../../../ui/design/input-mode');
  const { useEditorStore } = await import('../../../state/store');
  act(() => { useEditorStore.setState({ locale: 'en' }); });
  const commits = { n: 0 };
  render(
    <Profiler id="editor" onRender={() => { commits.n++; }}>
      <EditorRoot dockRef={NO_DOCK} onRestoreSession={() => {}}><div /></EditorRoot>
    </Profiler>,
  );
  await quiet(commits);
  return { commits, touchSizing, useEditorStore };
}

/** Waits until no commit has landed for 300 ms: the mount's effects and deferred work are done. */
async function quiet(commits: { n: number }): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const before = commits.n;
    await wait(300);
    if (commits.n === before) return;
  }
  throw new Error('the editor never went quiet');
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  sizeWindow(1024, 768);
});

describe('what a switch costs in React commits', () => {
  spec('UI-27', 'a switch between touch and PC mode steps its sizes in one commit and commits the editor a few times, not on each frame of the morph', async () => {
    const { commits, touchSizing, useEditorStore } = await mountEditor();
    for (const [mode, end] of [['touch', true], ['pc', false]] as const) {
      commits.n = 0;
      act(() => { useEditorStore.getState().setInputMode(mode); });
      // The sizes step in the switching commit; the chrome's morph carries them on screen.
      expect(touchSizing.get(), `to ${mode}`).toBe(end);
      await quiet(commits);
      expect(commits.n, `to ${mode}`).toBeLessThanOrEqual(MODE_SWITCH_COMMITS);
    }
  });

  spec('UI-28', 'turning the window upright and back commits every reader of the window size together, not one commit per reader, and morphs the chrome past React', async () => {
    const waapi = installWebAnimations('[data-morph], [inert]');
    const { commits } = await mountEditor();
    // The page's own shape detector, as the editor's start installs it.
    const { installDeviceWiring } = await import('../../../editor/session/device-wiring');
    const stop = installDeviceWiring();
    try {
      for (const [w, h] of [[820, 1180], [1180, 820]] as const) {
        commits.n = 0;
        waapi.animations.length = 0;
        sizeWindow(w, h);
        act(() => {
          window.dispatchEvent(new Event('resize'));
          window.visualViewport?.dispatchEvent(new Event('resize'));
        });
        await quiet(commits);
        expect(commits.n, `${w}x${h}`).toBeLessThanOrEqual(RESIZE_COMMITS);
        // The morph ran: the corner actions and the mode tiles were drawn from their old places.
        const moved = new Set(waapi.animations
          .filter((a) => a.animation.id === MORPH_ANIMATION && a.options.composite === 'add')
          .map((a) => a.target.getAttribute('data-morph')));
        expect([...moved], `${w}x${h}`).toEqual(expect.arrayContaining(['corner', 'mode-object']));
      }
    } finally {
      stop();
      waapi.restore();
    }
  });
});
