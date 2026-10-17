import { EDITION_COPY } from '../../platform/build/edition';
import { useLocale, useT } from '../../i18n/context';
import { baseBrandName } from '../../i18n/terms/brand';
import { roleFont } from '../design/text-weight';
import { skin } from '../design/window-skin';
import { Wavy } from '../primitives/Wavy';
import { radii } from '../design/styles';

/** Visible brand headings keep the edition separate from the product name. */
export function BrandName({ wavy = false }: { wavy?: boolean }) {
  const locale = useLocale();
  const t = useT();
  const badge = EDITION_COPY.badge;
  const name = badge ? baseBrandName(locale) : t('app.name');
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {wavy ? <Wavy>{name}</Wavy> : <span>{name}</span>}
    {badge && <span style={{ ...roleFont('caption'), lineHeight: 1.2, padding: '2px 6px', borderRadius: radii.chip, background: skin.active, color: skin.ink }}>{t(badge)}</span>}
  </span>;
}
