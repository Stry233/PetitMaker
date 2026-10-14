/*
 * The Help Center: catalog on the left, one page on the right, search and the
 * "what's this?" arm in the header. The window keeps the reader's place across opens; a deep link
 * (`openHelp`) outranks it once, then clears.
 */
import { cssMotion, framerMotion } from '../design/motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { effectiveCombo } from '../../state/keymap/resolve';
import { prettyCombo } from '../../platform/input/combo';
import { useKeybinds } from '../../state/keymap/store';
import { useEditorStore } from '../../state/store';
import { useWindow, type WindowProps } from '../chrome/modals/use-window';
import { useHelpTables, useLocale, useT } from '../../i18n/context';
import { ModalShell, useModalEntered } from '../primitives/ModalShell';
import { FloatMenu } from '../primitives/FloatMenu';
import { ActionButton } from '../primitives/ActionButton';
import { WindowClose } from '../primitives/Window';
import { windowIconButton } from '../design/window-skin';
import { roleFont } from '../design/text-weight';
import { ACTIVE, INK, INSET, LINE, MUTED, PLATE, PLATE_INK, TRACK, WASH, rgbaOf } from '../design/tokens';
import { cursors, radii, z } from '../design/styles';
import { HELP_GROUPS, HELP_GROUP_TITLES, HELP_PAGES, HELP_PAGE_ORDER } from './catalog';
import type { HelpPageId } from './page-schema';
import { PageView } from './PageView';
import { FigureReadyContext } from './figures/figure-ready';
import { searchHelp, type HelpHit } from './search';

const NAV_W = 252;

function QuestionGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.6 9a3.6 3.6 0 1 1 5.2 3.2c-1.2.6-1.8 1.3-1.8 2.6" />
      <circle cx="12" cy="18.6" r="1.1" fill={INK} stroke="none" />
    </svg>
  );
}

export function HelpModal(props: WindowProps) {
  const t = useT();
  useHelpTables();
  const { open, close: onClose } = useWindow('help', props);
  const overrides = useKeybinds(s => s.overrides);
  const helpCombo = effectiveCombo(overrides, 'app.whats_this');
  const locale = useLocale();
  const helpTarget = useEditorStore((s) => s.helpTarget);
  const setHelpTarget = useEditorStore((s) => s.setHelpTarget);
  const setWhatsThis = useEditorStore((s) => s.setWhatsThis);
  const [page, setPage] = useState<HelpPageId>('welcome');
  const [scrollRequest, setScrollRequest] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HelpHit[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ page: HelpPageId; anchor?: string } | null>(null);
  const reduced = useReducedMotionConfig();
  const { entered, onEntered } = useModalEntered(open);

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
      el.style.transition = cssMotion('help.highlight', ['background-color'], reduced);
      const raf = requestAnimationFrame(() => { el.style.backgroundColor = ACTIVE; });
      const timeout = setTimeout(() => {
        el.style.transition = cssMotion('help.highlight.leave', ['background-color'], reduced);
        el.style.backgroundColor = 'transparent';
      }, 900);
      return () => { cancelAnimationFrame(raf); clearTimeout(timeout); };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- each scroll request replays the scroll
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
    <ModalShell helpTarget={{ page: 'welcome', anchor: 'welcome-help' }}
      open={open}
      onClose={onClose}
      onEntered={onEntered}
      backdropStyle={{ zIndex: z.helpWindow }}
      size="reader"
      ariaLabel={t('modal.help_title')}
      cardStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
   >
      {(exiting) => (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px 14px 24px', flex: 'none' }}>
            <span style={{ ...roleFont('title'), color: INK }}>{t('modal.help_title')}</span>
            {/* The auto margin pushes the pill to the row's right, beside the what's-this arm. */}
            <div style={{ flex: '0 1 330px', marginLeft: 'auto' }}>
              <div ref={searchRef} style={{ display: 'flex', alignItems: 'center', gap: 8, background: INSET, borderRadius: radii.pill, padding: '8px 16px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4" strokeLinecap="round" aria-hidden>
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
              <FloatMenu
                row={null}
                anchor={searchRef}
                keepFocus
                open={hits.length > 0}
                onOpen={() => {}}
                onClose={() => setHits([])}
                onPick={(id) => { const hit = hits[Number(id)]; if (hit) go(hit.page, hit.anchor); }}
                items={hits.map((h, i) => ({ id: String(i), label: t(HELP_PAGES[h.page].titleKey), sub: h.snippet }))}
                aria-label={t('help.search_placeholder')}
              />
            </div>
            <ActionButton
              interaction="tile"
              title={helpCombo ? t('shortcut.with_combo', { label: t('help.whats_this_tip'), combo: prettyCombo(helpCombo) }) : t('help.whats_this_tip')}
              aria-label={t('help.whats_this')}
              onClick={() => { setWhatsThis(true); onClose(); }}
              style={windowIconButton}
           >
              <QuestionGlyph />
            </ActionButton>
            <WindowClose label={t('hint.close')} onPress={onClose} />

          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `${NAV_W}px 1fr`, minHeight: 0 }}>
            <nav aria-label={t('modal.help_title')} style={{ overflowY: 'auto', padding: '8px 12px 18px 16px', background: WASH, borderRight: `2px solid ${LINE}` }}>
              {groups.map((group) => (
                <div key={group.id}>
                  {/* The catalog's ladder descends in size: group (lead, muted) over page rows (head),
                      so a section never stands smaller than the pages inside it. */}
                  <div style={{ ...roleFont('lead'), color: MUTED, padding: '16px 10px 6px' }}>{t(HELP_GROUP_TITLES[group.id])}</div>
                  {group.pages.map((id) => {
                    const current = id === page;
                    return (
                      <ActionButton
                        key={id}
                        interaction="row"
                        hoverFill={current ? undefined : PLATE}
                        aria-current={current || undefined}
                        onClick={() => go(id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                          border: 'none', borderRadius: radii.md, padding: '8px 12px',
                          // Every row at head: the chosen one is told by its fill and ink, not by a
                          // weight step, and no row reads thinner than the prose beside it.
                          ...roleFont('head'),
                          color: current ? INK : PLATE_INK,
                          backgroundColor: current ? ACTIVE : rgbaOf(PLATE, 0),
                          cursor: cursors.clickable,
                        }}
                     >
                        <span aria-hidden style={{ width: 6, height: 6, borderRadius: radii.pill, background: current ? INK : TRACK, flex: 'none' }} />
                        {t(HELP_PAGES[id].navKey ?? HELP_PAGES[id].titleKey)}
                      </ActionButton>
                    );
                  })}
                </div>
              ))}
            </nav>
            {/* Anchoring off: the figures re-render as they animate, and Chrome's scroll anchoring can
                latch onto a node inside one and haul the reader back up to it on every beat. Every
                figure holds a fixed box, so the article's height never changes and nothing here needs
                anchoring to keep a reading position. */}
            <div ref={scrollRef} style={{ overflowY: 'auto', minWidth: 0, overflowAnchor: 'none' }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={page}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={exiting ? undefined : { opacity: 0, y: -8, transition: framerMotion('surface.leave') }}
                  transition={framerMotion('surface.arrive')}
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
