/*
 * Offers the last saved session from the generation shelf. The card restores immediately; the visible
 * countdown (under the card on the wide shelf, round the resume pill upright, where the picture spans
 * the panel) pauses while covered, leaving or focused through either action. Upright the offer never
 * scrolls: its picture is the part that yields to the bar's room, down to a generation candidate's
 * height, and what still stands taller covers the column (`useBarSurface`'s `overColumn`).
 */
import { ActionButton } from '../../../primitives/ActionButton';
import { mapEdgeAttr } from '../../../primitives/map-edge';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { renderThumbnail } from '../../../../view/map2d/capture/thumbnail';
import { useT } from '../../../../i18n/context';
import { timedHint } from '../../../chrome/timed-hint';
import type { GridState } from '../../../../core/model/types';
import { helpTargetAttr } from '../../../session/help-targets';
import { TimedButton } from '../../../primitives/TimedButton';
import { TouchReach } from '../../../primitives/TouchReach';
import { useFrameZoom } from '../../use-frame-zoom';
import { ScaleProvider } from '../../../design/scale';
import { btnReset, cursors, radii } from '../../../design/styles';
import { ACTIVE, ON_DARK, PLATE, PLATE_INK, rgbaOf } from '../../../design/tokens';
import { EDGE, SHELF_SCALE, SHELF_TABS, TEXT, UPRIGHT_SPACE } from '../../units';
import { MOTIONS } from '../../../design/motion/registry';
import { useBeat, useTransition, useMotionAllowed } from '../../../design/motion/use-motion';
import { BarText } from '../bar-atoms';
import { CardFace } from './CandidateCard';
import { CARD, GAP, PAD, STRIP, cardHeight } from './generate-shelf';
import { useFrameLayout } from '../../frame-layout';
import { PanelTone, UPRIGHT_FOOT, useBarSurface } from '../bar-panel';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { LANDSCAPE_BAR } from '../../frame-plan';

/** The rule over the mode tiles closing the upright offer, on the dark plate. */
const DIVIDER = rgbaOf(ON_DARK, 0.12);

/** Restored-map card scale relative to a generation candidate. */
const CARD_SCALE = 1.5;

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

