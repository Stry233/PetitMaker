/*
 * The studio's picture at the map's own ratio (contain, never stretched), with the other picture in its
 * corner: pressing the corner swaps what the two boxes show without changing which version exports. The
 * stage pans and zooms like the export preview (`use-pan-zoom`) and keeps its view across take switches.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { INK, inkTint, rgbaOf } from '../../../../design/tokens';
import { cursors, radii, shadows } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import { usePanZoom } from '../../../../primitives/use-pan-zoom';
import { PanZoomResetHint } from '../../../../primitives/pan-zoom-stage';
import { MAP_ASPECT } from './sample-art';
import { entering } from './stylize-parts';
import { amplitude, framerMotion } from '../../../../design/motion';

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
          borderRadius: radii.field, overflow: 'hidden', background: skin.inset,
          boxShadow: shadows.s2,
          ...pz.stageProps.style,
        }}
      >
        {/* The moved layer holds both halves of a crossfade, so a zoomed view carries through a
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
        <PanZoomResetHint show={pz.showResetHint} label={t('export.preview_reset_hint')} />
        <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: radii.field, boxShadow: `inset 0 0 0 1.5px ${rgbaOf(INK, 0.22)}`, pointerEvents: 'none' }} />
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
            border: 'none', borderRadius: radii.md, overflow: 'hidden', background: skin.plate,
            boxShadow: `${shadows.float}, 0 0 0 2px ${skin.plate}`,
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

const pipTag = {
  position: 'absolute' as const,
  left: 4,
  bottom: 4,
  ...roleFont('small'),
  color: skin.plate,
  background: inkTint(0.66),
  borderRadius: radii.sm,
  padding: '2px 6px',
  pointerEvents: 'none' as const,
};
