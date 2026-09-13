import { motion } from 'framer-motion';
import { useT } from '../../../../../i18n/context';
import type { MapReview } from '../../../../../io/moderation/map/types';
import { Spinner } from '../../../../primitives/Spinner';
import { buttonMotion } from '../../../../design/styles';
import { skin, windowFooterGhost } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';

export function MapReviewStatus({ result, pending, onRetry }: { result: MapReview | null; pending: boolean; onRetry: () => void }) {
  const t = useT();
  if (!pending && (!result || result.status === 'clear')) return null;
  return <div role="status" aria-live="polite" style={{ ...roleFont('caption'), color: skin.ink, lineHeight: 1.5, padding: '12px 0' }}>
    {pending ? <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Spinner size={18} />{t('export.map_check.checking')}</span>
      : <>{t(result?.status === 'blocked' ? 'export.map_check.blocked' : 'export.map_check.unavailable')}
        <motion.button onClick={onRetry} style={{ ...windowFooterGhost, marginTop: 8, display: 'block' }} {...buttonMotion}>{t('export.review.retry')}</motion.button></>}
  </div>;
}
