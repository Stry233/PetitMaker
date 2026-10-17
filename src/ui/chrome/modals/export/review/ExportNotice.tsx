import { EDITION_COPY } from '../../../../../platform/build/edition';
import { WindowHeader, windowFrame } from '../../../../primitives/Window';
import { ActionButton } from '../../../../primitives/ActionButton';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../../i18n/context';
import { timedHint } from '../../../timed-hint';
import { ModalShell } from '../../../../primitives/ModalShell';
import { TimedButton } from '../../../../primitives/TimedButton';
import { ScrollArea } from '../../../../primitives/ScrollArea';
import { useScrollGeometry } from '../../../../primitives/scroll-geometry';
import { cursors, UNAVAILABLE } from '../../../../design/styles';
import { skin, windowFooterPrimary } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';

const READING_MS = 7000;

function ExportNotice({ open, onDecision, format = 'image', hasPetitGlyph = false }: { open: boolean; onDecision: (accepted: boolean) => void; format?: 'image' | 'json'; hasPetitGlyph?: boolean }) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const [entered, setEntered] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [readingVisible, setReadingVisible] = useState(!document.hidden);
  const [atEnd, setAtEnd] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const onEntered = useCallback(() => setEntered(true), []);
  useEffect(() => { if (!open) setEntered(false); }, [open]);

  useEffect(() => {
    setElapsed(0);
    if (!open || !entered) return;
    let last = performance.now();
    let visible = !document.hidden;
    setReadingVisible(visible);
    let total = 0;
    const tick = () => {
      const now = performance.now();
      if (visible) total += now - last;
      last = now;
      visible = !document.hidden;
      setReadingVisible(visible);
      setElapsed(Math.min(READING_MS, total));
    };
    const timer = setInterval(tick, 100);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [open, entered, t, format, hasPetitGlyph]);

  const checkEnd = useCallback(() => {
    const node = content.current;
    setAtEnd(!!node && node.clientHeight > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
  }, []);
  useEffect(() => {
    setAtEnd(false);
    if (!open || !entered) return;
    if (content.current) content.current.scrollTop = 0;
    checkEnd();
  }, [open, entered, t, format, hasPetitGlyph, checkEnd]);

  useScrollGeometry(content, checkEnd);

  const seconds = Math.ceil((READING_MS - elapsed) / 1000);
  const ready = open && entered && seconds === 0 && atEnd;
  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-confirm' }} open={open} onClose={() => onDecision(false)} onEntered={onEntered} size="panel" width={530}
      cardStyle={{ ...windowFrame, minHeight: 0 }} ariaLabel={t('export.notice.title')}>
      <WindowHeader title={<h2 style={{ margin: 0, font: 'inherit' }}>{t('export.notice.title')}</h2>} reserve
        close={{ label: t('hint.close'), onPress: () => onDecision(false) }} style={{ marginBottom: 16, flex: '0 0 auto' }} />
      <ScrollArea ref={content} gutter="stable" surface={skin.plate} tabIndex={0} role="region" aria-label={t('export.notice.title')}
        style={{ minHeight: 0, ...roleFont('body'), lineHeight: 1.65, color: skin.plateInk }}>
        <div>
          <p style={{ margin: '0 0 14px' }}>{t('export.notice.intro', { app: t('app.name') })}</p>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 12 }}>
            <li>{t('export.notice.honesty')}</li>
            <li>{t('export.notice.respect')}</li>
            <li>{t(EDITION_COPY.exportResponsibility)}</li>
            {format === 'json' ? <li>{t('export.notice.json_attribution')}</li>
              : hasPetitGlyph && <li>{t('export.notice.image_attribution')}</li>}
          </ol>
        </div>
      </ScrollArea>
      <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10, flex: '0 0 auto' }}>
        <ActionButton appearance="secondary" style={{ flex: '1 0 140px' }} onClick={() => onDecision(false)}>{t('export.notice.cancel')}</ActionButton>
        <TimedButton after={0} hint={timedHint(t, 0)} disabled={!ready} external={seconds > 0 ? {
          fraction: (reduced ? Math.floor(elapsed / 1000) * 1000 : elapsed) / READING_MS,
          spanMs: open && entered && readingVisible ? READING_MS : 0,
        } : undefined}
          onPress={() => { if (ready) onDecision(true); }}
          style={{ ...windowFooterPrimary, flex: '1 0 180px', minWidth: 0, opacity: ready ? 1 : UNAVAILABLE, cursor: ready ? cursors.clickable : cursors.default }}>
          {seconds > 0 ? t('export.notice.wait', { seconds }) : !atEnd ? t('export.notice.scroll') : t('export.notice.confirm')}
        </TimedButton>
      </div>
    </ModalShell>
  );
}

/** One acknowledgement per attempt; closing or changing its inputs retires pending consent. */
export function useExportNotice(open: boolean, revision: unknown, map: unknown, format: 'image' | 'json' = 'image') {
  const [showing, setShowing] = useState(false);
  const [hasPetitGlyph, setHasPetitGlyph] = useState(false);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const decide = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setShowing(false);
    resolve?.(accepted);
  }, []);
  useEffect(() => {
    decide(false);
    return () => decide(false);
  }, [open, revision, map, format, decide]);
  const request = useCallback((containsPetitGlyph = false): Promise<boolean> => {
    if (!open || pending.current) return Promise.resolve(false);
    setHasPetitGlyph(containsPetitGlyph);
    return new Promise(resolve => { pending.current = resolve; setShowing(true); });
  }, [open]);
  return { request, notice: <ExportNotice open={open && showing} onDecision={decide} format={format} hasPetitGlyph={hasPetitGlyph} /> };
}
