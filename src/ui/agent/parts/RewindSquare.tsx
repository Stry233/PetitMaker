import { useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { ACTIVE, INK, PLATE } from '../../design/tokens';
import { radii } from '../../design/styles';
import { ActionButton } from '../../primitives/ActionButton';
import { useNameReveal } from '../../primitives/use-name-reveal';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../../shell/use-frame-zoom';
import { Icon, type IconId } from './sprite';
import { rewindConfirmCopy } from '../derive/rollback';
import type { RollbackCost } from '../../../agent/panel';
import { ControlConfirm } from '../../primitives/ControlConfirm';
import { PANEL_CONFIRM_W } from '../panel-skin';

/** The take-back square's side, in frame px. */
const SQUARE = 26;

const STYLE: CSSProperties = {
  position: 'relative', width: SQUARE, height: SQUARE, borderRadius: radii.chip, flex: '0 0 auto', padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  color: INK, border: 'none', boxShadow: 'none',
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
  const zoom = useFrameZoom();
  const busyWhy = t('agent.rollback_busy');
  const name = useNameReveal(label, 'above', busy ? busyWhy : label);
  const [asking, setAsking] = useState(false);
  const open = asking && !busy;
  const ask = (next: boolean) => { setAsking(next); onAskChange?.(next); };
  const copy = rewindConfirmCopy(t, cost);
  return (
    <>
      <ActionButton
        ref={ref}
        data-testid={testId}
        {...name.bind}
        aria-label={busy ? `${label} (${busyWhy})` : label}
        aria-expanded={open}
        disabled={busy}
        fill={PLATE}
        hoverFill={ACTIVE}
        onClick={() => ask(!asking)}
        style={STYLE}
      >
        <Icon id={icon} size={13} />
        <TouchReach zoom={zoom} />
        {name.bubble}
      </ActionButton>
      <AnimatePresence>
        {open && (
          <ControlConfirm
            key="rewind"
            anchor={ref}
            floor={false}
            width={PANEL_CONFIRM_W}
            helpTarget={{ page: 'agent-undo' }}
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
