/*
 * The assistant's status card: the face's glyph, word and meta deck, and the seat and gear column.
 * Its paper crossfades in place; the desk above it owns the keyed flip between faces.
 */
import type { CSSProperties, RefObject } from 'react';
import { motion } from 'framer-motion';
import type { Translate } from '../../../i18n/keys';
import { amplitude, cssMotion, framerMotion } from '../../design/motion';
import { font, radii } from '../../design/styles';
import { roleFont, roleWeight } from '../../design/text-weight';
import { DANGER_DEEP, INK } from '../../design/tokens';
import { windowPill } from '../../design/window-skin';
import { Pill } from '../../primitives/Pill';
import { TimedButton } from '../../primitives/TimedButton';
import { Icon } from '../parts/sprite';
import { splitOnToken, type DeskSeat, type Face } from '../derive/desk-face';
import type { RepairAct } from '../derive/repair';
import { IconButton } from '../parts/IconButton';
import { metaInk, recede, statePaper } from '../panel-skin';
import { timedHint } from '../../chrome/timed-hint';

/** Status-card height in pixels. */
export const STATUS_CARD_HEIGHT = 74;

const GLYPH_SLOT: CSSProperties = {
  width: 28, height: 28, flex: '0 0 auto', display: 'flex',
  alignItems: 'center', justifyContent: 'center', color: 'inherit', opacity: recede.near,
};

/** Out-of-flow beta tag at the card's top-left corner. */
const BETA_TAG: CSSProperties = {
  ...roleFont('small'),
  position: 'absolute', top: 6, left: 14,
  lineHeight: 1, letterSpacing: 0.5,
  color: 'inherit', opacity: recede.still,
  pointerEvents: 'none', userSelect: 'none',
};

/** The card's primary line. */
const WORD_STYLE: CSSProperties = {
  ...roleFont('menu'),
  fontFamily: font.family,
  color: 'inherit',
  lineHeight: 1.25,
  marginRight: 'auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Ellipsizing text fragment that preserves translated whitespace beside a separate value node. */
const CLIPPED: CSSProperties = {
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre',
};

const META_STYLE: CSSProperties = {
  ...roleFont('caption'),
  fontFamily: font.family,
  lineHeight: 1.25,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

/** Trailing datum keeps its width and ellipsizes only when it exceeds the entire word deck. */
const DATUM_STYLE: CSSProperties = {
  ...roleFont('caption'),
  fontFamily: font.family,
  color: metaInk.figure,
  flex: '0 0 auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginLeft: 6,
  fontVariantNumeric: 'tabular-nums',
};

/** Card actions use the shared inset window-pill treatment. */
const ACT_PILL: CSSProperties = { ...windowPill('quiet', false, 'inset'), boxShadow: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 };

/** Caps translated action copy within the card's word deck. */
const BOUND_PILL: CSSProperties = { ...ACT_PILL, maxWidth: '100%', minWidth: 0 };

/** How far a fresh countdown digit rises from, per its declaration. */
const DIGIT_RISE = amplitude('panel.retry.digit') ?? 0;

interface StatusCardProps {
  face: Face;
  seat: DeskSeat | null;
  seatRef: RefObject<HTMLButtonElement>;
  gear: boolean;
  allowAll: boolean;
  reduced: boolean;
  t: Translate;
  onSeat(act: 'pause' | 'stop' | 'resume'): void;
  onManage?: () => void;
  onRetryNow?: () => void;
  onCardAct?: (act: RepairAct) => void;
}

export function StatusCard({
  face, seat, seatRef, gear, allowAll, reduced, t,
  onSeat, onManage, onRetryNow, onCardAct,
}: StatusCardProps) {
  const ink = face.paper === 'danger' ? DANGER_DEEP : INK;
  const factInk = face.paper === 'danger' ? metaInk.danger : metaInk.fact;
  // Action faces reserve their second line for controls rather than metadata.
  const acting = face.kind !== 'plain';
  const solo = !acting && face.meta === undefined && !allowAll;

  return (
    <div
      data-testid="dock"
      data-paper={face.paper}
      data-face={face.kind}
      data-solo={String(solo)}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        height: STATUS_CARD_HEIGHT,
        boxSizing: 'border-box',
        borderRadius: radii.md,
        padding: '0 8px 0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflow: 'hidden',
        color: ink,
        background: statePaper[face.paper],
        // CSS owns the in-place paper crossfade and the global reduced-motion override.
        transition: cssMotion('panel.dock.paper', ['background-color'], reduced),
      }}
    >
      <span data-testid="dock-beta" aria-hidden="true" style={BETA_TAG}>{t('app.beta')}</span>

      <motion.span key={face.glyph} data-testid="dock-glyph" data-icon={face.glyph} style={GLYPH_SLOT}
        initial={reduced ? false : { opacity: 1 - amplitude('panel.status.update') }}
        animate={{ opacity: 1 }} transition={framerMotion('panel.status.update')}>
        <Icon id={face.glyph} size={20} />
      </motion.span>

      <div
        data-testid="dock-col-words"
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          // Border-box keeps vertical padding within the fixed card height.
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: acting ? 'flex-start' : 'center',
          paddingTop: acting ? 10 : 0,
        }}
      >
        <div data-testid="dock-deck-word" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <motion.span key={face.word} data-testid="dock-sentence" style={WORD_STYLE}
            initial={reduced ? false : { opacity: 1 - amplitude('panel.status.update') }}
            animate={{ opacity: 1 }} transition={framerMotion('panel.status.update')}>
            {face.word}
          </motion.span>
          {face.datum !== undefined && (
            <span data-testid="dock-datum" style={DATUM_STYLE}>{face.datum}</span>
          )}
          {/* On a solo face the clock steps up beside the word, where the meta line would have been. */}
          {solo && face.clock !== undefined && <Elapsed text={face.clock} />}
        </div>

        {!solo && (
          <div
            data-testid="dock-deck-meta"
            style={{
              display: 'flex', alignItems: 'center', minWidth: 0,
              marginTop: acting ? 7 : 2,
              color: factInk, ...META_STYLE,
            }}
          >
            {face.kind === 'retry' && face.retry && (
              <RetryPill retry={face.retry} t={t} reduced={reduced} {...(onRetryNow ? { onRetryNow } : {})} />
            )}
            {face.kind === 'act' && face.act && (
              <Pill
                variant="quiet"
                on="inset"
                data-testid="dock-act"
                onClick={() => onCardAct?.(face.act!.id)}
              >
                {face.act.label}
              </Pill>
            )}
            {face.kind === 'plain' && (
              <>
                {/* The stall time keeps its own fixed-width leaf while translated fragments ellipsize around it. */}
                {face.stall ? (
                  <span
                    data-testid="dock-meta"
                    style={{ display: 'flex', minWidth: 0, marginRight: 'auto' }}
                  >
                    <span style={CLIPPED}>{face.stall.prefix}</span>
                    <span data-testid="dock-stall-clock" style={{ flex: '0 0 auto' }}>
                      {face.stall.clock}
                    </span>
                    <span style={CLIPPED}>{face.stall.suffix}</span>
                  </span>
                ) : face.meta !== undefined && (
                  <span
                    data-testid="dock-meta"
                    style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', marginRight: 'auto' }}
                  >
                    {face.meta}
                  </span>
                )}
                {/* Session-wide oversight status shares the line and can ellipsize beside state metadata. */}
                {allowAll && (
                  <span
                    data-testid="dock-allow-mark"
                    style={{
                      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      marginLeft: face.meta !== undefined || face.stall !== undefined ? 6 : 0,
                      marginRight: 'auto', opacity: recede.aside,
                    }}
                  >
                    {t('agent.dock_asks_off')}
                  </span>
                )}
                {face.clock !== undefined && <Elapsed text={face.clock} />}
              </>
            )}
          </div>
        )}
      </div>

      <span
        data-testid="dock-col"
        style={{
          alignSelf: 'stretch', flex: '0 0 auto', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {seat ? (
          <IconButton
            ref={seatRef}
            testId="dock-seat"
            icon={seat.icon}
            label={t(seat.labelKey)}
            data-act={seat.act ?? undefined}
            disabled={seat.act === null}
            {...(seat.act ? { onClick: () => onSeat(seat.act!) } : {})}
          />
        ) : (
          <Ghost />
        )}
        {gear ? (
          <IconButton
            testId="dock-gear"
            icon="pw-settings"
            label={t('agent.dock_manage')}
            data-act="manage"
            door
            // Standalone mounts without a management callback render the gear disabled.
            disabled={onManage === undefined}
            {...(onManage ? { onClick: onManage } : {})}
          />
        ) : (
          <Ghost />
        )}
      </span>
    </div>
  );
}

