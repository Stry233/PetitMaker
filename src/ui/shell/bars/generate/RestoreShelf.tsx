/*
 * Offers the last saved session from the generation shelf. The card restores immediately and its
 * visible countdown pauses while covered, leaving or focused through either sibling action.
 */
import { ActionButton } from '../../../primitives/ActionButton';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { useEffect, useState } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { renderThumbnail } from '../../../../view/map2d/capture/thumbnail';
import { useT } from '../../../../i18n/context';
import { timedHint } from '../../../chrome/timed-hint';
import type { GridState } from '../../../../core/model/types';
import { helpTargetAttr } from '../../../session/help-targets';
import { TimedButton } from '../../../primitives/TimedButton';
import { ScaleProvider } from '../../../design/scale';
import { btnReset, cursors, z, radii } from '../../../design/styles';
import { ACTIVE, PLATE, PLATE_INK } from '../../../design/tokens';
import { SHELF_SCALE, SHELF_TABS, TEXT } from '../../units';
import { MOTIONS } from '../../../design/motion/registry';
import { useBeat, useTransition, useMotionAllowed } from '../../../design/motion/use-motion';
import { BarText } from '../bar-atoms';
import { CardFace } from './CandidateCard';
import { CARD, CARD_H, GAP, PAD, STRIP } from './generate-shelf';
import { ShelfBand } from '../ShelfBand';

/** Restored-map card scale relative to a generation candidate. */
const CARD_SCALE = 1.5;
const CARD_H_BIG = CARD_H * CARD_SCALE;
/** The width follows from the height, since the shape is the drawing's. */
const CARD_W_BIG = (CARD_H_BIG * CARD.w) / CARD.h;

/** Aligns the restore card with the generation candidates' foot line, in CSS pixels. */
const CARD_FOOT = PAD.bottom + STRIP.h + STRIP.gap;

/** Gap between the picture and copy, in CSS pixels. */
const COLUMN_GAP = GAP.strip;

/** Restore-action pill dimensions derived from the shelf's text controls. */
const ANSWER = { h: SHELF_TABS.field, padX: SHELF_TABS.padX, gap: GAP.sliderPart } as const;

/** Maximum body-copy measure in ems. */
const BODY_MEASURE = 30;

/** Thumbnail long edge in device pixels, with enough resolution for high-density screens. */
const SHOT_PX = 1024;

/** Motion amplitudes are owned by the shared choreography registry. */
const CARD_RISE = MOTIONS['restore.card.arrive'].amplitude;
const WORDS_RISE = MOTIONS['restore.words.arrive'].amplitude;
const LEAVE_DROP = MOTIONS['restore.offer.leave'].amplitude;

/** Visible decision time before the saved session restores automatically, in seconds. */
const RESTORE_AFTER_S = 12;

interface RestoreShelfProps {
  /** The saved map, for its photograph. */
  state: GridState;
  /** Whether the boot splash covers the offer and pauses its countdown. */
  splashActive?: boolean;
  onRestore: () => void;
  onDismiss: () => void;
}

export function RestoreShelf(props: RestoreShelfProps) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <RestoreShelfBody {...props} />
    </ScaleProvider>
  );
}

