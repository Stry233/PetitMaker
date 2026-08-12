/*
 * registry.ts — every motion the shell makes, declared once.
 *
 * TWO TIERS, AND THEY ARE NOT THE SAME KIND OF THING. An INFORM motion carries a fact and has a
 * static carrier behind it, so stripping it leaves the interface readable; it survives reduced
 * motion because it is feedback. An AMBIENT motion carries only warmth, has no carrier because
 * there is no fact, and reduced motion removes it entirely.
 *
 * Each tier is required to declare the thing its own failures come from. An inform entry states
 * WHAT IT SAYS, because a motion whose only answer is "looks nice" belongs in the other tier. An
 * ambient entry states its AMPLITUDE, because the one decorative motion the earlier interface
 * shipped was removed for being two pixels: below the floor, motion reads as a rendering fault
 * rather than as life.
 *
 * A call site names an id and never a number. `__tests__/ui/shell/motion-registry.test.ts` fails on a
 * duration or curve written anywhere else under `ui/shell/`.
 */
import { pressable } from '../../design/styles';
import { VIGNETTE_DEPTH } from '../../design/tokens';
import type { CurveId } from './curves';

/** How far a button grows to acknowledge the pointer, as a fraction of itself. The app's shared
 *  hover feedback (`styles.ts:pressable`), read rather than restated so a motion declared here
 *  cannot claim a travel the call site does not make. */
const HOVER_GROWTH = pressable.whileHover.scale - 1;

/** Below this a displacement reads as jitter rather than as motion. */
export const AMPLITUDE_FLOOR_PX = 4;
/** The same floor for a motion that scales rather than moves. */
export const AMPLITUDE_FLOOR_SCALE = 0.03;
/** And for one that only changes how present a thing is. Higher than the other two in its own units
 *  because a partial fade has no shape to read: under about a fifth of the range it is not a thing
 *  arriving or leaving, it is a thing flickering. */
export const AMPLITUDE_FLOOR_OPACITY = 0.2;

interface Base {
  curve: CurveId;
  /** Seconds. Required by a tween curve and forbidden on a spring, which carries its own timing.
   *  `motion-registry.test.ts` fails on either mistake. For a `loop` it is one whole cycle. */
  duration?: number;
  /** Runs again as soon as it ends, for as long as its state lasts. A loop needs a tween curve,
   *  since the length it repeats over is the tween's own. */
  loop?: true;
  /** A burst inside this window produces one settled beat rather than N stacked. Milliseconds. */
  coalesce?: number;
  /**
   * How far the moving thing travels at its furthest, in css px, or as a fraction when
   * `amplitudeUnit` is 'scale'.
   *
   * REQUIRED of an ambient motion and floor-checked; optional on an informing one, which is judged
   * by what it says rather than by how far it goes. Written here either way, because a distance
   * typed at the element is the same unfindable decision a duration typed there is.
   */
  amplitude?: number;
  amplitudeUnit?: 'px' | 'scale' | 'opacity';
}

export interface InformMotion extends Base {
  tier: 'inform';
  /** The fact this underlines, which the interface already states without it. Required, no default:
   *  writing it is the check. */
  says: string;
}

export interface AmbientMotion extends Base {
  tier: 'ambient';
  amplitude: number;
}

export type Motion = InformMotion | AmbientMotion;

