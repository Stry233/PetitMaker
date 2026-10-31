import { createContext, useContext, useRef } from 'react';
import { useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { BRUSH_MIN_TRACK, BrushSizeSlider, SLIDER_LIFT, type SliderMeaning } from './BrushSizeSlider';
import { BRUSH } from './terrain-cells';
import { scaleMovingNow, usePx } from '../../design/scale';
import { easingCss, seconds } from '../../design/motion';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useEditorStore } from '../../../state/store';
import { brushSizeOf } from '../../../state/editing/edit-mode';

/** Set where the control fills the width its row leaves it (the upright tool row), its track
 *  narrowing to that width down to `BRUSH_MIN_TRACK`. */
export const BrushSizeFills = createContext(false);

/** The control's widths in css px: the drawing's, and the narrowest it draws. */
export function useBrushSizeWidths(): { full: number; least: number } {
  const { px } = usePx();
  return { full: px(BRUSH.track.w), least: px(BRUSH_MIN_TRACK) };
}

/** An exiting slider keeps its place but stops accepting input; its toolbar slot fades it. */
export function BrushSizeControl({ value, onChange, of }: { value: number; onChange: (value: number) => void; of?: SliderMeaning }) {
  const present = useIsPresent();
  const fills = useContext(BrushSizeFills);
  const { full, least } = useBrushSizeWidths();
  const reduced = !!useReducedMotionConfig();
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drawn = useRef<number | null>(null);
  const resize = useRef<Animation | null>(null);
  // The track follows its box through layout, a scale glide included, with no render. A width the
  // box takes at once (a re-render of the row at rest) is played from the width drawn before it on
  // `tool.size.resize`; the track stands at the box's right end, so its right end stays put.
  useObservedSize(() => (fills ? box.current : null), () => {
    const el = track.current;
    if (!el) return;
    const playing = resize.current?.playState === 'running' ? resize.current : null;
    const before = playing ? el.offsetWidth : drawn.current;
    playing?.cancel();
    resize.current = null;
    const after = el.offsetWidth;
    drawn.current = after;
    if (before === null || Math.abs(before - after) < 0.5 || reduced || scaleMovingNow() || typeof el.animate !== 'function') return;
    resize.current = el.animate([{ width: `${before}px` }, { width: '100%' }], {
      duration: seconds('tool.size.resize') * 1000, easing: easingCss('tool.size.resize'),
    });
  }, [fills, reduced]);
  const slider = <BrushSizeSlider value={value} onChange={next => { if (present) onChange(next); }} fill={fills} of={of}/>;
  if (!fills) return <div data-brush-size-control style={{ marginTop: SLIDER_LIFT }}>{slider}</div>;
  return <div ref={box} data-brush-size-control style={{ marginTop: SLIDER_LIFT, width: '100%', minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
    <div ref={track} style={{ width: '100%', minWidth: least, maxWidth: full, flex: 'none' }}>{slider}</div>
  </div>;
}

/** The live editor's size slider: the brush's size, or a route's line width. It reads the store
 *  itself, so a drag re-renders the slider and not the toolbar around it. */
export function LiveBrushSize({ of }: { of: 'brush' | 'route' }) {
  const value = useEditorStore((s) => (of === 'route' ? s.annotationRouteWidth : brushSizeOf(s)));
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const setRouteWidth = useEditorStore((s) => s.setAnnotationRouteWidth);
  return <BrushSizeControl value={value} onChange={of === 'route' ? setRouteWidth : setBrushSize}/>;
}
