import { EDITION_COPY } from '../../core/runtime/edition';
import { useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { baseBrandName } from '../../version';
import { roleFont } from '../design/text-weight';
import { skin } from '../design/window-skin';
import { Wavy } from '../primitives/Wavy';

/** Visible brand headings keep the edition separate from the product name. */
export function BrandName({ wavy = false }: { wavy?: boolean }) {
  const locale = useEditorStore(s => s.locale);
  const t = useT();
  const badge = EDITION_COPY.badge;
  const name = badge ? baseBrandName(locale) : t('app.name');
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {wavy ? <Wavy>{name}</Wavy> : <span>{name}</span>}
    {badge && <span style={{ ...roleFont('caption'), lineHeight: 1.2, padding: '3px 7px', borderRadius: 7, background: skin.active, color: skin.ink }}>{t(badge)}</span>}
  </span>;
}
