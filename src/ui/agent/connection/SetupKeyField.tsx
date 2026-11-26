import type { RefObject } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { amplitude, framerMotion } from '../../design/motion';
import { Icon } from '../parts/sprite';
import { TextField } from '../../primitives/TextField';

/** How far the refused field shakes, per its own declaration. */
const SHAKE = amplitude('panel.setup.refuse') ?? 0;

/** The mark the field and the provider row carry together: the reading's own state. */
export type Mark = 'spin' | 'cross' | null;

/** Stateless key input shared by key and endpoint steps; the caller owns value, masking and refusal state. */
export function SetupKeyField({
  value, masked = false, optional = false, refused, shakeSeq, inputRef, onChange, onFocus, onBlur, onEnter,
}: {
  value: string;
  /** Whether the resting key field uses `type="password"`. */
  masked?: boolean;
  optional?: boolean;
  refused: boolean;
  /** Bumped on every refusal, so a second refusal of the same key shakes again (see the caller). */
  shakeSeq: number;
  inputRef?: RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: (value: string) => void;
  /** Enter, read as the same advance the foot's own press fires. */
  onEnter?: () => void;
}) {
  const t = useT();
  const hint = t(optional ? 'agent.setup_key_optional' : 'agent.setup_key_placeholder');
  return (
    <motion.div
      data-testid="setup-key-field"
      data-danger={refused || undefined}
      // Alternating targets replay repeated refusals without remounting the focused field.
      animate={refused
        ? { x: shakeSeq % 2 === 0 ? [0, -SHAKE, SHAKE, 0] : [0, SHAKE, -SHAKE, 0] }
        : { x: 0 }}
      transition={framerMotion('panel.setup.refuse')}
    >
      <TextField inputRef={inputRef} type={masked ? 'password' : 'text'} data-testid="setup-key-input" danger={refused}
        leading={<Icon id="pw-key" size={17} />} spellCheck={false} autoComplete="off" label={hint} placeholder={hint}
        value={value} onChange={onChange} onEnter={() => onEnter?.()}
        onFocus={() => onFocus?.()} onBlur={(e) => onBlur?.(e.target.value)} />
    </motion.div>
  );
}
