/*
 * The Help Center: catalog on the left, one page on the right, search and the
 * "what's this?" arm in the header. The window keeps the reader's place across opens; a deep link
 * (`openHelp`) outranks it once, then clears. A body too narrow for two columns shows one screen at
 * a time: each open starts on the catalog, a pick or a deep link shows the page, and Back in the
 * header returns to the catalog.
 */
import { cssMotion, framerMotion, NO_MOTION } from '../design/motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { effectiveCombo } from '../../state/keymap/resolve';
import { prettyCombo } from '../../platform/input/combo';
import { useKeybinds } from '../../state/keymap/store';
import { useEditorStore } from '../../state/store';
import { useWindow, type WindowProps } from '../chrome/modals/use-window';
import { useWindowColumns } from '../chrome/modals/use-window-columns';
import { useLeavingView } from '../chrome/modals/WindowStep';
import { useTransition } from '../design/motion/use-motion';
import { MOTIONS } from '../design/motion/registry';
import { useHelpTables, useLocale, useT } from '../../i18n/context';
import { ModalShell, useModalEntered } from '../primitives/ModalShell';
import { FloatMenu } from '../primitives/FloatMenu';
import { ActionButton } from '../primitives/ActionButton';
import { useNameReveal } from '../primitives/use-name-reveal';
import { WindowBack, WindowClose } from '../primitives/Window';
import { windowIconButton } from '../design/window-skin';
import { roleFont } from '../design/text-weight';
import { ACTIVE, INK, INSET, LINE, MUTED, PLATE, PLATE_INK, TRACK, WASH, rgbaOf } from '../design/tokens';
import { cursors, radii, z } from '../design/styles';
import { HELP_GROUPS, HELP_GROUP_TITLES, HELP_PAGES, HELP_PAGE_ORDER } from './catalog';
import type { HelpPageId } from './page-schema';
import { PageView } from './PageView';
import { FigureReadyContext } from './figures/figure-ready';
import { searchHelp, type HelpHit } from './search';
import { useReading, useReadingT } from '../design/reading';

const NAV_W = 252;

/** Which of the two screens a one-column Help shows. */
type Screen = 'catalog' | 'page';

