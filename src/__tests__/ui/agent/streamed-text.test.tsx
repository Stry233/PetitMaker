import { act, render, renderHook } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useStreamedText } from '../../../ui/agent/use-streamed-text';
import { ModelProse } from '../../../ui/agent/model-prose';

let time: number;
let sequence: number;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  time = 0;
  sequence = 0;
  frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(ms: number): void {
  act(() => {
    time += ms;
    const ready = [...frames.values()];
    frames.clear();
    ready.forEach(callback => callback(time));
  });
}

function FullMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="never">{children}</MotionConfig>;
}

describe('streamed thoughts reveal', () => {
  it('opens existing text immediately and reveals only appended characters', () => {
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps: { text: 'Read ' }, wrapper: FullMotion });
    expect(view.result.current).toBe('Read ');
    view.rerender({ text: 'Read this' });
    expect(view.result.current).toBe('Read ');
    frame(12);
    expect(view.result.current).toBe('Read t');
    frame(12);
    expect(view.result.current).toBe('Read th');
    frame(24);
    expect(view.result.current).toBe('Read this');
    expect(frames.size).toBe(0);
  });

  it('keeps making progress when chunks arrive faster than a character interval', () => {
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps: { text: '' }, wrapper: FullMotion });
    view.rerender({ text: 'a' });
    frame(6);
    expect(view.result.current).toBe('');
    view.rerender({ text: 'ab' });
    frame(6);
    expect(view.result.current).toBe('a');
    view.rerender({ text: 'abcd' });
    frame(12);
    expect(view.result.current).toBe('ab');
    frame(24);
    expect(view.result.current).toBe('abcd');
  });

  it('catches up a large burst within a short window', () => {
    const text = 'stream '.repeat(500);
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps: { text: '' }, wrapper: FullMotion });
    view.rerender({ text });
    frame(120);
    expect(view.result.current.length).toBeGreaterThan(0);
    expect(view.result.current.length).toBeLessThan(text.length);
    frame(120);
    expect(view.result.current).toBe(text);
    expect(frames.size).toBe(0);
  });

  it('keeps combining marks, joined emoji and non-Latin text intact', () => {
    const chars = ['e\u0301', '👩🏽‍🌾', '中', '文'];
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps: { text: '' }, wrapper: FullMotion });
    view.rerender({ text: chars.join('') });
    for (let count = 1; count <= chars.length; count++) {
      frame(12);
      expect(view.result.current).toBe(chars.slice(0, count).join(''));
    }
  });

  it('reveals Markdown words in their final formatting without flashing delimiters or future blocks', () => {
    const view = render(<ModelProse text="# Plan" streaming />, { wrapper: FullMotion });
    view.rerender(<ModelProse text={'# Plan\n\n**Read the shore.**\n\n1. Leave room.\n2. Add trees.'} streaming />);
    expect(view.container.textContent).toBe('Plan');
    expect(view.container.querySelector('ol')).toBeNull();
    frame(24);
    expect(view.container.querySelector('strong')?.textContent?.length).toBeGreaterThan(0);
    expect(view.container.textContent).not.toContain('*');
    expect(view.container.querySelector('h3')?.textContent).toBe('Plan');
    frame(240);
    expect(view.container.querySelector('strong')?.textContent).toBe('Read the shore.');
    expect(view.container.querySelectorAll('li')).toHaveLength(2);
  });

  it('replaces a reset transcript immediately and cancels its pending reveal', () => {
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps: { text: 'Old' }, wrapper: FullMotion });
    view.rerender({ text: 'Old thoughts still arriving' });
    frame(24);
    view.rerender({ text: 'New turn' });
    expect(view.result.current).toBe('New turn');
    expect(frames.size).toBe(0);
    frame(300);
    expect(view.result.current).toBe('New turn');
  });

  it('shows the entire buffer as soon as streaming is held or finished', () => {
    const view = renderHook(({ text, streaming }) => useStreamedText(text, streaming), {
      initialProps: { text: 'Start', streaming: true }, wrapper: FullMotion,
    });
    view.rerender({ text: 'Start and finish', streaming: true });
    view.rerender({ text: 'Start and finish', streaming: false });
    expect(view.result.current).toBe('Start and finish');
    expect(frames.size).toBe(0);
  });

  it('flushes pending text when reduced motion is enabled', () => {
    let reduced = false;
    const wrapper = ({ children }: { children: ReactNode }) => <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>;
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps: { text: '' }, wrapper });
    view.rerender({ text: 'New thoughts' });
    reduced = true;
    view.rerender({ text: 'New thoughts' });
    expect(view.result.current).toBe('New thoughts');
    expect(frames.size).toBe(0);
    view.rerender({ text: 'New thoughts arrive immediately' });
    expect(view.result.current).toBe('New thoughts arrive immediately');
    expect(frames.size).toBe(0);
  });

  it('cancels the frame on unmount and does not replay text when reopened', () => {
    const initialProps = { text: '' };
    const view = renderHook(({ text }) => useStreamedText(text, true), { initialProps, wrapper: FullMotion });
    view.rerender({ text: 'Already arrived' });
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    const reopened = renderHook(() => useStreamedText('Already arrived', true), { wrapper: FullMotion });
    expect(reopened.result.current).toBe('Already arrived');
    expect(frames.size).toBe(0);
  });
});
