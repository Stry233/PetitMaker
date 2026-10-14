/** The top-left mode row, its travelling splat, and the assistant block that is the character's seat. */
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../help/page-schema';
import { tourTargetAttr, type TourTargetId } from '../../chrome/tour/steps';
import { presence } from '../../design/motion';
import { useBeat } from '../../design/motion/use-motion';
import { useUiPreview } from '../../design/preview';
import { btnReset, cursors, z } from '../../design/styles';
import { FOCUS_SHAPE_RADIUS, MAP_LABEL } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { MapCaption } from '../bars/MapCaption';
import { ASSISTANT_BLOCK, ASSISTANT_ROW_TOP, MODE_PLATE, MODE_PLATE_ID, MODE_ROW_LEFT, MODE_ROW_TOP, blockCentre, type BlockArt, type ModeArt } from '../frame';
import { CHARACTER_SEAT } from '../panel-frame';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { MODE, MODE_SCALE } from '../units';

/** A frame cluster comes and goes with a planet session on the bottom bar's handover clock; opacity only, so fixed clusters keep their corners. */
export function useChromeSwap() {
  const reduced = useReducedMotionConfig();
  return { ...presence('mode.bar.enter', { opacity: 0 }, { leave: 'mode.bar.leave', reduced }), ...(reduced ? { initial: false as const } : {}) };
}
export type ChromeSwap = ReturnType<typeof useChromeSwap>;

/** The splat as it lands: wider than its block and centred on it. */
const PLATE_W = MODE_PLATE.w * MODE_SCALE;
/** How far under its size the splat arrives and leaves. */
const PLATE_FROM = 0.88;

/**
 * The splat under the chosen block, on the row's layer so it passes behind every block whichever way
 * it travels; placed by a length because Framer owns the transform of what it moves.
 */
function BlockPlate({ centre }: { centre: number }) {
  const arrive = useBeat('mode.switch', 'plate.arriving');
  const leave = useBeat('mode.switch', 'plate.leaving');
  return (
    <motion.img
      data-testid={MODE_PLATE_ID}
      src={MODE_PLATE.src}
      alt=""
      draggable={false}
      initial={{ opacity: 0, scale: PLATE_FROM }}
      animate={{ opacity: 1, scale: 1, transition: arrive }}
      exit={{ opacity: 0, scale: PLATE_FROM, transition: leave }}
      style={{
        position: 'absolute', left: centre - MODE_ROW_LEFT - PLATE_W / 2,
        bottom: -MODE_PLATE.drop * MODE_SCALE,
        width: PLATE_W, height: MODE_PLATE.h * MODE_SCALE,
      }}
    />
  );
}

/**
 * One mode or assistant block. Drawings share a bottom baseline and may overflow their slots; an
 * active mode shows its caption on the map. `expanded` gives a panel trigger disclosure semantics.
 */
function RowBlock({ art, on, centre, expanded, tourTarget, helpTarget, slot, onPress }: {
  art: BlockArt;
  on: boolean;
  /** The block's centre from the window's left edge. */
  centre: number;
  expanded?: boolean;
  tourTarget?: TourTargetId;
  helpTarget?: HelpPageId;
  /** A box drawn in place of the art: the assistant's, where the live character stands. */
  slot?: ReactNode;
  onPress: () => void;
}) {
  const weightAt = useFrameReadableWeight();
  const t = useT();
  const caption = useBeat('mode.switch', 'caption');
  const reduced = useReducedMotionConfig();
  const drawing = on ? art.selected : art;
  return (
    <ActionButton
      interaction="tile"
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      {...(helpTarget ? helpTargetAttr(helpTarget) : {})}
      aria-label={t(art.labelKey)}
      {...(expanded === undefined ? { 'aria-pressed': on } : { 'aria-expanded': expanded })}
      onClick={onPress}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        width: MODE.size, height: MODE.height, borderRadius: FOCUS_SHAPE_RADIUS,
        cursor: cursors.clickable,
      }}
    >
      {slot ?? (
        <motion.img
          src={drawing.src}
          alt=""
          draggable={false}
          // Centred by Framer's own `x`, and pivoting where it meets the baseline, as a standing figure does.
          style={{
            position: 'absolute', left: '50%', bottom: 0, x: '-50%', originX: 0.5, originY: 1,
            width: drawing.w * MODE_SCALE, height: drawing.h * MODE_SCALE,
          }}
        />
      )}
      {on ? (
        <MapCaption
          top={`calc(100% + ${MODE.label.gap}px)`}
          centre={centre}
          motionProps={{ initial: reduced ? false : { opacity: 0 }, animate: { opacity: 1 }, transition: caption }}
          style={{ ...MAP_LABEL, fontSize: MODE.label.size, fontWeight: weightAt(MODE.label.weight, MODE.label.size) }}
        >
          {t(art.labelKey)}
        </MapCaption>
      ) : null}
    </ActionButton>
  );
}

