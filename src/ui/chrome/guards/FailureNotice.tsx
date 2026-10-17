/** What a surface shows in place of itself once it has failed, as the `fallback` of a `RenderBoundary`:
 *  the failure in one sentence and the one action that recovers it. */
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { buttonMotion } from '../../design/styles';
import { NoticeBar, noticeActionStyle } from '../../primitives/NoticeBar';

/** The notice spans most of a narrow window and caps on a wide one. */
const WIDTH: CSSProperties = { width: '92vw', maxWidth: 520 };

function FailureNotice({ testId, text, action, onAction }: {
  testId: string; text: string; action: string; onAction: () => void;
}) {
  return (
    <NoticeBar role="alert" data-testid={testId} edge="bottom" offset={16} width={WIDTH} travel={12}>
      <span>{text}</span>
      <motion.button type="button" style={{ ...noticeActionStyle, padding: '6px 12px' }} onClick={onAction} {...buttonMotion}>
        {action}
      </motion.button>
    </NoticeBar>
  );
}

/** A lazily loaded surface whose chunk failed to fetch or parse: only a reload brings it back. */
export function ChunkNotice() {
  const t = useT();
  return <FailureNotice testId="chunk-failed-notice" text={t('boot.chunk_failed')} action={t('boot.reload')} onAction={() => location.reload()} />;
}

/** A surface that threw while rendering: mounting it again may well work, the rest of the app still does. */
export function SurfaceNotice({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return <FailureNotice testId="surface-failed-notice" text={t('guard.surface_failed')} action={t('guard.retry')} onAction={onRetry} />;
}
