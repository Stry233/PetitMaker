/**
 * A descriptive line led by `InfoIcon`. The mark is sized in `em` off the line's own type, so it sits
 * inside the element that sets the line's role and takes no size of its own; it stands inline on the
 * first line, and wrapped lines hang under the words rather than under the mark.
 */
import type { ReactNode } from 'react';
import { SPACE } from '../design/styles';
import { InfoIcon } from './line-glyphs';

/** The mark's size, in the line's ems. */
const MARK = 1.15;
const GAP = SPACE[3];
/** Lowers the mark's foot so its centre stands 0.35 em over the baseline: the middle of a Han
 *  character and of a Latin capital. */
const DROP = `${(0.35 - MARK / 2).toFixed(3)}em`;
const HANG = `calc(${MARK}em + ${GAP}px)`;

export function InfoLine({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: 'block', paddingLeft: HANG, textIndent: `calc(-1 * ${HANG})` }}>
      <InfoIcon size={`${MARK}em`} style={{ verticalAlign: DROP, marginRight: GAP }} />
      {children}
    </span>
  );
}
