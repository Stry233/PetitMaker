/** The object shelf's search field, drawn as the design's capsule. */
import { useFrameReadableWeight } from '../../use-frame-zoom';
import {
  type CSSProperties, type HTMLAttributes,
} from 'react';
import { cursors, type PwStyle } from '../../../design/styles';
import { MUTED_INK, PLATE_INK } from '../../../design/tokens';
import { ShapeEdge } from '../../../design/shape-edge';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../../design/focus-source';
import { Plate } from '../bar-atoms';
import {
  SEARCH, } from './object-shelf';
import searchArt from '../../../../assets/shell/shelf-object/search-field.svg';

/**
 * The search capsule as one part: the drawn plate, its silhouette hairline and the field laid over
 * it, at the sizes `SEARCH` declares. The shelf mounts it live; the Help Center's search figure
 * mounts the same part read-only, so the pictured field is this field rather than a copy of its
 * values.
 */
export function ShelfSearchField({ value, onChange, placeholder, ariaLabel, readOnly, wrapStyle, wrapAttrs }: {
  value: string;
  onChange?: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  /** The room the capsule keeps in the row it stands in; the box itself is `SEARCH`'s. */
  wrapStyle?: CSSProperties;
  wrapAttrs?: HTMLAttributes<HTMLDivElement>;
}) {
  const weightAt = useFrameReadableWeight();
  const searchStyle: PwStyle = {
    position: 'relative', display: 'block', boxSizing: 'border-box',
    width: '100%', height: '100%',
    paddingLeft: SEARCH.padX, paddingRight: SEARCH.padX,
    paddingTop: 0, paddingBottom: 0,
    background: 'transparent', border: 'none', outline: 'none',
    fontSize: SEARCH.text, fontWeight: weightAt(800, SEARCH.text), color: PLATE_INK,
    lineHeight: 'normal', cursor: cursors.text,
    '--pw-placeholder': MUTED_INK,
  };
  return (
    // The focus ring goes on the box, not on the input: an outline follows its own element's
    // corner, and the input is a rectangle laid over the drawn capsule. The pair is declared in
    // `design/focus-source.ts`, which is where the whole rule reads.
    <div
      className={FIELD_WRAP_CLASS}
      style={{ position: 'relative', width: SEARCH.w, height: SEARCH.h, borderRadius: SEARCH.radius, ...wrapStyle }}
      {...wrapAttrs}
    >
      {/* The plate wears the hairline every drawing standing on the map wears
          (`shape-edge.tsx:ShapeEdge`), on the art itself rather than on the box, so what is
          outlined is the capsule's own silhouette and not the rectangle around it. */}
      <ShapeEdge style={{ position: 'absolute', inset: 0 }}>
        <Plate src={searchArt} style={{ inset: 0, width: '100%', height: '100%' }} />
      </ShapeEdge>
      <input
        type="search"
        className={`pw-search-field ${FIELD_INPUT_CLASS}`}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        aria-label={ariaLabel}
        placeholder={placeholder}
        style={searchStyle}
      />
    </div>
  );
}