/** How far a screen travels as it arrives or leaves, in css px; the page moves on the end side. */
const SCREEN_TRAVEL = MOTIONS['help.screen'].amplitude;
const screenCell: CSSProperties = { display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0, minWidth: 0 };
/** Both screens of a one-column Help share the body's one cell. */
const stackedCell: CSSProperties = { gridArea: '1 / 1' };

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
  const rt = useReadingT();
  // The held name reads by the finger that holds it; the hover title is a mouse's.
  const whatsThisName = useNameReveal(rt('help.whats_this_tip'), 'below',
    helpCombo ? t('shortcut.with_combo', { label: t('help.whats_this_tip'), combo: prettyCombo(helpCombo) }) : t('help.whats_this_tip'));
  const locale = useLocale();
  const reading = useReading();
  const helpTarget = useEditorStore((s) => s.helpTarget);
  const setHelpTarget = useEditorStore((s) => s.setHelpTarget);
  const setWhatsThis = useEditorStore((s) => s.setWhatsThis);
  const [page, setPage] = useState<HelpPageId>('welcome');
  const [scrollRequest, setScrollRequest] = useState(0);
  const [query, setQuery] = useState('');
  // The list stands until a pick, an outside press or Escape puts it away; the next keystroke brings
  // it back. Hits follow the live reading, so a mode flip rewords open results.
  const [listed, setListed] = useState(false);
  const hits = useMemo<HelpHit[]>(() => (listed ? searchHelp(locale, query, reading) : []), [listed, locale, query, reading]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  // In one column the catalogue and the page each fill the body, one at a time.
  const [columns, bodyRef] = useWindowColumns();
  const single = columns === 1;
  const [screen, setScreen] = useState<Screen>('catalog');
  const navRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const pendingAnchor = useRef<{ page: HelpPageId; anchor?: string } | null>(null);
  const reduced = useReducedMotionConfig();
  const { entered, onEntered } = useModalEntered(open);

  // Chosen during the render that opens, so a reopen shows its screen at its first frame: the
  // catalog, or the page a deep link carried by the same open names.
  const [openEdge, setOpenEdge] = useState(false);
  if (open !== openEdge) {
    setOpenEdge(open);
    if (open) setScreen(helpTarget && HELP_PAGES[helpTarget.page as HelpPageId] ? 'page' : 'catalog');
  }

  // A deep link is consumed exactly once, at the open (or the click) that carried it.
  useEffect(() => {
    if (!open || !helpTarget) return;
    const target = helpTarget.page as HelpPageId;
    if (HELP_PAGES[target]) {
      setPage(target);
      setScreen('page');
      pendingAnchor.current = { page: target, anchor: helpTarget.anchor };
      setScrollRequest((n) => n + 1);
      setQuery('');
      setListed(false);
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
    setScreen('page');
    setScrollRequest((n) => n + 1);
    setQuery('');
    setListed(false);
  }, []);

  // Keyboard focus left on the screen that went away moves to the one that came: Back on the page,
  // the current page's row on the catalog.
  const showsPage = !single || screen === 'page';
  // A screen that comes or goes because the body crossed the breakpoint (a resize, a rotation, the
  // first measure) does so at once; only a reader's own move between the screens travels.
  const [settledSingle, setSettledSingle] = useState(single);
  useLayoutEffect(() => { if (settledSingle !== single) setSettledSingle(single); }, [single, settledSingle]);
  const crossing = settledSingle !== single;
  useEffect(() => {
    if (!single) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (screen === 'page') {
      if (lost || navRef.current?.contains(active)) backRef.current?.focus();
    } else if (lost || scrollRef.current?.contains(active) || backRef.current?.contains(active)) {
      navRef.current?.querySelector<HTMLElement>('[aria-current]')?.focus();
    }
  }, [single, screen]);

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
      {(exiting) => {
        const catalog = (
          <nav ref={navRef} aria-label={t('modal.help_title')} style={{ overflowY: 'auto', padding: '8px 12px 18px 16px', background: WASH,
            ...(single ? null : { borderRight: `2px solid ${LINE}` }) }}>
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
                      fill={current ? ACTIVE : rgbaOf(PLATE, 0)}
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
        );
        // Anchoring off: the figures re-render as they animate, and Chrome's scroll anchoring can
        // latch onto a node inside one and haul the reader back up to it on every beat. Every figure
        // holds a fixed box, so the article's height never changes and nothing here needs anchoring
        // to keep a reading position.
        const reader = (
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
        );
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px 14px 24px', flex: 'none', ...(single ? { flexWrap: 'wrap' } : null) }}>
              {single && screen === 'page' && (
                <WindowBack ref={backRef} label={t('help.back_to_pages')} onPress={() => setScreen('catalog')} />
              )}
              <span style={{ ...roleFont('title'), color: INK }}>{t('modal.help_title')}</span>
              {/* The auto margin pushes the pill to the row's right, beside the what's-this arm. In one
                  column the pill takes a row of its own under the title. */}
              <div style={single ? { flex: '1 0 100%', minWidth: 0, order: 1 } : { flex: '0 1 330px', marginLeft: 'auto' }}>
                <div ref={searchRef} style={{ display: 'flex', alignItems: 'center', gap: 8, background: INSET, borderRadius: radii.pill, padding: '8px 16px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                    <circle cx="10.5" cy="10.5" r="6" /><path d="M15.5 15.5 20 20" />
                  </svg>
                  <input
                    type="search"
                    className="pw-search-field pw-field-input"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setListed(true); }}
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
                  onClose={() => setListed(false)}
                  onPick={(id) => { const hit = hits[Number(id)]; if (hit) go(hit.page, hit.anchor); }}
                  items={hits.map((h, i) => ({ id: String(i), label: t(HELP_PAGES[h.page].titleKey), sub: h.snippet }))}
                  aria-label={t('help.search_placeholder')}
                />
              </div>
              <ActionButton
                interaction="tile"
                {...whatsThisName.bind}
                aria-label={t('help.whats_this')}
                onClick={() => { setWhatsThis(true); onClose(); }}
                style={single ? { ...windowIconButton, marginLeft: 'auto' } : windowIconButton}
             >
                <QuestionGlyph />
                {whatsThisName.bubble}
              </ActionButton>
              <WindowClose label={t('hint.close')} onPress={onClose} />

            </div>
            <div ref={bodyRef} data-columns={columns} style={{ flex: 1, display: 'grid', minHeight: 0,
              ...(single ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' } : { gridTemplateColumns: `${NAV_W}px 1fr` }) }}>
              {/* The page screen keeps its place in the tree across the breakpoint, so crossing it keeps
                  the reading position and the figures' state. */}
              <AnimatePresence initial={false} custom={crossing ? 'still' : exiting ? 'stay' : 'travel'}>
                {(!single || !showsPage) && (
                  <HelpScreen key="catalog" cell={single ? stackedCell : { gridColumn: 1, gridRow: 1 }} travel={-SCREEN_TRAVEL} still={crossing}>{catalog}</HelpScreen>
                )}
                {showsPage && (
                  <HelpScreen key="page" cell={single ? stackedCell : { gridColumn: 2, gridRow: 1 }} travel={SCREEN_TRAVEL} still={crossing}>{reader}</HelpScreen>
                )}
              </AnimatePresence>
            </div>
          </>
        );
      }}
    </ModalShell>
  );
}

/** How a screen leaves: travelling (the reader moved), at once (the body crossed the breakpoint), or
 *  not at all (the window is closing and fades as a whole). */
type Leave = 'travel' | 'still' | 'stay';

/** One of Help's two screens. A reader's move between them arrives from and leaves towards `travel`
 *  px; a `still` one (the body crossing the breakpoint) appears at once. A leaving screen takes no
 *  input while it fades. */
function HelpScreen({ cell, travel, still, children }: { cell: CSSProperties; travel: number; still: boolean; children: ReactNode }) {
  const reduced = useReducedMotionConfig();
  const transition = useTransition('help.screen');
  const leaving = useLeavingView();
  // AnimatePresence hands a leaving screen its latest `custom`, the one that says how it goes.
  const variants = {
    away: (leave: Leave) => (leave === 'stay' ? {} : leave === 'still' ? { opacity: 0, transition: NO_MOTION } : { opacity: 0, x: travel }),
    shown: { opacity: 1, x: 0 },
  };
  return (
    <motion.div style={{ ...screenCell, ...cell }} {...leaving} custom={still ? 'still' : 'travel'}
      variants={variants} initial={reduced || still ? false : 'away'} animate="shown" exit="away"
      transition={transition}
   >
      {children}
    </motion.div>
  );
}
