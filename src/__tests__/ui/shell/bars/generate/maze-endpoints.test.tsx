// @vitest-environment jsdom
/** The maze's end marks on the map: a mark answers the pointer as every pressable does, and dragging it
 *  still moves its end. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../../i18n/context';
import { setActiveView } from '../../../../../view/active-view';
import type { ActiveView } from '../../../../../tools/pointer/runtime';
import { MazeEndpoints, type MazeEnds } from '../../../../../ui/shell/bars/generate/MazeEndpoints';

/** A flat view, 10 px a cell. */
const flat = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
} as unknown as ActiveView;

const ends: MazeEnds = { entrance: { cell: { x: 2, y: 2 }, kind: 'hole' }, exit: { cell: { x: 8, y: 6 }, kind: 'target' } };

/** jsdom has no PointerEvent; MouseEvent carries every field the drag reads. */
const pointer = (type: string, init: MouseEventInit = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

const settle = () => act(() => new Promise((r) => setTimeout(r, 80)));

/** The scale a settled transform draws at, 1 where it draws none. */
const scaleOf = (el: HTMLElement): number => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);

afterEach(() => { cleanup(); setActiveView(null); });

describe('a maze end mark', () => {
  it('grows under a hover and gives under a press', async () => {
    setActiveView(flat);
    render(<MotionConfig reducedMotion="always"><I18nProvider><MazeEndpoints ends={ends} onMove={() => {}} /></I18nProvider></MotionConfig>);
    const mark = screen.getByTestId('shell-gate-entrance');
    fireEvent.pointerEnter(mark, { pointerType: 'pen' });
    await settle();
    expect(scaleOf(mark)).toBeGreaterThan(1);
    fireEvent.pointerLeave(mark, { pointerType: 'pen' });
    fireEvent.pointerDown(mark, { pointerType: 'pen', isPrimary: true, button: 0 });
    await settle();
    expect(scaleOf(mark)).toBeLessThan(1);
    fireEvent.pointerUp(window, { pointerType: 'pen', isPrimary: true, button: 0 });
  });

  it('moves its end along the drag and drops it on release', () => {
    setActiveView(flat);
    const move = vi.fn();
    render(<I18nProvider><MazeEndpoints ends={ends} onMove={move} /></I18nProvider>);
    fireEvent(screen.getByTestId('shell-gate-exit'), pointer('pointerdown', { clientX: 85, clientY: 65 }));
    fireEvent(window, pointer('pointermove', { clientX: 45, clientY: 35 }));
    fireEvent(window, pointer('pointerup', { clientX: 55, clientY: 35 }));
    expect(move.mock.calls).toEqual([['exit', { x: 4, y: 3 }, false], ['exit', { x: 5, y: 3 }, true]]);
  });
});
