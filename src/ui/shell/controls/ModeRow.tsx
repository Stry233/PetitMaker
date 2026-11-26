/** The mode row (top left, or across the upright bar), its travelling splat, and the assistant block that is the character's seat. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig, type Transition } from 'framer-motion';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../../editor/help/page-schema';
import { tourTargetAttr, type TourTargetId } from '../../chrome/tour/steps';
import { arrangementFades, cssMotion, presence } from '../../design/motion';
import { useBeat } from '../../design/motion/use-motion';
import { useUiPreview } from '../../design/preview';
import { btnReset, cursors, UNAVAILABLE, z } from '../../design/styles';
import { FOCUS_SHAPE_RADIUS, MAP_LABEL } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { mapEdgeAttr } from '../../primitives/map-edge';
import { MapCaption } from '../bars/MapCaption';
import { ASSISTANT_BLOCK, ASSISTANT_ROW_TOP, MODE_PLATE, MODE_PLATE_ID, MODE_ROW_LEFT, blockCentre, type BlockArt, type ModeArt } from '../frame';
import { ShelfBand } from '../bars/ShelfBand';
import { panelInk } from '../bars/bar-panel';
import { useFrameLayout, useScaleGlideLine, type BarPanel } from '../frame-layout';
import { LANDSCAPE_MODE_ROW } from '../frame-plan';
import { CHARACTER_SEAT } from '../panel-frame';
import { useFrameReadableWeight, useFrameZoom } from '../use-frame-zoom';
import { EDGE, MODE, MODE_SCALE, UPRIGHT_SPACE } from '../units';
import { roleSize } from '../../design/text-weight';
import { useMorph, useMorphGroup } from '../../primitives/morph';
import { useScrollFade } from '../../primitives/scroll-fade';
import { useWheelToHorizontal } from '../../primitives/wheel-horizontal';
import { centreIn } from '../bars/row-scroll';

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
 * Whether the latest change of `fold` or `other` changed `fold`. Kept as state from the render that saw
 * the change until the next change, so the renders an exit spans still pass AnimatePresence the reason
 * it began with.
 */
function useFoldedLast(fold: boolean, other: unknown): boolean {
  const [last, setLast] = useState({ fold, other, folded: false });
  if (last.fold === fold && last.other === other) return last.folded;
  const folded = last.fold !== fold;
  setLast({ fold, other, folded });
  return folded;
}

/**
 * The splat under the chosen block, on the row's layer so it passes behind every block whichever way
 * it travels; placed by a length because Framer owns the transform of what it moves. As a piece of the
 * chrome's morph it is the chosen mode's own, so the plate a pick brings arrives as a new piece rather
 * than as the one leaving.
 */
