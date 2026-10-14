import type { CSSProperties } from 'react';
import { useT } from '../../../i18n/context';
import { ActionButton } from '../../primitives/ActionButton';
import { Pill } from '../../primitives/Pill';

/** The panel's stretched ink primary: the footer primary at the house radius, filling its row. */
export const PANEL_PRIMARY: CSSProperties = { flex: 1, padding: '10px 0', boxShadow: 'none' };

const ROW: CSSProperties = { display: 'flex', gap: 8, flex: '0 0 auto' };

/** The two verbs that end a hold, wherever the hold's controls stand (`ticket-*` or `hold-*` ids). */
export function HoldActions({ ids, onResume, onStop, style }: {
  ids: 'ticket' | 'hold';
  onResume?: () => void;
  onStop?: () => void;
  style?: CSSProperties;
}) {
  const t = useT();
  if (onResume === undefined && onStop === undefined) return null;
  return (
    <div data-testid={`${ids}-actions`} style={{ ...ROW, ...style }}>
      {onResume !== undefined && (
        <ActionButton appearance="primary" data-testid={`${ids}-resume`} onClick={onResume} style={PANEL_PRIMARY}>
          {t('agent.action_resume')}
        </ActionButton>
      )}
      {onStop !== undefined && (
        <Pill variant="danger" data-testid={`${ids}-stop`} onClick={onStop}>
          {t('agent.action_stop')}
        </Pill>
      )}
    </div>
  );
}
