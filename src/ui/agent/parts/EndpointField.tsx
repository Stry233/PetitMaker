import type { ReactNode } from 'react';
import { useT } from '../../../i18n/context';
import { Icon } from './sprite';
import { TextField } from '../../primitives/TextField';

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
    <TextField type="text" data-testid={testId} danger={bad} leading={<Icon id="pw-link-out" size={17} />}
      spellCheck={false} autoComplete="off" label={t('agent.setup_endpoint_placeholder')} placeholder={t('agent.setup_endpoint_placeholder')}
      value={value} onChange={onChange} onEnter={onEnter} trailing={trailing} />
  );
}