function BlockPlate({ mode, centre, rowLeft, folding }: {
  mode: string; centre: number; rowLeft: number;
  /** It comes as the row unfolds, so it fades in with the row's words. */
  folding: boolean;
}) {
  const arrive = useBeat('mode.switch', 'plate.arriving');
  const leave = useBeat('mode.switch', 'plate.leaving');
  const fade = arrangementFades('shell.row.fade', useReducedMotionConfig());
  const piece = useMorph(`mode-plate-${mode}`);
  return (
    <motion.img
      {...piece}
      data-testid={MODE_PLATE_ID}
      src={MODE_PLATE.src}
      alt=""
      draggable={false}
      initial={{ opacity: 0, scale: PLATE_FROM }}
      animate={{ opacity: 1, scale: 1, transition: folding ? fade.in : arrive }}
      // As the row folds it fades with the row's words; a mode switch keeps its own beat.
      exit="leave"
      variants={{ leave: (fold: boolean) => ({ opacity: 0, scale: PLATE_FROM, transition: fold ? fade.out : leave }) }}
      style={{
        position: 'absolute', left: centre - rowLeft - PLATE_W / 2,
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
function RowBlock({
  art, piece, on, named = true, captionFade, centre, captionSpan, onBar, expanded, tourTarget, helpTarget, dataTile, slot,
  dimmed = false, shown = 1, label, onPress,
}: {
  art: BlockArt;
  /** The id a mode tile wears as a piece of the chrome's morph, which carries it on its own from its
   *  place in one arrangement to its place in the other. */
  piece?: string;
  /** The block's name, where it is not its art's own (the folded stack's front, an action). */
  label?: string;
  on: boolean;
  /** The transition the caption fades in and out on as the row folds and unfolds; a mode switch keeps
   *  the mode switch's beat. */
  captionFade?: { in: Transition; out: Transition };
  /** Whether an open block shows its caption; a folded stack keeps its drawings and shows no words. */
  named?: boolean;
  /** The block's centre from the window's left edge; absent in a scrolling row, where the name centres on the tile. */
  centre?: number;
  /** The window span the caption keeps inside; absent, the landscape left margin. */
  captionSpan?: { left: number; right: number };
  /** The plate of the upright bar the block stands on, whose ink its name takes. */
  onBar?: BarPanel['tone'];
  /** A panel trigger's disclosure state; null for a block that is a plain action (the stack's front). */
  expanded?: boolean | null;
  tourTarget?: TourTargetId;
  helpTarget?: HelpPageId | { page: HelpPageId; anchor: string };
  /** The mode a tile of a scrolling row stands for, which the row brings into view. */
  dataTile?: string;
  /** A box drawn in place of the art: the assistant's, where the live character stands. */
  slot?: ReactNode;
  /** Another task holds the map; a press still switches to this mode, which ends that task. */
  dimmed?: boolean;
  /** How strongly it shows: a tile behind a folded stack's front shows faintly or not at all. */
  shown?: number;
  onPress: () => void;
}) {
  const weightAt = useFrameReadableWeight();
  const t = useT();
  const caption = useBeat('mode.switch', 'caption');
  const reduced = useReducedMotionConfig();
  const drawing = on ? art.selected : art;
  const pose = useBeat('mode.switch', on ? 'tile.arriving' : 'tile.leaving');
  const morph = useMorph(piece ?? '');
  // Whether the row's fold, rather than a switch of mode, last showed or hid the caption: it fades on the fold.
  const folding = useFoldedLast(named, on);
  const captionNode = on && named ? (
    <MapCaption
      key="caption"
      top={`calc(100% + ${MODE.label.gap}px)`}
      centre={centre}
      span={captionSpan}
      motionProps={captionFade
        ? {
          initial: reduced ? false : { opacity: 0 }, animate: { opacity: 1, transition: folding ? captionFade.in : caption },
          exit: 'leave', variants: { leave: (fold: boolean) => ({ opacity: 0, transition: fold ? captionFade.out : { duration: 0 } }) },
        }
        : { initial: reduced ? false : { opacity: 0 }, animate: { opacity: 1 }, transition: caption }}
      style={{ ...(onBar ? { color: panelInk(onBar) } : MAP_LABEL), fontSize: roleSize('lead'), fontWeight: weightAt(MODE.label.weight, roleSize('lead')) }}
    >
      {t(art.labelKey)}
    </MapCaption>
  ) : null;
  return (
    <ActionButton
      interaction="tile"
      {...(piece !== undefined ? morph : {})}
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      {...(helpTarget ? (typeof helpTarget === 'string' ? helpTargetAttr(helpTarget) : helpTargetAttr(helpTarget.page, helpTarget.anchor)) : {})}
      aria-label={label ?? t(art.labelKey)}
      {...(dataTile ? { 'data-mode-tile': dataTile } : {})}
      {...(expanded === undefined ? { 'aria-pressed': on } : expanded === null ? {} : { 'aria-expanded': expanded })}
      onClick={onPress}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        width: MODE.size, height: MODE.height, borderRadius: FOCUS_SHAPE_RADIUS,
        cursor: cursors.clickable, opacity: (dimmed ? UNAVAILABLE : 1) * shown,
        // On the tile itself, so a turn's morph carries how strongly it shows.
        ...(captionFade ? { transition: cssMotion('shell.row.fade', ['opacity'], reduced) } : {}),
      }}
    >
      {slot ?? (
        <motion.img
          src={drawing.src}
          alt=""
          draggable={false}
          initial={false}
          animate={{ width: drawing.w * MODE_SCALE, height: drawing.h * MODE_SCALE }}
          transition={pose}
          // Centred by Framer's own `x`, and pivoting where it meets the baseline, as a standing figure does.
          style={{ position: 'absolute', left: '50%', bottom: 0, x: '-50%', originX: 0.5, originY: 1 }}
        />
      )}
      {captionFade ? <AnimatePresence initial={false} custom={folding}>{captionNode}</AnimatePresence> : captionNode}
    </ActionButton>
  );
}

/** How far each block stacked behind the front of a folded row steps right and up, in css px, its size
 *  as a share of the front's, how many stand visible behind it, and how strongly they show. */
const STACK_STEP = 12;
const STACK_RISE = 5;
const STACK_SHRINK = 0.82;
const STACK_SHOWN = 2;
const STACK_BACK = 0.4;

/**
 * The modes of the top row, each tile placed by its own motion so the row folds and unfolds as one
 * move: laid out along the row, or, where the top row is too narrow for them beside the corner actions
 * (`frame-plan.ts:planFrame`), folded into one stack at the row's start in the row's own order, the first
 * in front and the next two behind it, its front standing where the row's first tile stands. The stack
 * shows no words: the open mode's caption fades out as the row folds and back in as it unfolds. A press
 * unfolds the stack in place, each tile travelling out to its slot; picking a mode opens it and folds the
 * row again the same way, as an outside press or Escape does. A window narrowed or widened across the
 * fold carries the tiles the same way.
 */
function ModeTiles({ modes, mode, row, dimmed, onPick }: {
  modes: readonly ModeArt[]; mode: BuildMode | null; row: { left: number; gap: number; folded?: true; open?: true }; dimmed: boolean;
  onPick: (id: BuildMode) => void;
}) {
  const t = useT();
  const folded = !!row.folded;
  const open = folded && !!row.open;
  const flat = !folded || open;
  const setOpen = useEditorStore((s) => s.setModeRowOpen);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig();
  const fade = arrangementFades('shell.row.fade', reduced);
  // Each tile's place is a group of the chrome's morph: a fold the window or a press makes travels on
  // its transition, and one an input switch or a turn makes is the morph's alone to carry.
  const group = useMorphGroup();
  const travel = cssMotion('shell.row.fold', ['transform'], reduced);
  useSurfaceScope({ open, onClose: () => setOpen(false), root, outside: true });
  return (
    <div ref={root} style={{ position: 'relative', width: modes.length * MODE.size + (modes.length - 1) * row.gap, height: MODE.height, pointerEvents: 'none' }}>
      {modes.map((art, i) => {
        const front = !flat && i === 0;
        const live = flat || front;
        const rank = Math.min(i, STACK_SHOWN);
        const at = flat
          ? { x: i * (MODE.size + row.gap), y: 0, scale: 1, shown: 1 }
          : { x: rank * STACK_STEP, y: -rank * STACK_RISE, scale: i === 0 ? 1 : STACK_SHRINK, shown: i === 0 ? 1 : i <= STACK_SHOWN ? STACK_BACK : 0 };
        return (
          <div key={art.id} {...group}
            {...(live ? {} : { inert: '', 'aria-hidden': true })}
            // A flex box, so no line box's strut lifts the tile off the row's foot.
            style={{
              position: 'absolute', left: 0, bottom: 0, display: 'flex', zIndex: modes.length - i, pointerEvents: live ? 'auto' : 'none',
              // In shares of the tile's own box, which a zoom of the frame leaves as they are: a length in px
              // is re-resolved at each frame of a scale glide, which restarts the fold's transition there.
              transform: `translate(${(at.x / MODE.size) * 100}%, ${(at.y / MODE.height) * 100}%) scale(${at.scale})`, transformOrigin: '50% 100%', transition: travel,
            }}>
            <RowBlock art={art} piece={`mode-${art.id}`} on={mode === art.id} named={flat} captionFade={fade} centre={blockCentre(i, row)} dimmed={dimmed} shown={at.shown}
              {...(folded ? {} : { tourTarget: `mode:${art.id}` as const })}
              {...(front ? { label: t('mode.deck_show'), expanded: null, helpTarget: { page: 'frame', anchor: 'frame-fold' } } : { helpTarget: art.helpTarget })}
              onPress={front ? () => setOpen(true) : () => { if (open) setOpen(false); onPick(art.id); }} />
          </div>
        );
      })}
    </div>
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
  // The block travels with her seat (`frame-plan.ts:planFrame`), which stands at the same place in it.
  const seat = useFrameLayout()?.character ?? CHARACTER_SEAT;
  const top = ASSISTANT_ROW_TOP + (seat.top - CHARACTER_SEAT.top);
  const left = MODE_ROW_LEFT + (seat.left - CHARACTER_SEAT.left);
  const morph = useMorph('assistant-block');
  const box = useRef<HTMLDivElement>(null);
  useScaleGlideLine(box, { top, left });
  return (
    <motion.div ref={box} {...swap} {...morph} style={{ position: 'fixed', top, left, zIndex: z.panel, pointerEvents: open ? 'none' : 'auto' }}>
      <RowBlock
        art={ASSISTANT_BLOCK}
        on={false}
        expanded={open}
        centre={left + MODE.size / 2}
        tourTarget="assistant"
        helpTarget="agent-setup"
        slot={preview ? undefined : <div ref={entranceRef} data-testid="entrance-plate-anchor" style={ENTRANCE_SLOT} />}
        onPress={onToggle}
      />
    </motion.div>
  );
}

/**
 * The row of mode blocks for one set of modes, the splat drawn first so it stands behind every block.
 * Placed by the frame's plan: along the top on a wide window, or across a bar at the foot of an
 * upright one, where the row stands over any shelf, since it is the way to switch or close it. The
 * bar's band is bare at rest, so the tiles stand on the map, and fills as it grows up behind an open
 * mode's panel in that panel's plate, under the panel's own layer (the same rung, drawn first), so the
 * bar and the panel read as one surface.
 */
export function ModeRow({ modes, mode, swap, dimmed = false, onPick }: {
  modes: readonly ModeArt[];
  mode: BuildMode | null;
  swap: ChromeSwap;
  /** Touch multi-select holds the map, so the modes stand back until it ends. */
  dimmed?: boolean;
  onPick: (id: BuildMode) => void;
}) {
  const selectedMode = modes.findIndex((art) => art.id === mode);
  const layout = useFrameLayout();
  const row = layout?.modeRow ?? LANDSCAPE_MODE_ROW;
  const bottom = row.placement === 'bottom';
  const panel = bottom ? layout?.barPanel ?? null : null;
  const tone = panel?.tone ?? 'cream';
  const captionSpan = bottom && layout ? { left: EDGE, right: layout.width - EDGE } : undefined;
  // The row draws nothing of its own: each tile and the splat are pieces of the chrome's morph.
  const rowGroup = useMorphGroup();
  // At the foot, held by its distance from the frame's foot, so a frame a dragged dock resizes past
  // React carries it.
  const scroll = bottom ? row.scroll : undefined;
  const place = scroll ? { bottom: 0, left: row.left, gap: 0 } : bottom && layout
    ? { bottom: layout.height - row.top - MODE.height, left: row.left, gap: row.gap }
    : { top: row.top, left: row.left, gap: row.gap };
  const rowRef = useRef<HTMLDivElement>(null);
  useScaleGlideLine(rowRef, place);
  const zoom = useFrameZoom();
  const fade = useScrollFade(rowRef, 'x', { on: !!scroll });
  useWheelToHorizontal(rowRef, { zoom, smooth: true });
  // The open mode's tile is brought to the middle of the scrolling row, clear of the fades.
  useEffect(() => {
    const box = rowRef.current;
    const tile = selectedMode >= 0 ? box?.querySelector<HTMLElement>(`[data-mode-tile="${modes[selectedMode]!.id}"]`) : null;
    if (scroll && box && tile) centreIn(box, tile, 'x');
  }, [scroll, selectedMode, modes]);
  const t = useT();
  // Whether folding the row into its stack or unfolding it, rather than a switch of mode, last moved the
  // splat, which then fades with the words.
  const stacked = !!row.folded && !row.open;
  const folding = useFoldedLast(stacked, selectedMode);
  return (
    <>
      {row.band > 0 ? (
        <motion.span {...swap} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: z.panel }}>
          <ShelfBand tone={tone} upright bare={!panel} glide={!panel?.following} height={row.band + (panel?.height ?? 0)} testId="shell-mode-band" morph="mode-band" />
        </motion.span>
      ) : null}
      <motion.div
        ref={rowRef}
        {...swap}
        {...rowGroup}
        role="group"
        aria-label={t('mode.deck')}
        {...tourTargetAttr('modes')}
        {...mapEdgeAttr(row.placement)}
        data-placement={row.placement}
        style={{
          position: 'fixed', ...place, zIndex: bottom ? z.column : z.panel,
          display: 'flex', alignItems: 'flex-end', pointerEvents: 'auto',
          // The box takes the whole bar's depth so each tile's name and the splat stay inside it.
          ...(scroll ? {
            width: scroll.width, height: row.band + MODE.height / 4, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none',
            overscrollBehaviorX: 'contain', ...fade,
          } : {}),
        }}
      >
        {scroll ? (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', flex: 'none', paddingBottom: row.band - UPRIGHT_SPACE.band - MODE.height }}>
            <AnimatePresence initial={false} custom={folding}>
              {selectedMode >= 0
                ? (
                  <BlockPlate key={selectedMode} mode={modes[selectedMode]!.id} centre={row.left + (selectedMode + 0.5) * MODE.size}
                    rowLeft={row.left} folding={folding} />
                )
                : null}
            </AnimatePresence>
            {modes.map((art) => (
              <RowBlock key={art.id} art={art} piece={`mode-${art.id}`} on={mode === art.id} tourTarget={`mode:${art.id}`} dataTile={art.id}
                {...(panel ? { onBar: panel.tone } : {})} helpTarget={art.helpTarget} dimmed={dimmed} onPress={() => onPick(art.id)} />
            ))}
          </div>
        ) : null}
        {scroll ? null : <AnimatePresence initial={false} custom={folding}>
          {selectedMode >= 0 && !stacked
            ? <BlockPlate key={selectedMode} mode={modes[selectedMode]!.id} centre={blockCentre(selectedMode, row)} rowLeft={row.left} folding={folding} />
            : null}
        </AnimatePresence>}
        {scroll ? null : !bottom ? <ModeTiles modes={modes} mode={mode} row={row} dimmed={dimmed} onPick={onPick} /> : modes.map((art, i) => (
          <RowBlock key={art.id} art={art} piece={`mode-${art.id}`} on={mode === art.id} centre={blockCentre(i, row)} captionSpan={captionSpan} tourTarget={`mode:${art.id}`}
            {...(panel ? { onBar: panel.tone } : {})} helpTarget={art.helpTarget} dimmed={dimmed} onPress={() => onPick(art.id)} />
        ))}
      </motion.div>
    </>
  );
}
