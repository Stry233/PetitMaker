/**
 * The stylize window: one card with two pages, opened from the export modal's own 画风 group.
 *
 * IT OPENS ON THE STUDIO, ALWAYS. Most directions draw on this machine and need nothing filed, so
 * a key is not a doorway any more: it is a requirement certain directions carry, surfaced by the
 * pane when such a direction is picked. The connection form remains its own page, reached from the
 * pane's own verb or the gear, and Escape there STEPS BACK to the studio rather than closing the
 * window out from under an unfinished job.
 *
 * The backdrop, the card, the overlay lock, the focus trap and Escape are `primitives/ModalShell`'s.
 * What this file owns is the rung (`z.stylizeWindow`, above the export modal's own overlay), the
 * page it stands on, and the shelf's binding to the map: while the window is open the version store
 * listens to the editor's own edit events, so a picture drawn from a map that has since changed is
 * retired rather than exported over the new one.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { z } from '../../../../design/styles';
import { windowCard, windowTitle } from '../../../../design/window-skin';
import { ModalShell } from '../../../../primitives/ModalShell';
import { useT } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { versionStore } from '../../../../../io/stylize';
import { Hero } from './Hero';
import { Studio } from './Studio';
import { amplitude, framerMotion, leaveMotion } from './motion';
import { useStylizeConnection, type StylizeListModels } from './use-stylize-connection';

type Page = 'hero' | 'studio';

/** How far a page stands off its mark at either end of the swap: the arriving one comes in from
 *  that side, the departing one goes out the other. */
const swapTravel = amplitude('stylize.page.swap');

export interface StylizeWindowProps {
  onClose: () => void;
  /** Injected for tests; the default asks the chosen dialect. */
  listModels?: StylizeListModels;
}

/** The studio card's own geometry, one record: the live window and the Help Center's figure wear
 *  the same box. */
export const STUDIO_CARD = { width: 880, height: 672, padding: '22px 24px 16px' } as const;

export function StylizeWindow({ onClose, listModels }: StylizeWindowProps) {
  const t = useT();
  const [page, setPage] = useState<Page | null>(null);
  // Whether the connection form was walked INTO from the create page, which is what its dismiss
  // means: back to the page it was opened over, not out of the window.
  const [openedOverStudio, setOpenedOverStudio] = useState(false);
  const conn = useStylizeConnection({
    ...(listModels ? { listModels } : {}),
    probing: page === 'hero',
  });

  useEffect(() => versionStore.bindMapEvents(useEditorStore.getState().eventBus), []);

  useEffect(() => {
    if (page !== null || !conn.booted) return;
    setPage('studio');
  }, [page, conn.booted]);

  const dismiss = () => {
    if (page === 'hero' && openedOverStudio) { setPage('studio'); setOpenedOverStudio(false); return; }
    onClose();
  };

  const start = () => {
    void conn.verify().then((ok) => { if (ok) { setPage('studio'); setOpenedOverStudio(false); } });
  };

  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-stylize' }}
      open
      onClose={dismiss}
      width={STUDIO_CARD.width}
      maxVwPct={95}
      height={STUDIO_CARD.height}
      maxVh={92}
      ariaLabel={t('stylize.win_title')}
      backdropStyle={{ zIndex: z.stylizeWindow }}
      cardStyle={{
        ...windowCard,
        padding: STUDIO_CARD.padding,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <h2 style={{ ...windowTitle, flex: 'none', margin: 0 }}>{t('stylize.win_title')}</h2>
      {/*
        THE TWO PAGES CROSS IN ONE BOX. A bare key change takes the old page out on the frame the new
        one mounts, which leaves the swap half a motion — a page arriving out of nothing — so the
        presence wrapper is what gives the departing page its leave. They are STACKED rather than
        queued (`mode='wait'` empties the card for the length of that leave), which is why the box
        holds the height and each page fills it. Nothing stands while the connection is still being
        read, so the first page to arrive replaces no one.
      */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <AnimatePresence>
          {page ? (
            <motion.div
              key={page}
              initial={{ opacity: 0, x: swapTravel }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -swapTravel, pointerEvents: 'none', transition: leaveMotion('stylize.page.swap') }}
              transition={framerMotion('stylize.page.swap')}
              style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
            >
              {page === 'hero' ? <Hero conn={conn} onStart={start} onDismiss={dismiss} /> : null}
              {page === 'studio' ? (
                <Studio
                  dialect={conn.connected ? conn.dialect : null}
                  cfg={conn.connected ? conn.cfg : null}
                  connected={conn.connected}
                  onSettings={() => { setPage('hero'); setOpenedOverStudio(true); }}
                  onDone={onClose}
                />
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </ModalShell>
  );
}
