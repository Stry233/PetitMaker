import { DANGER_INK, INK, MUTED, PLATE_INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { Spinner } from '../../primitives/Spinner';
import { Icon } from '../parts/sprite';
import type { Mark } from './SetupKeyField';
import type { RowFace } from './setup-copy';

/** Pure provider-row rendering for both live setup and static previews. */
export function SetupProviderFace({ row, mark }: { row: RowFace; mark: Mark }) {
  return (
    <span
      data-testid="setup-prov-face"
      data-provider={row.id ?? undefined}
      data-dim={row.dim || undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
    >
      {/* Provider verdict marks remain fully opaque while row text can recede. */}
      {mark === 'cross' ? (
        <span data-testid="setup-row-cross" style={{ color: DANGER_INK, display: 'inline-flex', flex: '0 0 auto' }}>
          <Icon id="pw-cross" size={15} />
        </span>
      ) : null}
      {/* Provider name and status share constrained width and ellipsize independently. */}
      <span
        style={{
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: row.dim ? MUTED : PLATE_INK,
        }}
      >
        {row.name}
      </span>
      <span
        data-testid="setup-prov-sub"
        style={{
          marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', ...roleFont('caption'), color: MUTED,
        }}
      >
        {row.sub}
      </span>
      {mark === 'spin' ? (
        <span data-testid="setup-row-spin" style={{ display: 'inline-flex', flex: '0 0 auto' }}>
          <Spinner size={13} color={INK} />
        </span>
      ) : null}
    </span>
  );
}
