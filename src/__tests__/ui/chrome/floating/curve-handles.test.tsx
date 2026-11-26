// @vitest-environment jsdom
/** Curve-handle projection, drag behavior, and zoom-scaled hit targets. What ends an open curve and
 *  where its footprint draws are the session's (`editor/session/curve-watch.test.ts`). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, waitFor, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { CurveHandles } from '../../../../ui/chrome/floating/CurveHandles';
import { I18nProvider } from '../../../../i18n/context';
import {
  __resetCurveSession, beginCurveSession, curveArmingKey, endCurveSession, getCurveSession, resetCurveAnchors,
} from '../../../_support/curve-session';
import { useEditorStore } from '../../../../state/store';
import { armingOf } from '../../../../state/editing/arming';

/** The key of what the store has armed now, which a session drawn under it is bound to. */
const armedKey = (): string => curveArmingKey(armingOf(useEditorStore.getState()));
import { setActiveView } from '../../../../view/active-view';
import { installKeyTracking } from '../../../../platform/input/held-keys';
import type { ActiveView } from '../../../../tools/pointer/runtime';

const SCALE = 10;

/** A flat projection: one cell is 10px, no camera. */
const view = {
  projection: {
    cellToScreen: (x: number, y: number) => ({ x: x * SCALE, y: y * SCALE, scale: SCALE }),
    screenToPoint: (sx: number, sy: number) => ({ x: sx / SCALE, y: sy / SCALE }),
  },
  camera: { pan: () => {}, zoomStep: () => {}, zoomBy: () => {} },
} as unknown as ActiveView;

const preview = vi.fn();
const repaint = vi.fn();
const finalize = vi.fn();

function openSession(anchors: { x: number; y: number }[]) {
  act(() => {
    beginCurveSession(anchors, { width: 1, grid: 'terrain', armingKey: armedKey() }, { preview, repaint, finalize });
  });
}

/** jsdom has no PointerEvent; MouseEvent carries every field these handlers read. */
const pointer = (type: string, init: MouseEventInit = {}) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

/** Drag from the element's own point to a target cell. */
function drag(el: Element, toCell: { x: number; y: number }) {
  act(() => { el.dispatchEvent(pointer('pointerdown')); });
  const at = { clientX: toCell.x * SCALE, clientY: toCell.y * SCALE };
  act(() => { window.dispatchEvent(pointer('pointermove', at)); });
  act(() => { window.dispatchEvent(pointer('pointerup', at)); });
}

/** Hold the break key for the duration of `run`. The overlay reads the held-key tracker, which tracks
 *  real key events. */
function holdingBreak(run: () => void) {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true })); });
  run();
  act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false })); });
}

installKeyTracking();

beforeEach(() => {
  preview.mockClear();
  repaint.mockClear();
  finalize.mockClear();
  setActiveView(view);
});
afterEach(() => {
  act(() => {
    __resetCurveSession();
    setActiveView(null);
  });
});

describe('what is on screen', () => {
  it('routed roads show only their endpoints and follow a corrected worker result', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    act(() => beginCurveSession([{ x: 2, y: 2 }, { x: 8, y: 2 }], { width: 2, grid: 'object', tangents: false }, { preview, repaint, finalize }));
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(document.querySelector('polyline')).toBeNull();
    const before = screen.getByLabelText('Curve point 2').style.left;
    act(() => resetCurveAnchors([{ x: 2, y: 2 }, { x: 10, y: 2 }]));
    expect(screen.getByLabelText('Curve point 2').style.left).not.toBe(before);
  });

  it('nothing at all when no curve has been drawn', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    expect(screen.queryByTestId('curve-handles')).toBeNull();
  });

  it('a grab and two direction knobs for every anchor', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 1, y: 1 }, { x: 5, y: 3 }, { x: 9, y: 1 }]);
    expect(screen.getAllByLabelText(/^Curve point /)).toHaveLength(3);
    expect(screen.getAllByLabelText(/^(Outgoing|Incoming) direction at curve point /)).toHaveLength(6);
  });

  it('places the grabs in proportion to their anchors', () => {
    // Absolute px carry the viewport's chrome zoom, so the ratio between anchors is asserted.
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 4 }, { x: 6, y: 4 }]);
    const px = (label: string) => {
      const el = screen.getByLabelText(label) as HTMLElement;
      return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
    };
    const a = px('Curve point 1'), b = px('Curve point 2');
    expect(b.left / a.left).toBeCloseTo(3, 5);   // x 2 -> 6
    expect(b.top).toBeCloseTo(a.top, 5);
  });

  it('goes away when the session ends', async () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 1, y: 1 }, { x: 5, y: 1 }]);
    expect(screen.getAllByLabelText(/^Curve point /)).toHaveLength(2);
    expect(screen.queryByTestId('curve-handles')).not.toBeNull();
    act(() => { endCurveSession(); });
    // AnimatePresence holds the node for its fade, so the overlay leaves once the fade completes.
    await waitFor(() => expect(screen.queryByTestId('curve-handles')).toBeNull());
  });
});

