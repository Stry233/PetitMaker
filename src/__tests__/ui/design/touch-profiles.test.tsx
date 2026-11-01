// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { ActionButton } from '../../../ui/primitives/ActionButton';
import { ToolPill } from '../../../ui/shell/bars/ToolPill';
import { useFrameZoom } from '../../../ui/shell/use-frame-zoom';
import { FIT_FLOOR, fittedUiScale, liveScaleNow } from '../../../ui/design/scale';
import { RAIL, ZOOM } from '../../../ui/shell/units';
import { RailButton } from '../../../ui/shell/controls/RailButton';
import { LayerControl } from '../../../ui/shell/controls/RailLayerControl';
import { ARRANGEMENT_ROOM, frameZoomFor } from '../../../ui/shell/panel-frame';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { useInputMode } from '../../../ui/session/use-input-mode';
import type { InputMode } from '../../../platform/device/input-mode';
import type { Glyph } from '../../../ui/shell/frame';
import { LayerPanel } from '../../../ui/shell/controls/LayerPanel';
import { tileOf } from '../../../ui/shell/controls/layer-plate';
import { TOUCH_TARGET, ArrangementRoomProvider } from '../../../ui/design/scale';
import { TouchReach } from '../../../ui/primitives/TouchReach';
import { makeState } from '../../_support/map-state';

const under = (inputMode: InputMode) => ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="always">
    <I18nProvider><InputModeProvider inputMode={inputMode}>{children}</InputModeProvider></I18nProvider>
  </MotionConfig>
);

const settle = () => act(() => new Promise((r) => setTimeout(r, 80)));

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => { cleanup(); resizeTo(1024, 768); delete document.documentElement.dataset.inputMode; });

describe('interaction profiles by input mode', () => {
  const button = async (inputMode: InputMode) => {
    const { getByRole } = render(<ActionButton interaction="tile" hoverFill="#EAE8CD" fill="#FFFEE3">Go</ActionButton>, { wrapper: under(inputMode) });
    const el = getByRole('button');
    fireEvent.pointerEnter(el, { pointerType: 'pen' });
    await settle();
    const hovered = { transform: el.style.transform, fill: el.style.backgroundColor };
    fireEvent.pointerLeave(el, { pointerType: 'pen' });
    fireEvent.pointerDown(el, { pointerType: 'pen', isPrimary: true, button: 0 });
    await settle();
    return { hovered, pressed: el.style.transform };
  };

  spec('UI-29', 'an ActionButton in touch mode has no hover gesture and keeps its press gesture', async () => {
    const pc = await button('pc');
    expect(pc.hovered.transform).toMatch(/scale\(1\.08\)/);
    cleanup();
    const touch = await button('touch');
    expect(touch.hovered.transform).not.toMatch(/scale/);
    expect(touch.hovered.fill).toMatch(/255, 254, 227/);
    expect(touch.pressed).toMatch(/scale\(0\.9\)/);
  });
});

const glyph: Glyph = { w: 10, h: 10, ink: { x: 0, y: 0, w: 10, h: 10 }, parts: [] } as unknown as Glyph;

