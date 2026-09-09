/*
 * Central registry for shell and assistant motion. Inform motions reinforce visible state and remain
 * meaningful with reduced motion; ambient motions are decorative and are removed. Call sites use ids.
 */
import { pressable } from '../../design/styles';
import { VIGNETTE_DEPTH } from '../../design/tokens';
import { tape } from '../../agent/tokens';
import type { CurveId } from './curves';

/** Shared button hover growth as a fraction of the button. */
const HOVER_GROWTH = pressable.whileHover.scale - 1;

/** Duration of one complete gesture-tour demonstration, in seconds. */
const TOUR_REP_S = 2.7;
/** How many buttons a diagram that teaches "any button" has to get through, one rep each. */
const TOUR_BUTTONS = 3;

/** Construction-tape travel per cycle; matching the stripe period prevents a seam jump. */
const TAPE_STRIPE_PX = tape.stripeSize;

/** Shared floating-panel and hosted-character departure time, in seconds. */
const FORM_LEAVE_S = 0.16;

/** Hosted-character arrival time, in seconds. */
const CHARACTER_POP_S = 0.3;

/** Shared panel-height and setup-step transition time, in seconds. */
const PANEL_HEIGHT_S = 0.24;

/** Below this a displacement reads as jitter rather than as motion. */
export const AMPLITUDE_FLOOR_PX = 4;
/** The same floor for a motion that scales rather than moves. */
export const AMPLITUDE_FLOOR_SCALE = 0.03;
/** Minimum opacity range for a visible ambient fade. */
export const AMPLITUDE_FLOOR_OPACITY = 0.2;

interface Base {
  curve: CurveId;
  /** Tween duration or full loop cycle, in seconds; springs carry their own timing. */
  duration?: number;
  /** Repeats a tween for as long as its state remains active. */
  loop?: true;
  /** A burst inside this window produces one settled beat rather than N stacked. Milliseconds. */
  coalesce?: number;
  /** Maximum travel in CSS pixels, or a fraction for scale and opacity. Required for ambient motion. */
  amplitude?: number;
  amplitudeUnit?: 'px' | 'scale' | 'opacity';
  /** Delay between successive members of a group, in seconds. */
  stagger?: number;
  /** Fraction of duration used for a flip's departure; undefined uses the full duration. */
  outShare?: number;
  /** Optional departure curve when it differs from the landing curve. */
  outCurve?: CurveId;
  /** Fraction of entry time at which a flip reaches its overshoot keyframe. */
  overshootAt?: number;
  landCurve?: CurveId;
}

export interface InformMotion extends Base {
  tier: 'inform';
  /** Static interface fact reinforced by this motion. */
  says: string;
}

export interface AmbientMotion extends Base {
  tier: 'ambient';
  amplitude: number;
}

export type Motion = InformMotion | AmbientMotion;

