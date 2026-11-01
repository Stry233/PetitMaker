/*
 * Central registry for shell and assistant motion. Inform motions reinforce visible state and say
 * which; ambient motions are decorative and bound their travel. Under reduced motion both step to
 * state through the adapters. Sample motions preview a motion setting and play under every
 * preference, only through `MotionSample`. Call sites use ids.
 */
import { pressable } from '../styles';
import { TAPE, VIGNETTE_DEPTH } from '../tokens';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import type { CurveId } from './curves';

/** Shared button hover growth as a fraction of the button. */
const HOVER_GROWTH = pressable.whileHover.scale - 1;


/** Construction-tape travel per cycle; matching the stripe period prevents a seam jump. */
const TAPE_STRIPE_PX = TAPE.stripeSize;

/** Shared floating-panel and hosted-character departure time, in seconds. */
const FORM_LEAVE_S = 0.16;

/** Hosted-character arrival time, in seconds. */
const CHARACTER_POP_S = 0.3;

/** Shared panel-height and setup-step transition time, in seconds. */
const PANEL_HEIGHT_S = 0.24;

/** The welcome tips' crossing between cards and the card's height glide, one clock, in seconds. */
const TOUR_CROSS_S = 0.34;

/** The plain in-place crossfade a control's drawing or wording changes on. */
const CONTROL_FADE = { tier: 'inform', curve: 'ease', duration: 0.18 } as const;

interface Base {
  curve: CurveId;
  /** Tween duration or full loop cycle, in seconds; springs carry their own timing. */
  duration?: number;
  /** Repeats a tween for as long as its state remains active. */
  loop?: true;
  /** Maximum travel in CSS pixels, or a fraction for scale and opacity. Required for ambient motion. */
  amplitude?: number;
  amplitudeUnit?: 'px' | 'scale' | 'opacity';
  /** Delay between successive members of a group, in seconds. */
  stagger?: number;
  /** How long a transient state stands from the moment it is shown before it is withdrawn, in
   *  seconds. A pause, not travel, so reduced motion keeps it. */
  hold?: number;
  /** Fraction of duration used for a flip's departure; undefined uses the full duration. */
  outShare?: number;
  /** Optional departure curve when it differs from the landing curve. */
  outCurve?: CurveId;
  /** The curve a re-arrangement's departing and arriving surfaces fade on, where it differs from the
   *  curve its pieces travel on (`primitives/morph.ts`). */
  fadeCurve?: CurveId;
  /** Fraction of entry time at which a flip reaches its overshoot keyframe. */
  overshootAt?: number;
  landCurve?: CurveId;
  /** A spring that drives `scale` uses the scale rest thresholds (`styles.ts:scaleRest`). */
  settleScale?: true;
}

interface InformMotion extends Base {
  tier: 'inform';
  /** Static interface fact reinforced by this motion. */
  says: string;
}

interface AmbientMotion extends Base {
  tier: 'ambient';
  amplitude: number;
}

/** One key of a sample's loop: when it falls (a fraction of the loop), how high the moving part
 *  stands (a fraction of `amplitude`), its width and height scale about its base, and the scale of
 *  the mark on the ground beneath it. */
export type SampleKey = readonly [at: number, lift: number, scaleX: number, scaleY: number, ground: number];

/** A preview of what a motion setting does: a map cell dropping `amplitude` px onto its ground mark,
 *  one loop per level of the setting. It plays under every preference so each option of the setting
 *  shows its own level; `MotionSample` is its only player. */
interface SampleMotion extends Base {
  tier: 'sample';
  amplitude: number;
  /** A segment that rises takes `curve` and one that falls takes this; a level segment eases. */
  fallCurve: CurveId;
  /** Each level's loop, keys in time order from 0 to 1. */
  tracks: { readonly full: readonly SampleKey[]; readonly reduced: readonly SampleKey[] };
  /** The setting this motion previews. */
  previews: string;
}

/** Full: the cell falls, lands squashed, bounces twice lower, settles, holds, shrinks away and stands
 *  at the top again. */
const CELL_BOUNCE: readonly SampleKey[] = [
  [0, 1, 0.92, 1.08, 0.35],
  [0.24, 0, 1.3, 0.7, 1.25],
  [0.27, 2 / 36, 0.94, 1.06, 1.14],
  [0.39, 17 / 36, 1, 1, 0.7],
  [0.5, 0, 1.16, 0.84, 1.1],
  [0.57, 6 / 36, 1, 1, 0.9],
  [0.63, 0, 1.06, 0.94, 1],
  [0.67, 0, 1, 1, 1],
  [0.84, 0, 1, 1, 1],
  [0.9, 0, 0, 0, 0],
  [0.91, 1, 0, 0, 0],
  [1, 1, 0.92, 1.08, 0.35],
];

/** Reduced: the same fall on the same beat, landing without a squash or a bounce. */
const CELL_LAND: readonly SampleKey[] = [
  [0, 1, 1, 1, 0.35],
  [0.24, 0, 1, 1, 1],
  [0.84, 0, 1, 1, 1],
  [0.9, 0, 0, 0, 0],
  [0.91, 1, 0, 0, 0],
  [1, 1, 1, 1, 0.35],
];

export type Motion = InformMotion | AmbientMotion | SampleMotion;

