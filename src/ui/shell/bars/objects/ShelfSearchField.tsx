/** The object shelf's search field: the one text field on a shelf's band, a cream stadium edged as the
 *  brush button beside it is, so it keeps its round ends at whatever width the row gives it. */
import { useFrameReadableWeight, useFrameZoom } from '../../use-frame-zoom';
import type { CSSProperties, HTMLAttributes } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { TouchReach } from '../../../primitives/TouchReach';
import { TextField } from '../../../primitives/TextField';
import { isComposingKey } from '../../../../platform/input/text-entry';
import { cssMotion } from '../../../design/motion';
import { SEARCH } from './object-shelf';
import { roleSize } from '../../../design/text-weight';

/**
 * The search capsule at the sizes `SEARCH` declares unless `wrapStyle` gives it another width, its
 * words in the shelf's lead type.
 */
export function ShelfSearchField({ value, onChange, placeholder, ariaLabel, wrapStyle, wrapAttrs, inPill, wordsHidden }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** The room the capsule keeps in the row it stands in; the box itself is `SEARCH`'s. */
  wrapStyle?: CSSProperties;
  wrapAttrs?: HTMLAttributes<HTMLLabelElement>;
  /** Laid in a pill its caller draws, of any width: no capsule of its own, the words centred clear of
   *  `inPill.padX` at either end. */
  inPill?: { padX: number };
  /** The words fade out while the capsule shrinks into the round search button. */
  wordsHidden?: boolean;
}) {
  const reduced = useReducedMotionConfig();
  const weightAt = useFrameReadableWeight();
  const zoom = useFrameZoom();
  const padX = inPill?.padX ?? SEARCH.padX;
  return (
    <TextField
      type="search"
      on="band"
      bare={!!inPill}
      value={value}
      onChange={onChange}
      label={ariaLabel}
      placeholder={placeholder}
      // Escape clears typed words first in every browser; an empty field leaves it to the back key.
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || value === '' || isComposingKey(e.nativeEvent)) return;
        e.preventDefault();
        onChange('');
      }}
      boxAttrs={wrapAttrs}
      style={{
        position: 'relative', width: SEARCH.w, height: SEARCH.h, borderRadius: SEARCH.radius, padding: `0 ${padX}px`,
        fontSize: roleSize('lead'), fontWeight: weightAt(800, roleSize('lead')), lineHeight: 'normal', ...wrapStyle,
      }}
      textStyle={{
        textOverflow: 'ellipsis', ...(inPill ? { textAlign: 'center' as const } : {}),
        ...(wordsHidden === undefined ? {} : { opacity: wordsHidden ? 0 : 1, transition: cssMotion('shelf.search.expand', ['opacity'], reduced) }),
      }}
      // The box is the field's label, so its fingertip reach focuses the field too.
      trailing={<TouchReach zoom={zoom} />}
    />
  );
}
