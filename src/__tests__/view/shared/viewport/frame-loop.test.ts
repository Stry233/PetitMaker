/** The render window both views keep: a request draws a short window, movers hold it open, paint waiters hear the next drawn frame, and dirty work runs once per flush in its declared order. */
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { DirtyFlags, FrameLoop, MOVE_WINDOW_FRAMES, listenAll } from '../../../../view/shared/viewport/frame-loop';

/** Advances until the window closes; returns the frames drawn. */
function drain(loop: FrameLoop, limit = 100): number {
  let drawn = 0;
  while (drawn < limit && loop.advance()) drawn++;
  return drawn;
}

describe('the frame loop', () => {
  it('draws the request window and then closes, however many requests landed in it', () => {
    const single = new FrameLoop(() => {});
    single.request();
    const window = drain(single);
    expect(window, 'a short window of frames').toBeGreaterThan(0);
    const wake = vi.fn();
    const loop = new FrameLoop(wake);
    for (let i = 0; i < 50; i++) loop.request();
    expect(wake).toHaveBeenCalledTimes(50);
    expect(drain(loop)).toBe(window);
    expect(loop.isOpen).toBe(false);
    expect(loop.advance()).toBe(false);
  });

  it('stays open while a mover moves, then closes the move window after it stops', () => {
    let moving = 6;
    const loop = new FrameLoop(() => {}, [() => moving-- > 0]);
    loop.request();
    expect(drain(loop)).toBe(6 + MOVE_WINDOW_FRAMES - 1);
  });

  it('polls every mover each frame, not only until one answers', () => {
    const second = vi.fn(() => false);
    const loop = new FrameLoop(() => {}, [() => true, second]);
    loop.advance();
    expect(second).toHaveBeenCalledOnce();
  });

  it('answers paint waiters once, on the next drawn frame', () => {
    const wake = vi.fn();
    const loop = new FrameLoop(wake);
    const painted = vi.fn();
    loop.onNextPaint(painted);
    expect(wake).toHaveBeenCalledOnce();
    expect(loop.awaitingPaint).toBe(true);
    loop.painted();
    loop.painted();
    expect(painted).toHaveBeenCalledOnce();
    expect(loop.awaitingPaint).toBe(false);
  });
});

describe('dirty flags', () => {
  it('run each marked flag once per flush, in declared order, and nothing unmarked', () => {
    const ran: string[] = [];
    const flags = new DirtyFlags<'a' | 'b' | 'c'>([['a', () => ran.push('a')], ['b', () => ran.push('b')], ['c', () => ran.push('c')]]);
    for (let i = 0; i < 50; i++) { flags.mark('c'); flags.mark('a'); }
    flags.flush();
    flags.flush();
    expect(ran).toEqual(['a', 'c']);
  });

  it('keeps a mark made while flushing for the next flush', () => {
    let runs = 0;
    const flags: DirtyFlags<'a'> = new DirtyFlags<'a'>([['a', () => { runs++; if (runs === 1) flags.mark('a'); }]]);
    flags.mark('a');
    flags.flush();
    expect(runs).toBe(1);
    flags.flush();
    expect(runs).toBe(2);
  });
});

describe('listenAll', () => {
  it('subscribes every handler and detaches them together', () => {
    const bus = new EventBus<EditorEvents>();
    const cells = vi.fn();
    const objects = vi.fn();
    const detach = listenAll(bus, { 'cells-changed': cells, 'objects-changed': objects });
    bus.emit('cells-changed', { cells: [] });
    bus.emit('objects-changed', {});
    detach();
    bus.emit('cells-changed', { cells: [] });
    bus.emit('objects-changed', {});
    expect(cells).toHaveBeenCalledOnce();
    expect(objects).toHaveBeenCalledOnce();
  });
});
