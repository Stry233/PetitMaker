/*
 * registry.ts — every motion the INTERFACE makes, declared once. The shell's own are the bulk of
 * it; the assistant panel's are at the foot of the table, under their own heading. A surface's
 * motions live here rather than beside it for the reason the whole file exists: "what moves, how
 * much, and why" has one answer or it has none.
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
import { tape } from '../../agent/tokens';
import type { CurveId } from './curves';

/** How far a button grows to acknowledge the pointer, as a fraction of itself. The app's shared
 *  hover feedback (`styles.ts:pressable`), read rather than restated so a motion declared here
 *  cannot claim a travel the call site does not make. */
const HOVER_GROWTH = pressable.whileHover.scale - 1;

/** One demonstration in the tour's gesture diagrams: rest, press, travel, the wheel beat, release.
 *  Every diagram runs on this clock, so two of them side by side keep the same tempo. */
const TOUR_REP_S = 2.7;
/** How many buttons a diagram that teaches "any button" has to get through, one rep each. */
const TOUR_BUTTONS = 3;

/** The period the construction stripe repeats at, read off the pattern's own geometry
 *  (`agent/tokens.ts:tape`) rather than restated: a crawl that travels any other distance per cycle
 *  jumps at the seam, so the drawing is what fixes the amplitude and the motion follows it. */
const TAPE_STRIPE_PX = tape.stripeSize;

/**
 * How long the floating form takes to LEAVE, and so how long anything leaving with it has.
 *
 * Named because two entries are that one length: the form's own exit (`panel.close`) and the leave half
 * of the character's presence beat (`panel.character.pop`). The dock hands one form to the other over
 * exactly this beat (`shell/use-dock.ts`), so a departure of hers that ran longer would be cut off
 * part-played by the arrival of the form replacing her.
 */
const FORM_LEAVE_S = 0.16;

/** How long the character's arrival takes: longer than the leave, the way every other pair in the house
 *  is, because the landing is the half a viewer watches. */
const CHARACTER_POP_S = 0.3;

/** How long the panel's box takes to move from the height it had to the height it wants. Named
 *  because two motions ARE that one movement: the box's own tween and the groups inside it sliding
 *  by the same distance (`panel.height`, `panel.setup.step`). */