function RestoreShelfBody({ state, splashActive = false, onRestore, onDismiss }: RestoreShelfProps) {
  const t = useT();
  const present = useIsPresent();
  const [shot, setShot] = useState<string | null | undefined>(undefined);
  /** Pauses the card's countdown while either sibling action is hovered or focused. */
  const [overAnswer, setOverAnswer] = useState(false);
  const arriving = useMotionAllowed('restore.offer.arrive');
  const plinth = useBeat('restore.offer', 'plinth');
  const cardBeat = useBeat('restore.offer', 'card');
  const wordsBeat = useBeat('restore.offer', 'words');
  const answersBeat = useBeat('restore.offer', 'answers');
  const leaving = useTransition('restore.offer.leave');

  useEffect(() => {
    let dropped = false;
    void (async () => {
      // Render at the inner picture rect's aspect so CardFace can fill it without letterboxing.
      const png = await renderThumbnail(state, SHOT_PX, { aspect: CARD.pic.w / CARD.pic.h });
      if (!dropped) setShot(png);
    })();
    return () => { dropped = true; };
  }, [state]);

  return (
    <motion.div
      {...helpTargetAttr('save')}
      {...mapEdgeAttr('bottom')}
      initial={arriving ? { opacity: 0 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={arriving ? { opacity: 0, y: LEAVE_DROP, transition: leaving } : { opacity: 0, transition: leaving }}
      transition={plinth}
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: z.panel }}
    >
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <ShelfBand />

        {/* Flow layout lets the offer establish the band's height from the shared card foot line. */}
        <div
          style={{
            position: 'relative', width: '100%', boxSizing: 'border-box',
            paddingLeft: PAD.side, paddingRight: PAD.right, paddingBottom: CARD_FOOT,
            display: 'flex', alignItems: 'flex-end', gap: COLUMN_GAP,
          }}
        >
          <motion.div
            initial={arriving ? { opacity: 0, y: CARD_RISE } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={cardBeat}
            // Flex layout avoids inline descender space below the card.
            style={{ display: 'flex', flex: '0 0 auto' }}
          >
            <TimedButton
              after={RESTORE_AFTER_S}
              hint={timedHint(t, RESTORE_AFTER_S)}
              paused={!present || overAnswer || splashActive}
              onPress={onRestore}
              ring={ACTIVE}
              clock="stadium"
              // The accessible name includes the offer because aria-label replaces descendant text.
              aria-label={t('restore.aria', { title: t('restore.title'), body: t('restore.body'), resume: t('restore.resume') })}
              data-testid="restore-card"
              style={{
                ...btnReset, width: CARD_W_BIG, height: CARD_H_BIG,
                pointerEvents: 'auto', cursor: cursors.clickable, padding: 0,
              }}
            >
              <CardFace shot={shot} waited />
            </TimedButton>
          </motion.div>

          {/* Copy and actions share one reading-order column beside the picture. */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: GAP.row, minHeight: CARD_H_BIG,
            }}
          >
            <motion.div
              initial={arriving ? { opacity: 0, y: WORDS_RISE } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={wordsBeat}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: SHELF_TABS.underlineGap,
              }}
            >
              <BarText size={TEXT.shelfTab} onMap align="left" weight={900}>
                {t('restore.title')}
              </BarText>
              {/* Sentence copy opts out of BarText's single-line control-label default. */}
              <BarText
                size={TEXT.head}
                onMap
                align="left"
                style={{ whiteSpace: 'normal', maxWidth: TEXT.head * BODY_MEASURE }}
              >
                {t('restore.body')}
              </BarText>
            </motion.div>

            <motion.div
              initial={arriving ? { opacity: 0, y: WORDS_RISE } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={answersBeat}
              onPointerEnter={() => setOverAnswer(true)}
              onPointerLeave={() => setOverAnswer(false)}
              // React's bubbling focus events let either keyboard-focused action pause the countdown.
              onFocus={() => setOverAnswer(true)}
              onBlur={() => setOverAnswer(false)}
              style={{ display: 'flex', gap: ANSWER.gap, pointerEvents: 'auto' }}
            >
              {/* The visible resume pill duplicates the fully labelled card and is removed from keyboard and a11y order. */}
              <ActionButton
                interaction="action"
                aria-hidden
                tabIndex={-1}
                data-testid="restore-resume"
                onClick={onRestore}
                style={{
                  ...btnReset, cursor: cursors.clickable, borderRadius: radii.pill,
                  height: ANSWER.h, padding: `0 ${ANSWER.padX}px`, background: ACTIVE,
                }}
              >
                <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.resume')}</BarText>
              </ActionButton>
              <ActionButton
                interaction="action"
                data-testid="restore-fresh"
                onClick={onDismiss}
                style={{
                  ...btnReset, cursor: cursors.clickable, borderRadius: radii.pill,
                  height: ANSWER.h, padding: `0 ${ANSWER.padX}px`, background: PLATE,
                }}
              >
                <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.fresh')}</BarText>
              </ActionButton>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