/** Isolates the elapsed value so a tick replaces one text leaf. */
function Elapsed({ text }: { text: string }) {
  return (
    <span
      data-testid="dock-elapsed"
      style={{ ...roleFont('caption'), fontFamily: font.family, color: metaInk.figure, flex: '0 0 auto', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}
    >
      {text}
    </span>
  );
}

/** The seat that is empty, holding its own space so the column's other control never moves. */
function Ghost() {
  return <span aria-hidden style={{ width: 28, height: 28, flex: '0 0 auto', visibility: 'hidden' }} />;
}

/** Renders timed retry progress from the loop, or a plain action for connectivity-gated retry. */
function RetryPill(
  { retry, t, reduced, onRetryNow }:
  { retry: NonNullable<Face['retry']>; t: Translate; reduced: boolean; onRetryNow?: () => void },
) {
  if (!retry.timed) {
    return (
      <Pill variant="quiet" on="inset" data-testid="dock-retry-pill" onClick={() => onRetryNow?.()}>
        {t('agent.action_retry_now')}
      </Pill>
    );
  }
  const [prefix, suffix] = splitOnToken(t('agent.dock_retrying'), '{s}');
  // A spent retry ring is already fired and no longer accepts input.
  const fired = retry.spent >= 1;
  return (
    <TimedButton
      after={retry.secs}
      hint={timedHint(t, retry.secs)}
      // Bound the translated label within the deck; spanMs interpolates between one-second samples.
      external={{ fraction: retry.spent, spanMs: retry.spanMs }}
      onPress={() => { if (!fired) onRetryNow?.(); }}
      data-testid="dock-retry-pill"
      style={fired ? { ...BOUND_PILL, pointerEvents: 'none' } : BOUND_PILL}
    >
      {/* Static sentence fragments ellipsize around the fixed-width countdown value. */}
      <span style={{ display: 'flex', minWidth: 0 }}>
        <span style={CLIPPED}>{prefix}</span>
        <b style={{ fontWeight: roleWeight('chip'), fontVariantNumeric: 'tabular-nums', display: 'inline-block', flex: '0 0 auto' }}>
          {/* Keying by value mounts one clipped upward roll per countdown second. */}
          <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}>
            <motion.span
              key={retry.secs}
              data-testid="retry-seconds"
              style={{ display: 'inline-block' }}
              initial={reduced ? false : { y: DIGIT_RISE, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={framerMotion('panel.retry.digit')}
            >
              {retry.secs}
            </motion.span>
          </span>
        </b>
        <span style={CLIPPED}>{suffix}</span>
      </span>
    </TimedButton>
  );
}
