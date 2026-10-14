/*
 * The fixed-height pane under the booklet: a preset's sample enlarged, or for Custom the prompt field,
 * its fragment chips and the length counter. The two fill one rect and crossfade, so choosing a
 * direction never moves the shelf or the canvas.
 */
import { ActionButton } from '../../../../primitives/ActionButton';
import { STYLIZE_PAPER, rgbaOf } from '../../../../design/tokens';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cursors, font, radii, shadows } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import {
  CUSTOM_DIRECTION_ID, CUSTOM_PROMPT_MAX, appendFragment,
  type StylizeDirection,
} from '../../../../../pipelines/stylize/facts';
import { packSampleUrl } from './sample-assets';
import { SampleTile, entering, fieldBox } from './stylize-parts';
import { directionRow } from './DirectionBooklet';
import { framerMotion } from '../../../../design/motion';

/** The six fragments the desk offers. They carry the locale's own words into the prompt: the model
 *  reads them, and the user has to recognise their own sentence afterwards. */
const CHIP_KEYS = [
  'stylize.chip_paper', 'stylize.chip_soft', 'stylize.chip_outline',
  'stylize.chip_flat', 'stylize.chip_night', 'stylize.chip_mass',
] as const;

export function DirectionPane({ direction, text, onText, connected, onConnect, enterIndex = 0 }: {
  direction: StylizeDirection;
  text: string;
  onText: (next: string) => void;
  /** Whether a provider key stands. A model direction without one shows the way to the form here,
   *  in the pane, because this is where the eye already is when the row was picked. */
  connected: boolean;
  onConnect: () => void;
  /** Where the pane stands in its page's arrival order. */
  enterIndex?: number;
}) {
  return (
    <motion.div {...entering(enterIndex)} style={paneStyle}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <AnimatePresence initial={false}>
          <motion.div
            key={direction}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={framerMotion('stylize.pane.turn')}
            style={faceStyle}
         >
            {faceOf(direction, connected) === 'desk'
              ? <WritingDesk text={text} onText={onText} />
              : <SampleFace direction={direction} needsKey={directionRow(direction).kind === 'model' && !connected} onConnect={onConnect} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Which face the pane wears: the desk for Custom once a key stands, the sample otherwise — a model
 *  direction with no key wears its sample too, with the way to the key laid over the tile's foot,
 *  so choosing a locked style still shows what it is before it asks for anything. */
function faceOf(direction: StylizeDirection, connected: boolean): 'desk' | 'sample' {
  return direction === CUSTOM_DIRECTION_ID && connected ? 'desk' : 'sample';
}

function WritingDesk({ text, onText }: { text: string; onText: (next: string) => void }) {
  const t = useT();
  return (
    <>
      <textarea
        rows={3}
        maxLength={CUSTOM_PROMPT_MAX}
        value={text}
        placeholder={t('stylize.custom_ph')}
        onChange={(e) => onText(e.target.value)}
        style={{ ...fieldBox, flex: 1, minHeight: 0, lineHeight: 1.55 }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 6 }}>
        {CHIP_KEYS.map((key) => (
          <ActionButton
            key={key}
            onClick={() => onText(appendFragment(text, t(key)))}
            interaction="tile"
            style={chipStyle}
         >
            {t(key)}
          </ActionButton>
        ))}
      </div>
      <div style={{ alignSelf: 'flex-end', ...roleFont('caption'), color: skin.muted, opacity: 0.5, paddingTop: 2 }}>
        {`${text.length} / ${CUSTOM_PROMPT_MAX}`}
      </div>
    </>
  );
}

function SampleFace({ direction, needsKey, onConnect }: {
  direction: StylizeDirection;
  /** A model direction with no key filed: the tile stays exactly where it always is, and the fact
   *  plus the one verb that resolves it ride a gradient over the tile's foot. */
  needsKey: boolean;
  onConnect: () => void;
}) {
  const t = useT();
  const row = directionRow(direction);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ position: 'relative', width: '78%', display: 'block' }}>
        <SampleTile
          url={packSampleUrl(direction)}
          art={row.art}
          radius={10}
          style={{ boxShadow: shadows.float }}
        />
        {needsKey ? (
          <span style={keyVeil}>
            <span style={{ ...roleFont('caption'), color: STYLIZE_PAPER.onVeil, textAlign: 'center', padding: '0 10px' }}>
              {t('stylize.key_needed')}
            </span>
            <ActionButton onClick={onConnect} interaction="tile" style={connectStyle}>
              {t('stylize.connect_cta')}
            </ActionButton>
          </span>
        ) : null}
      </span>
      <b style={{ ...roleFont('chip'), color: skin.plateInk }}>{t(row.nameKey)}</b>
    </div>
  );
}

/** The gradient at the tile's foot a locked style speaks from: art above, the fact and the verb
 *  below, one rounded bottom matching the tile's own radius. */
const keyVeil: CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0, height: '68%',
  borderRadius: `0 0 ${radii.md}px ${radii.md}px`,
  background: `linear-gradient(180deg, ${rgbaOf(STYLIZE_PAPER.veil, 0)} 0%, ${rgbaOf(STYLIZE_PAPER.veil, 0.62)} 38%, ${rgbaOf(STYLIZE_PAPER.veil, 0.86)} 100%)`,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
  gap: 6, paddingBottom: 10,
};

const connectStyle: CSSProperties = {
  background: skin.plate,
  color: skin.ink,
  border: 'none',
  borderRadius: radii.md,
  padding: '6px 14px',
  fontFamily: font.family,
  ...roleFont('chip'),
  cursor: cursors.clickable,
};

const paneStyle: CSSProperties = {
  flex: 'none',
  height: 196,
  background: skin.inset,
  borderRadius: radii.lg,
  padding: 10,
  display: 'flex',
  overflow: 'hidden',
};

/** Both faces occupy the whole pane, which is what lets the outgoing one still be there while the
 *  incoming one arrives. */
const faceStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const chipStyle: CSSProperties = {
  background: skin.plate,
  color: skin.plateInk,
  border: 'none',
  borderRadius: radii.pill,
  padding: '4px 10px',
  fontFamily: font.family,
  ...roleFont('caption'),
  cursor: cursors.clickable,
};