/** The character's drawn width inside her seat (`panel-frame.ts:CHARACTER_SEAT`). */
export const ENTRANCE_CHAR_W = CHARACTER_SEAT.w - CHARACTER_SEAT.pad * 2;
/** Her seat, placed by lengths: the character measures this box, so nothing here or above it may take a transform. */
const ENTRANCE_SLOT: CSSProperties = {
  position: 'absolute', left: '50%', marginLeft: -CHARACTER_SEAT.w / 2, bottom: -CHARACTER_SEAT.pad,
  width: CHARACTER_SEAT.w, height: CHARACTER_SEAT.h,
};

/**
 * The assistant's block: the character's seat and the keyboard's and tour's way to her toggle. Her
 * own layer takes the pointer, and the block is deaf while the panel stands over it; it wears no
 * splat, because the open panel already says what is open.
 */
export function AssistantBlock({ entranceRef, onToggle }: { entranceRef: RefObject<HTMLDivElement>; onToggle: () => void }) {
  const open = useEditorStore((s) => s.assistantOpen);
  // A pictured shell mounts no character layer, so the block draws her still art instead.
  const preview = useUiPreview();
  const swap = useChromeSwap();
  return (
    <motion.div {...swap} style={{ position: 'fixed', top: ASSISTANT_ROW_TOP, left: MODE_ROW_LEFT, zIndex: z.panel, pointerEvents: open ? 'none' : 'auto' }}>
      <RowBlock
        art={ASSISTANT_BLOCK}
        on={false}
        expanded={open}
        centre={blockCentre(0)}
        tourTarget="assistant"
        helpTarget="agent-setup"
        slot={preview ? undefined : <div ref={entranceRef} data-testid="entrance-plate-anchor" style={ENTRANCE_SLOT} />}
        onPress={onToggle}
      />
    </motion.div>
  );
}

/** The row of mode blocks for one set of modes, the splat drawn first so it stands behind every block. */
export function ModeRow({ modes, mode, swap, onPick }: {
  modes: readonly ModeArt[];
  mode: BuildMode | null;
  swap: ChromeSwap;
  onPick: (id: BuildMode) => void;
}) {
  const selectedMode = modes.findIndex((art) => art.id === mode);
  return (
    <motion.div
      {...swap}
      {...tourTargetAttr('modes')}
      {...mapEdgeAttr('top')}
      style={{
        position: 'fixed', top: MODE_ROW_TOP, left: MODE_ROW_LEFT, zIndex: z.panel,
        display: 'flex', alignItems: 'flex-end', gap: MODE.gap, pointerEvents: 'auto',
      }}
    >
      <AnimatePresence initial={false}>
        {selectedMode >= 0 ? <BlockPlate key={selectedMode} centre={blockCentre(selectedMode)} /> : null}
      </AnimatePresence>
      {modes.map((art, i) => (
        <RowBlock key={art.id} art={art} on={mode === art.id} centre={blockCentre(i)} helpTarget={art.helpTarget} onPress={() => onPick(art.id)} />
      ))}
    </motion.div>
  );
}