const PANEL_HEIGHT_S = 0.24;

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
  /**
   * A flip whose leave is a shorter, accelerating fraction of the declared duration rather than the
   * same length as the landing it precedes (the departing face has nothing yet to show; only the
   * arrival is the half worth the full length). Undefined means the one declared length runs both
   * ways. `ui/agent/motion.ts:outSeconds` is the one reader, so a call site asks for the LEAVE length
   * by name instead of doing the multiplication itself.
   */
  outShare?: number;
  /** The curve the LEAVE runs on, where it is not the same shape as the landing. A departure and an
   *  arrival are not one motion reversed: one accelerates away from a mark, the other settles onto
   *  one. */
  outCurve?: CurveId;
  /**
   * A flip's landing OVERSHOOT, as the fraction of the entry at which the keyframe past the mark
   * sits, and the curve the settle back from it runs on.
   *
   * Framer spaces keyframes EVENLY by default, which puts a three-frame overshoot at the halfway
   * point and gives the settle as long as the whole approach — the landing then reads as a swing
   * rather than as weight. `ui/agent/motion.ts:flipProfile` is the one reader.
   */
  overshootAt?: number;
  landCurve?: CurveId;
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
   * The boot splash's island: one tile plops in per slice of the asset preload. Decoration over
   * the pill's own progress fill, which is the carrier — under reduced motion the tiles simply
   * stand where they land.
   */
  'splash.tile.plop': {
    tier: 'ambient', curve: 'bouncy', amplitude: 26, amplitudeUnit: 'px',
  },
  /**
   * The arrival: the boot loader's centred logo (index.html's static copy) is replaced by a
   * traveling twin that flies up onto the masthead's own logo box — one object from the first
   * painted frame to the splash. A TWEEN, because the phase change rides its declared duration.
   */
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
  /**
   * The hand-off: the splash slides up and away while the app beneath slides its last stretch up
   * into place on the same curve — two planes parting. Under reduced motion the splash is simply
   * gone and the app simply there.
   */
  'splash.handoff': {
    tier: 'ambient', curve: 'swing', duration: 0.5, amplitude: 900, amplitudeUnit: 'px',
  },
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
   * A name wider than the bubble holding it, travelling so the whole of it can be read.
   *
   * AMBIENT, AND WHAT MAKES THAT HONEST IS THE FALLBACK. Under reduced motion the bubble wraps to as
   * many lines as the name needs (`CardNameBubble.tsx`), so the fact — what the thing under the
   * pointer is called — is never the travel's to carry: one shape reads it along, the other reads it
   * down, and only the first of them moves.
   *
   * SWING, because it is a back-and-forth: an ease that arrives has a corner at the turn, which reads
   * as a machine reversing rather than as a line being scanned. The duration is one whole round trip,
   * out and back, including the pause it stands still at each end for (`CardNameBubble.tsx:REST`
   * places those, since the registry describes a motion's length and not its phrasing).
   *
   * The amplitude is the SMALLEST travel it will ever make rather than the largest: how far it goes
   * is the name's own overrun, and a name that overruns by less than this is left clipped instead —
   * below the floor the word twitches rather than scrolls, for a glyph that was nearly whole anyway.
   */
  'item.name.marquee': {
    tier: 'ambient', curve: 'swing', duration: 8, loop: true, amplitude: 12,
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
  /**
   * What a shelf offers, when the visitor picks another category: the object shelf's row of item
   * cards, and the generate shelf's whole block of candidates and settings. One motion, because it
   * is one event — the row of names above it does not move in either, so what travels is the answer
   * to the press.
   */
  'shelf.category.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 14,
    says: 'these are the things the category you just chose offers',
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
   * THE CHARACTER'S STATES ARE NOT DECLARED HERE, and that is the one place this table hands a
   * subject over. The live character poses itself from a table of its OWN
   * (`ui/agent/character/poses.ts`), transcribed whole from the normative prototype as per-part
   * WAAPI tracks in milliseconds, which is not a shape this table speaks.
   * What the character still declares here is what she does BESIDE a pose: `character.blink`, the two
   * `character.badge.*` and `panel.character.hover`, further down.
   */
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
  /*
   * THE TOUR'S GESTURE DIAGRAMS (`ui/shell/tour-diagrams.tsx`). Each one performs the gesture its
   * step is about, in a small drawing inside the bubble, and each is INFORM: the motion is the
   * instruction, not decoration on top of one. What makes that legitimate rather than a way of
   * exempting an animation from reduced motion is that every diagram has a STATIC carrier of the
   * same fact — the pointer, the trail it has drawn behind it, the ground it has already laid, the
   * key standing filled — so under reduced motion the drawing stands at the END of the gesture and
   * still says which way it went. The loop stops; what it was saying does not.
   *
   * ONE CLOCK FOR ALL OF THEM, `TOUR_REP_S` below: a rep is one complete demonstration, and a
   * diagram that teaches a drag and then a scroll fits both inside it rather than running two
   * clocks a viewer has to separate. `swing` is the curve, because a rep returns to where it began
   * and a repeat on a spring has a corner at the turn, which reads as a machine reversing rather
   * than as a hand moving.
   */
  /** The hand carrying the map, and the rep clock every other diagram runs on. The map travels the
   *  same distance the pointer does, which is what a drag actually does. */
  'tour.gesture.drag': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S, loop: true,
    amplitude: 26, amplitudeUnit: 'px',
    says: 'the map follows a held button across the screen',
  },
  /**
   * The same drag demonstrated once per mouse button, a whole rep each.
   *
   * NEVER AS A CHORD. "Any button" drawn as three keys lit at once says press all three; drawn as
   * three reps it says each of them on its own, which is the offer the app actually makes. The
   * length is that many reps, so the button being held changes only between complete gestures.
   */
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
  /**
   * What the 3D scene does with the same three reps: the left button SLIDES it, the right and the
   * middle TURN it. On the cycle's clock, since which of the two answers the scene gives is the
   * cycle's to say.
   *
   * The amplitude is the slide. The turn's travel is an ANGLE, which is none of the three units
   * this table measures in, and an inform entry is judged by what it says rather than by how far
   * it goes.
   */
  'tour.gesture.orbit': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S * TOUR_BUTTONS, loop: true,
    amplitude: 14, amplitudeUnit: 'px',
    says: 'in 3D a left drag slides the island and a right or middle drag turns it',
  },
  /** The flat map tipping into the 3D one under the press that switches views. No amplitude, for
   *  the reason the orbit entry gives. */
  'tour.gesture.tilt': {
    tier: 'inform', curve: 'swing', duration: TOUR_REP_S, loop: true,
    says: 'the flat map and the 3D one are the same map, seen from beside it',
  },
  /*
   * THE ASSISTANT PANEL (`ui/agent/`).
   *
   * The panel is a desk somebody works at, so almost everything it does is INFORM: a job arrived, a
   * step finished, a question is waiting, the wait got shorter. Three motions are not — the panel
   * itself opening, the stripe crawling and the character's own two idle habits — and those are the
   * three where nothing is being said.
   *
   * WHY THE DOCK IS ONE ENTRY AND NOT NINE. The dock's paper takes a colour per session state, and
   * the colours are the states; what MOVES is one crossfade between two of them, so a second entry
   * per state would be the same motion registered nine times under nine names.
   */
  /**
   * THE PANEL AND THE CHARACTER ARE ONE GESTURE, and this entry is the whole of its clock.
   *
   * The panel unfolds out of its own top-left corner — the corner her SEAT is at — and she steps
   * from the folded box she was pressed in into that seat. Those are not two events happening at
   * once: they are two TRACKS of one move, and this declaration owns both, which is what stops them
   * reading as a card appearing while a drawing walks somewhere near it. Three things make it one:
   *
   *   - ONE LENGTH AND ONE CURVE. Both tracks read this entry; neither has a clock of its own.
   *   - ONE ORIGIN. The wipe's seed rect is the panel's top-left corner, which is her seat.
   *   - ONE TRAVEL. The panel carries her own step's delta and gives it back over the same clock
   *     (`agent/character/seat.ts:carryPanel`), so the seed rect starts ON her folded box and the two
   *     arrive together rather than one of them being already in place.
   *
   * INFORM, because a viewer reads something off it that nothing else says: the desk that just opened
   * is the assistant they pressed. Under reduced motion the panel is simply standing and she is
   * simply in it, which says the same thing without the move.
   */
  // The amplitude is the fade's; the wipe and the travel that ride it are the panel's own box and the
  // frame's own gap between two seats, neither of which a number here could name.
  'panel.open': {
    tier: 'inform', curve: 'punchy', duration: 0.32, amplitude: 1, amplitudeUnit: 'opacity',
    says: 'the desk that just opened is the assistant you pressed',
  },
  /**
   * AND GOING, THE SAME GESTURE REVERSED, in every track it has: the panel folds back into the corner
   * it unfolded out of, travels her own step's delta the other way, and she walks back to the button
   * on this one clock. A leave that only faded said the panel had stopped being there rather than that
   * it had gone BACK to her, which is the one thing the corner's geometry is for.
   *
   * Shorter than the arrival, the way every other leave in the house is. Never a SHRINK: her placement
   * is measured off the seat's rect, and a scale on the panel would move that rect while it was being
   * read. A translate cannot, because it is the same delta she is travelling.
   *
   * IT IS ALSO THE DOCK SEQUENCE'S FIRST BEAT — the floating panel and the character leaving together
   * before the sheet slides off the ground (`shell/use-dock.ts`) — so the two read as one length: the
   * floating form goes away the same way whether a press dismissed it or a dock replaced it.
   */
  'panel.close': {
    tier: 'inform', curve: 'punchy', duration: FORM_LEAVE_S, amplitude: 1, amplitudeUnit: 'opacity',
    says: 'the assistant you were talking to has gone back to her button',
  },
  /**
   * The panel box tweening to its new content height, whenever a repaint changes what it holds
   * (a gate opening, a banner landing, the setup screen swapping in for the record).
   *
   * INFORM, and the RESIZE ITSELF IS THE CARRIER: what a person reads off it is that the panel now
   * holds a different amount of standing content, which a jump cut says exactly as well as a tween
   * does — reduced motion loses nothing by cutting straight to the new height. What the tween adds is
   * that the change did not simply overwrite the box: the old content is seen leaving room rather
   * than vanishing under the new.
   */
  'panel.height': {
    tier: 'inform', curve: 'punchy', duration: PANEL_HEIGHT_S,
    says: 'the panel now holds a different amount of standing content',
  },
  /**
   * The dock's paper crossing from one session state's colour to the next.
   *
   * INFORM, and the colour is the carrier: the dock also says the state in words, so under reduced
   * motion the paper is simply the new colour with the new sentence on it. What the crossfade adds
   * is that the change was a CHANGE — a dock that cuts between two creams reads as a redraw.
   *
   * FOR AN IN-PLACE REPAINT ONLY, and that is what tells it apart from `panel.dock.flip` below: a
   * clock tick, a countdown digit or a mid-state word updates the standing face without the session
   * itself moving to a different state, and a card that flipped for every one of those would turn
   * dozens of times a minute.
   */
  'panel.dock.paper': {
    tier: 'inform', curve: 'punchy', duration: 0.24,
    says: 'the assistant has moved from one state to another',
  },
  /**
   * The dock card turning to its new face when the session moves to a different STATE, keyed on
   * state identity rather than on the words standing on the card.
   *
   * A ROTATION, NOT A CROSSFADE, and long as panel motions go for the same reason `panel.ticket.flip`
   * is: the card leaves edge-on before its new face is even written, and lands weighted rather than
   * merely arriving, past flat by 7 degrees before settling — a rock landing rather than a card
   * appearing. That LANDING WEIGHT IS WHERE THE DECLARED LENGTH BELONGS: the leave is a shorter,
   * accelerating 150ms with nothing yet to show; only the return carries the full 280ms this entry
   * declares, since it is the half a viewer actually watches settle.
   *
   * THREE SEGMENTS, THREE SHAPES, and the weight is in the spacing of them. The leave ACCELERATES
   * away (it has no mark to settle on). The approach carries two thirds of the entry and arrives on
   * `punchy`, past flat. The settle back is the last third on `settle`, which comes to rest without
   * a decelerating shape of its own — one curve over all three, evenly spaced, puts the overshoot at
   * the halfway mark and reads as a swing.
   *
   * `panel.dock.paper` survives beside this for the repaint that is NOT a state change (see its own
   * entry): the two never fire for the same cause.
   */
  'panel.dock.flip': {
    tier: 'inform', curve: 'punchy', duration: 0.28, outShare: 0.54,
    outCurve: 'accel', overshootAt: 0.66, landCurve: 'settle',
    says: 'the assistant has moved to a different session state, not just repainted the one it was in',
  },
  /** A step's row landing on the ticket, from below, as it starts. One entry for every kind of row:
   *  they are the same object arriving, and what differs is what the row says. */
  'panel.op.enter': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 12, amplitudeUnit: 'px',
    says: 'this step is new since you last looked at the ticket',
  },
  /**
   * A step's outcome mark landing: the one beat that says the row is finished rather than running.
   *
   * A scale beat and not a travel, because the mark is already in place — what changes is the mark,
   * so it swells and comes back rather than arriving from anywhere. It only ever fires on the CHANGE
   * out of a running state; a row drawn already settled (history, a re-render) has nothing to report.
   */
  'panel.tick.settle': {
    tier: 'inform', curve: 'punchy', duration: 0.34, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'this step is done, and this is how it went',
  },
  /**
   * The marked region's outline, pulsing once when a write outside it rolls the whole call back.
   *
   * A STROKE-OPACITY BEAT, not a travel: the outline is already standing on the map, so what says
   * "this is why" is the same line breathing rather than something new arriving beside it. The
   * amplitude is the dip from its resting opacity, which is also the whole of what a viewer reads —
   * a pulse that dipped less would be indistinguishable from the outline's own steady line.
   */
  'panel.region.pulse': {
    tier: 'inform', curve: 'punchy', duration: 0.6, amplitude: 0.45, amplitudeUnit: 'opacity',
    says: 'your region held, and this is its edge',
  },
  /**
   * A stage of the plan ticking over on the rail.
   *
   * AN ARRIVAL, NOT A PULSE, and that is what separates it from the entry above: the stage box had no
   * check in it a moment ago, so the mark is a new object landing rather than an existing one
   * reacting. Same reason it is shorter — nothing has to swell and return, it just gets there.
   */
  'panel.plan.check': {
    tier: 'inform', curve: 'punchy', duration: 0.2, amplitude: 0.4, amplitudeUnit: 'scale',
    says: 'this stage of the plan is behind you',
  },
  /**
   * The question card arriving, and the one motion in the panel that is allowed to interrupt.
   *
   * IT GROWS RATHER THAN TRAVELLING. An op row slides up because it is the next line of a record
   * being written; this is not another line, it is the record STOPPING, so it arrives in place. The
   * travel is small on purpose — what makes the card unmissable is its paper and the dock beside it,
   * and a card that leapt in would read as a notification rather than as work waiting.
   */
  'panel.gate.enter': {
    tier: 'inform', curve: 'stiff', amplitude: 0.03, amplitudeUnit: 'scale',
    says: 'nothing further happens until you answer this',
  },
  /**
   * The verdict chip landing once a gate has an answer: approved, declined, answered in words,
   * unanswered when the job stopped.
   *
   * IT RISES INTO PLACE ON THE CARD'S OWN BASELINE, the same entrance an op row makes
   * (`panel.op.enter`'s own travel): the gate has just become a settled line of the record rather
   * than a standing question, so its answer arrives the way any other finished line does. Instant
   * under reduced motion — the chip is the answer, and it must be legible the instant it exists.
   */
  'panel.gate.verdict': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 12, amplitudeUnit: 'px',
    says: 'this gate has an answer now',
  },
  /**
   * The answered ask cards fanning out of their deck into the record, and restacking into it.
   *
   * ONE MOTION BOTH WAYS (`panel.history.fold`'s argument): it is one pile opening and closing, and
   * a second curve for the restack would read as two different objects. The cards open on their own
   * height (`panel.thoughts.open`'s construction), so the record below them moves down rather than
   * being jumped over. Instant under reduced motion: the cards are the record, and they must be
   * readable the moment they are asked for.
   */
  'panel.gate.deck': {
    tier: 'inform', curve: 'punchy', duration: 0.22,
    says: 'these are the answered asks the deck was holding, standing where they were answered',
  },
  /**
   * The chip at the parked character's shoulder, arriving and leaving: with the panel shut, it is
   * the only evidence a job is still editing the map.
   *
   * INFORM, and the WORDS are the carrier, so under reduced motion the chip simply stands there
   * saying them. What the growth adds is that it arrived — it comes out of the character's own
   * corner rather than fading up over the map, which is what makes it hers.
   *
   * IT MUST HAVE AN EXIT FOR THE SAME REASON. A chip switched off by a display flip TELEPORTED
   * beside the folding panel: the fold's own timer landed and a fully formed chip appeared with no
   * entrance at all, which is the spatial jump the prototype's own note records.
   */
  'panel.chip.hero': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 0.3, amplitudeUnit: 'scale',
    says: 'the assistant is still working on the map while the panel is shut',
  },
  /**
   * THE CHARACTER'S OWN ARRIVAL AND DEPARTURE, which she has at exactly one moment: a change of FORM.
   *
   * Free, she has none — she is part of the floating panel and the panel's own gesture carries her, so
   * there is nothing for her to do on her own account. What she cannot do is TRAVEL between the two
   * forms, because they are different layers, so a dock hands her from one to the other and that
   * hand-off is hers to play: she goes from the floating desk and comes to the docked one.
   *
   * A ZOOM WITH WEIGHT IN IT, NOT A FADE. A fade says a drawing stopped being painted;
   * a pop past her own size and back says a character arrived, which is the register everything else
   * about her is drawn in. THREE POINTS AND THREE SHAPES, the same construction `panel.dock.flip` is
   * built on: `amplitude` is how much smaller she starts, `overshootAt` is where the keyframe past her
   * own size sits — spaced evenly it would give the settle as long as the whole approach, which reads as
   * a swing — and `landCurve` is the shape that settle comes back on. The LEAVE has none of it: a
   * departure has no mark to land on, so it goes straight down and out on `outCurve`.
   *
   * INFORM, and SHE is the carrier: under reduced motion she is simply at the desk that is standing,
   * which is the whole of what this says.
   */
  'panel.character.pop': {
    tier: 'inform', curve: 'punchy', duration: CHARACTER_POP_S,
    overshootAt: 0.62, landCurve: 'settle',
    outShare: FORM_LEAVE_S / CHARACTER_POP_S, outCurve: 'accel',
    amplitude: 0.34, amplitudeUnit: 'scale',
    says: 'the assistant is sitting at this desk now',
  },
  /**
   * The one live character answering a pointer resting on her.
   *
   * IT IS THE HOUSE HOVER ITSELF, not a second version of it: she is a control standing at the end of
   * the row of five blocks, all of which take `styles.ts:pressable`, so the growth and the spring are
   * READ from it. A lift of her own read as a different kind of thing beside them, which is the one
   * thing a shared feedback idiom exists to prevent. Reduced motion has her standing still, which
   * says the same thing the moment she is pressed.
   */
  'panel.character.hover': {
    tier: 'ambient', curve: 'stiff', amplitude: HOVER_GROWTH, amplitudeUnit: 'scale',
  },
  /**
   * THE INTERFACE MOVING ASIDE FOR THE DOCKED PANEL, and back again when it is set free.
   *
   * INFORM, and what it says is that the two are ONE surface rather than a panel that appeared over
   * the work: the whole frame travels the panel's own width and settles into the window that is
   * left, so what a viewer reads is the room being shared. The carrier is the layout itself — under
   * reduced motion the interface is simply in its new place, which says the same thing — and the
   * travel is the frame's own side inset (`shell/panel-frame.ts:PINNED_PANEL`), so no amplitude here
   * could name a distance the call site takes.
   *
   * TWO TRACKS ON ONE CLOCK, because two planes PART rather than one sliding over a still one: the
   * sheet travels the dock's whole width and the GROUND drifts a small share of that in the same
   * direction, settling with it (`shell/panel-frame.ts:DOCK_PARALLAX_SHARE`, which is the splash
   * hand-off's own relationship rather than a second one). Reduced motion has both planes simply in
   * place, which is what the fraction landing at its end in one frame does.
   *
   * ONE ENTRY BOTH WAYS. Docking and undocking are the same move in two directions, and a viewer
   * watching the second is watching the first run backwards; two lengths would make them two events.
   * A change of SIDE is this entry twice, with the ground crossing the window between the two while
   * the sheet is covering all of it.
   */
  'panel.pin.slide': {
    tier: 'inform', curve: 'punchy', duration: 0.3,
    says: 'the interface and the panel are sharing the window',
  },
  /**
   * THE SHEET CROSSING THE WINDOW to put the dock at the other end, and it is ONE PASS rather than
   * two slides that happen to meet.
   *
   * The geometry gives it no choice about the middle: the ground can only change ends while the sheet
   * covers every part of it, so the sheet must come all the way back before it can leave the other
   * way. What the middle must NOT be is a stop. Run as `panel.pin.slide` twice, both halves eased at
   * both ends, the sheet arrived at rest and set off again from rest — a 600ms move with a visible
   * pause at 300, which reads as two presses rather than one.
   *
   * So the two halves take the two shapes the house already keeps for exactly this difference: the
   * return ACCELERATES away from the end it is leaving (`outCurve`, and it has no mark to settle on —
   * the middle is not where it stops), and the departure lands on the new end with `panel.pin.slide`'s
   * own curve, since arriving at a dock is the same arrival however the sheet got there. Velocity is
   * high and continuous through the crossing, and the pass reads as one movement whose middle happens
   * to be where the ground changes ends. `outShare` is 1 because neither half is the lesser one: they
   * are the same distance, and the whole of the move is watched.
   */
  'panel.pin.cross': {
    tier: 'inform', curve: 'punchy', duration: 0.26, outShare: 1, outCurve: 'accel',
    says: 'the panel is going to the other end of the window, and this is one crossing',
  },
  /** A typed note taking its place in the queue rather than being sent. A spring, because the chip
   *  is arriving somewhere — the queue is a place, and this is the note landing in it. It grows into
   *  place for the same reason the gate does: the note is not travelling from the composer, it is
   *  appearing where it now lives. */
  'panel.steer.chip': {
    tier: 'inform', curve: 'stiff', amplitude: 0.1, amplitudeUnit: 'scale',
    says: 'what you typed is queued for the next step, not for this one',
  },
  /**
   * The chip LEAVING because a step consumed it, as opposed to being taken back.
   *
   * A DIFFERENT EXIT FOR A DIFFERENT REASON. Recalling a note is the user undoing their own queued
   * chip, and it shrinks back the way `panel.steer.chip` grew. Delivery is the chip being CONSUMED —
   * it lifts clear of the queue and shrinks past its own size on its way out, because the words are
   * not disappearing, they are going somewhere: into the step that is about to read them.
   */
  'panel.steer.deliver': {
    tier: 'inform', curve: 'punchy', duration: 0.18, amplitude: 26, amplitudeUnit: 'px',
    says: 'this note has left the queue and gone into the step it was queued for',
  },
  /**
   * One digit of the retry countdown replacing the one before it, rolling up from under.
   *
   * INFORM on a number: the digit itself is the carrier, so under reduced motion it simply changes.
   * What the roll adds is that the wait is SHORTENING, which a number swapping in place does not
   * say — a countdown that cut between values read as a display fault rather than as time passing.
   */
  'panel.retry.digit': {
    tier: 'inform', curve: 'punchy', duration: 0.12, amplitude: 8, amplitudeUnit: 'px',
    says: 'the wait is shorter than it was a second ago',
  },
  /**
   * The setup field handing a key back: the box shakes once, in place.
   *
   * AMBIENT, AND THAT IS THE HONEST TIER RATHER THAN THE FLATTERING ONE. The refusal is carried by
   * the field's danger border, the crossed provider row and the note under them, all of which stand
   * whatever the motion preference is; the shake only makes the same fact land harder. It is also
   * the tier the mechanism forces: the travel is `x`, and framer disables positional keys outright
   * under `MotionConfig reducedMotion`, so an `inform` entry here would be a declaration that the
   * preference silently does not honour.
   */
  /**
   * The connection screen's own groups SLIDING as a step changes what stands on the screen.
   *
   * The first character typed retires the line above the field, and the field, the provider row and
   * the note under them all stand ~57px higher for it. Nothing about that is news — the groups are
   * the same groups saying the same things — so what the movement carries is that they MOVED rather
   * than that the screen was redrawn: a field, a row and a caret that jump-cut to a new place read as
   * a different screen arriving under the hands, and the caret is in one of them.
   *
   * ONE MOVEMENT WITH THE PLATE, which is why it takes `panel.height`'s own curve and length: the
   * panel's box is shrinking by the same distance over the same time, so the groups inside it and the
   * edge below them travel together. INFORM, because the step it lands on is one the user is being
   * asked to read; a cut straight to the new place says the same thing under reduced motion.
   */
  'panel.setup.step': {
    tier: 'inform', curve: 'punchy', duration: PANEL_HEIGHT_S,
    says: 'these are the same controls, standing somewhere else now',
  },
  'panel.setup.refuse': {
    tier: 'ambient', curve: 'punchy', duration: 0.32, amplitude: 4, amplitudeUnit: 'px',
  },
  /**
   * A DESTRUCTIVE VERB BECOMING ITS OWN QUESTION: the one button growing into the question's words
   * while its fill crosses to danger (`primitives/InlineConfirm`).
   *
   * A CONTINUOUS MORPH, AND A TWEEN RATHER THAN A SPRING. Nothing arrives and nothing leaves: the
   * control the pointer is already on has changed meaning, so the box the hand is over grows to fit
   * what it now says and the colour travels with it. Anything with overshoot in it reads as this
   * button being swapped for a different one, which is the single thing an in-place confirm exists to
   * avoid — so the smooth curve, both ways, and the same length for the width and the paint.
   *
   * The travel is the width of one word, which is a distance the words decide and no number here can
   * claim, so this entry declares none.
   */
  'panel.confirm.arm': {
    tier: 'inform', curve: 'punchy', duration: 0.18,
    says: 'this button is now the question, and pressing it again answers it',
  },
  /*
   * THE COMPOSER'S SEND HAS NO MOTION, DELIBERATELY, and this seat stands empty rather than holding
   * an unwired entry. What says a message was taken is the FIELD EMPTYING and the order landing
   * in the record a beat later — two facts the panel already states plainly — so a pop on the button
   * would be a third telling of something nobody is waiting to hear. The prototype gives `.send`
   * nothing either. If a send ever becomes ambiguous (a queue that does not visibly move, say), this
   * is where its motion is declared first and written second.
   */
  /**
   * THE COMPOSER'S FIELD UNFOLDING INTO THE FLOATING EDITOR, and folding back into the well.
   *
   * ONE FIELD AT TWO SIZES, so what moves is the field's own RECT: its corner, its box and its
   * radius travel from the docked pill to the card and back, and the well stands as the empty seat
   * they came out of. A card that faded in over a well still holding the text would say a second
   * field had opened, which is the one thing this exists to deny — and the same beat carries the
   * door's own width unfolding beside the send, since that is the same field changing shape.
   *
   * ONE MOTION BOTH WAYS, `panel.history.fold`'s argument: it is one box changing size, and a second
   * curve for the way home would read as two different objects. Longer than the fold because the
   * travel is a whole box's, not a strip's height.
   */
  'panel.composer.unfold': {
    tier: 'inform', curve: 'punchy', duration: 0.26,
    says: 'this is the same field you were typing in, at the size a paragraph needs',
  },
  /** The finished jobs folding away, and opening again. ONE MOTION BOTH WAYS: it is one strip
   *  changing height, and a second curve for the closing would read as two different objects. The
   *  chevron over the row turns on the same clock, since it is the same fold saying which way it
   *  goes. */
  'panel.history.fold': {
    tier: 'inform', curve: 'punchy', duration: 0.22,
    says: 'the jobs that are already finished are folded away here',
  },
  /**
   * The thoughts box growing out of the mark that opened it, and folding back into it.
   *
   * SHORT, because the box is a DISCLOSURE and not a screen: the press is deliberate, the reader is
   * already looking at the row it opens under, and the whole of what the motion has to say is that
   * the text came from HERE. It opens on its own height, which is what makes the record below it
   * move down rather than be jumped over, and its own scroller is what bounds the height that
   * height animates to.
   *
   * IT IS ALSO THE ONE MOTION IN THE RECORD THAT MUST NOT BE FOLLOWED. The zone follows its own foot
   * while a job appends, and a box growing at the foot would drag the reader down its own opening;
   * the ticket stands the follow down for as long as one is open, and that exemption is what makes
   * this animation safe rather than a fight.
   */
  'panel.thoughts.open': {
    tier: 'inform', curve: 'punchy', duration: 0.2,
    says: 'this is the thinking behind the row you pressed',
  },
  /**
   * The construction stripe crawling along its own track, for work whose length is not known.
   *
   * AMBIENT, AND THE ONE PLACE THAT COSTS SOMETHING. The filled track is the carrier and it stands
   * still under reduced motion, so a determinate bar still reads its fraction; an INDETERMINATE one
   * loses the crawl and reads as a full bar, which is why the dock's own sentence says what is
   * happening in words beside it and the bar is never the only thing saying so.
   *
   * The amplitude is one stripe period, which is also the whole travel: the pattern repeats at
   * `tokens.ts:tape.stripeSize`, so a cycle that moves exactly that far is seamless and any other
   * distance jumps. LINEAR for the same reason (see `curves.ts`).
   */
  'panel.tape.crawl': {
    tier: 'ambient', curve: 'linear', duration: 1.6, loop: true,
    amplitude: TAPE_STRIPE_PX, amplitudeUnit: 'px',
  },
  /**
   * The block at the end of the assistant's own line while the words are still arriving.
   *
   * AMBIENT: the sentence is the carrier and the caret only says it is unfinished, so a still one
   * reads as a mark at the end of the text and costs nothing. It BLINKS rather than fades — a
   * two-step opacity track, the typewriter idiom, since a caret that eased in and out would read as
   * a pulsing highlight. The duration is one whole blink, dark and lit together.
   */
  'panel.says.caret': {
    tier: 'ambient', curve: 'linear', duration: 1, loop: true, amplitude: 1, amplitudeUnit: 'opacity',
  },
  /**
   * The character's eyes closing and lifting again.
   *
   * The duration is the DWELL — how long the lids stay down — because the lids do not travel: they
   * are drawn at full height and scaled to nothing, so the closing itself is one frame and what a
   * viewer reads is the pause. `ui/agent/character/poses.ts` arms it on a jittered interval per pose,
   * which is what keeps two blinks from ever falling on the same beat.
   */
  'character.blink': {
    tier: 'ambient', curve: 'punchy', duration: 0.13, amplitude: 1, amplitudeUnit: 'scale',
  },
  /** The badge on the character's shoulder being replaced: the old one out, a beat of nothing, the
   *  new one in. The GAP is the motion — two badges crossfading read as one badge changing colour,
   *  and what this says is that the assistant has moved to a different kind of work. */
  'character.badge.swap': {
    tier: 'inform', curve: 'punchy', duration: 0.11,
    says: 'the assistant is doing a different kind of thing now',
  },
  /**
   * The new badge popping in with overshoot, once the old one has finished leaving.
   *
   * ITS OWN ENTRY BESIDE `character.badge.swap` RATHER THAN FOLDED INTO IT, because the two are
   * different halves of one sequence with different jobs: the swap above is the GAP that says a
   * badge changed at all, and this is the badge that changed LANDING — the overshoot is what says
   * this one is staying, not merely appearing. The pop is a baked three-point scale track (0, an
   * 18% overshoot, rest), so `linear` is the accurate curve: a spring layered on top of a shape
   * already keyframed would be two curves multiplied together. No amplitude is declared, for the same
   * reason the tour's orbit entry declares none — the overshoot is baked into the frames, not
   * measured against a floor here. The ask bubble's own reply-arrival keeps its longer 420ms boing as
   * a pose transition in `character/poses.ts`, which is a different badge with a different weight to
   * land with.
   */
  'panel.badge.pop': {
    tier: 'inform', curve: 'linear', duration: 0.28,
    says: 'this is the badge the assistant is wearing now',
  },
  /**
   * The working badge turning: a quarter turn on a fixed beat, over and over.
   *
   * Ambient, and its amplitude is the RIM's travel rather than the angle — a rotation is in none of
   * the three units this table measures in, and the badge draws at about 24 px across, so a quarter
   * turn carries its edge roughly 18 px. The duration is one whole beat, turn and rest together.
   */
  'character.badge.spin': {
    tier: 'ambient', curve: 'linear', duration: 0.42, loop: true, amplitude: 18, amplitudeUnit: 'px',
  },
  /**
   * A finished job's ticket turning over to show how it was built.
   *
   * ONE CARD WITH TWO FACES, so it ROTATES: both faces stay mounted and the card turns on `rotateY`,
   * because a crossfade between two cards would say there are two of them. Long, as panel motions
   * go, and that is the fact — the back is a different document, and a turn fast enough to be a
   * crossfade would not read as one object having another side.
   *
   * The amplitude is a half turn, which is neither a distance nor a scale, so it declares none: this
   * is the case the tour's orbit entry already names.
   */
  'panel.ticket.flip': {
    tier: 'inform', curve: 'punchy', duration: 0.55,
    says: 'this ticket has another side, and it is the same ticket',
  },
  /**
   * The construction tape's fill growing to the fraction of the plan that is done.
   *
   * INFORM, and the WIDTH is the carrier: it stands at the right fraction under reduced motion, it
   * simply gets there in one frame. What the growth adds is direction — a bar that jumped between
   * fractions would read as a gauge being redrawn rather than as work advancing. Slower than
   * anything else in the panel on purpose: it is the one motion measuring a thing that genuinely
   * takes minutes, and a fast fill claims a stage was finished in half a second.
   */
  'panel.tape.fill': {
    tier: 'inform', curve: 'punchy', duration: 0.5,
    says: 'this much of the plan is behind you',
  },
  /**
   * The finished receipt's stat figures counting up from zero, once, as the card arrives.
   *
   * INFORM ON A NUMBER, the same shape as `panel.retry.digit`: the figure is the carrier, so under
   * reduced motion it simply stands at what was built. What the run adds is that the number was
   * EARNED — it is the one celebration a build receipt makes, and a card whose totals were already
   * printed reads as a form rather than as a job that just finished.
   *
   * `settle` because the count may only ever DECELERATE into its total: a figure still moving fast
   * at the end reads as a meter that has not finished measuring, and this one is measuring something
   * that is already on the map.
   */
  'panel.stat.count': {
    tier: 'inform', curve: 'settle', duration: 0.7,
    says: 'this is what the job actually built',
  },
} as const satisfies Record<string, Motion>;

export type MotionId = keyof typeof MOTIONS;

export { CURVES } from './curves';
export type { CurveId } from './curves';
