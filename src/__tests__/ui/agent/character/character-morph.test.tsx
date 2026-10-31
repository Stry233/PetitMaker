// @vitest-environment jsdom
/**
 * A layout-shape morph draws the character as one of its pieces: she takes her new seat before the
 * morph measures and reads it where the morph puts it, never where it is drawn travelling. A flip that starts while another
 * morph runs must leave her on the newest seat; jsdom lays out marked pieces from their inline boxes
 * (`installWebAnimations`), the seat drawn where its paused morph stands.
 */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { CharacterHost } from '../../../../ui/agent/character/CharacterHost';
import { getCharacterHandle } from '../../../../ui/agent/character/Character';
import { setDeskSeat, setPanelCarriage } from '../../../../ui/agent/character/seat';
import { MORPHING_ATTR, measureMorph, playMorph } from '../../../../ui/primitives/morph';
import { CHARACTER_SEAT } from '../../../../ui/shell/panel-frame';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import { installWebAnimations } from '../../../_support/web-animations';
import { spec } from '../../../_support/spec';

let env: ReturnType<typeof installWebAnimations>;

const nextFrame = () => new Promise<void>((r) => { requestAnimationFrame(() => r()); });
/** Every promise reaction queued so far, the cancelled run's included, has run. */
const drain = () => new Promise<void>((r) => { setTimeout(r, 0); });

/** Her folded seat, a morph piece of its own, mounted with her host. */
function mountOnSeat(): HTMLElement {
  const seat = document.createElement('div');
  seat.setAttribute('data-morph', 'assistant-block');
  document.body.appendChild(seat);
  moveSeat(seat, 0, 0);
  render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <CharacterHost entranceRef={{ current: seat }} open={false} connected size={CHARACTER_SEAT.w} />
      </I18nProvider>
    </MotionConfig>,
  );
  return seat;
}

function moveSeat(seat: HTMLElement, left: number, top: number): void {
  Object.assign(seat.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${CHARACTER_SEAT.w}px`, height: `${CHARACTER_SEAT.w}px` });
}

/** Where she is placed, read off the styles her park writes. */
function herPlace(): { left: number; top: number } {
  const el = getCharacterHandle()!.el;
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

const onSeat = (left: number, top: number) => ({ left: left + CHARACTER_SEAT.pad, top: top + CHARACTER_SEAT.pad });

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  useEditorStore.setState({ locale: 'en' });
  env = installWebAnimations('[data-morph], [inert], [data-seat]');
});

afterEach(() => {
  cleanup();
  env.restore();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(MORPHING_ATTR);
});

describe('the character through a flip that interrupts another', () => {
  spec('UI-28', 'a second flip during a running morph leaves her on the newest seat, never parked between', async () => {
    const seat = mountOnSeat();
    await act(async () => { await nextFrame(); });

    const first = measureMorph();
    moveSeat(seat, 300, 300);
    playMorph(first, 'shell.shape.morph');
    await nextFrame();
    expect(herPlace()).toEqual(onSeat(300, 300));

    const second = measureMorph();
    moveSeat(seat, 100, 500);
    playMorph(second, 'shell.shape.morph');
    // The first run's animations were cancelled; its settling must not re-park her on the seat as
    // the second run draws it, at its old place.
    await drain();
    expect(herPlace()).toEqual(onSeat(100, 500));
  });

  spec('UI-28', 'a second flip held for the window to turn also retires the running morph', async () => {
    const seat = mountOnSeat();
    await act(async () => { await nextFrame(); });

    const first = measureMorph();
    moveSeat(seat, 300, 300);
    playMorph(first, 'shell.shape.morph');
    await nextFrame();

    const second = measureMorph();
    moveSeat(seat, 100, 500);
    playMorph(second, 'shell.shape.morph', { held: true });
    await drain();
    expect(herPlace()).toEqual(onSeat(100, 500));
  });
});

describe('the character when a flip docks the open assistant elsewhere', () => {
  /** Her host with the assistant open on a wide window, so the panel floats; `turn` gives the window
   *  the upright shape, where the open panel docks at the foot and she takes the docked seat. */
  function mountOpen(): { turn: () => void } {
    const seat = document.createElement('div');
    seat.setAttribute('data-morph', 'assistant-block');
    document.body.appendChild(seat);
    moveSeat(seat, 0, 0);
    useEditorStore.setState({ assistantOpen: true, assistantPinned: false });
    const at = (shape: 'landscape' | 'portrait') => (
      <MotionConfig reducedMotion="never">
        <I18nProvider>
          <InputModeProvider inputMode="touch" shape={shape}>
            <CharacterHost entranceRef={{ current: seat }} open connected size={CHARACTER_SEAT.w} />
          </InputModeProvider>
        </I18nProvider>
      </MotionConfig>
    );
    const view = render(at('landscape'));
    return { turn: () => { act(() => { view.rerender(at('portrait')); }); } };
  }

  /** Her own pop: an animation of her opacity, which leaves her place and arrives at another. */
  const pops = (from: number) => env.animations.slice(from)
    .filter((a) => a.target === getCharacterHandle()!.el && a.keyframes.some((k) => k.opacity !== undefined));

  spec('UI-28', 'the chrome\'s morph carries her to the docked seat: she never fades out and pops in there', async () => {
    const { turn } = mountOpen();
    await act(async () => { await nextFrame(); });
    const before = env.animations.length;
    const first = measureMorph();
    turn();
    playMorph(first, 'shell.shape.morph');
    await act(async () => { await nextFrame(); });
    expect(pops(before)).toEqual([]);
    expect(getCharacterHandle()!.el.style.opacity).toBe('1');
  });

  spec('UI-28', 'with no morph running, a change of her place still pops her in at the new seat', async () => {
    const { turn } = mountOpen();
    await act(async () => { await nextFrame(); });
    const before = env.animations.length;
    turn();
    await act(async () => { await nextFrame(); });
    expect(pops(before).length).toBeGreaterThan(0);
  });
});

describe('the panel a mode switch opens', () => {
  spec('UI-27', 'a press that switches the mode and opens the docked assistant leaves the panel on its sheet once the morph ends', async () => {
    useEditorStore.setState({ assistantOpen: false, assistantPinned: false });
    const folded = document.createElement('div');
    folded.setAttribute('data-morph', 'assistant-block');
    document.body.appendChild(folded);
    moveSeat(folded, 300, 700);
    const at = (open: boolean) => (
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <InputModeProvider inputMode="touch" shape="portrait">
            <CharacterHost entranceRef={{ current: folded }} open={open} connected size={CHARACTER_SEAT.w} />
          </InputModeProvider>
        </I18nProvider>
      </MotionConfig>
    );
    const view = render(at(false));
    await act(async () => { await nextFrame(); });

    // The switch re-sizes the frame in the commit that opens the panel, which mounts its plate and desk seat.
    const first = measureMorph();
    moveSeat(folded, 280, 680);
    playMorph(first, 'shell.mode.resize');
    const plate = document.createElement('div');
    const desk = document.createElement('div');
    desk.setAttribute('data-seat', '');
    moveSeat(desk, 20, 400);
    document.body.append(plate, desk);
    act(() => {
      setPanelCarriage(plate);
      setDeskSeat(desk);
      useEditorStore.setState({ assistantOpen: true });
      view.rerender(at(true));
    });
    await act(async () => {
      for (const a of env.animations) a.animation.finish();
      await drain();
      await nextFrame();
    });

    expect(['', 'none']).toContain(plate.style.transform);
    act(() => { setDeskSeat(null); setPanelCarriage(null); });
  });
});
