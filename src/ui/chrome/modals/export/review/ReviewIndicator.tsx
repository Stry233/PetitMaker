import { Spinner } from '../../../../primitives/Spinner';

/** The field reserves this trailing space in both states, so checking never moves the caret. */
export function ReviewIndicator({ label }: { label: string }) {
  return <span role="status" aria-label={label} title={label} style={{ position: 'absolute', right: 11, top: 12, display: 'flex', pointerEvents: 'none' }}><Spinner size={16} thickness={2} /></span>;
}
