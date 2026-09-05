/*
 * DirectionPane.tsx — the RESERVED pane under the booklet: one box of fixed height whose contents
 * change with the direction, never its size.
 *
 * A preset shows its sample enlarged, which is the only honest answer to "what will this look
 * like". 自定义 shows the writing desk: a field with real room, the fragment chips that append to
 * it in the reader's own language, and the counter that says how much of the cap is spent. The two
 * fill the same rect, so choosing a direction never moves the shelf or the canvas beside it — and
 * they CROSS over each other rather than one following the other out, so the pane is never empty
 * for a frame in the middle of a change nobody asked to wait for.
 */
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cursors, font, pressable, radii } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import {
  CUSTOM_DIRECTION_ID, CUSTOM_PROMPT_MAX, appendFragment,
  type StylizeDirection,
} from '../../../../../io/stylize';
import { packSampleUrl } from './sample-assets';
import { SampleTile, entering, fieldBox } from './atoms';
import { directionRow } from './DirectionBooklet';
import { framerMotion } from './motion';

/** The six fragments the desk offers. They carry the LOCALE'S OWN words into the prompt: the model
 *  reads them, and the user has to recognise their own sentence afterwards. */
const CHIP_KEYS = [
  'stylize.chip_paper', 'stylize.chip_soft', 'stylize.chip_outline',
  'stylize.chip_flat', 'stylize.chip_night', 'stylize.chip_mass',
];

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

/** Which face the pane wears: the desk for 自定义 once a key stands, the sample otherwise — a model
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 6 }}>
        {CHIP_KEYS.map((key) => (
          <motion.button
            key={key}
            type="button"
            onClick={() => onText(appendFragment(text, t(key)))}
            {...pressable}
            style={chipStyle}
          >
            {t(key)}
          </motion.button>
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ position: 'relative', width: '78%', display: 'block' }}>
        <SampleTile
          url={packSampleUrl(direction)}
          art={row.art}
          radius={10}
          style={{ boxShadow: '0 3px 10px rgba(74,59,50,0.18)' }}
        />
        {needsKey ? (
          <span style={keyVeil}>
            <span style={{ ...roleFont('caption'), color: '#F5EEDA', textAlign: 'center', padding: '0 10px' }}>
              {t('stylize.key_needed')}
            </span>
            <motion.button type="button" onClick={onConnect} {...pressable} style={connectStyle}>
              {t('stylize.connect_cta')}
            </motion.button>
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
  borderRadius: '0 0 10px 10px',
  background: 'linear-gradient(180deg, rgba(30,26,20,0) 0%, rgba(30,26,20,0.62) 38%, rgba(30,26,20,0.86) 100%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
  gap: 7, paddingBottom: 11,
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
