/**
 * AgentNote — the agent's plain, avatar-free note (spec §UI.2). A busy note
 * carries the pulsing grey ring with a verb glyph; a survey note grows
 * findings chips (field-bg pills with a green glyph) that pop in staggered
 * 80ms apart.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import type { NoteEntry } from '../../../../agent/session';
import { colors as C, font, springs } from '../../../styles';
import { usePx } from '../../scale';
import { EntryShell, RUN_GREY, VerbGlyph, VITAL_GREEN, pulseProps } from '../atoms';
import { Markdown } from '../Markdown';

export function AgentNote({ entry }: { entry: NoteEntry }) {
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  return (
    <EntryShell undone={entry.undone} testId="note" style={{ alignSelf: 'flex-start', maxWidth: '92%' }}>
      <div style={{ display: 'flex', gap: px(18), padding: `${px(2)}px ${px(8)}px` }}>
        {entry.busy && (
          <motion.span
            data-testid="pulsering"
            {...pulseProps(!reduced)}
            style={{
              width: px(44),
              height: px(44),
              borderRadius: '50%',
              background: RUN_GREY,
              display: 'grid',
              placeItems: 'center',
              color: C.white,
              flex: '0 0 auto',
              marginTop: px(2),
            }}
          >
            <VerbGlyph icon={entry.icon ?? 'eval'} size={px(24)} />
          </motion.span>
        )}
        <div style={{ minWidth: 0 }}>
          {/* a div, not <p>: Markdown emits block elements (divs), which HTML
              forbids inside a paragraph (hydration/DOM-nesting warning) */}
          <div
            style={{
              margin: 0,
              fontSize: pxf(29),
              fontWeight: fw(700),
              color: entry.busy ? C.textSecondary : C.inkText,
              lineHeight: 1.45,
              fontFamily: font.family,
            }}
          >
            {entry.busy ? entry.text : <Markdown text={entry.text} />}
          </div>
          {entry.findings && entry.findings.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: px(12), marginTop: px(14) }}>
              {entry.findings.map((f, i) => (
                <motion.span
                  key={i}
                  data-testid="finding"
                  initial={reduced ? false : { opacity: 0, y: px(10), scale: 0.96 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: { ...springs.bouncy, delay: reduced ? 0 : i * 0.08 },
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: px(12),
                    fontSize: pxf(24),
                    fontWeight: fw(700),
                    color: C.inkText,
                    background: C.surfaceSecondary,
                    borderRadius: 999,
                    padding: `${px(10)}px ${px(20)}px ${px(10)}px ${px(16)}px`,
                    whiteSpace: 'nowrap',
                    fontFamily: font.family,
                  }}
                >
                  <span style={{ color: VITAL_GREEN, display: 'flex' }}>
                    <VerbGlyph icon={f.icon} size={px(28)} />
                  </span>
                  {f.t}
                </motion.span>
              ))}
            </div>
          )}
        </div>
      </div>
    </EntryShell>
  );
}
