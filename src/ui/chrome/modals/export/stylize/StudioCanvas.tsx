/*
 * StudioCanvas.tsx — the picture the page is about, at the map's own ratio, with the other picture
 * standing in its corner.
 *
 * THE RATIO IS THE MAP'S AND THE FIT IS CONTAIN. A stylized band that had been stretched to fill
 * this box would be a promise the export cannot keep, since what is exported is the map's shape.
 *
 * THE CORNER PICTURE IS A SWAP, NOT A SELECTION. Pressing it exchanges what the two boxes show and
 * touches nothing about which version the export carries: comparing a take against the original is
 * a thing you do WHILE keeping the take.
 *
 * THE STAGE ANSWERS THE SAME HANDS THE EXPORT PREVIEW DOES (`use-pan-zoom`): drag pans, the wheel
 * zooms, a double-click resets. The view survives a take switch ON PURPOSE — zooming into one
 * corner and stepping through the shelf is how two styles' handling of the same spot is compared.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { cursors, radii, exitTransition, font } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import { usePanZoom } from '../use-pan-zoom';
import { MAP_ASPECT } from './sample-art';
import { entering } from './atoms';
import { amplitude, framerMotion } from './motion';

export interface Picture {
  /** What is being shown, for a viewer and for a test alike: 'original', or a version's id. */
  key: string;
  src: string | null;
  label: string;
}

export function StudioCanvas({ main, corner, onSwap, enterIndex = 0 }: {
  main: Picture;
  corner: Picture | null;
  onSwap: () => void;
  /** Where the canvas stands in its page's arrival order. */
  enterIndex?: number;
}) {
  const t = useT();
  const pz = usePanZoom();
  return (
    <motion.div
      {...entering(enterIndex)}
      style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', position: 'relative' }}
    >
      <div
        data-testid="stylize-canvas"
        data-picture={main.key}
        {...pz.stageProps}
        style={{
          height: '100%', aspectRatio: String(MAP_ASPECT), position: 'relative',
          borderRadius: 14, overflow: 'hidden', background: skin.inset,
          boxShadow: '0 8px 22px rgba(74,59,50,0.14)',
          ...pz.stageProps.style,
        }}
      >
        {/* The moved layer holds BOTH halves of a crossfade, so a zoomed view carries through a
            take switch instead of one picture standing zoomed while the other arrives at rest. */}
        <div data-testid="stylize-canvas-view" style={{ position: 'absolute', inset: 0, ...pz.viewStyle }}>
          <AnimatePresence initial={false}>
            <motion.div
              key={main.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={framerMotion('stylize.canvas.crossfade')}
              style={{
                position: 'absolute', inset: 0,
                ...(main.src ? { backgroundImage: `url(${main.src})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
              }}
            />
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {pz.showResetHint && (
            <motion.div key="reset-hint" style={resetHint}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: exitTransition }}>
              {t('export.preview_reset_hint')}
            </motion.div>
          )}
        </AnimatePresence>
        <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 14, boxShadow: 'inset 0 0 0 1.5px rgba(87,73,53,0.22)', pointerEvents: 'none' }} />
      </div>

      {corner ? (
        <motion.button
          type="button"
          onClick={onSwap}
          aria-label={t('stylize.swap_hint')}
          title={t('stylize.swap_hint')}
          animate={{ scale: 1 }}
          // Both halves of the answer are the swap's own declared travel: the corner picture rises
          // by it under the pointer and sinks by it under the press.
          whileHover={{ scale: 1 + amplitude('stylize.pip.swap') }}
          whileTap={{ scale: 1 - amplitude('stylize.pip.swap') }}
          transition={framerMotion('stylize.pip.swap')}
          style={{
            position: 'absolute', right: 10, bottom: 10, width: 118, padding: 0,
            border: 'none', borderRadius: 10, overflow: 'hidden', background: skin.plate,
            boxShadow: `0 3px 12px rgba(67,65,62,0.35), 0 0 0 2px ${skin.plate}`,
            cursor: cursors.clickable,
          }}
        >
          <span
            data-picture={corner.key}
            style={{
              display: 'block', width: '100%', aspectRatio: String(MAP_ASPECT),
              ...(corner.src ? { backgroundImage: `url(${corner.src})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
            }}
          />
          <span style={pipTag}>{corner.label}</span>
        </motion.button>
      ) : null}
    </motion.div>
  );
}

const resetHint = {
  position: 'absolute' as const,
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  ...roleFont('caption'),
  color: skin.plateInk,
  background: skin.plate,
  borderRadius: 999,
  padding: '3px 11px',
  whiteSpace: 'nowrap' as const,
  pointerEvents: 'none' as const,
  fontFamily: font.family,
};

const pipTag = {
  position: 'absolute' as const,
  left: 4,
  bottom: 4,
  ...roleFont('small'),
  color: skin.plate,
  background: 'rgba(67,65,62,0.66)',
  borderRadius: radii.sm,
  padding: '1px 6px',
  pointerEvents: 'none' as const,
};
