import type { CSSProperties, ReactNode } from 'react';
import { ActionButton } from './ActionButton';
import { roleFont, LINE_HEIGHT } from '../design/text-weight';
import { skin, windowCard, windowTitle } from '../design/window-skin';
import { Spinner } from './Spinner';

export interface ConfirmationContentProps {
  title: string;
  message?: string;
  /** Content between the heading and the actions, such as a field the confirmation needs. */
  body?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  alternativeAction?: { label: string; onClick: () => void };
  busy?: boolean;
  confirmDisabled?: boolean;
  /** Test ids for the two answers, where a caller's tests reach them by id. */
  confirmTestId?: string;
  cancelTestId?: string;
}

export const confirmationCardStyle: CSSProperties = {
  ...windowCard, padding: '24px 28px 20px', overflowY: 'auto',
};

/** The designed height of the action row and its choice buttons, in design px. */
export const CONFIRM_ACTION_HEIGHT = 44;

const actionStyle: CSSProperties = {
  whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 0,
};

const choiceStyle: CSSProperties = {
  ...actionStyle, flex: '0 1 auto', minWidth: 88, minHeight: CONFIRM_ACTION_HEIGHT,
};

/** Hosts own placement and dismissal; simple confirmations share their content and action order. */
export function ConfirmationContent({
  title, message, body, cancelLabel, confirmLabel, onCancel, onConfirm, alternativeAction, busy = false, confirmDisabled = false,
  confirmTestId, cancelTestId,
}: ConfirmationContentProps) {
  const buttonStyle = alternativeAction ? choiceStyle : actionStyle;
  return (
    <div aria-busy={busy || undefined} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ ...windowTitle, margin: 0, lineHeight: LINE_HEIGHT.snug, overflowWrap: 'anywhere' }}>{title}</h2>
      {message && <p style={{ ...roleFont('body'), color: skin.plateInk, margin: 0, lineHeight: 1.5 }}>{message}</p>}
      {body}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch', gap: 8, minHeight: CONFIRM_ACTION_HEIGHT }}>
        {busy ? <Spinner size={22} color={skin.ink} /> : <>
          {alternativeAction && <ActionButton appearance="tertiary" hoverFill={skin.inset} style={{ ...choiceStyle, marginInlineEnd: 'auto' }} onClick={alternativeAction.onClick}>{alternativeAction.label}</ActionButton>}
          <ActionButton appearance="secondary" data-testid={cancelTestId} autoFocus={!!alternativeAction} style={buttonStyle} onClick={onCancel}>{cancelLabel}</ActionButton>
          <ActionButton appearance="primary" data-testid={confirmTestId} disabled={confirmDisabled} style={buttonStyle} onClick={onConfirm}>{confirmLabel}</ActionButton>
        </>}
      </div>
    </div>
  );
}
