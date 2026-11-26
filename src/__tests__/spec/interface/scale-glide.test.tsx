// @vitest-environment jsdom
/**
 * A change of the interface scale carries what the frame places straight from where it stood to where
 * the new scale puts it, on screen: a piece placed by the room the scale leaves, such as the upright
 * mode row, centred and spread across it, never sets off from its new place drawn at the old scale, nor
 * turns back on the way.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';
import { FrameLayoutProvider, useFrameLayout, type LayoutState } from '../../../ui/shell/frame-layout';
import { useFrameZoom } from '../../../ui/shell/use-frame-zoom';
import { AssistantBlock, ModeRow, type ChromeSwap } from '../../../ui/shell/controls/ModeRow';
import { CornerActions } from '../../../ui/shell/controls/CornerActions';
import { LayerControl } from '../../../ui/shell/controls/RailLayerControl';
import { MODES } from '../../../ui/shell/frame';

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

let plan: LayoutState | null = null;
let settledZoom = 1;
function Probe() {
  plan = useFrameLayout();
  settledZoom = useFrameZoom();
  return null;
}

/** The zoom the frame draws at this frame: the live room's through a glide, the settled one at rest. */
const drawnZoom = () => plan!.liveRoom()?.zoom ?? settledZoom;
const frame = () => act(() => new Promise<void>((done) => { requestAnimationFrame(() => done()); }));

/** Each piece the frame places, by an edge it keeps: its offset on screen, in the frame's pixels times
 *  the zoom it is drawn at. */
const PIECES = [
  ['the mode row', () => screen.getByRole('group', { name: 'Modes' }), 'left'],
  ['the mode row\'s spacing', () => screen.getByRole('group', { name: 'Modes' }), 'gap'],
  ['the corner actions', () => screen.getByTestId('shell-corner-actions'), 'right'],
  ['the layer control', () => screen.getByTestId('shell-layer-control'), 'top'],
  ['the assistant block', () => document.querySelector<HTMLElement>('[data-morph=assistant-block]')!, 'left'],
] as const;
const onScreen = (el: HTMLElement, edge: 'left' | 'right' | 'top' | 'gap') => parseFloat(el.style[edge]) * drawnZoom();

function Shell() {
  return (
    <>
      <ModeRow modes={MODES} mode={null} swap={{} as ChromeSwap} onPick={() => {}} />
      <AssistantBlock entranceRef={{ current: null }} onToggle={() => {}} />
      <CornerActions pose="map" swap={{} as ChromeSwap} menuOpen={false} toggleMenu={() => {}} menuButton={{ current: null }} />
      <LayerControl panelOpen={false} onOpen={() => {}} veiled={false} />
    </>
  );
}

beforeEach(() => { resetStore(); __resetUiZoomAnim(); });
afterEach(() => { cleanup(); plan = null; __resetUiZoomAnim(); resizeTo(1024, 768); });

describe.each([
  { form: 'an upright phone', shape: 'portrait', w: 390, h: 844, from: 1.6, to: 1 },
  { form: 'a wide phone', shape: 'landscape', w: 844, h: 390, from: 1.3, to: 0.8 },
] as const)('on $form', ({ shape, w, h, from, to }) => {
  spec('UI-39', 'a change of the interface scale carries each placed piece straight from where it stood to where it lands', async () => {
    setStoreState({ locale: 'en', inputMode: 'touch', layoutShape: shape, uiZoom: from });
    resizeTo(w, h);
    render(
      <MotionConfig reducedMotion="never">
        <InputModeProvider inputMode="touch" shape={shape}><I18nProvider><FrameLayoutProvider><Probe /><Shell /></FrameLayoutProvider></I18nProvider></InputModeProvider>
      </MotionConfig>,
    );
    const read = () => PIECES.map(([, el, edge]) => onScreen(el(), edge));
    const stood = read();
    act(() => { useEditorStore.getState().setUiZoom(to); });
    const path = [read()];
    for (let i = 0; i < 90 && plan!.liveRoom(); i++) { await frame(); path.push(read()); }
    await frame();
    const landed = read();
    PIECES.forEach(([name], p) => {
      expect(Math.abs(path[0]![p]! - stood[p]!), `${name} sets off from where it stood`).toBeLessThan(1);
      const dir = Math.sign(landed[p]! - stood[p]!);
      for (let i = 1; i < path.length; i++) expect((path[i]![p]! - path[i - 1]![p]!) * dir, `${name}, frame ${i}, never turns back`).toBeGreaterThan(-0.5);
      expect(Math.abs(path[path.length - 1]![p]! - landed[p]!), `${name} ends where the scale lands it`).toBeLessThan(1);
    });
  });
});

describe.each([
  { form: 'a wide window with a mouse', mode: 'pc', shape: 'landscape', w: 1280, h: 800, from: 0.8, by: 0.05 },
  { form: 'an upright phone', mode: 'touch', shape: 'portrait', w: 390, h: 844, from: 1.6, by: -0.05 },
] as const)('on $form, the scale held', ({ mode, shape, w, h, from, by }) => {
  spec('UI-39', 'a scale stepped every other frame, as a held key steps it, carries each placed piece on without turning back', async () => {
    setStoreState({ locale: 'en', inputMode: mode, layoutShape: shape, uiZoom: from });
    resizeTo(w, h);
    render(
      <MotionConfig reducedMotion="never">
        <InputModeProvider inputMode={mode} shape={shape}>
          <I18nProvider><FrameLayoutProvider><Probe /><Shell /></FrameLayoutProvider></I18nProvider>
        </InputModeProvider>
      </MotionConfig>,
    );
    const read = () => PIECES.map(([, el, edge]) => onScreen(el(), edge));
    const stood = read();
    const path = [stood];
    for (let press = 1; press <= 10; press++) {
      act(() => { useEditorStore.getState().setUiZoom(Math.round((from + press * by) * 100) / 100); });
      path.push(read());
      await frame(); path.push(read());
      await frame(); path.push(read());
    }
    for (let i = 0; i < 90 && plan!.liveRoom(); i++) { await frame(); path.push(read()); }
    await frame();
    const landed = read();
    // Sampled between frame callbacks, a sample may read a length one writer has yet to draw at the
    // frame's zoom, which no painted frame shows: a turn back is one of a pixel or more.
    PIECES.forEach(([name], p) => {
      const dir = Math.sign(landed[p]! - stood[p]!);
      for (let i = 1; i < path.length; i++) {
        expect((path[i]![p]! - path[i - 1]![p]!) * dir, `${name}, sample ${i}, never turns back`).toBeGreaterThan(-1);
      }
      expect(Math.abs(path[path.length - 1]![p]! - landed[p]!), `${name} ends where the scale lands it`).toBeLessThan(1);
    });
  });
});
