/**
 * SketchCard — options drafted off the map (spec §UI.2). Kicker in the
 * provider accent, option rows with glyph tile + name + descriptive trait sub
 * (never scores), a hint line while undecided. Picking decides the card:
 * the picked row gets a green border + check, the others fade to 38% and
 * stop taking clicks.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import type { SketchesEntry } from '../../../agent/session';
import { useT } from '../../../i18n/context';
import { colors as C, inkTint, font, cursors } from '../../design/styles';
import { usePx } from '../../design/scale';
import { CARD_LINE, CheckIcon, EntryShell, OK_GREEN, VerbGlyph } from '../atoms';

export function SketchCard({
  entry,
  accent,
  onPick,
}: {
  entry: SketchesEntry;
  accent: string;
  onPick: (id: number, i: number) => void;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const decided = entry.picked != null;

  return (
    <EntryShell undone={entry.undone} testId="sketches">
      <div
        style={{
          background: C.white,
          border: `${px(2)}px solid ${CARD_LINE}`,
          borderRadius: px(32),
          padding: `${px(22)}px ${px(24)}px`,
          boxShadow: `0 ${px(6)}px ${px(16)}px ${inkTint(0.06)}`,
          display: 'flex',
          flexDirection: 'column',
          gap: px(16),
        }}
      >
        <span
          style={{
            fontSize: pxf(20),
            fontWeight: fw(800),
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: accent,
            fontFamily: font.family,
          }}
        >
          {t('agent2.sketches_kicker')}
        </span>
        {entry.opts.map((o, i) => {
          const picked = entry.picked === i;
          const faded = decided && !picked;
          return (
            <motion.button
              key={i}
              data-testid="sketch-opt"
              data-picked={picked ? 'true' : 'false'}
              whileHover={decided || reduced ? undefined : { y: px(-2) }}
              onClick={() => onPick(entry.id, i)}
              disabled={decided}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: px(20),
                background: picked ? '#F0F7E8' : C.surfaceSecondary,
                border: `${px(4)}px solid ${picked ? OK_GREEN : 'transparent'}`,
                borderRadius: px(26),
                padding: `${px(16)}px ${px(20)}px`,
                cursor: decided ? cursors.blocked : cursors.clickable,
                fontFamily: font.family,
                textAlign: 'left',
                width: '100%',
                appearance: 'none',
                opacity: faded ? 0.38 : 1,
                pointerEvents: decided ? 'none' : 'auto',
              }}
            >
              <span
                style={{
                  width: px(60),
                  height: px(60),
                  borderRadius: px(18),
                  background: o.tile,
                  display: 'grid',
                  placeItems: 'center',
                  color: C.inkText,
                  flex: '0 0 auto',
                }}
              >
                <VerbGlyph icon={o.icon} size={px(34)} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: pxf(28), fontWeight: fw(800), color: C.inkText }}>{o.name}</b>
                <span style={{ fontSize: pxf(23), fontWeight: fw(700), color: C.textSecondary }}>{o.sub}</span>
              </span>
              <span
                data-testid="sketch-check"
                style={{
                  width: px(40),
                  height: px(40),
                  borderRadius: '50%',
                  background: OK_GREEN,
                  color: C.white,
                  display: picked ? 'grid' : 'none',
                  placeItems: 'center',
                  flex: '0 0 auto',
                }}
              >
                <CheckIcon size={px(24)} />
              </span>
            </motion.button>
          );
        })}
        {!decided && (
          <p style={{ margin: 0, fontSize: pxf(23), fontWeight: fw(700), color: C.textSecondary, fontFamily: font.family }}>
            {t('agent2.sketches_hint')}
          </p>
        )}
      </div>
    </EntryShell>
  );
}
