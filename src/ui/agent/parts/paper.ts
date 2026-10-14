import type { CSSProperties } from 'react';
import { INSET } from '../../design/tokens';
import { radii } from '../../design/styles';
import { CARD_PAD, edge } from '../panel-skin';

/** The paper every settled card in the job zone stands on: one fill, one radius, one gutter. */
export const PAPER: CSSProperties = {
  background: INSET,
  border: edge,
  borderRadius: radii.lg,
  padding: CARD_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: '0 0 auto',
  boxShadow: 'none',
};
