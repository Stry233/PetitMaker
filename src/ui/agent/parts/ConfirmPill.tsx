import { useRef, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import type { WindowSurface } from '../../design/window-skin';
import { Pill } from '../../primitives/Pill';
import { PanelConfirm } from './PanelConfirm';

/** A destructive pill that asks before it acts; the question unrolls from the pill, which stays as it is. */
export function ConfirmPill({
  testId, on = 'inset', disabled = false, children, title, message, actLabel, help, onConfirm,
}: {
  testId: string;
  on?: WindowSurface;
  disabled?: boolean;
  children: ReactNode;
  /** The question, including what the press costs. */
  title: string;
  message?: string;
  /** The confirming answer's wording. */
  actLabel: string;
  /** The Help page the card's What's this answers with. */
  help: string;
  onConfirm(): void;
}) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Pill ref={ref} variant="quiet" on={on} data-testid={testId} disabled={disabled} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
        {children}
      </Pill>
      <AnimatePresence>
        {asking && !disabled && (
          <PanelConfirm
            key="ask"
            anchor={ref}
            help={help}
            testId={`${testId}-ask`}
            title={title}
            {...(message !== undefined ? { message } : {})}
            cancelLabel={t('agent.action_cancel')}
            confirmLabel={actLabel}
            confirmTestId={`${testId}-confirm`}
            cancelTestId={`${testId}-cancel`}
            onCancel={() => setAsking(false)}
            onConfirm={() => { setAsking(false); onConfirm(); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
