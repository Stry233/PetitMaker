/**
 * The stylize window: one card with two pages, opening on the studio; the connection form is a page of
 * its own, where Escape steps back to the studio. It stands on `z.takeover`, and while it is open the
 * version store retires a picture drawn from a map that has since changed.
 */
import { useWindow, type WindowProps } from '../../use-window';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { z } from '../../../../design/styles';
import { ModalShell } from '../../../../primitives/ModalShell';
import { WindowHeader, windowFrame } from '../../../../primitives/Window';
import { useT } from '../../../../../i18n/context';
import { Hero } from './Hero';
import { Studio } from './Studio';
import { amplitude, framerMotion, outMotion } from '../../../../design/motion';
import { useStylizeConnection, type StylizeListModels } from './use-stylize-connection';

type Page = 'hero' | 'studio';

/** How far a page stands off its mark at either end of the swap: the arriving one comes in from
 *  that side, the departing one goes out the other. */
const swapTravel = amplitude('stylize.page.swap');

interface StylizeWindowProps extends Pick<WindowProps, 'onClose'> {
  /** Injected for tests; the default asks the chosen dialect. */
  listModels?: StylizeListModels;
}

/** The studio card's own geometry, one record: the live window and the Help Center's figure wear
 *  the same box. */
export const STUDIO_CARD = { width: 880, height: 672 } as const;

export function StylizeWindow({ onClose, listModels }: StylizeWindowProps) {
  const t = useT();
  // Its host mounts it only while the flag is on, the lazy chunk with it.
  const { open, close } = useWindow('stylize', { open: true, onClose });
  const [page, setPage] = useState<Page | null>(null);
  // Whether the connection form was walked into from the create page, which is what its dismiss
  // means: back to the page it was opened over, not out of the window.
  const [openedOverStudio, setOpenedOverStudio] = useState(false);
  const conn = useStylizeConnection({
    ...(listModels ? { listModels } : {}),
    probing: page === 'hero',
  });

  useEffect(() => {
    if (page !== null || !conn.booted) return;
    setPage('studio');
  }, [page, conn.booted]);

  const dismiss = () => {
    if (page === 'hero' && openedOverStudio) { setPage('studio'); setOpenedOverStudio(false); return; }
    close();
  };

  const start = () => {
    void conn.verify().then((ok) => { if (ok) { setPage('studio'); setOpenedOverStudio(false); } });
  };

  return (
    <ModalShell helpTarget={{ page: 'share', anchor: 'share-stylize' }}
      open={open}
      onClose={dismiss}
      size="workspace"
      width={STUDIO_CARD.width}
      height={STUDIO_CARD.height}
      ariaLabel={t('stylize.win_title')}
      backdropStyle={{ zIndex: z.takeover }}
      cardStyle={{ ...windowFrame, overflow: 'hidden' }}
    >
      <WindowHeader title={<h2 style={{ margin: 0, font: 'inherit' }}>{t('stylize.win_title')}</h2>} reserve
        close={{ label: t('hint.close'), onPress: close }} style={{ flex: 'none' }} />
      {/*
        The two pages cross in one box. A bare key change takes the old page out on the frame the new
        one mounts, which leaves the swap half a motion — a page arriving out of nothing — so the
        presence wrapper is what gives the departing page its leave. They are stacked rather than
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
              exit={{ opacity: 0, x: -swapTravel, pointerEvents: 'none', transition: outMotion('stylize.page.swap') }}
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
                  onDone={close}
                />
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </ModalShell>
  );
}
