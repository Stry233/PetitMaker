import type { ReactNode } from 'react';
import { useT } from '../../../i18n/context';
import { DANGER_INK } from '../../design/tokens';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../design/focus-source';
import { Icon } from './sprite';
import { FIELD_STYLE, INPUT_STYLE } from '../connection/setup-parts';

/** The custom-endpoint address field shared by setup and management; Enter asks the caller to file it. */
export function EndpointField({ testId, value, bad, onChange, onEnter, trailing }: {
  testId: string;
  value: string;
  bad: boolean;
  onChange(next: string): void;
  onEnter(): void;
  /** Status standing inside the field, such as the check's spinner. */
  trailing?: ReactNode;
}) {
  const t = useT();
  return (
    <label className={FIELD_WRAP_CLASS} style={bad ? { ...FIELD_STYLE, borderColor: DANGER_INK } : FIELD_STYLE}>
      <Icon id="pw-link-out" size={17} />
      <input
        type="text"
        data-testid={testId}
        className={FIELD_INPUT_CLASS}
        spellCheck={false}
        autoComplete="off"
        placeholder={t('agent.setup_endpoint_placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        style={{ ...INPUT_STYLE, letterSpacing: 0 }}
      />
      {trailing}
    </label>
  );
}