/** Steps per unit of the upright picture's aspect that retake its photograph. */
const ASPECT_STEPS = 10;

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
  /** Pauses the countdown while an answer is hovered or focused, or upright the picture is hovered. */
  const [overAnswer, setOverAnswer] = useState(false);
  const arriving = useMotionAllowed('restore.offer.arrive');
  const plinth = useBeat('restore.offer', 'plinth');
  const cardBeat = useBeat('restore.offer', 'card');
  const wordsBeat = useBeat('restore.offer', 'words');
  const answersBeat = useBeat('restore.offer', 'answers');
  const leaving = useTransition('restore.offer.leave');
  const layout = useFrameLayout();
  const zoom = useFrameZoom();
  const edgeLeft = layout?.edgeLeft ?? EDGE;
  const edgeRight = layout?.edgeRight ?? EDGE;
  /** A generation candidate's height, the least the upright picture yields to. */
  const candidateH = cardHeight((layout?.bar ?? LANDSCAPE_BAR).tabsTop);
  const column = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  /** Upright, the offer's height besides its picture, padding included, in frame px; null until measured. */
  const [rest, setRest] = useState<number | null>(null);
  // Upright, the offer is the dark panel the bar raises: it draws no band and stacks its parts on the
  // bar's spacing scale, the divider over the mode tiles closing its foot. It claims all it holds with
  // the picture at its least, and covers the column rather than scrolling where that passes the room.
  const { upright, bar, root, reveal, band, content } = useBarSurface('dark', {
    top: UPRIGHT_SPACE.pad, foot: UPRIGHT_FOOT, overColumn: true,
    ...(rest === null ? {} : { least: rest + candidateH }),
  });
  useObservedSize(
    () => (upright ? column.current : null),
    ([box]) => { if (box && picture.current) setRest(UPRIGHT_SPACE.pad + UPRIGHT_FOOT + box.offsetHeight - picture.current.offsetHeight); },
    [upright],
  );
  const fullH = candidateH * CARD_SCALE;
  // Upright, the picture takes what the room leaves the rest of the offer, up to its full height.
  const cardH = upright && rest !== null && bar.room !== undefined
    ? Math.max(candidateH, Math.min(fullH, bar.room - rest))
    : fullH;
  const bare = upright && layout !== null;
  // Upright, the picture alone spans the panel's width at the shelf card's height.
  const cardW = bare ? layout.width - edgeLeft - edgeRight : (cardH * CARD.w) / CARD.h;
  // Rounded so a resize only retakes the photograph once its shape visibly changes.
  const aspect = bare ? Math.round((cardW / cardH) * ASPECT_STEPS) / ASPECT_STEPS : CARD.pic.w / CARD.pic.h;

  useEffect(() => {
    let dropped = false;
    void (async () => {
      // Rendered at the picture's own aspect so it fills its box without letterboxing.
      const png = await renderThumbnail(state, SHOT_PX, { aspect });
      if (!dropped) setShot(png);
    })();
    return () => { dropped = true; };
  }, [state, aspect]);

  // The accessible name includes the offer because aria-label replaces descendant text.
  const offerName = t('restore.aria', { title: t('restore.title'), body: t('restore.body'), resume: t('restore.resume') });
  /** The countdown that resumes on its own: the card's stadium on the wide shelf, the resume pill's
   *  ring upright, where the picture stands alone. */
  const clock = {
    after: RESTORE_AFTER_S,
    hint: timedHint(t, RESTORE_AFTER_S),
    paused: !present || overAnswer || splashActive,
    onPress: onRestore,
    ring: ACTIVE,
    'aria-label': offerName,
  };
  const cardStyle: CSSProperties = { ...btnReset, position: 'relative', width: cardW, height: cardH, pointerEvents: 'auto', cursor: cursors.clickable, padding: 0 };
  // Upright, the two answers share the row's width.
  const answerFill = upright ? { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {};
  const resumeStyle: CSSProperties = {
    ...btnReset, position: 'relative', cursor: cursors.clickable, borderRadius: radii.pill,
    height: ANSWER.h, padding: `0 ${ANSWER.padX}px`, background: ACTIVE,
  };
  const cardPart = (
    <motion.div
      ref={picture}
      initial={arriving ? { opacity: 0, y: CARD_RISE } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={cardBeat}
      // Flex layout avoids inline descender space below the card.
      style={{ display: 'flex', flex: '0 0 auto' }}
    >
      {bare ? (
        // The picture duplicates the fully labelled resume pill and is removed from keyboard and a11y order.
        <ActionButton
          interaction="action" aria-hidden tabIndex={-1} data-testid="restore-card" onClick={onRestore} style={cardStyle}
          onPointerEnter={() => setOverAnswer(true)} onPointerLeave={() => setOverAnswer(false)}
        >
          <CardFace shot={shot} waited bare />
        </ActionButton>
      ) : (
        <TimedButton {...clock} clock="stadium" data-testid="restore-card" style={cardStyle}>
          <CardFace shot={shot} waited />
        </TimedButton>
      )}
    </motion.div>
  );
  const wordsPart = (
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
        style={{ whiteSpace: 'normal', maxWidth: upright ? undefined : TEXT.head * BODY_MEASURE }}
      >
        {t('restore.body')}
      </BarText>
    </motion.div>
  );
  const answersPart = (
    <motion.div
      initial={arriving ? { opacity: 0, y: WORDS_RISE } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={answersBeat}
      onPointerEnter={() => setOverAnswer(true)}
      onPointerLeave={() => setOverAnswer(false)}
      // React's bubbling focus events let either keyboard-focused action pause the countdown.
      onFocus={() => setOverAnswer(true)}
      onBlur={() => setOverAnswer(false)}
      style={{ display: 'flex', gap: ANSWER.gap, pointerEvents: 'auto', ...(upright ? { alignSelf: 'stretch' } : {}) }}
    >
      {bare ? (
        <TimedButton {...clock} clock="ring" data-testid="restore-resume" style={{ ...resumeStyle, ...answerFill }}>
          <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.resume')}</BarText>
          <TouchReach zoom={zoom} />
        </TimedButton>
      ) : (
        // The visible resume pill duplicates the fully labelled card and is removed from keyboard and a11y order.
        <ActionButton interaction="action" aria-hidden tabIndex={-1} data-testid="restore-resume" onClick={onRestore} style={{ ...resumeStyle, ...answerFill }}>
          <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.resume')}</BarText>
          <TouchReach zoom={zoom} />
        </ActionButton>
      )}
      <ActionButton
        interaction="action"
        data-testid="restore-fresh"
        onClick={onDismiss}
        style={{
          ...btnReset, position: 'relative', cursor: cursors.clickable, borderRadius: radii.pill,
          height: ANSWER.h, padding: `0 ${ANSWER.padX}px`, background: PLATE, ...answerFill,
        }}
      >
        <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.fresh')}</BarText>
        <TouchReach zoom={zoom} />
      </ActionButton>
    </motion.div>
  );

  if (upright && layout) {
    return (
      <motion.div
        {...helpTargetAttr('save')}
        {...mapEdgeAttr('bottom')}
        {...root}
        // It rises with the band alone (the column's reveal), and fades as the band lets it go.
        exit={{ opacity: 0, transition: leaving }}
      >
        <PanelTone tone="dark">
          <motion.div ref={column} {...reveal} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: UPRIGHT_SPACE.row }}>
            {cardPart}
            {wordsPart}
            {answersPart}
            <div aria-hidden style={{ alignSelf: 'stretch', height: 1, background: DIVIDER }} />
          </motion.div>
        </PanelTone>
      </motion.div>
    );
  }

  return (
    <motion.div
      {...helpTargetAttr('save')}
      {...mapEdgeAttr('bottom')}
      initial={arriving ? { opacity: 0 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={arriving ? { opacity: 0, y: LEAVE_DROP, transition: leaving } : { opacity: 0, transition: leaving }}
      transition={plinth}
      {...root}
    >
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {band}

        {/* Flow layout lets the offer establish the band's height from the shared card foot line. */}
        <div
          {...content.start}
          style={{
            position: 'relative', width: '100%', boxSizing: 'border-box',
            paddingLeft: PAD.side, paddingRight: PAD.right, paddingBottom: CARD_FOOT,
            display: 'flex', alignItems: 'flex-end', gap: COLUMN_GAP,
          }}
        >
          {cardPart}

          {/* Copy and actions share one reading-order column beside the picture. */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: GAP.row, minHeight: cardH,
            }}
          >
            {wordsPart}
            {answersPart}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
