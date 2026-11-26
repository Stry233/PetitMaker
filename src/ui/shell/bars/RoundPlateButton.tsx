/**
 * A round button on a shelf's plate, as the object shelf's brush button and the blueprint shelf's New
 * folder stand beside the search: the plate's fill with its shape edge, the ink of its glyph, and a
 * fingertip's reach round it. `width` past `size` draws it as the pill it grows into, and `'auto'` as a
 * pill round a word, which stands half the side in from each round end. `reach` past `size` makes the
 * button a box that much larger, in either input mode, its plate drawn in the middle: a reach that
 * stays inside what holds the button, which a reach grown past it would leave (a scrolling row of cards
 * cuts what stands past a card).
 */
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { btnReset, cursors, radii } from '../../design/styles';
import { INK, PLATE, plateShapeEdge } from '../../design/tokens';
import { ActionButton, type ActionButtonProps } from '../../primitives/ActionButton';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../use-frame-zoom';

export const RoundPlateButton = forwardRef<HTMLButtonElement, Omit<ActionButtonProps, 'interaction' | 'style' | 'children'> & {
  children: ReactNode;
  /** The button's side in the row's px. */
  size: number;
  width?: number | 'auto';
  /** The side of the box it answers presses in, in the row's px. */
  reach?: number;
  style?: CSSProperties;
}>(function RoundPlateButton({ size, width = size, reach = size, style, fill = PLATE, unavailable, children, ...props }, ref) {
  const zoom = useFrameZoom();
  const face: CSSProperties = { borderRadius: radii.pill, boxShadow: plateShapeEdge(), color: INK };
  const cursor = unavailable ? cursors.blocked : cursors.clickable;
  if (reach > size && typeof width === 'number') {
    return (
      <ActionButton
        ref={ref}
        {...props}
        interaction="action"
        {...(unavailable === undefined ? {} : { unavailable })}
        style={{
          ...btnReset, position: 'relative', flex: 'none', width: width + reach - size, height: reach, pointerEvents: 'auto', cursor,
          display: 'flex', alignItems: 'center', justifyContent: 'center', ...style,
        }}
      >
        <span style={{ ...face, position: 'relative', flex: 'none', width, height: size, background: fill, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </span>
      </ActionButton>
    );
  }
  return (
    <ActionButton
      ref={ref}
      {...props}
      interaction="action"
      fill={fill}
      {...(unavailable === undefined ? {} : { unavailable })}
      style={{
        ...btnReset, ...face, position: 'relative', flex: 'none', height: size, pointerEvents: 'auto', cursor,
        ...(typeof width === 'number' ? { width } : { padding: `0 ${size / 2}px`, whiteSpace: 'nowrap' }), display: 'flex', ...style,
      }}
    >
      {children}
      <TouchReach {...(typeof width === 'number' ? { w: size } : {})} h={size} zoom={zoom} />
    </ActionButton>
  );
});
