import { Spinner } from '../../../../primitives/Spinner';

/** The spinner's diameter, in css px. */
const DIAMETER = 16;

/** The check's spinner, standing in the flow of the row its caller places it in. */
export function ReviewIndicator({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} title={label} style={{ display: 'flex', flex: 'none', pointerEvents: 'none' }}>
      <Spinner size={DIAMETER} />
    </span>
  );
}

/** A field's trailing room for the check's spinner, kept while nothing is checked so checking never
 *  moves the caret. */
export function ReviewSlot({ label, checking }: { label: string; checking: boolean }) {
  return <span style={{ display: 'flex', flex: 'none', width: DIAMETER, height: DIAMETER }}>{checking && <ReviewIndicator label={label} />}</span>;
}
