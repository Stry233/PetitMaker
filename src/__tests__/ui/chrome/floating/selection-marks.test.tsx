// @vitest-environment jsdom
/** A view that projects bodies gets screen-space selection marks; the 2D view draws its own. */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { SelectionMarks } from '../../../../ui/chrome/floating/SelectionMarks';
import { useEditorStore } from '../../../../state/store';
import { setActiveView } from '../../../../view/active-view';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import { setHoverTarget } from '../../../../view/hover-target';
import { makeState } from '../../../_support/map-state';

function view(boxes: Record<string, { x: number; y: number; w: number; h: number }> | null): ActiveView {
  return {
    projection: {
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
      screenToPoint: () => ({ x: 0, y: 0 }),
      ...(boxes ? { objectScreenBox: (id: string) => boxes[id] ?? null } : {}),
    },
    camera: {},
  } as unknown as ActiveView;
}

const paths = () => [...screen.getByTestId('selection-marks').querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');

afterEach(() => {
  cleanup();
  setHoverTarget(null);
  setActiveView(null);
  useEditorStore.setState({ selection: [] });
});

describe('SelectionMarks', () => {
  it('draws nothing over a view without projected bodies', () => {
    setActiveView(view(null));
    useEditorStore.setState({ selection: [{ kind: 'object', id: 'a' }] });
    render(<SelectionMarks />);
    expect(paths()).toEqual([]);
  });

  it('brackets one projected body at the corners of its box', () => {
    setActiveView(view({ a: { x: 100, y: 200, w: 60, h: 40 } }));
    useEditorStore.setState({ selection: [{ kind: 'object', id: 'a' }] });
    render(<SelectionMarks />);
    const d = paths();
    expect(d).toHaveLength(2); // the edge and the ink over it
    expect(d[0]).toBe(d[1]);
    expect(d[0]).toContain('M96 ');       // left edge, 4px outside the box
    expect(d[0]).toContain('V196');       // top edge
  });

  it('rings each member of a group and brackets the whole', () => {
    setActiveView(view({ a: { x: 100, y: 200, w: 20, h: 20 }, b: { x: 300, y: 260, w: 20, h: 20 } }));
    useEditorStore.setState({ selection: [{ kind: 'object', id: 'a' }, { kind: 'object', id: 'b' }] });
    render(<SelectionMarks />);
    const d = paths();
    expect(d).toHaveLength(4);
    expect((d[0]!.match(/a\d/g) ?? []).length).toBe(4); // two arcs per ring
    expect(d[2]).toContain('M90 ');                      // group brackets 10px outside the union
  });

  it('follows the camera', () => {
    const boxes = { a: { x: 100, y: 200, w: 60, h: 40 } };
    setActiveView(view(boxes));
    useEditorStore.setState({ selection: [{ kind: 'object', id: 'a' }] });
    render(<SelectionMarks />);
    act(() => {
      boxes.a = { x: 150, y: 200, w: 60, h: 40 };
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });
    expect(paths()[0]).toContain('M146 ');
  });

  it('boxes what a click would select while hovering', () => {
    const gs = makeState(24, 24);
    gs.objects.set('h', { id: 'h', catalogId: 'sel-hut', position: { x: 4, y: 5 }, rotation: 0, elevation: 0 });
    setActiveView(view({ h: { x: 40, y: 50, w: 30, h: 20 } }));
    useEditorStore.setState({ gridState: gs, selection: [] });
    render(<SelectionMarks />);
    act(() => { setHoverTarget({ x: 4, y: 5, w: 1, h: 1, grid: 'object' }); });
    const rect = screen.getByTestId('selection-marks').querySelector('rect')!;
    expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')]).toEqual(['40', '50', '30', '20']);
    act(() => { setHoverTarget(null); });
    expect(screen.getByTestId('selection-marks').querySelector('rect')).toBeNull();
  });
});