export const MOTIONS = {
  /** One island tile arrives per asset-preload slice. */
  'splash.tile.plop': {
    tier: 'ambient', curve: 'bouncy', amplitude: 26, amplitudeUnit: 'px',
  },
  /** The boot logo travels from the centered loader to the masthead. */
  'splash.logo.travel': {
    tier: 'ambient', curve: 'punchy', duration: 0.5, amplitude: 160, amplitudeUnit: 'px',
  },
  /** The island and the pill fading up once the logo has landed. */
  'splash.content.fade': {
    tier: 'ambient', curve: 'punchy', duration: 0.35, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** The stadium button's fill sweeping to the fetched share. */
  'splash.pill.fill': {
    tier: 'inform', curve: 'punchy', duration: 0.28,
    says: 'this share of the art is on the device',
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
  /** Layer selection and hover plates fade through the same fill property. */
  'layer.select.fade': {
    tier: 'ambient', curve: 'settle', duration: 0.15, amplitude: 1, amplitudeUnit: 'opacity',
  },
  'planet.choice.select': {
    tier: 'inform', curve: 'punchy', duration: 0.18,
    says: 'this is the selected destination for the planet change',
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
  /** A tool setting folds between its word and compact circle. */
  'chip.fold': {
    tier: 'inform', curve: 'stiff',
    says: 'this setting is doing this now',
  },
  /* Character poses own their WAAPI tracks; this registry covers surrounding UI motion. */
  /** Shelf wheel input closes on its horizontal target exponentially; duration is the time constant. */
  'shelf.row.wheel-glide': {
    tier: 'ambient', curve: 'punchy', duration: 0.09, amplitude: 40, amplitudeUnit: 'px',
  },
  /* Gesture diagrams share one repetition clock and retain static end-state cues under reduced motion. */
  /** A held pointer and map travel together. */
  'tour.gesture.drag': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S, loop: true,
    amplitude: 26, amplitudeUnit: 'px',
    says: 'the map follows a held button across the screen',
  },
  /** Demonstrates each mouse button independently for one full repetition. */
  'tour.gesture.cycle': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S * TOUR_BUTTONS, loop: true,
    says: 'each mouse button on its own does this, and here is every one of them in turn',
  },
  /** The wheel beat, in the second half of a rep: the map comes closer and goes back. */
  'tour.gesture.wheel': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S, loop: true,
    amplitude: 0.16, amplitudeUnit: 'scale',
    says: 'the wheel brings the map closer and takes it away again',
  },
  /** A brush crossing the map, with the ground appearing behind it. */
  'tour.gesture.stroke': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S, loop: true,
    amplitude: 58, amplitudeUnit: 'px',
    says: 'a brush lays ground along the path it is dragged',
  },
  /** Cycles through the 3D slide and orbit gestures; amplitude records the linear slide. */
  'tour.gesture.orbit': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S * TOUR_BUTTONS, loop: true,
    amplitude: 14, amplitudeUnit: 'px',
    says: 'in 3D a left drag slides the island and a right or middle drag turns it',
  },
  /** Tips the flat-map diagram into its 3D view; angular travel has no registry amplitude unit. */
  'tour.gesture.tilt': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S, loop: true,
    says: 'the flat map and the 3D one are the same map, seen from beside it',
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
  /** A destructive button expands in place into its confirmation question while its fill changes. */
  'panel.confirm.arm': {
    tier: 'inform', curve: 'punchy', duration: 0.18,
    says: 'this button is now the question, and pressing it again answers it',
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
  /** Shared unfold timing for operation details, full prose and management verdicts. */
  'panel.detail.unfold': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'here is the rest of what this element holds',
  },
  /** Job-zone screens leave before their replacement rises in, keeping one scroller mounted at a time. */
  'panel.zone.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.14, amplitude: 8, amplitudeUnit: 'px',
    says: 'the panel switched to the screen your press asked for',
  },
  /** Indeterminate construction tape moves exactly one stripe period per seamless linear cycle. */
  'panel.tape.crawl': {
    tier: 'ambient', curve: 'linear', duration: 1.6, loop: true,
    amplitude: TAPE_STRIPE_PX, amplitudeUnit: 'px',
  },
  /** The streaming-text caret uses a discrete opacity blink; duration covers one full cycle. */
  'panel.says.caret': {
    tier: 'ambient', curve: 'linear', duration: 1, loop: true, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** Character blink duration is the closed-eye dwell; pose code schedules jittered intervals. */
  'character.blink': {
    tier: 'ambient', curve: 'punchy', duration: 0.13, amplitude: 1, amplitudeUnit: 'scale',
  },
  /** Character badges leave before their replacement enters. */
  'character.badge.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.11,
    says: 'the assistant is doing a different kind of thing now',
  },
  /** A replacement badge uses a baked three-keyframe overshoot after the swap gap. */
  'panel.badge.pop': {
    tier: 'inform', curve: 'linear', duration: 0.28,
    says: 'this is the badge the assistant is wearing now',
  },
  /** The working badge repeats a quarter turn; amplitude records its rim travel. */
  'character.badge.spin': {
    tier: 'ambient', curve: 'linear', duration: 0.42, loop: true, amplitude: 18, amplitudeUnit: 'px',
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

export { CURVES } from './curves';
export type { CurveId } from './curves';
