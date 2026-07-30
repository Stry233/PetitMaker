/**
 * OrderSlip — the user's message as a right-aligned paper slip (spec §UI.2).
 * Prototype .oslip: #FBEECB on an #efdfb4 hairline, radius 15/15/5/15 css px
 * (→ 30/30/10/30 design px), max width 86%.
 */
import type { OrderSlipEntry } from '../../../../agent/session';
import { colors as C, font } from '../../../styles';
import { usePx } from '../../scale';
import { EntryShell } from '../atoms';

export function OrderSlip({ entry }: { entry: OrderSlipEntry }) {
  const { px, pxf, fw } = usePx();
  return (
    <EntryShell undone={entry.undone} testId="oslip" style={{ alignSelf: 'flex-end', maxWidth: '86%' }}>
      <div
        style={{
          background: '#FBEECB',
          border: `${px(2)}px solid #efdfb4`,
          borderRadius: `${px(30)}px ${px(30)}px ${px(10)}px ${px(30)}px`,
          padding: `${px(18)}px ${px(26)}px`,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: pxf(29),
            fontWeight: fw(800),
            color: C.inkText,
            lineHeight: 1.4,
            fontFamily: font.family,
          }}
        >
          {entry.text}
        </p>
      </div>
    </EntryShell>
  );
}
