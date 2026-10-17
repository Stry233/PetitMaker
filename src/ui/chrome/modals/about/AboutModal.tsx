/**
 * The About window and the legal documents it drills into. A document keeps the height About last
 * stood at; the card glides between the two views' sizes while they crossfade. Each opening starts
 * on About, or on the document `aboutTarget` names.
 */
import { Suspense, lazy, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLocale, useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { loadLocale, localeLoaded } from '../../../../i18n/translations';
import { showToast } from '../../../../platform/channels/toast-bus';
import { useWindow, type WindowProps } from '../use-window';
import { visuallyHidden } from '../../../design/styles';
import { skin, windowCard } from '../../../design/window-skin';
import { useChromeScale, useViewportSize } from '../../../design/scale';
import { RenderBoundary } from '../../../primitives/RenderBoundary';
import { ChunkNotice } from '../../guards/FailureNotice';
import { ModalShell } from '../../../primitives/ModalShell';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { useScrollFade } from '../../../primitives/scroll-fade';
import { useSizeGlide } from '../../../primitives/use-size-glide';
import { WindowClose } from '../../../primitives/Window';
import { DOCS, docIdForPath, type DocId } from '../../../../legal/registry';
import { WindowStep } from '../WindowStep';
import { AboutView, opensDoc } from './AboutView';
import { loadLegalDocView } from '../../loaders';

const LegalDocView = lazy(loadLegalDocView);

type View = { kind: 'about' } | { kind: 'doc'; id: DocId };

/** The stacked About column, the wide brand-band layout, and the document reader, in css px. */
const ABOUT_WIDTH = 440;
const ABOUT_WIDE_WIDTH = 800;
const DOC_WIDTH = 640;
/** Window px the wide card must leave free beside itself; below that About stacks into one column. */
const WIDE_MARGIN = 32;
/** A document opened straight from another window, before About has stood once. */
const DOC_FIRST_HEIGHT = 480;

const cardStyle: CSSProperties = { ...windowCard, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const glideBox: CSSProperties = { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '0 1 auto' };
const aboutScroll: CSSProperties = { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden', minHeight: 0, padding: '32px 28px 28px', gap: 24 };
const aboutWide: CSSProperties = { ...aboutScroll, padding: '28px 32px 24px' };
const closeAt: CSSProperties = { position: 'absolute', top: 16, insetInlineEnd: 16, zIndex: 1 };
const suspenseFallback: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };

export function AboutModal(props: WindowProps) {
  const { open, close } = useWindow('about', props);
  const titleId = useId();
  return (
    <ModalShell helpTarget={{ page: 'settings', anchor: 'settings-about' }} open={open} onClose={close} size="panel" cardStyle={cardStyle} ariaLabelledBy={titleId}>
      <AboutBody titleId={titleId} onClose={close} />
    </ModalShell>
  );
}

function AboutBody({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useState<View>(() => {
    const target = useEditorStore.getState().aboutTarget;
    return target && opensDoc(target) ? { kind: 'doc', id: target } : { kind: 'about' };
  });
  useEffect(() => { useEditorStore.getState().takeAboutTarget(); }, []);
  const [docLang, setDocLang] = useState<'en' | 'zh'>(locale === 'zh' && localeLoaded('zh') ? 'zh' : 'en');
  // A Chinese document writes some words from the zh table, so it shows once that table has arrived.
  const chooseDocLang = (lang: 'en' | 'zh') => {
    if (localeLoaded(lang)) { setDocLang(lang); return; }
    loadLocale(lang).then(() => setDocLang(lang), () => showToast(t('boot.chunk_failed'), 'error'));
  };
  const isDoc = view.kind === 'doc';
  // The card renders at `width × chrome` window px.
  const wide = ABOUT_WIDE_WIDTH * useChromeScale() + WIDE_MARGIN <= useViewportSize().w;

  const width = useSizeGlide<HTMLDivElement>(`${view.kind}|${wide}`, { axis: 'width', motionId: 'modal.resize' });
  const height = useSizeGlide<HTMLDivElement>(`${view.kind}|${wide}|${locale}`, { axis: 'height', motionId: 'modal.resize' });
  const gliding = width.gliding || height.gliding;
  /** The height About stood at as a document opened over it, which the document keeps. */
  const [docHeight, setDocHeight] = useState(DOC_FIRST_HEIGHT);

  const rowRefs = useRef<Partial<Record<DocId, HTMLButtonElement | null>>>({});
  const refocusId = useRef<DocId | null>(null);
  const openDoc = (id: DocId) => {
    if (view.kind === 'about' && height.ref.current) setDocHeight(height.ref.current.offsetHeight);
    setView({ kind: 'doc', id });
  };
  const back = () => {
    if (view.kind === 'doc') refocusId.current = view.id;
    setView({ kind: 'about' });
  };
  // Back returns focus to the row that opened the document, a fresh node once About remounts.
  useEffect(() => {
    if (view.kind !== 'about' || !refocusId.current) return;
    rowRefs.current[refocusId.current]?.focus();
    refocusId.current = null;
  }, [view]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(scrollRef, 'y');

  return (
    <>
      <span id={titleId} style={visuallyHidden}>{isDoc ? t(DOCS[view.id].titleKey) : t('modal.about_title')}</span>
      <div ref={width.ref} style={{ ...glideBox, ...(gliding ? { overflow: 'hidden' } : null) }}>
        <div ref={height.ref} style={{ ...glideBox, position: 'relative' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {view.kind === 'doc' ? (
              <WindowStep key="doc" view="doc" style={{ width: DOC_WIDTH, height: docHeight, maxHeight: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div data-doc-view style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  <RenderBoundary resetKey={view.id} fallback={<ChunkNotice />}>
                    <Suspense fallback={<div style={suspenseFallback}><LoadingDots color={skin.muted} /></div>}>
                      <LegalDocView id={view.id} lang={docLang} onLang={chooseDocLang} onBack={back}
                        onInternalLink={(path) => { const id = docIdForPath(path); if (id) openDoc(id); }} />
                    </Suspense>
                  </RenderBoundary>
                </div>
              </WindowStep>
            ) : (
              <WindowStep key="about" view="about" style={{ width: wide ? ABOUT_WIDE_WIDTH : ABOUT_WIDTH, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div ref={scrollRef} data-about-view data-scroll data-about-layout={wide ? 'wide' : 'stack'} style={{ ...(wide ? aboutWide : aboutScroll), ...fade }}>
                  <AboutView wide={wide} onOpenDoc={openDoc} rowRefs={rowRefs} />
                </div>
                <WindowClose label={t('hint.close')} onPress={onClose} style={closeAt} data-testid="about-close" />
              </WindowStep>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
