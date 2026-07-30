/**
 * Dispatch robustness: one faulty listener must never silence the listeners
 * after it (the error toast and the red flash ride the same emit), and it must
 * never break the emitter's own control flow.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../core/commands/event-bus';

interface Events { ping: { n: number } }

describe('EventBus.emit', () => {
  it('a throwing handler does not stop later handlers or the emitter', () => {
    const bus = new EventBus<Events>();
    const order: string[] = [];
    bus.on('ping', () => { order.push('first'); throw new Error('faulty listener'); });
    bus.on('ping', () => { order.push('second'); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => bus.emit('ping', { n: 1 })).not.toThrow();
    expect(order).toEqual(['first', 'second']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('off during emit is safe', () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    const a = () => { seen.push(1); bus.off('ping', a); };
    bus.on('ping', a);
    bus.on('ping', () => seen.push(2));
    bus.emit('ping', { n: 1 });
    expect(seen).toEqual([1, 2]);
  });
});