describe('dragging', () => {
  it('a cancelled pointer drag dismisses adjustment without painting its tentative position', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    act(() => { screen.getByLabelText('Curve point 1').dispatchEvent(pointer('pointerdown')); });
    act(() => { window.dispatchEvent(pointer('pointermove', { clientX: 40, clientY: 60 })); });
    expect(preview).toHaveBeenCalled();
    act(() => { window.dispatchEvent(pointer('pointercancel')); });
    expect(getCurveSession()).toBeNull(); expect(repaint).not.toHaveBeenCalled();
  });

  it('moves an anchor, and re-lays the map only on release', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    drag(screen.getByLabelText('Curve point 1'), { x: 3, y: 7 });
    expect(getCurveSession()!.anchors[0]).toMatchObject({ x: 3, y: 7 });
    expect(repaint, 'one repaint per drag, not per pointer event').toHaveBeenCalledTimes(1);
  });

  it('ghosts the path on every frame of the drag, so the drag can be aimed', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    drag(screen.getByLabelText('Curve point 1'), { x: 3, y: 7 });
    expect(preview).toHaveBeenCalled();
    expect(preview.mock.calls[0]![0][0]).toMatchObject({ x: 3, y: 7 });
  });

  it('turns the tangent when a direction knob is dragged, without moving the anchor', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 14, y: 2 }]);
    drag(screen.getByLabelText('Outgoing direction at curve point 2'), { x: 8, y: 6 });
    const a = getCurveSession()!.anchors[1]!;
    expect(a).toMatchObject({ x: 8, y: 2 });
    expect(a.hy).toBe(4);
    expect(a.hx).toBe(0);
  });

  it('mirrors the incoming knob, so the two ends are one tangent', () => {
    // Dragging the far end is the same direction seen from the other side; storing it unmirrored
    // would kink the path at the anchor instead of keeping it smooth through.
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 14, y: 2 }]);
    drag(screen.getByLabelText('Incoming direction at curve point 2'), { x: 8, y: 6 });
    expect(getCurveSession()!.anchors[1]!.hy).toBe(-4);
  });

  it('breaks the line while the break key is held, leaving the other side where it was', () => {
    // Photoshop's pen: Alt turns one side of the handle on its own, so the anchor becomes a corner.
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 14, y: 2 }]);
    holdingBreak(() => drag(screen.getByLabelText('Outgoing direction at curve point 2'), { x: 8, y: 6 }));
    const a = getCurveSession()!.anchors[1]!;
    expect(a).toMatchObject({ hx: 0, hy: 4 });
    expect(a.ihy, 'the untouched side held still rather than mirroring').not.toBe(-4);
  });

  it('re-links the two sides when the same knob is dragged WITHOUT the break key', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 14, y: 2 }]);
    holdingBreak(() => drag(screen.getByLabelText('Outgoing direction at curve point 2'), { x: 8, y: 6 }));
    drag(screen.getByLabelText('Outgoing direction at curve point 2'), { x: 12, y: 2 });
    const a = getCurveSession()!.anchors[1]!;
    expect(a).toMatchObject({ hx: 4, hy: 0, ihx: -4, ihy: -0 });
  });

  it('draws the direction line THROUGH the anchor, so a broken handle reads as a corner', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 14, y: 2 }]);
    holdingBreak(() => drag(screen.getByLabelText('Outgoing direction at curve point 2'), { x: 8, y: 6 }));
    const line = document.querySelectorAll('polyline')[1] as SVGPolylineElement;
    expect(line.getAttribute('points')!.split(' ')).toHaveLength(3);
  });

  it('keeps the browser out of a touch drag on a handle', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    const grab = screen.getByLabelText('Curve point 1') as HTMLElement;
    expect(grab.style.touchAction).toBe('none');
    expect((screen.getByLabelText('Outgoing direction at curve point 1') as HTMLElement).style.touchAction).toBe('none');
  });

  it('does not let the press through to the canvas, which would dismiss the handles', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    const seen = vi.fn();
    window.addEventListener('pointerdown', seen);
    act(() => { screen.getByLabelText('Curve point 1').dispatchEvent(pointer('pointerdown')); });
    window.removeEventListener('pointerdown', seen);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('pointer feedback', () => {
  const settle = () => act(() => new Promise((r) => setTimeout(r, 80)));
  /** The scale a settled transform draws at, 1 where it draws none. */
  const scaleOf = (el: HTMLElement): number => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);

  it.each(['Curve point 1', 'Outgoing direction at curve point 1'])('%s grows under a hover and gives while grabbed', async (label) => {
    render(<MotionConfig reducedMotion="always"><I18nProvider><CurveHandles /></I18nProvider></MotionConfig>);
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    const handle = screen.getByLabelText(label) as HTMLElement;
    fireEvent.pointerEnter(handle, { pointerType: 'pen' });
    await settle();
    expect(scaleOf(handle)).toBeGreaterThan(1);
    fireEvent.pointerLeave(handle, { pointerType: 'pen' });
    fireEvent.pointerDown(handle, { pointerType: 'pen', isPrimary: true, button: 0 });
    await settle();
    expect(scaleOf(handle)).toBeLessThan(1);
    act(() => { window.dispatchEvent(pointer('pointerup', { clientX: 20, clientY: 20 })); });
  });
});

