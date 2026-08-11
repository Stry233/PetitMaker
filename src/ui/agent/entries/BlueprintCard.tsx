/**
 * BlueprintCard — the big-job card (spec §UI.2). Kicker BLUEPRINT (provider
 * accent) + draft/paused state chip + right-aligned ellipsized goal; NO
 * progress meter (the dock owns progress). Stage rows carry checkbox boxes
 * (done green ✓ / current = accent ring with a pulsing dot / pending hollow),
 * a ↩ rewind affordance on done
 * stages of a finished/paused card, one-line notes under done stages, and the
 * current stage's curtail (helpers / tick rail / amber revertnote / grey
 * now-line). Draft gate = "Looks right, go" / "Not now" + hint; paused gate =
 * Resume / Abandon-and-undo. Done = a stroke-drawing check watermark + recap
 * ("Finished in ⟨wavy⟩N steps⟨/wavy⟩", rewind note, ↩ Undo all).
 */
import { useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { BlueprintEntry } from '../../../agent/session';
import { useT } from '../../../i18n/context';
import { colors as C, inkTint, font, springs, cursors } from '../../design/styles';
import { usePx } from '../../design/scale';
import {
  CARD_LINE,
  CaretDownIcon,
  CheckIcon,
  EntryShell,
  FIELD_DEEP,
  GBtn,
  OK_GREEN,
  Rail,
  REVERT_TEXT,
  SummaryFold,
  UndoChip,
  pulseProps } from '../atoms';
import { Wavy } from '../../primitives/Wavy';
import { HelpersBlock } from './HelpersBlock';
import { Markdown } from '../Markdown';

export interface BlueprintCardProps {
  entry: BlueprintEntry;
  accent: string;
  /** Newest live entry: its summary starts expanded; older cards fold it. */
  latest?: boolean;
  onGate: (id: number, go: boolean) => void;
  onResume: (id: number) => void;
  onRewind: (id: number, i: number) => void;
  onUndo: (id: number) => void;
  onToggleSummary?: (id: number) => void;
}

/** The model's narration while a stage was active: a compact "notes" toggle
 *  under the stage, COLLAPSED by default (it is context, not the headline). */
function StageNarration({ text }: { text: string }) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const [open, setOpen] = useState(false);
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div style={{ flexBasis: '100%', paddingLeft: px(62), marginTop: px(2) }}>
      <button
        type="button"
        data-testid="stage-prose-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: px(8),
          border: 'none', appearance: 'none', background: 'transparent', padding: 0,
          cursor: cursors.clickable, fontFamily: font.family, fontWeight: fw(800),
          fontSize: pxf(20), color: C.textSecondary,
        }}
      >
        <span style={{ display: 'flex', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}>
          <CaretDownIcon size={px(22)} color={C.textSecondary} />
        </span>
        {t('agent2.stage_notes')}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            data-testid="stage-prose-body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeInOut' } }}
            transition={springs.gentle}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingTop: px(6), fontSize: pxf(23), fontWeight: fw(700), color: C.textSecondary, lineHeight: 1.45, fontFamily: font.family }}>
              <Markdown text={trimmed} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function BlueprintCard({ entry, accent, latest, onGate, onResume, onRewind, onUndo, onToggleSummary }: BlueprintCardProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();

  const gateRow: CSSProperties = {
    display: 'flex',
    gap: px(16),
    flexWrap: 'wrap',
    paddingTop: px(20),
    borderTop: `${px(2)}px solid ${CARD_LINE}`,
  };

  // "Finished in {n} steps" with the count-and-tail under the wavy underline.
  // Interpolate a sentinel for {n}: the prefix stays plain, everything from
  // the count to the end of the sentence gets the wave, in every locale.
  const SENT = '\u0000';
  const finished = t('agent2.finished_in', { n: SENT });
  const cut = finished.indexOf(SENT);
  const finishedPrefix = cut >= 0 ? finished.slice(0, cut) : '';
  const finishedWavy = cut >= 0 ? `${entry.steps}${finished.slice(cut + 1)}` : finished;

  return (
    <EntryShell undone={entry.undone} testId="bp">
      <div
        style={{
          background: C.white,
          border: `${px(2)}px solid ${CARD_LINE}`,
          borderRadius: px(36),
          padding: `${px(26)}px ${px(26)}px ${px(24)}px`,
          boxShadow: `0 ${px(8)}px ${px(24)}px ${inkTint(0.07)}`,
          display: 'flex',
          flexDirection: 'column',
          gap: px(22),
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* top: kicker + state chip | goal */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: px(20) }}>
          <span
            style={{
              fontSize: pxf(22),
              fontWeight: fw(800),
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: accent,
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: px(14),
              fontFamily: font.family,
            }}
          >
            {t('agent2.blueprint')}
            {!entry.done && entry.draft && (
              <span data-testid="bp-state" style={stateChip(px, pxf, fw, C.surfaceSecondary, C.textSecondary)}>
                {t('agent2.draft')}
              </span>
            )}
            {!entry.done && !entry.draft && entry.paused && (
              <span data-testid="bp-state" style={stateChip(px, pxf, fw, '#F6E9C8', REVERT_TEXT)}>
                {t('agent2.paused')}
              </span>
            )}
          </span>
          <span
            style={{
              fontSize: pxf(27),
              fontWeight: fw(800),
              color: C.inkText,
              textAlign: 'right',
              maxWidth: '56%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: font.family,
            }}
          >
            {entry.goal}
          </span>
        </div>

        {/* stages */}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: px(18) }}>
          {entry.stages.map((label, i) => {
            let cls: 'pending' | 'done' | 'current' = 'pending';
            if (!entry.draft && i < entry.doneCount) cls = 'done';
            else if (!entry.draft && i === entry.currentIdx && !entry.paused) cls = 'current';
            const showCurtail =
              cls === 'current' && Boolean(entry.rail || entry.now || entry.revertnote || entry.helpers?.length);
            const note = cls === 'done' ? entry.notes[i] : undefined;
            return (
              <motion.li
                key={`${i}-${label}`}
                data-testid="stage"
                data-state={cls}
                initial={reduced ? false : { opacity: 0, x: px(-12) }}
                animate={{ opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut', delay: reduced ? 0 : i * 0.07 } }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: px(20), flexWrap: 'wrap' }}
              >
                {/* box */}
                {cls === 'done' ? (
                  <span
                    style={{
                      width: px(42),
                      height: px(42),
                      borderRadius: px(14),
                      background: OK_GREEN,
                      color: C.white,
                      display: 'grid',
                      placeItems: 'center',
                      flex: '0 0 auto',
                    }}
                  >
                    <CheckIcon size={px(26)} />
                  </span>
                ) : cls === 'current' ? (
                  <span
                    style={{
                      width: px(42),
                      height: px(42),
                      borderRadius: px(14),
                      border: `${px(4)}px solid ${accent}`,
                      display: 'grid',
                      placeItems: 'center',
                      flex: '0 0 auto',
                      boxSizing: 'border-box',
                    }}
                  >
                    <motion.span
                      data-testid="stage-dot"
                      {...pulseProps(!reduced)}
                      style={{ width: px(16), height: px(16), borderRadius: '50%', background: accent, display: 'block' }}
                    />
                  </span>
                ) : (
                  <span
                    style={{
                      width: px(42),
                      height: px(42),
                      borderRadius: px(14),
                      border: `${px(4)}px solid ${FIELD_DEEP}`,
                      background: 'transparent',
                      flex: '0 0 auto',
                      boxSizing: 'border-box',
                    }}
                  />
                )}

                {/* label */}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    paddingTop: px(4),
                    fontSize: pxf(28),
                    fontWeight: cls === 'pending' ? fw(700) : fw(800),
                    color: cls === 'pending' ? C.textSecondary : C.inkText,
                    fontFamily: font.family,
                  }}
                >
                  {label}
                </span>

                {/* right affordance */}
                {cls === 'done' && (entry.done || entry.paused) && (
                  <button
                    data-testid="stage-rewind"
                    aria-label={t('agent2.a11y_rewind')}
                    onClick={() => onRewind(entry.id, i)}
                    style={{
                      border: 'none',
                      appearance: 'none',
                      background: C.surfaceSecondary,
                      color: C.textSecondary,
                      cursor: cursors.clickable,
                      padding: `${px(6)}px ${px(16)}px`,
                      fontSize: pxf(22),
                      fontWeight: fw(800),
                      borderRadius: px(16),
                      flex: '0 0 auto',
                      fontFamily: font.family,
                    }}
                  >
                    ↩
                  </button>
                )}

                {/* under the current stage: helpers / rail / revertnote / now */}
                {showCurtail && (
                  <div
                    data-testid="curtail"
                    style={{ flexBasis: '100%', paddingLeft: px(62), display: 'flex', flexDirection: 'column', gap: px(14) }}
                  >
                    {entry.helpers && entry.helpers.length > 0 && <HelpersBlock helpers={entry.helpers} />}
                    {entry.rail && <Rail rail={entry.rail} live={!entry.done && !entry.paused} />}
                    {entry.revertnote && (
                      <p style={{ margin: 0, fontSize: pxf(25), fontWeight: fw(700), color: REVERT_TEXT, fontFamily: font.family }}>
                        {entry.revertnote}
                      </p>
                    )}
                    {entry.now && (
                      <p style={{ margin: 0, fontSize: pxf(25), fontWeight: fw(700), color: C.textSecondary, fontFamily: font.family }}>
                        {entry.now}
                      </p>
                    )}
                  </div>
                )}
                {note && (
                  <div
                    data-testid="stage-note"
                    style={{
                      flexBasis: '100%',
                      paddingLeft: px(62),
                      margin: `${px(-6)}px 0 0`,
                      fontSize: pxf(24),
                      fontWeight: fw(700),
                      color: C.textSecondary,
                      fontFamily: font.family,
                    }}
                  >
                    {note}
                  </div>
                )}
                {entry.stageProse?.[i] && <StageNarration text={entry.stageProse[i]!} />}
              </motion.li>
            );
          })}
        </ul>

        {/* draft gate */}
        {entry.draft && (
          <div data-testid="draft-gate" style={gateRow}>
            <GBtn label={t('agent2.looks_right')} kind="yes" onClick={() => onGate(entry.id, true)} />
            <GBtn label={t('agent2.not_now')} kind="no" delay={0.05} onClick={() => onGate(entry.id, false)} />
            <p
              style={{
                flexBasis: '100%',
                margin: 0,
                fontSize: pxf(22),
                fontWeight: fw(700),
                color: C.textSecondary,
                fontFamily: font.family,
              }}
            >
              {t('agent2.draft_hint')}
            </p>
          </div>
        )}

        {/* paused gate */}
        {entry.paused && !entry.done && (
          <div data-testid="paused-gate" style={gateRow}>
            <GBtn label={t('agent2.resume')} kind="yes" onClick={() => onResume(entry.id)} />
            <GBtn label={t('agent2.abandon')} kind="no" delay={0.05} onClick={() => onUndo(entry.id)} />
          </div>
        )}

        {/* done: watermark + recap */}
        {entry.done && (
          <>
            <svg
              className="pw-drawcheck"
              data-testid="bp-watermark"
              viewBox="0 0 24 24"
              fill="none"
              stroke={OK_GREEN}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: 'absolute',
                right: px(12),
                bottom: px(4),
                width: px(208),
                height: px(208),
                opacity: 0.12,
                pointerEvents: 'none',
              }}
            >
              <path d="M4 13l5 5L20 7" />
            </svg>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: px(20),
                paddingTop: px(20),
                borderTop: `${px(2)}px solid ${CARD_LINE}`,
              }}
            >
              <span
                style={{
                  width: px(48),
                  height: px(48),
                  borderRadius: '50%',
                  background: OK_GREEN,
                  color: C.white,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: fw(900),
                  flex: '0 0 auto',
                  fontSize: pxf(28),
                  fontFamily: font.family,
                }}
              >
                ✓
              </span>
              <div style={{ fontSize: pxf(27), fontWeight: fw(800), color: C.inkText, fontFamily: font.family, flex: 1, minWidth: 0 }}>
                {finishedPrefix}
                <Wavy dimmed={entry.undone}>{finishedWavy}</Wavy>
                <small style={{ display: 'block', fontWeight: fw(700), color: C.textSecondary, fontSize: pxf(22) }}>
                  {t('agent2.rewind_note')}
                </small>
              </div>
              {!entry.undone && <UndoChip label={t('agent2.undo_all')} onClick={() => onUndo(entry.id)} />}
            </div>
          </>
        )}
        {entry.summary && (
          <SummaryFold
            text={entry.summary}
            open={entry.summaryOpen ?? !!latest}
            onToggle={() => onToggleSummary?.(entry.id)}
          />
        )}
      </div>
    </EntryShell>
  );
}

function stateChip(
  px: (n: number) => number,
  pxf: (n: number) => number,
  fw: (w: number) => number,
  bg: string,
  color: string,
): CSSProperties {
  return {
    fontSize: pxf(19),
    fontWeight: fw(800),
    letterSpacing: '.06em',
    background: bg,
    color,
    borderRadius: 999,
    padding: `${px(4)}px ${px(16)}px`,
    // text-transform:uppercase inherits from the kicker, as in the prototype
  };
}
