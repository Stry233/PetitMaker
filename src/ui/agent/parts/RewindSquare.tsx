import { useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { ACTIVE, INK, PLATE } from '../../design/tokens';
import { radii } from '../../design/styles';
import { ActionButton } from '../../primitives/ActionButton';
import { Icon, type IconId } from './sprite';
import { rewindConfirmCopy, type RollbackCost } from '../derive/rollback';
import { PanelConfirm } from './PanelConfirm';

/** The take-back square's side, in frame px. */
const SQUARE = 26;

const STYLE: CSSProperties = {
  width: SQUARE, height: SQUARE, borderRadius: radii.chip, flex: '0 0 auto', padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: PLATE, color: INK, border: 'none', boxShadow: 'none',
};

/**
 * Every take-back in the panel: one square that asks before it pops anything, naming what the press
 * would cost. While a job runs it stands disabled and says why.
 */
export function RewindSquare({
  testId, icon = 'pw-rewind', label, actLabel, cost, busy = false, onConfirm, onAskChange,
}: {
  testId: string;
  icon?: IconId;
  /** The square's own name, also its title. */
  label: string;
  /** The confirming answer's wording. */
  actLabel: string;
  /** What the press pops, or null where the live depth is unknown. */
  cost: RollbackCost | null;
  busy?: boolean;
  onConfirm(): void;
  /** Told when the question opens and closes, for a row previewing what would go. */
  onAskChange?(asking: boolean): void;
}) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const open = asking && !busy;
  const ask = (next: boolean) => { setAsking(next); onAskChange?.(next); };
  const copy = rewindConfirmCopy(t, cost);
  const busyWhy = t('agent.rollback_busy');
  return (
    <>
      <ActionButton
        ref={ref}
        data-testid={testId}
        title={busy ? busyWhy : label}
        aria-label={busy ? `${label} (${busyWhy})` : label}
        aria-expanded={open}
        disabled={busy}
        hoverFill={ACTIVE}
        onClick={() => ask(!asking)}
        style={STYLE}
      >
        <Icon id={icon} size={13} />
      </ActionButton>
      <AnimatePresence>
        {open && (
          <PanelConfirm
            key="rewind"
            anchor={ref}
            help="agent-undo"
            testId={`${testId}-ask`}
            title={copy.confirmLabel}
            {...(copy.question !== copy.confirmLabel ? { message: copy.question } : {})}
            cancelLabel={t('agent.action_cancel')}
            confirmLabel={actLabel}
            confirmTestId={`${testId}-confirm`}
            cancelTestId={`${testId}-cancel`}
            onCancel={() => ask(false)}
            onConfirm={() => { ask(false); onConfirm(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
