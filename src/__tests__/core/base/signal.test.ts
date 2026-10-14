import { describe, expect, it, vi } from 'vitest';
import { createSignal } from '../../../core/base/signal';

describe('createSignal', () => {
  it('calls listeners in subscription order with the value and the previous one, and get reads the last value', () => {
    const s = createSignal<number>(1);
    const seen: string[] = [];
    s.subscribe((v, p) => seen.push(`a${p}>${v}`));
    s.subscribe((v, p) => seen.push(`b${p}>${v}`));
    s.emit(2);
    expect(seen).toEqual(['a1>2', 'b1>2']);
    expect(s.get()).toBe(2);
  });

  it('works as a bare channel', () => {
    const s = createSignal();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.emit();
    off();
    s.emit();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('notifies the listeners subscribed when the emit began', () => {
    const s = createSignal();
    const late = vi.fn();
    let offB: () => void = () => {};
    const b = vi.fn();
    s.subscribe(() => { offB(); s.subscribe(late); });
    offB = s.subscribe(b);
    s.emit();
    expect(b).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    s.emit();
    expect(b).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('subscribes a listener once however often it is added', () => {
    const s = createSignal();
    const fn = vi.fn();
    s.subscribe(fn);
    s.subscribe(fn);
    s.emit();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates a throw by default and isolates it with onError', () => {
    const plain = createSignal();
    const after = vi.fn();
    plain.subscribe(() => { throw new Error('x'); });
    plain.subscribe(after);
    expect(() => plain.emit()).toThrow('x');
    expect(after).not.toHaveBeenCalled();

    const onError = vi.fn();
    const guarded = createSignal<void>(undefined, onError);
    guarded.subscribe(() => { throw new Error('y'); });
    guarded.subscribe(after);
    guarded.emit();
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'y' }));
  });
});
