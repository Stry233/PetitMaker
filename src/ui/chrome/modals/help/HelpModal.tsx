/*
 * HelpModal.tsx — the Help Center: catalog on the left, one page on the right, search and the
 * "what's this?" arm in the header. The window keeps the reader's place across opens; a deep link
 * (`openHelp`) outranks it once, then clears.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { useEditorStore } from '../../../../state/store';
import { useT } from '../../../../i18n/context';
import { ensureHelpStrings } from '../../../../i18n/locales/help';
import { ModalShell } from '../../../primitives/ModalShell';
import { ClickCatcher } from '../../../primitives/ClickCatcher';
import { roleFont } from '../../../design/text-weight';
import { ACTIVE, INK, INSET, LINE, PLATE, PLATE_INK, TRACK } from '../../../design/tokens';
import { colors, cursors, exitTransition, pressable, radii, shadows, springs } from '../../../design/styles';
import { HELP_GROUPS, HELP_GROUP_TITLES, HELP_PAGES, HELP_PAGE_ORDER } from './catalog';
import type { HelpPageId } from './page-schema';
import { PageView } from './PageView';
import { FigureReadyContext } from './figures/figure-ready';
import { searchHelp, type HelpHit } from './search';

// The chunk's words arrive with the chunk: registering at module scope means no surface in
// this file can render before its strings exist.
ensureHelpStrings();

const WIDTH = 1080;
const NAV_W = 252;

function QuestionGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.6 9a3.6 3.6 0 1 1 5.2 3.2c-1.2.6-1.8 1.3-1.8 2.6" />
      <circle cx="12" cy="18.6" r="1.1" fill={INK} stroke="none" />
    </svg>
  );
}

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const helpTarget = useEditorStore((s) => s.helpTarget);
  const setHelpTarget = useEditorStore((s) => s.setHelpTarget);
  const setWhatsThis = useEditorStore((s) => s.setWhatsThis);
  const [page, setPage] = useState<HelpPageId>('welcome');
  const [scrollRequest, setScrollRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HelpHit[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ page: HelpPageId; anchor?: string } | null>(null);
  const reduced = useReducedMotionConfig();
  const [entered, setEntered] = useState(false);
  const onEntered = useCallback(() => setEntered(true), []);
  useEffect(() => { if (!open) setEntered(false); }, [open]);

  // A deep link is consumed exactly once, at the open (or the click) that carried it.
  useEffect(() => {
    if (!open || !helpTarget) return;
    const target = helpTarget.page as HelpPageId;
    if (HELP_PAGES[target]) {
      setPage(target);
      pendingAnchor.current = { page: target, anchor: helpTarget.anchor };
      setScrollRequest((n) => n + 1);
    }
    setHelpTarget(null);
  }, [open, helpTarget, setHelpTarget]);

  // Page transitions can keep the outgoing article mounted; consume the anchor only when the
  // destination article is present, including a new anchor on the current page.
  const onPageReady = useMemo(() => {
    // Effect replay must use the same anchor, even after the first invocation consumes it.
    const target = pendingAnchor.current;
    return (readyPage: HelpPageId) => {
      const host = scrollRef.current;
      if (!host || !open) return;
      if (target && target.page !== readyPage) return;
      const anchor = target?.anchor;
      if (pendingAnchor.current === target) pendingAnchor.current = null;
      if (!anchor) { host.scrollTop = 0; return; }
      const el = host.querySelector<HTMLElement>(`#help-${anchor}`);
      if (!el) { host.scrollTop = 0; return; }
      el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      el.style.transition = reduced ? 'none' : 'background-color 0.4s ease';
      const raf = requestAnimationFrame(() => { el.style.backgroundColor = ACTIVE; });
      const timeout = setTimeout(() => {
        el.style.transition = reduced ? 'none' : 'background-color 1.2s ease';
        el.style.backgroundColor = 'transparent';
      }, 900);
      return () => { cancelAnimationFrame(raf); clearTimeout(timeout); };
    };
  }, [scrollRequest, open, reduced]);

  // Search input must not invalidate the memoized article or restart its illustrations.
  const go = useCallback((id: HelpPageId, anchor?: string) => {
    pendingAnchor.current = { page: id, anchor };
    setPage(id);
    setScrollRequest((n) => n + 1);
    setQuery('');
    setHits([]);
  }, []);

  const groups = useMemo(() => HELP_GROUPS.map((g) => ({
    id: g,
    pages: HELP_PAGE_ORDER.filter((id) => HELP_PAGES[id].group === g),
  })).filter((g) => g.pages.length > 0), []);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      onEntered={onEntered}
      width={WIDTH}
      maxVw={96}
      maxVh={92}
      height={720}
      ariaLabel={t('modal.help_title')}
      cardStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {(exiting) => (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px 14px 26px', flex: 'none' }}>
            <span style={{ ...roleFont('title'), color: INK }}>{t('modal.help_title')}</span>
            {/* The auto margin pushes the pill to the row's right, beside the what's-this arm. */}
            <div style={{ flex: '0 1 330px', position: 'relative', marginLeft: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: INSET, borderRadius: radii.pill, padding: '9px 16px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.brownText} strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <circle cx="10.5" cy="10.5" r="6" /><path d="M15.5 15.5 20 20" />
                </svg>
                <input
                  type="search"
                  className="pw-search-field pw-field-input"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setHits(searchHelp(locale, e.target.value)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0].page, hits[0].anchor); }}
                  placeholder={t('help.search_placeholder')}
                  aria-label={t('help.search_placeholder')}
                  style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', ...roleFont('field'), color: PLATE_INK, fontFamily: 'inherit' }}
                />
              </div>
              {hits.length > 0 && <ClickCatcher onDismiss={() => setHits([])} zIndex={4} />}
              <AnimatePresence>
                {hits.length > 0 && (
                  <motion.div
                    key="search-hits"
                    initial={reduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98, transition: exitTransition }}
                    transition={springs.stiff}
                    style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, transformOrigin: 'top center', background: PLATE, border: `1px solid rgba(87,73,53,0.62)`, borderRadius: radii.lg, padding: 6, boxShadow: shadows.menu, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 340, overflowY: 'auto', zIndex: 5 }}
                  >
                    {hits.map((h, i) => (
                      <motion.button
                        key={`${h.page}-${h.anchor ?? i}`}
                        type="button"
                        onClick={() => go(h.page, h.anchor)}
                        initial={reduced ? false : { opacity: 0 }}
                        animate={{ opacity: 1, transition: { ...springs.stiff, delay: reduced ? 0 : i * 0.025 } }}
                        style={{ display: 'flex', alignItems: 'baseline', gap: 9, textAlign: 'left', border: 'none', borderRadius: radii.md, padding: '9px 14px', background: PLATE, cursor: cursors.clickable, transition: 'background-color 0.15s ease' }}
                        onPointerEnter={(e) => { e.currentTarget.style.background = INSET; }}
                        onPointerLeave={(e) => { e.currentTarget.style.background = PLATE; }}
                      >
                        <span style={{ ...roleFont('menu'), color: PLATE_INK, whiteSpace: 'nowrap' }}>{t(HELP_PAGES[h.page].titleKey)}</span>
                        <span style={{ ...roleFont('caption'), color: colors.brownText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.snippet}</span>
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <motion.button
              type="button"
              title={t('help.whats_this_tip')}
              aria-label={t('help.whats_this')}
              onClick={() => { setWhatsThis(true); onClose(); }}
              {...pressable}
              style={{ width: 36, height: 36, borderRadius: radii.pill, background: INSET, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: cursors.clickable, flex: 'none' }}
            >
              <QuestionGlyph />
            </motion.button>

          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `${NAV_W}px 1fr`, minHeight: 0 }}>
            <nav aria-label={t('modal.help_title')} style={{ overflowY: 'auto', padding: '8px 12px 18px 16px', background: 'rgba(234,232,205,0.42)', borderRight: `2px solid ${LINE}` }}>
              {groups.map((group) => (
                <div key={group.id}>
                  {/* The catalog's ladder descends in size: group (lead, muted) over page rows (head),
                      so a section never stands smaller than the pages inside it. */}
                  <div style={{ ...roleFont('lead'), color: colors.brownText, padding: '16px 10px 6px' }}>{t(HELP_GROUP_TITLES[group.id])}</div>
                  {group.pages.map((id) => {
                    const current = id === page;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-current={current || undefined}
                        onClick={() => go(id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                          border: 'none', borderRadius: radii.md, padding: '8px 12px',
                          // Every row at head: the chosen one is told by its fill and ink, not by a
                          // weight step, and no row reads thinner than the prose beside it.
                          ...roleFont('head'),
                          color: current ? INK : PLATE_INK,
                          background: current ? ACTIVE : 'transparent',
                          cursor: cursors.clickable,
                          transition: 'background-color 0.15s ease',
                        }}
                        onPointerEnter={(e) => { if (!current) e.currentTarget.style.background = PLATE; }}
                        onPointerLeave={(e) => { if (!current) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span aria-hidden style={{ width: 6, height: 6, borderRadius: radii.pill, background: current ? INK : TRACK, flex: 'none' }} />
                        {t(HELP_PAGES[id].navKey ?? HELP_PAGES[id].titleKey)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            {/* Anchoring OFF: the figures re-render as they animate, and Chrome's scroll anchoring can
                latch onto a node inside one and haul the reader back up to it on every beat. Every
                figure holds a fixed box, so the article's height never changes and nothing here needs
                anchoring to keep a reading position. */}
            <div ref={scrollRef} style={{ overflowY: 'auto', minWidth: 0, overflowAnchor: 'none' }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={page}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={exiting ? undefined : { opacity: 0, y: -8, transition: exitTransition }}
                  transition={springs.stiff}
                >
                  <FigureReadyContext.Provider value={!!reduced || entered}>
                    <PageView page={HELP_PAGES[page]} onGo={go} onReady={onPageReady} />
                  </FigureReadyContext.Provider>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}
