// @vitest-environment jsdom
// The one picture-stage gesture: a drag pans, the wheel and a pinch zoom, a press that stays put is a
// tap, and a double-click or a double-tap puts the view back at rest.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { usePanZoom, type PanZoomOptions } from '../../../ui/primitives/use-pan-zoom';

function Stage(props: PanZoomOptions) {
  const pz = usePanZoom(props);
  const { tx, ty, scale } = pz.view;
  return (
    <div data-testid="stage" data-view={`${tx},${ty},${scale.toFixed(3)}`} data-hint={pz.showResetHint ? 'shown' : 'hidden'} {...pz.stageProps}>
      <div data-testid="picture" style={pz.viewStyle} />
    </div>
  );
}

const stage = () => screen.getByTestId('stage');
const view = () => stage().dataset.view!.split(',').map(Number);

type Pointer = { id?: number; type?: string };
const down = (x: number, y: number, p: Pointer = {}) => fireEvent.pointerDown(stage(), { clientX: x, clientY: y, pointerId: p.id ?? 1, pointerType: p.type ?? 'mouse' });
const move = (x: number, y: number, p: Pointer = {}) => fireEvent.pointerMove(stage(), { clientX: x, clientY: y, pointerId: p.id ?? 1, pointerType: p.type ?? 'mouse' });
const up = (x: number, y: number, p: Pointer = {}) => fireEvent.pointerUp(stage(), { clientX: x, clientY: y, pointerId: p.id ?? 1, pointerType: p.type ?? 'mouse' });

/** A pointer event jsdom lacks: a mouse event carrying the pointer's id and kind. */
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

beforeEach(() => { vi.stubGlobal('PointerEvent', FakePointerEvent); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('usePanZoom', () => {
  it('pans by the drag and does not call it a tap', () => {
    const onTap = vi.fn();
    render(<Stage onTap={onTap} />);
    down(10, 10);
    move(40, 30);
    up(40, 30);
    expect(view()).toEqual([30, 20, 1]);
    expect(onTap).not.toHaveBeenCalled();
    expect(stage().dataset.hint).toBe('shown');
  });

  it('calls a press that stays within the slop a tap and leaves the view at rest', () => {
    const onTap = vi.fn();
    render(<Stage onTap={onTap} />);
    down(10, 10);
    move(12, 11);
    up(12, 11);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(view()).toEqual([0, 0, 1]);
  });

  it('zooms in notches on a mouse wheel and smoothly on a trackpad pinch', () => {
    render(<Stage />);
    fireEvent.wheel(stage(), { deltaY: -100 });
    expect(view()[2]).toBeCloseTo(1.12, 3);
    fireEvent.wheel(stage(), { deltaY: 10, ctrlKey: true });
    expect(view()[2]).toBeCloseTo(1.12 * Math.exp(-0.1), 3);
  });

  it('keeps the zoom between half and six times', () => {
    render(<Stage />);
    for (let i = 0; i < 40; i++) fireEvent.wheel(stage(), { deltaY: -100 });
    expect(view()[2]).toBe(6);
    for (let i = 0; i < 80; i++) fireEvent.wheel(stage(), { deltaY: 100 });
    expect(view()[2]).toBe(0.5);
  });

  it('zooms by a two-finger pinch and follows its midpoint', () => {
    const onTap = vi.fn();
    render(<Stage onTap={onTap} />);
    down(100, 100, { id: 1, type: 'touch' });
    down(200, 100, { id: 2, type: 'touch' });
    move(250, 100, { id: 2, type: 'touch' });
    // The spread went from 100 to 150 and the midpoint moved 25 px right.
    expect(view()).toEqual([25, 0, 1.5]);
    up(250, 100, { id: 2, type: 'touch' });
    // The finger left behind pans on from where the view stands.
    move(110, 120, { id: 1, type: 'touch' });
    expect(view()).toEqual([35, 20, 1.5]);
    up(110, 120, { id: 1, type: 'touch' });
    expect(onTap).not.toHaveBeenCalled();
  });

  it('resets on a double-click', () => {
    render(<Stage />);
    fireEvent.wheel(stage(), { deltaY: -100 });
    down(0, 0); move(20, 0); up(20, 0);
    fireEvent.doubleClick(stage());
    expect(view()).toEqual([0, 0, 1]);
    expect(stage().dataset.hint).toBe('hidden');
  });

  it('resets on a double-tap, and two slow taps stay two taps', () => {
    vi.useFakeTimers();
    const onTap = vi.fn();
    render(<Stage onTap={onTap} />);
    fireEvent.wheel(stage(), { deltaY: -100 });
    const tap = (x: number, y: number) => { down(x, y, { type: 'touch' }); up(x, y, { type: 'touch' }); };
    tap(50, 50);
    act(() => { vi.advanceTimersByTime(1000); });
    tap(52, 51);
    expect(view()[2]).toBeCloseTo(1.12, 3);
    act(() => { vi.advanceTimersByTime(200); });
    tap(52, 51);
    expect(view()).toEqual([0, 0, 1]);
    expect(onTap).toHaveBeenCalledTimes(3);
  });

  it('settles on the registry motion, and jumps where motion is reduced', () => {
    const { unmount } = render(<Stage />);
    expect(screen.getByTestId('picture').style.transition).toContain('transform');
    unmount();
    render(<MotionConfig reducedMotion="always"><Stage /></MotionConfig>);
    expect(screen.getByTestId('picture').style.transition).toBe('none');
  });

  it('fades the reset hint after a quiet spell', () => {
    vi.useFakeTimers();
    render(<Stage />);
    fireEvent.wheel(stage(), { deltaY: -100 });
    expect(stage().dataset.hint).toBe('shown');
    act(() => { vi.advanceTimersByTime(2600); });
    expect(stage().dataset.hint).toBe('hidden');
  });
});
