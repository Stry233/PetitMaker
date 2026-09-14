import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../../i18n/context';
import { ModalShell } from '../../../../primitives/ModalShell';
import { TimedButton } from '../../../../primitives/TimedButton';
import { useScrollFade } from '../../../../primitives/scroll-fade';
import { buttonMotion, cursors } from '../../../../design/styles';
import { skin, windowCard, windowFooterGhost, windowFooterPrimary, windowTitle } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';

const READING_MS = 7000;

export function ExportNotice({ open, onDecision }: { open: boolean; onDecision: (accepted: boolean) => void }) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const [entered, setEntered] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [readingVisible, setReadingVisible] = useState(!document.hidden);
  const [atEnd, setAtEnd] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(content, 'y');
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
  }, [open, entered, t]);

  const checkEnd = useCallback(() => {
    const node = content.current;
    setAtEnd(!!node && node.clientHeight > 0 && node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
  }, []);
  useEffect(() => {
    setAtEnd(false);
    if (!open || !entered) return;
    if (content.current) content.current.scrollTop = 0;
    checkEnd();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(checkEnd);
    if (content.current) observer?.observe(content.current);
    if (words.current) observer?.observe(words.current);
    window.addEventListener('resize', checkEnd);
    return () => { observer?.disconnect(); window.removeEventListener('resize', checkEnd); };
  }, [open, entered, t, checkEnd]);

  const seconds = Math.ceil((READING_MS - elapsed) / 1000);
  const ready = open && entered && seconds === 0 && atEnd;
  return createPortal(
    <ModalShell open={open} onClose={() => onDecision(false)} onEntered={onEntered} width={530} maxVwPct={94} maxVh={88}
      cardStyle={{ ...windowCard, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', minHeight: 0 }} ariaLabel={t('export.notice.title')}>
      <h2 style={{ ...windowTitle, margin: '0 0 16px', flex: '0 0 auto' }}>{t('export.notice.title')}</h2>
      <div ref={content} onScroll={checkEnd} tabIndex={0} role="region" aria-label={t('export.notice.title')}
        style={{ overflowY: 'auto', minHeight: 0, ...roleFont('body'), lineHeight: 1.65, color: skin.plateInk, ...fade }}>
        <div ref={words}>
          <p style={{ margin: '0 0 14px' }}>{t('export.notice.intro', { app: t('app.name') })}</p>
          <ol style={{ margin: 0, paddingInlineStart: 22, display: 'grid', gap: 12 }}>
            <li>{t('export.notice.honesty')}</li>
            <li>{t('export.notice.respect')}</li>
            <li>{t('export.notice.responsibility')}</li>
          </ol>
        </div>
      </div>
      <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10, flex: '0 0 auto' }}>
        <TimedButton after={0} disabled={!ready} external={seconds > 0 ? {
          fraction: (reduced ? Math.floor(elapsed / 1000) * 1000 : elapsed) / READING_MS,
          spanMs: open && entered && readingVisible ? READING_MS : 0,
        } : undefined}
          onPress={() => { if (ready) onDecision(true); }}
          style={{ ...windowFooterPrimary, flex: '1 0 180px', minWidth: 0, opacity: ready ? 1 : 0.65, cursor: ready ? cursors.clickable : cursors.default }}>
          {seconds > 0 ? t('export.notice.wait', { seconds }) : !atEnd ? t('export.notice.scroll') : t('export.notice.confirm')}
        </TimedButton>
        <motion.button style={{ ...windowFooterGhost, flex: '1 0 140px' }} onClick={() => onDecision(false)} {...buttonMotion}>{t('export.notice.cancel')}</motion.button>
      </div>
    </ModalShell>, document.body,
  );
}

/** One acknowledgement per attempt; closing or changing its inputs retires pending consent. */
export function useExportNotice(open: boolean, revision: unknown, map: unknown) {
  const [showing, setShowing] = useState(false);
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
  }, [open, revision, map, decide]);
  const request = useCallback((): Promise<boolean> => {
    if (!open || pending.current) return Promise.resolve(false);
    return new Promise(resolve => { pending.current = resolve; setShowing(true); });
  }, [open]);
  return { request, notice: <ExportNotice open={open && showing} onDecision={decide} /> };
}
