/** What a lazily loaded surface shows when its chunk fails to fetch or parse: the failure and a
 *  reload, as the `fallback` of every `ChunkBoundary`. */
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { buttonMotion } from '../../design/styles';
import { NoticeBar, noticeActionStyle } from '../../primitives/NoticeBar';

/** The notice spans most of a narrow window and caps on a wide one. */
const WIDTH: CSSProperties = { width: '92vw', maxWidth: 520 };

export function ChunkNotice() {
  const t = useT();
  return (
    <NoticeBar role="alert" data-testid="chunk-failed-notice" edge="bottom" offset={16} width={WIDTH}>
      <span>{t('boot.chunk_failed')}</span>
      <motion.button type="button" style={{ ...noticeActionStyle, padding: '6px 12px' }} onClick={() => location.reload()} {...buttonMotion}>
        {t('boot.reload')}
      </motion.button>
    </NoticeBar>
  );
}