export const MOTIONS = {
  'loading.spinner': { tier: 'inform', curve: 'linear', duration: 0.85, loop: true, says: 'work is in progress' },
  'meter.fill': { tier: 'inform', curve: 'ease', duration: 0.25, says: 'the map capacity changed' },
  'modal.dim': { tier: 'inform', curve: 'ease', duration: 0.3, says: 'the window is at work and the page waits' },
  'map.view.crossfade': { tier: 'inform', curve: 'ease', duration: 0.35, says: 'the map view changed underneath you' },
  /** The ring filling by a still finger over the hold time, after which the map's menu opens or
   *  the held card lifts into the hand. */
  'press.hold': {
    tier: 'inform', curve: 'linear', duration: GESTURE_TIMING.touch.holdMs / 1000,
    says: 'keep holding here and what you hold acts: the menu opens or the card lifts',
  },
  /** The magnifier rising over a touch press. */
  'map.loupe.arrive': { tier: 'inform', curve: 'punchy', duration: 0.16, says: 'this circle shows the cells under your finger' },
  'character.blink.lid': { tier: 'ambient', curve: 'easeOut', duration: 0.07, amplitude: 1, amplitudeUnit: 'scale' },
  'settings.grid.shift': { tier: 'inform', curve: 'easeOut', duration: 0.22, says: 'the grid lines moved onto the cells the chosen grid marks' },
  /** A Settings tile's caption crossfades from the setting's name into the value a press gave it,
   *  its width gliding on the same fade, and back to the name once `hold` has passed. */
  'settings.label.morph': { ...CONTROL_FADE, hold: 1.4, says: 'the setting now holds the value the tile names' },
  'control.paint': { tier: 'inform', curve: 'ease', duration: 0.15, says: 'the control state changed' },
  'control.fade': { ...CONTROL_FADE, says: 'the control state changed' },
  'control.drop': { tier: 'inform', curve: 'ease', duration: 0.12, says: 'the drop target is active' },
  'control.detail': { tier: 'inform', curve: 'easeOut', duration: 0.15, says: 'the selected detail is visible' },
  'control.tint': { tier: 'inform', curve: 'easeOut', duration: 0.18, says: 'the key state changed' },
  'control.hint': { tier: 'inform', curve: 'easeOut', duration: 0.16, says: 'the shortcut action changed' },
  'section.expand': { tier: 'inform', curve: 'expand', duration: 0.42, says: 'the section is open or closed' },
  'scroll.fade': { tier: 'ambient', curve: 'ease', duration: 0.18, amplitude: 1, amplitudeUnit: 'opacity' },
  'scroll.fade.settle': { tier: 'ambient', curve: 'ease', duration: 0.06, amplitude: 24 },
  'section.opacity': { tier: 'inform', curve: 'ease', duration: 0.3, says: 'the section content is available' },
  'modal.resize': { tier: 'inform', curve: 'punchy', duration: 0.3, says: 'the window fits its content' },
  'selection.fade': { tier: 'inform', curve: 'easeOut', duration: 0.12, says: 'the selection changed' },
  /** The selection card travels to a new place its selection leaves room for; a camera move is tracked instantly instead. */
  'selection.card.move': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'this is the same card, standing where its selection now has room for it',
  },
  /** The selection card grows from the point nearest the selection it names. */
  'selection.card.arrive': {
    tier: 'inform', curve: 'bouncy', amplitude: 0.15, amplitudeUnit: 'scale',
    says: 'these controls belong to what you just selected',
  },
  /** A card anchored to a control (a confirmation, the planet session's save panel) grows from that control. */
  'anchored.card.arrive': {
    tier: 'inform', curve: 'bouncy', amplitude: 0.15, amplitudeUnit: 'scale',
    says: 'this card answers the control it grows from',
  },
  /** A surface the visitor opened (a window, a menu, a notice, a guard) settles into place fast and stops. */
  'surface.arrive': { tier: 'inform', curve: 'stiff', says: 'this surface answers what you just did' },
  /** A surface being put away eases out flat, without the bounce it may have arrived with. */
  'surface.leave': { tier: 'inform', curve: 'fade', duration: 0.16, says: 'the surface is put away' },
  /** A card that answers a press at the place it was pressed (the note editor, a count badge) lands with a small overshoot. */
  'surface.pop': { tier: 'inform', curve: 'bouncy', says: 'this card belongs to what you just touched' },
  /** A control's moving part (a switch knob, a menu row's tint) travels to its new state. */
  'control.settle': { tier: 'inform', curve: 'stiff', says: 'the control now holds this value' },
  /** A segmented choice's plate slides under the segment just chosen and stops on it without overshooting. */
  'control.plate.slide': { tier: 'inform', curve: 'punchy', duration: 0.24, says: 'this segment is the one chosen now' },
  /** A notice slides in from its window edge and settles. */
  'notice.arrive': { tier: 'inform', curve: 'stiff', says: 'there is something to read here' },
  /** A Show me's spotlight and dim travel to the next control without overshooting it. */
  'tour.spotlight.move': { tier: 'inform', curve: 'roll', duration: 0.16, says: 'this is the control the tour describes now' },
  /** The tour window's reel and words travel `amplitude` px out the way the run went and the next
   *  card's in from the other side, crossing over; the words follow the reel by `stagger`, and the
   *  leaving card goes over `outShare` of the arrival. */
  'tour.copy.swap': {
    tier: 'inform', curve: 'punchy', duration: TOUR_CROSS_S, amplitude: 24, stagger: 0.04, outShare: 0.6,
    says: 'the tour moved on to the card that way',
  },
  /** After a part is pressed, a reel's bars follow the clip's time exponentially to it, `duration` the
   *  time constant; steady play and the loop's restart stand at the clip's own time. */
  'tour.reel.seek': { tier: 'inform', curve: 'easeOut', duration: 0.06, says: 'the reel now plays from here' },
  /** A reel's frame, mark, bars and caption travel from their place in the card to the enlarged plate
   *  and back (`primitives/morph.ts:morphScope`), the plate growing with them from round the frame; a
   *  caption that re-flows crosses over in `outShare`, and the dim and the mark's glyphs cross over the
   *  whole motion. */
  'tour.reel.enlarge': { tier: 'inform', curve: 'punchy', duration: 0.34, outShare: 0.4, fadeCurve: 'fade', says: 'the demonstration is shown large, or back in its card' },
  /** A tips card's reel and words, dragged by a swipe too short to turn the card, spring back into place. */
  'tour.card.swipe': { tier: 'inform', curve: 'stiff', says: 'the card stays where it was' },
  /** The tour window's height follows its incoming card. */
  'tour.card.resize': { tier: 'inform', curve: 'punchy', duration: TOUR_CROSS_S, says: 'the window fits the card it now shows' },
  /** A Show me's callout pops beside the control it rings; its scale settles continuously so it never snaps at the end. */
  'tour.card.pop': { tier: 'inform', curve: 'bouncy', settleScale: true, says: 'this callout describes the control it rings' },
  /** Stagger: each anchor's grab lands this long after the one before it. */
  'curve.fade': { tier: 'inform', curve: 'easeOut', duration: 0.18, stagger: 0.045, says: 'the curve controls changed' },
  'notice.leave': { tier: 'inform', curve: 'accel', duration: 0.2, says: 'the notice is dismissed' },
  'notice.crossfade': { tier: 'inform', curve: 'fade', duration: 0.22, says: 'the arrival detail changed' },
  /** The arrival notice's row eases to the width of its new line. */
  'notice.resize': { tier: 'inform', curve: 'gentle', says: 'the notice fits its new line' },
  /** A 3D shot in the export strip opens or closes its slot. */
  'export.shot.resize': { tier: 'inform', curve: 'gentle', says: 'the shot list changed' },
  'export.total': { tier: 'inform', curve: 'roll', duration: 0.6, says: 'the export size changed' },
  'export.tint': { tier: 'inform', curve: 'swing', duration: 0.7, says: 'the export size increased or decreased' },
  'preview.zoom': { tier: 'inform', curve: 'ease', duration: 0.08, says: 'the preview zoom changed' },
  /** The interface scale follows its setting exponentially; `duration` is the follow's time constant
   *  (a 60 Hz frame closes a fifth of the gap). */
  'ui.zoom.follow': { tier: 'inform', curve: 'easeOut', duration: 0.075, says: 'the interface is resizing to the scale you chose' },
  /** The chrome travels and resizes from its arrangement for the old input mode to the new one's
   *  (`primitives/morph.ts`), a surface only one mode has arriving over the rest after `outShare`, and
   *  content that leaves or re-flows inside a surface crossing what replaces it over `outShare`;
   *  reduced motion steps to the new size. */
  'shell.mode.resize': { tier: 'inform', curve: 'punchy', duration: 0.3, outShare: 0.5, fadeCurve: 'fade', says: 'the interface is sized for the input you are using now' },
  /** The frame's chrome travels from its old arrangement to its new one when the layout shape flips
   *  (`primitives/morph.ts`), a surface only one arrangement has arriving over the rest after
   *  `outShare`, and content that leaves or re-flows inside a surface crossing what replaces it over
   *  `outShare`; reduced motion re-arranges at once. */
  'shell.shape.morph': { tier: 'inform', curve: 'punchy', duration: 0.42, outShare: 0.5, fadeCurve: 'fade', says: 'these are the same controls, standing where the turned screen puts them' },
  /** A folded mode row's stack unfolds into the row and folds back, each tile travelling between the
   *  stack and its place (`shell/controls/ModeRow.tsx:ModeTiles`); reduced motion re-arranges at once. */
  'shell.row.fold': { tier: 'inform', curve: 'punchy', duration: 0.26, says: 'these are the modes, folded into one stack' },
  /** The dock's seam handle fades in once the dock has formed under it. */
  'dock.handle.arrive': { tier: 'inform', curve: 'fade', duration: 0.2, says: 'the dock can be resized from here' },
  /** The tiles behind a folded stack's front, the open mode's caption and the corner actions the
   *  unfolded row passes over fade with the fold, on a curve that never crosses most of the way in one frame. */
  'shell.row.fade': { tier: 'inform', curve: 'fade', duration: 0.26, says: 'these modes are behind the stack, and the stack shows no words' },
  /** The upright bottom bar's surface grows into the open mode's panel and back, as one surface. */
  'shell.bar.expand': { tier: 'inform', curve: 'punchy', duration: 0.26, says: 'this panel is the bar you pressed, opened' },
  /** A Help figure's spotlight and its name plate travel to the corner being described. */
  'help.figure.spotlight': { tier: 'inform', curve: 'ease', duration: 0.4, says: 'the figure now describes this part' },
  /** A Help figure's marks fade in and out with its script. */
  'help.figure.fade': { tier: 'inform', curve: 'ease', duration: 0.2, says: 'the figure shows this mark now' },
  /** A Help figure's pictured pointer glides to its next target. */
  'help.figure.pointer': { tier: 'inform', curve: 'fade', duration: 0.6, says: 'the pointer moves to the next control' },
  /** In a window too narrow for two columns, the page list and the chosen page each fill Help; the
   *  page arrives from the end side and the list from the start side, `amplitude` px away. */
  'help.screen': { tier: 'inform', curve: 'ease', duration: 0.24, amplitude: 24, says: 'the window now shows the page list or the chosen page' },
  'help.highlight': { tier: 'inform', curve: 'ease', duration: 0.4, says: 'this is the requested section' },
  'help.highlight.leave': { tier: 'inform', curve: 'ease', duration: 1.2, says: 'the requested section has been reached' },
  'loading.dots': { tier: 'inform', curve: 'breathing', duration: 0.72, stagger: 0.14, loop: true, says: 'work is in progress' },
  'settings.cell.drop': {
    tier: 'sample', curve: 'toss', fallCurve: 'gravity', duration: 1.25, loop: true, amplitude: 22.5,
    tracks: { full: CELL_BOUNCE, reduced: CELL_LAND }, previews: 'the motion preference',
  },

  /** One map tile arrives per asset-preload slice. */
  'splash.tile.plop': {
    tier: 'ambient', curve: 'bouncy', amplitude: 26, amplitudeUnit: 'px',
  },
  /** The boot logo travels from the centered loader to the masthead. */
  'splash.logo.travel': {
    tier: 'ambient', curve: 'punchy', duration: 0.5, amplitude: 160, amplitudeUnit: 'px',
  },
  /** The map and the pill fading up once the logo has landed. */
  'splash.content.fade': {
    tier: 'ambient', curve: 'punchy', duration: 0.35, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** The stadium button's fill sweeping to the fetched share. */
  'splash.pill.fill': {
    tier: 'inform', curve: 'punchy', duration: 0.28,
    says: 'this share of the download is on the device',
  },
  /** The splash and app slide apart during handoff. */
  'splash.handoff': {
    tier: 'ambient', curve: 'swing', duration: 0.5, amplitude: 900, amplitudeUnit: 'px',
  },
  /** Selection plates enter and leave independently instead of traveling between mode blocks. */
  'mode.plate.arrive': {
    tier: 'inform', curve: 'stiff',
    says: 'this is the block you are building in',
  },
  'mode.plate.leave': {
    tier: 'inform', curve: 'stiff',
    says: 'the block you were building in is no longer the one',
  },
  /** The bar for the mode being left. */
  'mode.bar.leave': {
    tier: 'inform', curve: 'stiff',
    says: 'the tools you were using are no longer the ones on the map',
  },
  /** The bar for the mode being entered. */
  'mode.bar.enter': {
    tier: 'inform', curve: 'stiff',
    says: 'these are the tools the map is armed with now',
  },
  /** The name under the selected block. */
  'mode.caption.swap': {
    tier: 'inform', curve: 'stiff',
    says: 'what you are building is now this',
  },
  /** The fixed frame fades in with the map; transforms would change its descendants' containing block. */
  'frame.arrive': {
    tier: 'ambient', curve: 'punchy', duration: 0.8, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** Frame conceal and reveal use separate timings. */
  'frame.veil': {
    tier: 'ambient', curve: 'punchy', duration: 0.34, amplitude: 1, amplitudeUnit: 'opacity',
  },
  'frame.unveil': {
    tier: 'ambient', curve: 'punchy', duration: 0.12, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** The bottom shelf's edge vignette travels its full depth on the shelf's transition timing. */
  'screen.seam.shade': {
    tier: 'ambient', curve: 'punchy', duration: 0.3, amplitude: VIGNETTE_DEPTH,
  },
  /** Undo and redo yield their rail space when the layer stack expands. */
  'rail.history.yield': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'the layer stack has this part of the column now',
  },
  /** Rail buttons retain their identity as their group folds into additional columns. */
  'rail.group.reflow': {
    tier: 'inform', curve: 'stiff',
    says: 'these are the same buttons, in the shape this window has room for',
  },
  /** Neighboring control groups yield space when the workspace changes shape. */
  'frame.layout.adapt': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'the controls keep their places relative to each other as space changes',
  },
  /** The layer stack's plate and rows resize together as one persistent control. */
  'layer.mode.resize': {
    tier: 'inform', curve: 'stiff',
    says: 'this is the same stack of floors, at the size you just asked for',
  },
  /** A locked floor's tint arrives fast when it refuses a paint and leaves slowly, so a drag along it reads as one steady tint. */
  'layer.lock.refuse': { tier: 'inform', curve: 'easeOut', duration: 0.12, says: 'this locked floor refused the paint' },
  'layer.lock.release': { tier: 'inform', curve: 'easeOut', duration: 0.35, says: 'the refusal is over' },
  /** Layer selection and hover plates fade through the same fill property. */
  'layer.select.fade': {
    tier: 'ambient', curve: 'settle', duration: 0.15, amplitude: 1, amplitudeUnit: 'opacity',
  },
  'planet.choice.select': {
    tier: 'inform', curve: 'punchy', duration: 0.18,
    says: 'this is the selected destination for the planet change',
  },
  /** The Change Planet preview crossfades to the planet just chosen. */
  'planet.preview.swap': {
    tier: 'inform', curve: 'ease', duration: 0.18,
    says: 'the preview shows the planet you chose',
  },
  /** The preview's tools come and go with a saved planet, which is the only kind they act on. */
  'planet.tools.offer': {
    tier: 'inform', curve: 'punchy', duration: 0.16, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'this planet is yours to edit, rename, copy, export or delete',
  },
  /** The video import's picture: ground the scan has just read fades in, the picture widens to
   *  what it has read and the camera's view glides after the camera (the time to cover most of
   *  the way), and the planet it read takes the picture's place. */
  'scan.preview.reveal': { tier: 'inform', curve: 'easeOut', duration: 0.4, says: 'the import has read this ground' },
  'scan.preview.follow': { tier: 'inform', curve: 'ease', duration: 0.6, says: 'the import has read further' },
  'scan.preview.finish': { tier: 'inform', curve: 'ease', duration: 0.5, says: 'the planet the import read is ready' },
  /** The planet session's chunk frame flashes once when a ground stroke reaches past the canvas. */
  'planet.frame.flash': {
    tier: 'inform', curve: 'ease', duration: 0.9,
    says: 'the planet is at its size limit',
  },
  /** The 3D-only yaw controls enter and leave without reflowing controls above them. */
  'rail.yaw.offer': {
    tier: 'inform', curve: 'punchy', duration: 0.16, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'turning the camera is something this view can do',
  },
  /** The mark behind the candidate a person chose. */
  'candidate.chosen': {
    tier: 'inform', curve: 'punchy', duration: 0.18,
    says: 'this is the recipe that will be built',
  },
  /** The ring around the armed item. */
  'item.armed': {
    tier: 'inform', curve: 'punchy', duration: 0.18,
    says: 'this is the piece the map will place',
  },
  /** An item card rising off the shelf while it is carried to the map, and settling back when it ends. */
  'item.carry.lift': {
    tier: 'inform', curve: 'stiff', amplitude: 0.1, amplitudeUnit: 'scale', settleScale: true,
    says: 'this piece is in your hand, and letting go over the map places it',
  },
  /** A candidate photograph settles over its loading state when asynchronous capture completes. */
  'candidate.shot.arrive': {
    tier: 'inform', curve: 'punchy', duration: 0.22, amplitude: 0.05, amplitudeUnit: 'scale',
    says: 'the picture of what this recipe builds is ready',
  },
  /** The custom candidate flips between a recipe field and its equal-sized preview. */
  'candidate.custom.flip': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 0.06, amplitudeUnit: 'scale',
    says: 'this card is a recipe number you type, and this is the map it makes',
  },
  /** Restore-offer choreography orders the card, copy and actions; its countdown remains informative. */
  'restore.offer.arrive': {
    tier: 'ambient', curve: 'punchy', duration: 0.24, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** The answered restore offer leaves before revealing the map. */
  'restore.offer.leave': {
    tier: 'ambient', curve: 'punchy', duration: 0.18, amplitude: 10,
  },
  /** The restore photograph rises first in the offer choreography. */
  'restore.card.arrive': {
    tier: 'ambient', curve: 'stiff', amplitude: 20,
  },
  /** Restore copy and actions arrive on successive beats of one motion. */
  'restore.words.arrive': {
    tier: 'ambient', curve: 'punchy', duration: 0.22, amplitude: 10,
  },
  /** A rail button grows and reveals its name without moving neighboring pointer targets. */
  'rail.name.reach': {
    tier: 'inform', curve: 'stiff',
    amplitude: HOVER_GROWTH, amplitudeUnit: 'scale',
    says: 'the button you are pointing at is called this, and it felt you arrive',
  },
  /** The name of the card under the pointer, which the card itself does not carry. */
  'item.name.reach': {
    tier: 'inform', curve: 'punchy', duration: 0.14,
    says: 'the piece you are pointing at is called this',
  },
  /** Long item names travel through their measured overrun; reduced motion wraps the text instead. */
  'item.name.marquee': {
    tier: 'ambient', curve: 'swing', duration: 8, loop: true, amplitude: 12,
  },
  /** A tool plate coordinates its active fill, bounds and optional setting pill. */
  'tool.plate.shape': {
    tier: 'inform', curve: 'stiff',
    says: 'this is the tool the map is armed with, and this is what it carries',
  },
  /** The object shelf's search button grows along its row into the search field, and back; on a wide
   *  shelf short of room the field shrinks into the button, and grows back out of it. */
  'shelf.search.expand': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'this field and the search button are one control',
  },
  /** The wide object shelf's brush button grows along the names' row into a pill naming the way to
   *  place while a mouse rests on it, the search field beside it shrinking by as much, and back. */
  'shelf.brush.expand': {
    tier: 'inform', curve: 'punchy', duration: 0.22,
    says: 'this is how the next press places',
  },
  /** The upright object shelf's cards travel between its one sideways row and its grid when its room
   *  crosses two rows (`primitives/morph.ts:morphScope`); a card scrolled out of view fades in over the rest. */
  'shelf.layout.morph': {
    tier: 'inform', curve: 'punchy', duration: 0.34, outShare: 0.4,
    says: 'these are the same cards, laid out for the room the panel has now',
  },
  /** Shelf contents swap beneath a stationary category row. */
  'shelf.category.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 14,
    says: 'these are the things the category you just chose offers',
  },
  /** Slider name and value appear over the active knob and remain available under reduced motion. */
  'slider.reading': {
    tier: 'inform', curve: 'stiff', amplitude: 4,
    says: 'this is the setting you are holding, and where it stands',
  },
  /** A slider's knob and fill follow its value to each stop a press, a drag or a key moves it to, settling in about a tenth of a second so they never trail the finger. */
  'slider.glide': { tier: 'inform', curve: 'stiff', says: 'the slider now stands at this stop' },
  /** A control both tools offer stays put across a tool switch and glides to its place in the new row. */
  'tool.control.morph': {
    tier: 'inform', curve: 'punchy', duration: 0.28,
    says: 'this is the same control, carried over to the tool you switched to',
  },
  /** The size slider takes the length its row now leaves it, its right end standing still. */
  'tool.size.resize': {
    tier: 'inform', curve: 'punchy', duration: 0.28,
    says: 'this is the same slider, at the length its row has room for',
  },
  /** The armed tool's plate slides under the row to the tool just chosen. */
  'tool.highlight.slide': {
    tier: 'inform', curve: 'stiff',
    says: 'the map is now armed with this tool instead of that one',
  },
  /** A control only the new tool offers fades in once the old tool's own controls have gone. */
  'tool.control.enter': {
    tier: 'inform', curve: 'punchy', duration: 0.16,
    says: 'this control belongs to the tool you switched to',
  },
  /** A control only the old tool offered fades where it stood, out of the row's flow. */
  'tool.control.leave': {
    tier: 'inform', curve: 'punchy', duration: 0.12,
    says: 'this control belonged to the tool you put down',
  },
  /** The selection plate and option names reshape together without scaling their contents. */
  'tool.option.select': {
    tier: 'inform', curve: 'punchy', duration: 0.28,
    says: 'this is the selected shape or corner treatment',
  },
  /** A custom tag grows into the Notes tag row where it was added. */
  'tag.pill.arrive': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'this tag has joined the row',
  },
  /** A removed custom tag shrinks out of the row. */
  'tag.pill.leave': {
    tier: 'inform', curve: 'punchy', duration: 0.14,
    says: 'this tag has left the row',
  },
  /** Each custom tag wears a removal badge while the row is removing tags. */
  'tag.remove.badge': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 0.5, amplitudeUnit: 'scale',
    says: 'pressing this tag removes it',
  },
  /** The Done and Discard pair rises into the tool row while a note draft stands. */
  'draft.actions.arrive': {
    tier: 'inform', curve: 'punchy', duration: 0.22, amplitude: 10,
    says: 'the strokes so far are one unfinished note, and this is how it ends',
  },
  /* Character poses own their WAAPI tracks; this registry covers surrounding UI motion. */
  /** Shelf wheel input closes on its horizontal target exponentially; duration is the time constant. */
  'shelf.row.wheel-glide': {
    tier: 'ambient', curve: 'punchy', duration: 0.09, amplitude: 40, amplitudeUnit: 'px',
  },
  /* Assistant motions cover panel state, job progress, setup and the hosted character. */
  /** The panel wipe and hosted-character step share one clock and the character's seat origin. */
  'panel.open': {
    tier: 'inform', curve: 'punchy', duration: 0.32, amplitude: 1, amplitudeUnit: 'opacity',
    says: 'the desk that just opened is the assistant you pressed',
  },
  /** The panel folds to the character button on the same clock used by the first dock-transition beat. */
  'panel.close': {
    tier: 'inform', curve: 'punchy', duration: FORM_LEAVE_S, amplitude: 1, amplitudeUnit: 'opacity',
    says: 'the assistant you were talking to has gone back to her button',
  },
  /** The panel animates its real height when visible content changes. */
  'panel.height': {
    tier: 'inform', curve: 'punchy', duration: PANEL_HEIGHT_S,
    says: 'the panel now holds a different amount of standing content',
  },
  /** Crossfades in-place dock updates that do not change the session-state identity. */
  'panel.dock.paper': {
    tier: 'inform', curve: 'punchy', duration: 0.24,
    says: 'the assistant has moved from one state to another',
  },
  /** Live status text changes stay legible throughout their brief emphasis. */
  'panel.status.update': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 0.35, amplitudeUnit: 'opacity',
    says: 'the current operation has changed while the same task continues',
  },
  /** Flips the dock card for a session-state identity change; in-place text updates use dock.paper. */
  'panel.dock.flip': {
    tier: 'inform', curve: 'punchy', duration: 0.28, outShare: 0.54,
    outCurve: 'accel', overshootAt: 0.66, landCurve: 'settle',
    says: 'the assistant has moved to a different session state, not just repainted the one it was in',
  },
  /** A new operation row rises onto the ticket. */
  'panel.op.enter': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 12, amplitudeUnit: 'px',
    says: 'this step is new since you last looked at the ticket',
  },
  /** The existing operation mark scales once when a running row settles. */
  'panel.tick.settle': {
    tier: 'inform', curve: 'punchy', duration: 0.34, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'this step is done, and this is how it went',
  },
  /** The marked-region outline pulses when an out-of-region write rolls the call back. */
  'panel.region.pulse': {
    tier: 'inform', curve: 'punchy', duration: 0.6, amplitude: 0.45, amplitudeUnit: 'opacity',
    says: 'your region held, and this is its edge',
  },
  /** A completion check lands on a newly finished plan stage. */
  'panel.plan.check': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 0.4, amplitudeUnit: 'scale',
    says: 'this stage of the plan is behind you',
  },
  /** A blocking question card grows in place when the record pauses for an answer. */
  'panel.gate.enter': {
    tier: 'inform', curve: 'stiff', amplitude: 0.03, amplitudeUnit: 'scale',
    says: 'nothing further happens until you answer this',
  },
  /** A gate verdict rises onto the card when the question becomes a settled record line. */
  'panel.gate.verdict': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 12, amplitudeUnit: 'px',
    says: 'this gate has an answer now',
  },
  /** Answered ask cards fan from and restack into their in-place deck. */
  'panel.gate.deck': {
    tier: 'inform', curve: 'punchy', duration: 0.22,
    says: 'these are the answered asks the deck was holding, standing where they were answered',
  },
  /** The parked character's status chip indicates that work continues while the panel is closed. */
  'panel.chip.hero': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'the assistant is still working on the map while the panel is shut',
  },
  /** The hosted character scales between floating and docked forms with a weighted landing. */
  'panel.character.pop': {
    tier: 'inform', curve: 'punchy', duration: CHARACTER_POP_S,
    overshootAt: 0.62, landCurve: 'settle',
    outShare: FORM_LEAVE_S / CHARACTER_POP_S, outCurve: 'accel',
    amplitude: 0.34, amplitudeUnit: 'scale',
    says: 'the assistant is sitting at this desk now',
  },
  /** Character hover uses the same growth and spring as neighboring controls. */
  'panel.character.hover': {
    tier: 'ambient', curve: 'stiff', amplitude: HOVER_GROWTH, amplitudeUnit: 'scale',
  },
  /** The interface sheet and ground share one clock while making room for a docked panel. */
  'panel.pin.slide': {
    tier: 'inform', curve: 'punchy', duration: 0.3,
    says: 'the interface and the panel are sharing the window',
  },
  /** Side switching accelerates through the fully covered midpoint and settles at the destination. */
  'panel.pin.cross': {
    tier: 'inform', curve: 'punchy', duration: 0.26, outShare: 1, outCurve: 'accel',
    says: 'the panel is going to the other end of the window, and this is one crossing',
  },
  /** A typed note grows into its place in the next-step queue. */
  'panel.steer.chip': {
    tier: 'inform', curve: 'stiff', amplitude: 0.1, amplitudeUnit: 'scale',
    says: 'what you typed is queued for the next step, not for this one',
  },
  /** A note consumed by the next step lifts out of the queue; recalled notes reverse their entry. */
  'panel.steer.deliver': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 26, amplitudeUnit: 'px',
    says: 'this note has left the queue and gone into the step it was queued for',
  },
  /** Each retry-countdown digit rolls upward as the wait shortens. */
  'panel.retry.digit': {
    tier: 'inform', curve: 'punchy', duration: 0.12, amplitude: 8, amplitudeUnit: 'px',
    says: 'the wait is shorter than it was a second ago',
  },
  /** Setup groups move with the panel-height transition when the active step changes. */
  'panel.setup.step': {
    tier: 'inform', curve: 'punchy', duration: PANEL_HEIGHT_S,
    says: 'these are the same controls, standing somewhere else now',
  },
  /** A refused setup key shakes once; static error styling carries the state under reduced motion. */
  'panel.setup.refuse': {
    tier: 'ambient', curve: 'punchy', duration: 0.32, amplitude: 4, amplitudeUnit: 'px',
  },
  /** The composer field preserves one element while changing between compact and paragraph sizes. */
  'panel.composer.unfold': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'this is the same field you were typing in, at the size a paragraph needs',
  },
  /** The finished-jobs strip and its chevron share one open-and-close clock. */
  'panel.history.fold': {
    tier: 'inform', curve: 'punchy', duration: 0.22,
    says: 'the jobs that are already finished are folded away here',
  },
  /** The thoughts disclosure animates its own bounded height while record auto-follow is suspended. */
  'panel.thoughts.open': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'this is the thinking behind the row you pressed',
  },
  /** Duration caps a streamed burst; stagger is the ordinary interval between graphemes. */
  'panel.thoughts.stream': {
    tier: 'inform', curve: 'linear', duration: 0.24, stagger: 0.012,
    says: 'new thoughts are arriving',
  },
  /** Shared unfold timing for operation details, full prose and management verdicts. */
  'panel.detail.unfold': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'here is the rest of what this element holds',
  },
  /** Incoming screens and the composer share one reveal after the previous screen unmounts. */
  'panel.zone.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.14, amplitude: 8, amplitudeUnit: 'px',
    says: 'the panel switched to the screen your press asked for',
  },
  /** Active construction tape moves exactly one stripe period per seamless linear cycle. */
  'panel.tape.crawl': {
    tier: 'ambient', curve: 'linear', duration: 1.6, loop: true,
    amplitude: TAPE_STRIPE_PX, amplitudeUnit: 'px',
  },
  /** The streaming-text caret uses a discrete opacity blink; duration covers one full cycle. */
  'panel.says.caret': {
    tier: 'ambient', curve: 'linear', duration: 1, loop: true, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** A replacement badge uses a baked three-keyframe overshoot after the swap gap. */
  'panel.badge.pop': {
    tier: 'inform', curve: 'linear', duration: 0.28,
    says: 'this is the badge the assistant is wearing now',
  },
  /** Both ticket faces remain mounted while one card rotates between them. */
  'panel.ticket.flip': {
    tier: 'inform', curve: 'punchy', duration: 0.55,
    says: 'this ticket has another side, and it is the same ticket',
  },
  /** Construction-tape width advances to the completed fraction of the plan. */
  'panel.tape.fill': {
    tier: 'inform', curve: 'punchy', duration: 0.5,
    says: 'this much of the plan is behind you',
  },
  /** Receipt statistics count once from zero and decelerate into their final values. */
  'panel.stat.count': {
    tier: 'inform', curve: 'settle', duration: 0.7,
    says: 'this is what the job actually built',
  },
  /* Stylize motions cover the connection form and studio contents inside the shared modal shell. */
  /** Stylize pages leave before the next page enters from the side. */
  'stylize.page.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.32, outShare: 0.5, outCurve: 'accel',
    amplitude: 16, amplitudeUnit: 'px',
    says: 'this is the window\'s other page, not a change to the one you were on',
  },
  /** Page parts arrive in reading order with a shared stagger. */
  'stylize.row.stagger': {
    tier: 'ambient', curve: 'punchy', duration: 0.4, stagger: 0.05, amplitude: 8, amplitudeUnit: 'px',
  },
  /** Custom-provider setup opens its endpoint-address row between key and model. */
  'stylize.address.unfold': {
    tier: 'inform', curve: 'punchy', duration: 0.3,
    says: 'this connection is one you name yourself, so it needs an address',
  },
  /** The model row's border flashing as a list lands in it. */
  'stylize.model.arrive': {
    tier: 'inform', curve: 'punchy', duration: 0.8,
    says: 'the endpoint answered, and these are the models it will run',
  },
  /** The primary verb growing once the last ingredient it was waiting on stands. */
  'stylize.button.arm': {
    tier: 'inform', curve: 'punchy', duration: 0.4, amplitude: 0.07, amplitudeUnit: 'scale',
    says: 'the connection is complete and this can be pressed now',
  },
  /** New content enters within the permanent status slot. */
  'stylize.status.pop': {
    tier: 'inform', curve: 'punchy', duration: 0.3,
    says: 'the status line has something it did not say a moment ago',
  },
  'export.preview.status': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'the preview has moved to its next preparation task',
  },
  /** A refused field shakes horizontally while static error styling preserves the evidence. */
  'stylize.fail.shake': {
    tier: 'inform', curve: 'swing', duration: 0.4, amplitude: 5, amplitudeUnit: 'px',
    says: 'this is the field the refusal is about',
  },
  /** Three sample cards breathe on the connection page. */
  'stylize.deck.breathe': {
    tier: 'ambient', curve: 'swing', duration: 5.5, loop: true, stagger: 1.8, amplitude: 6, amplitudeUnit: 'px',
  },
  /** The canvas crossfades between visual treatments of the same map. */
  'stylize.canvas.crossfade': {
    tier: 'inform', curve: 'punchy', duration: 0.5,
    says: 'this is the same map drawn another way, not another map',
  },
  /** The two pictures changing places when the corner one is pressed. */
  'stylize.pip.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.3, amplitude: 0.04, amplitudeUnit: 'scale',
    says: 'the picture you were looking at and the one in the corner have changed places',
  },
  /** A finished picture arriving on the shelf, out of the skeleton that was standing for it. */
  'stylize.card.enter': {
    tier: 'inform', curve: 'punchy', duration: 0.5, amplitude: 0.14, amplitudeUnit: 'scale',
    says: 'this take has just been drawn',
  },
  /** Indeterminate image progress slows across 90% of its track and never claims completion. */
  'stylize.progress.creep': {
    tier: 'ambient', curve: 'settle', duration: 28, amplitude: 0.9, amplitudeUnit: 'scale',
  },
  /** A retired picture leaves the shelf. */
  'stylize.shelf.retire': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'that picture is off the shelf for good',
  },
  /** A retired slot closes its width and gap so surviving cards reflow continuously. */
  'stylize.shelf.settle': {
    tier: 'inform', curve: 'settle', duration: 0.32,
    says: 'the shelf has closed the gap the retired picture left',
  },
  /** The fixed-size pane turns to the selected direction. */
  'stylize.pane.turn': {
    tier: 'inform', curve: 'punchy', duration: 0.3,
    says: 'the pane is showing the direction you just picked',
  },
  /** The selection ring travels between booklet rows or shelf pictures. */
  'stylize.select.ring': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'this is the one that is chosen now',
  },
  /** The entry button's outer style cards fan five pixels on hover. */
  'stylize.entry.fan': {
    tier: 'ambient', curve: 'bouncy', amplitude: 5, amplitudeUnit: 'px',
  },
  /** The hero deck follows the pointer with decreasing travel through its card stack. */
  'stylize.deck.follow': {
    tier: 'ambient', curve: 'stiff', amplitude: 7, amplitudeUnit: 'px',
  },
  /** A press tosses the front sample card and advances the deck. */
  'stylize.deck.shuffle': {
    tier: 'inform', curve: 'bouncy',
    says: 'that press turned the deck to another style sample',
  },
} as const satisfies Record<string, Motion>;

export type MotionId = keyof typeof MOTIONS;

/** Ids of the motions that preview a setting. */
export type SampleMotionId = { [K in MotionId]: (typeof MOTIONS)[K]['tier'] extends 'sample' ? K : never }[MotionId];

export { CURVES } from './curves';