describe('touch sizing', () => {
  const zoomAt = (inputMode: InputMode, width: number, height: number) => {
    resizeTo(width, height);
    return renderHook(() => useFrameZoom(), { wrapper: under(inputMode) }).result.current;
  };

  spec('UI-34', 'in touch mode a rail button and a tool cell carry a fingertip hit area, upright and wide', () => {
    for (const [w, h, shape] of [[390, 844, 'portrait'], [844, 390, 'landscape']] as const) {
      resizeTo(w, h);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <MotionConfig reducedMotion="always"><I18nProvider><InputModeProvider inputMode="touch" shape={shape}>{children}</InputModeProvider></I18nProvider></MotionConfig>
      );
      const rail = render(<RailButton morph="probe" label="Undo" grow="left" onPress={() => {}}>{null}</RailButton>, { wrapper });
      expect(rail.getByRole('button').querySelector('[data-touch-reach]'), `${w}x${h}`).not.toBeNull();
      cleanup();
      const cell = render(<ToolPill glyph={glyph} label="Brush" active={false} centre={0} onSelect={() => {}}/>, { wrapper });
      expect(cell.getByRole('button').querySelector('[data-touch-reach]'), `${w}x${h}`).not.toBeNull();
      cleanup();
    }
  });

  const switching = (reduced: boolean) => {
    resizeTo(390, 844);
    let mode: InputMode = 'pc';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}><InputModeProvider inputMode={mode} shape="portrait">{children}</InputModeProvider></MotionConfig>
    );
    const hook = renderHook(() => useFrameZoom(), { wrapper });
    const before = hook.result.current;
    mode = 'touch';
    hook.rerender();
    return { before, hook };
  };
  /** The zoom the frame plane is drawn at this frame: the live scale its writer reads. */
  const drawn = () => { const { touch, uiZoom } = liveScaleNow(); return frameZoomFor(390, 844, uiZoom, 0, { touch, upright: true }); };

  spec('UI-27', 'a switch to touch mode draws the frame at its touch size in the switching commit, with or without reduced motion', () => {
    for (const reduced of [true, false]) {
      const switched = switching(reduced);
      const lifted = switched.hook.result.current;
      expect(lifted, `reduced ${reduced}`).toBeGreaterThan(switched.before);
      // No frames between the two sizes: the chrome's morph carries the change on screen.
      expect(drawn(), `reduced ${reduced}`).toBe(lifted);
      cleanup();
    }
  });

  spec('UI-27', 'in touch mode each layer step carries a fingertip hit area', () => {
    resizeTo(844, 390);
    const { getByRole } = render(<LayerControl panelOpen={false} onOpen={() => {}} veiled={false} />, { wrapper: under('touch') });
    for (const name of [/add a layer|添加图层|layer up|add layer/i, /remove a layer|删除图层|layer down|remove layer/i]) {
      expect(getByRole('button', { name }).querySelector('[data-touch-reach]'), String(name)).not.toBeNull();
    }
  });

  spec('UI-27', 'in touch mode every control on the open layer panel answers a fingertip, and the file\'s rows stand a fingertip apart', () => {
    resizeTo(844, 390);
    useEditorStore.setState({ gridState: makeState() });
    const { container } = render(<LayerPanel mode="column" onMode={() => {}} right={0} maxHeight={400} top={0} />, { wrapper: under('touch') });
    for (const id of ['shell-layer-numbers', 'shell-layer-bigger', 'shell-layer-smaller', 'shell-layer-annotation-help',
      'shell-layer-annotation-eye', 'shell-layer-annotation-lock', 'shell-layer-eye-0', 'shell-layer-lock-0']) {
      expect(container.querySelector(`[data-testid="${id}"] [data-touch-reach]`), id).not.toBeNull();
    }
    // A toggle's hit area stays inside its own row and off its pair's, at the reach the touch frame's
    // least zoom asks for, which is the most touch mode ever asks.
    const reach = TOUCH_TARGET / (ZOOM * FIT_FLOOR);
    const tile = tileOf('column', true);
    expect(tile.padY).toBeGreaterThanOrEqual((reach - tile.icon) / 2);
    expect(tile.toggleGap).toBeGreaterThanOrEqual(reach - tile.icon);
    const grid = tileOf('grid', true);
    expect(grid.toggleGap).toBeGreaterThanOrEqual(reach - grid.icon);
  });

  it('draws no hit area around a layer step in PC mode', () => {
    const { container } = render(<LayerControl panelOpen={false} onOpen={() => {}} veiled={false} />, { wrapper: under('pc') });
    expect(container.querySelector('[data-touch-reach]')).toBeNull();
  });

  it('leaves the PC frame zoom where the fit puts it', () => {
    for (const [w, h] of [[1280, 800], [844, 390], [1920, 1080]] as const) {
      expect(zoomAt('pc', w, h), `${w}x${h}`).toBeCloseTo(ZOOM * fittedUiScale(w, h, 1), 9);
    }
  });

  // A hit area is a fingertip on screen at and over 100%; under it, it spans what it spanned at 100%,
  // so neighbours spaced a fingertip apart there never meet however small the frame draws.
  it('keeps a hit area within its controls\' spacing at any frame zoom, and a fingertip wide at and over 100%', () => {
    const reachAt = (uiZoom: number) => {
      useEditorStore.setState({ uiZoom });
      const zoom = frameZoomFor(window.innerWidth, window.innerHeight, uiZoom, 0, { touch: true, upright: false });
      const { container, unmount } = render(
        <ArrangementRoomProvider value={ARRANGEMENT_ROOM}><TouchReach w={RAIL.button} h={RAIL.button} zoom={zoom} /></ArrangementRoomProvider>,
        { wrapper: under('touch') },
      );
      const box = container.querySelector<HTMLElement>('[data-touch-reach]')!;
      const span = RAIL.button - (parseFloat(box.style.left) || 0) - (parseFloat(box.style.right) || 0);
      unmount();
      return { span, zoom };
    };
    const atFull = reachAt(1);
    for (const uiZoom of [0.6, 0.8, 0.9]) expect(reachAt(uiZoom).span, `at ${uiZoom}`).toBeCloseTo(atFull.span, 9);
    for (const uiZoom of [1, 1.25, 1.5]) {
      const { span, zoom } = reachAt(uiZoom);
      expect(span * zoom, `at ${uiZoom}`).toBeCloseTo(Math.max(TOUCH_TARGET, RAIL.button * zoom), 9);
    }
    useEditorStore.setState({ uiZoom: 1 });
  });
});

describe('the input mode on the page', () => {
  it('is published for the style sheets', () => {
    useEditorStore.setState({ inputMode: 'touch' });
    renderHook(() => useInputMode());
    expect(document.documentElement.dataset.inputMode).toBe('touch');
    act(() => useEditorStore.setState({ inputMode: 'pc' }));
    expect(document.documentElement.dataset.inputMode).toBe('pc');
  });
});

describe('shortcut badges', () => {
  const pill = (inputMode: InputMode) => render(
    <ToolPill glyph={glyph} label="Brush" commandId="tool.brush" active={false} centre={0} onSelect={() => {}}/>,
    { wrapper: under(inputMode) },
  ).container.textContent ?? '';

  it('are absent in touch mode', () => {
    expect(pill('pc')).not.toBe('');
    cleanup();
    expect(pill('touch')).toBe('');
  });
});
