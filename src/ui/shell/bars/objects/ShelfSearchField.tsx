/** The object shelf's search field: a cream stadium edged as the brush button beside it is, so it keeps
 *  its round ends at whatever width the row gives it. */
import { useFrameReadableWeight, useFrameZoom } from '../../use-frame-zoom';
import {
  useId, type CSSProperties, type HTMLAttributes,
} from 'react';
import { TouchReach } from '../../../primitives/TouchReach';
import { cursors, type PwStyle } from '../../../design/styles';
import { MUTED_INK, PLATE, PLATE_INK, plateShapeEdge } from '../../../design/tokens';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../../design/focus-source';
import { useReducedMotionConfig } from 'framer-motion';
import { cssMotion } from '../../../design/motion';
import { SEARCH } from './object-shelf';

/**
 * The search capsule as one part: the plate, its hairline and the field laid over it, at the sizes
 * `SEARCH` declares unless `wrapStyle` gives it another width.
 */
export function ShelfSearchField({ value, onChange, placeholder, ariaLabel, readOnly, wrapStyle, wrapAttrs, inPill, wordsHidden }: {
  value: string;
  onChange?: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  /** The room the capsule keeps in the row it stands in; the box itself is `SEARCH`'s. */
  wrapStyle?: CSSProperties;
  wrapAttrs?: HTMLAttributes<HTMLDivElement>;
  /** Laid in a pill its caller draws, of any width: no capsule art, the words centred clear of
   *  `inPill.padX` at either end. */
  inPill?: { padX: number };
  /** The words fade out while the capsule shrinks into the round search button. */
  wordsHidden?: boolean;
}) {
  const reduced = useReducedMotionConfig();
  const weightAt = useFrameReadableWeight();
  const zoom = useFrameZoom();
  const fieldId = useId();
  const searchStyle: PwStyle = {
    position: 'relative', display: 'block', boxSizing: 'border-box',
    width: '100%', height: '100%',
    paddingLeft: inPill?.padX ?? SEARCH.padX, paddingRight: inPill?.padX ?? SEARCH.padX,
    ...(inPill ? { textAlign: 'center' as const } : {}),
    paddingTop: 0, paddingBottom: 0,
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: SEARCH.text, fontWeight: weightAt(800, SEARCH.text), color: PLATE_INK,
    lineHeight: 'normal', cursor: cursors.text, textOverflow: 'ellipsis',
    '--pw-placeholder': MUTED_INK,
    ...(wordsHidden === undefined ? {} : { opacity: wordsHidden ? 0 : 1, transition: cssMotion('shelf.search.expand', ['opacity'], reduced) }),
  };
  return (
    // The focus ring goes on the box, not on the input: an outline follows its own element's
    // corner, and the input is a rectangle laid over the drawn capsule. The pair is declared in
    // `design/focus-source.ts`, which is where the whole rule reads.
    <div
      className={FIELD_WRAP_CLASS}
      style={{
        position: 'relative', width: SEARCH.w, height: SEARCH.h, borderRadius: SEARCH.radius,
        ...(inPill ? {} : { background: PLATE, boxShadow: plateShapeEdge() }), ...wrapStyle,
      }}
      {...wrapAttrs}
    >
      <input
        id={fieldId}
        type="search"
        className={`pw-search-field ${FIELD_INPUT_CLASS}`}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        aria-label={ariaLabel}
        placeholder={placeholder}
        style={searchStyle}
      />
      {/* A field holds no children, so its reach is a label that focuses it. */}
      <TouchReach zoom={zoom} labelFor={fieldId} />
    </div>
  );
}