export const MOTIONS = {
  /**
   * The ground under the selected block, arriving and leaving.
   *
   * It does NOT travel between blocks. One that slid along the row read as a single object being
   * carried, which is a claim about the row rather than about the block: what the mark means is
   * "this is the one", and the one it was is no longer it. So the old is destroyed and the new is
   * made, and the plate is still the beat the rest of the switch hangs off.
   */
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
  /**
   * The whole frame arriving, once, when the editor opens.
   *
   * IT SITS WITH THE MAP RATHER THAN BEFORE OR AFTER IT. The 3D scene flies the whole island in from
   * a far framing over 800 ms (`map3d/scene/scene.ts`), so the chrome takes the same length and the
   * two read as one arrival: the map comes in and the interface comes up around it. Shorter and the
   * frame is standing there waiting for the map; longer and it is still assembling once the map has
   * settled.
   *
   * PRESENCE ONLY, AND THAT IS A CONSTRAINT RATHER THAN A CHOICE. The frame's every cluster is a
   * FIXED element inside one zoomed wrapper, and a transform or a filter on that wrapper would make
   * it their containing block and drag all of them off the corners they are placed against. Opacity
   * is the one property that reaches them and leaves the layout alone.
   */
  'frame.arrive': {
    tier: 'ambient', curve: 'punchy', duration: 0.8, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /**
   * The frame going away when the interface is put aside, and coming back.
   *
   * TWO ENTRIES BECAUSE THE TWO ARE NOT THE SAME ERRAND. Going is unhurried: someone has asked for
   * the map and the frame clearing off is the last thing they are watching. Coming back is not
   * watched at all — they want a control, and every millisecond of a flourish is a millisecond
   * between reaching for it and having it. So the return is the shortest fade that is still a fade.
   */
  'frame.veil': {
    tier: 'ambient', curve: 'punchy', duration: 0.34, amplitude: 1, amplitudeUnit: 'opacity',
  },
  'frame.unveil': {
    tier: 'ambient', curve: 'punchy', duration: 0.12, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /**
   * The screen's own shading, arriving under the bottom shelf and leaving with it.
   *
   * ONE MOTION, BOTH WAYS. It is a pane sliding up past the fold and back down again, and there is
   * no fact in either direction: the shelf is what says a surface has arrived, and this only softens
   * the seam that surface makes with the map (`tokens.ts:EDGE_VIGNETTE`). So it is ambient, and
   * reduced motion drops the travel — the shading still ends up where the shelf is, it simply gets
   * there in one frame.
   *
   * WHEN it moves is not its own to choose. Both of its moments are the bar's, in the mode-switch
   * score, so the shading cannot arrive before the surface it is under.
   *
   * A TWEEN, not a spring. It travels the vignette's whole depth, and a spring's overshoot at the
   * top of that travel is the shading momentarily reaching further up the window than it settles —
   * a dark band pumping over the map, on a motion nobody is waiting for.
   */
  'screen.seam.shade': {
    tier: 'ambient', curve: 'punchy', duration: 0.3, amplitude: VIGNETTE_DEPTH,
  },
  /**
   * Undo and redo stepping down the column when the layer stack opens across their lane.
   *
   * A tween rather than a spring: the pair is not the thing being pressed, and an overshoot on a
   * control moving out of the way reads as the control reacting rather than as the panel arriving.
   * It travels the width of the whole column on a tall window and not at all on a short one, which
   * is the fact it is carrying either way.
   */
  'rail.history.yield': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'the layer stack has this part of the column now',
  },
  /**
   * A right-hand group finding its new rows when the column folds it into two files.
   *
   * The buttons are the same buttons in a different arrangement, so each one TRAVELS to its new
   * place rather than the group being redrawn: a group that reflows in a single frame reads as a
   * rendering fault, which is what the kit did until the pair learned to fold beside it.
   *
   * A spring, because the buttons are arriving somewhere rather than getting out of the way.
   */
  'rail.group.reflow': {
    tier: 'inform', curve: 'stiff',
    says: 'these are the same buttons, in the shape this window has room for',
  },
  /**
   * The layer stack changing size: the pill, the file of nine floors, and the square plate.
   *
   * ONE MOTION FOR THE WHOLE CHANGE, because it is one thing changing shape. The nine floors are
   * the same nine floors in every size, so a floor travels from where it was to where it now is and
   * the plate around them grows or shrinks under the same spring. Crossfading one plate into
   * another would say they are two panels, which is exactly what the three sizes are not.
   */
  'layer.mode.resize': {
    tier: 'inform', curve: 'stiff',
    says: 'this is the same stack of floors, at the size you just asked for',
  },
  /**
   * The two yaw buttons, which only the 3D view offers.
   *
   * ONE MOTION FOR BOTH DIRECTIONS, because it is one fact either way. They stand in the last row of
   * the kit's grid and the kit is planned for its full complement whichever view is showing, so
   * nothing above them moves while they come and go.
   */
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
  /**
   * A candidate's photograph landing on its card.
   *
   * The picture is a real generation run on a detached copy of the map, so it takes a moment and
   * the card shows dots while it is taken. It arrives rather than replacing them: a shade over its
   * frame and settling into it, which is a photograph being placed.
   *
   * ONLY A PICTURE THAT WAS WAITED FOR REVEALS. A card drawn with its shot already in hand has
   * nothing to announce, and a card that will never get one (no renderer to photograph with) must
   * not sit waiting for a reveal that is not coming.
   */
  'candidate.shot.arrive': {
    tier: 'inform', curve: 'punchy', duration: 0.22, amplitude: 0.05, amplitudeUnit: 'scale',
    says: 'the picture of what this recipe builds is ready',
  },
  /**
   * The last candidate card turning between the two things it is: a place to TYPE a recipe number,
   * and the picture of the one that was typed.
   *
   * ONE MOTION, BOTH WAYS, because it is one card showing its other face. The two states hold the
   * same rect — the field and its confirm stand exactly where the picture will be, which is what
   * makes the place to type impossible to miss — so what crosses is the content and nothing moves
   * around it.
   */
  'candidate.custom.flip': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 0.06, amplitudeUnit: 'scale',
    says: 'this card is a recipe number you type, and this is the map it makes',
  },
  /*
   * THE RESTORE OFFER ARRIVING AND LEAVING.
   *
   * It is the first surface of a session, and it is one composition rather than four things that
   * appear together: the plate, the photograph standing on it, the words beside it and the two
   * answers under them. So the arrival is a SCORE (`choreography.ts:restore.offer`) — the picture
   * first, because it is what the offer is, then what it says, then what to do about it — and each
   * beat below is one element's part of it.
   *
   * AMBIENT, ALL OF IT. Nothing here is a fact: the card says a map is saved, the words say which,
   * and the clock (which is `inform`, and lives in `TimedButton`) says the offer will take itself.
   * Under reduced motion the whole composition is simply THERE, with the mark still shortening on
   * it — which is the one thing a person actually needs from it.
   */
  'restore.offer.arrive': {
    tier: 'ambient', curve: 'punchy', duration: 0.24, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /** The offer going, once it has been answered. Faster than it arrived: the answer has been given
   *  and what follows it is the map. */
  'restore.offer.leave': {
    tier: 'ambient', curve: 'punchy', duration: 0.18, amplitude: 10,
  },
  /**
   * The photograph standing up out of the plate.
   *
   * A spring, and the only one in the score: the card is the thing arriving and the rest is what
   * follows it in. It rises further than the words do because it is bigger — an object twice the
   * size travelling the same distance reads as having moved half as far.
   */
  'restore.card.arrive': {
    tier: 'ambient', curve: 'stiff', amplitude: 20,
  },
  /** The words, and then the two answers, coming in behind the picture. ONE MOTION AT TWO BEATS:
   *  they are the same kind of thing arriving in reading order, and a second curve for the second
   *  of them would read as two events. */
  'restore.words.arrive': {
    tier: 'ambient', curve: 'punchy', duration: 0.22, amplitude: 10,
  },
  /**
   * A round rail button answering the pointer: the plate grows a little, and where the group has
   * room for it, opens into a pill carrying the button's name.
   *
   * The plate is what moves, so the name is not a label ARRIVING beside a button: it was always in
   * the plate and the plate opens far enough to show it. That is why there is no second motion for
   * the word, and why the pill has to grow over the map rather than in the column — a button that
   * pushed its neighbours aside to introduce itself would move the thing the pointer is aiming at.
   *
   * ONE MOTION FOR BOTH, deliberately. The growth says the button felt the pointer and the pill
   * says what the button is: two facts, but one event and one shape, and a second clock on the same
   * plate would put them out of phase — the width and the scale multiply, so the name would reach
   * past its open position and settle back into it.
   */
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
  /**
   * The tool cell's plate changing shape: taking the row's active colour, growing past the cell box
   * as the chosen one, and opening into a pill around the setting that tool carries.
   *
   * ONE MOTION FOR ALL THREE, because they are one shape. The plate is described by four insets and
   * a fill, every state sets all five, and a press moves whichever of them differ — so putting a
   * tool away closes the pill by the same rule that opened it, and the cells after it slide because
   * the row's own layout follows the width.
   */
  'tool.plate.shape': {
    tier: 'inform', curve: 'stiff',
    says: 'this is the tool the map is armed with, and this is what it carries',
  },
  /** The row of item cards, when the visitor picks another category. */
  'shelf.category.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 14,
    says: 'these are the pieces in the category you just chose',
  },
  /**
   * The reading that appears over a slider's knob while a hand is on it.
   *
   * INFORM, because it IS the reading: the value and the setting's name live nowhere else on the
   * strip now, so under reduced motion it must still arrive, instantly and without travel. The rise
   * is small on purpose -- it is a label catching up to a pointer, not an object entering.
   */
  'slider.reading': {
    tier: 'inform', curve: 'stiff', amplitude: 4,
    says: 'this is the setting you are holding, and where it stands',
  },
  /** A setting chip inside a tool cell folding between its word and its circle: auto trim, and the
   *  eraser's shape. */
  'chip.fold': {
    tier: 'inform', curve: 'stiff',
    says: 'this setting is doing this now',
  },
  /*
   * THE CHARACTER'S FIVE STATES.
   *
   * One drawing, so every state is a transform on it and the five have to be told apart by the KIND
   * of transform rather than by a change of pose. They are: a slow swing from the feet, a held lean,
   * a squash, a stretch, and a quick lean and back. Each amplitude is how far the character's HEAD
   * moves at the furthest point, in css px, which is the one measurement all five share and the one
   * the amplitude floor is written in; `character-state.ts` turns it into the angle or the scale
   * that delivers it, off the drawing's own rendered height.
   */

  /**
   * At rest the character swings, slowly, from where its feet meet the ground.
   *
   * THE FLOOR AND CALM PULL AGAINST EACH OTHER, and the resolution is that they are different
   * measurements: the floor is a DISTANCE and calm is a SPEED. Five px is over the floor and, on a
   * 54 px drawing, an excursion a glance registers as a different pose. Spread over a cycle this
   * long the head moves about 4 px a second, which is under what peripheral vision flags, so it is
   * legible to someone looking at it and quiet to someone working beside it. The earlier bob failed
   * on the first measurement, not the second: at 2 px there was no speed slow enough to save it.
   */
  'character.rest.sway': {
    tier: 'ambient', curve: 'swing', duration: 5.2, loop: true, amplitude: 5,
  },
  /** Its panel is open or the pointer has arrived: it turns toward the work and holds there. A held
   *  pose rather than a second loop, so the change from rest is the turn itself. */
  'character.attentive.lean': {
    tier: 'ambient', curve: 'gentle', amplitude: 6,
  },
  /** A squash, from planted feet: the body compresses and springs back, over and over. */
  'character.working.pump': {
    tier: 'inform', curve: 'swing', duration: 0.66, loop: true, amplitude: 5,
    says: 'the assistant is working on your map right now',
  },
  /** A stretch, the squash's opposite, so the pair reads as one vocabulary: down while it works, up
   *  when it is done. */
  'character.reacting.pop': {
    tier: 'inform', curve: 'punchy', duration: 0.42, amplitude: 7,
    says: 'what the assistant was doing has finished',
  },
  /** A quick lean toward the panel and back, timed to the card landing in it. */
  'character.speaking.nod': {
    tier: 'inform', curve: 'punchy', duration: 0.34, amplitude: 5,
    says: 'this card came from the assistant',
  },
  /**
   * A shelf row answering a vertical wheel notch.
   *
   * AN APPROACH, NOT AN EASE. The sideways axis is the browser's own impulse scrolling, which moves
   * the moment the wheel does; the browser's smooth `scrollTo` starts slow and runs a fixed length,
   * and beside the sideways axis that reads as lag. So the glide closes the remaining distance
   * exponentially — movement lands on the very next frame, and `duration` is the time constant —
   * and each further notch re-aims the run in flight rather than starting a new one. The amplitude
   * is one wheel LINE, the step a notch is turned into; `bars/row-scroll.ts` reads both numbers
   * from here and is the one driver.
   */
  'shelf.row.wheel-glide': {
    tier: 'ambient', curve: 'punchy', duration: 0.09, amplitude: 40, amplitudeUnit: 'px',
  },
} as const satisfies Record<string, Motion>;

export type MotionId = keyof typeof MOTIONS;

export { CURVES } from './curves';
export type { CurveId } from './curves';
