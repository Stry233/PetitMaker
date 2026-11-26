/** The one line the object shelf shows while a finger carries a card off it: a release over the shelf puts the card back. */
import type { CSSProperties } from 'react';
import { useT } from '../../../../i18n/context';
import { ON_DARK, rgbaOf } from '../../../design/tokens';
import { roleSize } from '../../../design/text-weight';
import { BAR_LINE_HEIGHT, BarText } from '../bar-atoms';

/** Quieter than the names on the dark plate, as the approved mockup draws it. */
const CANCEL_INK = rgbaOf(ON_DARK, 0.7);

export function CarryCancel({ style }: { style?: CSSProperties }) {
  const t = useT();
  return (
    <BarText role="small" color={CANCEL_INK} style={{ minHeight: roleSize('small') * BAR_LINE_HEIGHT, ...style }}>
      <span role="status">{t('shelf.carry_cancel')}</span>
    </BarText>
  );
}