describe('sizing against the map zoom', () => {
  /** Re-register the view with a different cell size, i.e. a different map zoom. */
  function viewAtCellPx(px: number) {
    setActiveView({
      ...view,
      projection: { ...view.projection, cellToScreen: (x: number, y: number) => ({ x: x * px, y: y * px, scale: px }) },
    } as unknown as ActiveView);
  }
  /** The visible dot inside the target, which is what scales with the map. */
  const grabWidth = () => {
    const btn = screen.getByLabelText('Curve point 1') as HTMLElement;
    return parseFloat((btn.firstElementChild as HTMLElement).style.width);
  };
  const hitWidth = () => parseFloat((screen.getByLabelText('Curve point 1') as HTMLElement).style.width);

  it('shrinks the controls as the map zooms out', () => {
    // Anchors sit a few cells apart, so fixed-size controls would cover the curve on a small map.
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    act(() => { viewAtCellPx(64); });
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    const full = grabWidth();
    act(() => { viewAtCellPx(20); });
    expect(grabWidth()).toBeLessThan(full);
  });

  it('stops shrinking at a size that can still be grabbed', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    act(() => { viewAtCellPx(20); });
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    const small = grabWidth();
    act(() => { viewAtCellPx(2); });      // absurdly far out
    expect(grabWidth()).toBe(small);
  });

  it('keeps a clickable target however small the dot gets', () => {
    // A tangent knob is a small dot by design; it must not also be a small target.
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    act(() => { viewAtCellPx(4); });
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    expect(grabWidth()).toBeLessThan(20);
    expect(hitWidth()).toBeGreaterThanOrEqual(30);
    const knob = screen.getByLabelText('Outgoing direction at curve point 1') as HTMLElement;
    expect(parseFloat(knob.style.width)).toBeGreaterThanOrEqual(30);
  });

  it('never grows past its design size when the map zooms IN', () => {
    render(<I18nProvider><CurveHandles /></I18nProvider>);
    act(() => { viewAtCellPx(64); });
    openSession([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    const full = grabWidth();
    act(() => { viewAtCellPx(400); });
    expect(grabWidth()).toBe(full);
  });
});
