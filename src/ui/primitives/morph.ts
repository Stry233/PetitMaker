/**
 * One re-arrangement drawn as a move (FLIP): the pieces marked through `useMorph` are measured before
 * the commit that re-arranges them (`measureMorph`), and once the new arrangement is laid out each is
 * drawn from the box it stood in to the one it stands in now on Web Animations (`playMorph`). The
 * animations draw a transform that runs out to none (added to one a piece wears, or alone, which the
 * compositor runs through a busy main thread), and a piece a later commit moves while they run is drawn
 * on to its new box, so every piece ends exactly where the layout puts it; a piece found only after
 * fades in, one found only before fades out where it stood, and one veiled (`visibility: hidden`) in
 * one arrangement fades as it travels. Every move and fade of a pass runs on its motion's one curve and
 * duration: what only one arrangement has fades where it stands, out over the first share of the
 * travel and in after a later share (`design/motion:fadeShares`); a piece that rides another
 * (`MORPH_RIDE_ATTR`) travels only with that one's box and crosses over between its two places; and
 * a scoped morph that lifts (`morphScope`) draws its travelling pieces as copies in a layer over every
 * clip around them, the pieces themselves showing again as the pass lands.
 * Content inside a piece that only one arrangement shows (`useMorphPresence`) fades the same way
 * within its piece. The page's morph (`measureMorph`, `playMorph`) carries the chrome's pieces; `morphScope` runs the
 * same morph inside one element apart from it, for a re-arrangement inside a piece.
 */
import { useIsPresent } from 'framer-motion';
import { createSignal } from '../../core/base/signal';
import { easingCss, fadeShares, outSeconds, seconds } from '../design/motion';
import { z as rungs } from '../design/styles';
import type { MotionId } from '../design/motion/registry';
import { useUiPreview } from '../design/preview';
import { effectiveZoom, visualRect, type VisualRect } from '../design/visual-rect';

/** The attribute naming a piece; a piece inside another piece moves with it and is not one itself. */
const MORPH_ATTR = 'data-morph';
/** The `id` every animation of a morph carries. */
export const MORPH_ANIMATION = 'shape-morph';
/** On the root from the first measure to the second, so no CSS transition inside a piece starts on
 *  the re-arrangement and the second measure reads where each piece settles (`animations.css`). */
export const MORPHING_ATTR = 'data-morphing';

/** On what a morph stands back in to fade out where it stood: inert, and no surface of the page. */
export const MORPH_STAND_IN_ATTR = 'data-morph-stand-in';

/** On a layer a running pass stands on its old rung, which `--morph-z` names (`animations.css`): the
 *  inline z-index React owns is never written, so it shows again as the attribute goes. */
export const MORPH_RAISED_ATTR = 'data-morph-raised';
const MORPH_Z_VAR = '--morph-z';

/** Whether `el` is a stand-in, so neither a piece's content nor its layout. */
const isStandIn = (el: Element) => el.hasAttribute(MORPH_STAND_IN_ATTR);

/** The attribute naming a piece of a scoped morph (`morphScope`), which the page's morph never reads. */
export const MORPH_PIECE_ATTR = 'data-morph-piece';

/** On a container of pieces that draws nothing of its own (a rail group): its own transitions hold
 *  still between the measures as a piece's do, so the morph alone carries its pieces. */
const MORPH_GROUP_ATTR = 'data-morph-group';

/** What a container of pieces wears (`MORPH_GROUP_ATTR`); a pictured subtree marks nothing. */
export function useMorphGroup(): { [MORPH_GROUP_ATTR]?: '' } {
  return useUiPreview() ? {} : { [MORPH_GROUP_ATTR]: '' };
}

/** Whether the page's morph has measured its pieces and not yet played: a commit now is one it
 *  carries, so a piece's own reflow lands at once rather than travelling a second time. */
export function pageMorphing(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(MORPHING_ATTR);
}

/** How a piece is drawn from its old box into its new one (`MORPH_SHAPE_ATTR`). By default it keeps its
 *  proportions, scaled by the ratio of the two areas about its centre. `fill` takes each box exactly,
 *  for a plate with nothing in it to stretch. `span-start` and `span-centre` are for a piece whose
 *  width the window decides rather than its content: it scales by the ratio of its heights, its
 *  content keeping to its leading edge or its centre. `fit` is for a piece whose content re-flows
 *  inside a box it must not pass: it scales evenly by the lesser of the two ratios about its old box's
 *  centre, so it starts within that box. `card` is for a card whose content re-flows: its
 *  outline takes each box exactly as `fill` does, while its content scales evenly from the zoom it
 *  stood at to the one it stands at, from the card's top left corner, cut by the card's outline. */
export type MorphShape = 'fill' | 'span-start' | 'span-centre' | 'fit' | 'card';

/** The attribute carrying a piece's `MorphShape`; absent, it keeps its proportions. */
export const MORPH_SHAPE_ATTR = 'data-morph-shape';

/** On a piece whose content re-flows between arrangements: its old content fades out where it stood,
 *  carried with the piece, as the new fades in, so no part of it is seen to jump. A piece of any shape
 *  but `fill` and the default re-flows without saying so. */
const MORPH_REFLOW_ATTR = 'data-morph-reflow';

/** On a piece that never travels a path of its own: it rides the piece or guide (`MORPH_GUIDE_ATTR`)
 *  its value names, carried only by that box's movement, and where its place beside that box differs
 *  between the arrangements it crosses over, its old self fading out and its new self in as for a
 *  piece only one arrangement has. A piece of a row rides the piece it stands beside; a piece pinned
 *  to a surface's corner rides that surface. With nothing to ride in both arrangements it fades where
 *  it stands. */
export const MORPH_RIDE_ATTR = 'data-morph-ride';
/** The edges of the box a riding piece holds to, space separated; on an axis it names none it keeps
 *  its share of that box. */
export const MORPH_RIDE_AT_ATTR = 'data-morph-ride-at';
/** On the picture inside a piece that, in another arrangement, is that picture alone (a card and a
 *  details row's picture): in a lifting scope, travelling between a piece with a face and one without,
 *  the picture travels between the face's own box and the other's, and the piece that has the face
 *  travels around it, standing about the picture as it did on every frame, while all of it but the
 *  face fades, out early as it leaves and in late as it arrives. */
export const MORPH_FACE_ATTR = 'data-morph-face';

/** On an element a morph measures, by its id, only as a box pieces ride: its owner draws its change
 *  on the motion's curve and duration (the Blueprint band gliding its own edges). */
export const MORPH_GUIDE_ATTR = 'data-morph-guide';

export type RideEdge = 'left' | 'right' | 'top' | 'bottom';
/** What a riding piece rides: the id of a piece or guide, and the edges of its box it holds to. */
export interface Ride { on: string; at?: readonly RideEdge[] }

/** What a riding piece wears beside its id. */
export function rideAttrs(ride: Ride | undefined): Record<string, string> {
  if (!ride) return {};
  return { [MORPH_RIDE_ATTR]: ride.on, ...(ride.at?.length ? { [MORPH_RIDE_AT_ATTR]: ride.at.join(' ') } : {}) };
}

/** What a piece's root wears: its id, unique on the page, its `shape` where it has one, whether its
 *  content `reflows` where its shape does not say so, and what it `ride`s. A pictured subtree marks
 *  nothing, and nor does a piece on its way out of an `AnimatePresence`: it leaves on its own exit
 *  where it stands, and its id is free for what arrives. */
export function useMorph(id: string, shape?: MorphShape, { reflows = false, ride }: { reflows?: boolean; ride?: Ride } = {}): {
  [MORPH_ATTR]?: string; [MORPH_SHAPE_ATTR]?: MorphShape; [MORPH_REFLOW_ATTR]?: '';
} {
  const present = useIsPresent();
  if (useUiPreview() || !present) return {};
  return { [MORPH_ATTR]: id, ...(shape ? { [MORPH_SHAPE_ATTR]: shape } : {}), ...(reflows ? { [MORPH_REFLOW_ATTR]: '' } : {}), ...rideAttrs(ride) };
}

/** Whether a piece's content re-flows between arrangements (`MORPH_REFLOW_ATTR`). */
function reflows(el: Element): boolean {
  const shape = el.getAttribute(MORPH_SHAPE_ATTR);
  return el.hasAttribute(MORPH_REFLOW_ATTR) || (shape !== null && shape !== 'fill');
}

/** The attribute naming content inside a piece that one arrangement shows and the other does not, by
 *  an id unique on the page; the page's morph fades it in or out within its piece. */
export const MORPH_PRESENCE_ATTR = 'data-morph-presence';

/** What content only one arrangement shows wears, by an id naming what it shows: an element that keeps
 *  its id stays, one whose id changes leaves under the old id and arrives under the new. Shown means
 *  drawn and not wholly cut off by a scroller or clip around it. A pictured subtree marks nothing. */
export function useMorphPresence(id: string): { [MORPH_PRESENCE_ATTR]?: string } {
  return useUiPreview() ? {} : { [MORPH_PRESENCE_ATTR]: id };
}

/** Where a piece standing in `box` is drawn at a morph's start, and the scale per axis that takes it
 *  there: its old box `was`, read through its `shape`. */
function startOf(was: VisualRect, box: VisualRect, shape: string | null): { left: number; top: number; sx: number; sy: number } {
  if (shape === 'fill' || shape === 'card') return { left: was.left, top: was.top, sx: was.width / box.width, sy: was.height / box.height };
  const s = shape === 'span-start' || shape === 'span-centre'
    ? was.height / box.height
    : shape === 'fit'
      ? Math.min(was.width / box.width, was.height / box.height)
      : Math.sqrt((was.width * was.height) / (box.width * box.height));
  const left = shape === 'span-start' ? was.left : was.left + was.width / 2 - (s * box.width) / 2;
  return { left, top: was.top + was.height / 2 - (s * box.height) / 2, sx: s, sy: s };
}

/** A box's corner and size, in screen px. */
type Box = { left: number; top: number; width: number; height: number };

/** Where a piece standing in `box` starts so that its face, standing in `face`, starts where `startOf`
 *  draws it from `was`: scaled with the face from the piece's top left corner. */
function startAround(was: VisualRect, box: VisualRect, face: VisualRect, shape: string | null): { left: number; top: number; sx: number; sy: number } {
  const f = startOf(was, face, shape);
  return { left: f.left - f.sx * (face.left - box.left), top: f.top - f.sy * (face.top - box.top), sx: f.sx, sy: f.sy };
}

/** A piece as it stood before the re-arrangement, with what it needs to stand there again on its way out. */
interface Was {
  el: HTMLElement;
  box: VisualRect;
  parent: HTMLElement | null;
  /** The product of its own and its ancestors' `zoom`: screen px per px of its own. */
  scale: number;
  opacity: string;
  z: string;
  /** For a piece whose parent left with it: the parent's type and colour, the custom properties set
   *  on its ancestors and their zoom, which a layer of its own stands in for. */
  inherited: { zoom: number; style: [string, string][] };
  /** For content shown in one arrangement: the scroller or clip around it, outside which a copy of it
   *  stands to fade out where it is still on the page but no longer shown. */
  clip?: Element | null;
  /** For a piece whose content re-flows: a copy of each child as it stood, to fade out in its place. */
  content?: Was[];
  /** For such a piece: where its drawn descendants stood, as shares of its box (`layoutShares`). */
  shares?: number[];
  /** For content shown in one arrangement: the piece it stands in. */
  piece?: HTMLElement | null;
  /** The outermost layer the piece stands in that has a rung of its own, and that rung. */
  layer?: { el: HTMLElement; z: number } | null;
  /** For a riding piece: what it rides (`MORPH_RIDE_ATTR`), the edges it holds to, and a copy of it as
   *  it stood, to cross over from. */
  ride?: { on: string; at: string | null; copy: HTMLElement };
  /** For a piece holding a face (`MORPH_FACE_ATTR`): where the face stood. */
  face?: VisualRect;
  /** The picture its face, or the piece itself, showed, by its source; null for none. */
  picture?: string | null;
  /** For a piece set off from where the screen drew it (`morphFrom`): `box` is its face's where it has one. */
  seen?: boolean;
  /** For such a piece: a copy of what drew it there, as it stood. */
  drew?: Was;
}

/** The picture `el` shows, by its source: its own where it is one, else the topmost inside it (a
 *  picture is drawn over its plate). */
function pictureOf(el: Element): string | null {
  const all = el.querySelectorAll('img');
  const img = el instanceof HTMLImageElement ? el : all[all.length - 1];
  return img?.getAttribute('src') ?? null;
}

/** The pieces measured before a re-arrangement, by id, the content shown in only one arrangement that
 *  stood shown, by id, and the window they were measured in. */
export interface MorphFirst {
  pieces: Map<string, Was>; shown: Map<string, Was>; view: { w: number; h: number }; scope: Scope;
  /** The boxes of the guides pieces ride, by id (`MORPH_GUIDE_ATTR`). */
  guides: Map<string, VisualRect>;
  /** Where a scoped morph's frame stood drawn as its pieces were measured (`Scope.frame`). */
  frame: VisualRect | null;
}

/** One pass of a morph, told as `playMorph` starts it: it settles once every animation of it has
 *  finished or been cancelled, a held pass once a later pass or `stopMorph` retires it. A newer pass
 *  is always told before an older one settles. */
export interface MorphRun { settled: Promise<void> }

const morphs = createSignal<MorphRun | null>(null);

/** Calls `tell` each time a morph pass starts, held and with nothing to draw included, for a surface
 *  placed from a piece (the character, who holds her place until the newest run settles). */
export function onMorph(tell: (run: MorphRun) => void): () => void {
  return morphs.subscribe((run) => { if (run) tell(run); });
}

const layouts = new Set<() => void>();

/** Calls `place` just before a morph measures where its pieces end, and again each time the pass
 *  re-aims a piece a later commit moved, for a piece placed from another piece's box (the character on
 *  her seat), so it stands at its new place when measured and ends where it rests. */
export function onMorphLayout(place: () => void): () => void {
  layouts.add(place);
  return () => { layouts.delete(place); };
}

/** Where a morph looks for its pieces and what its running pass holds. */
interface Scope {
  /** The subtree searched, and the attribute naming a piece in it. */
  within: () => ParentNode | null;
  attr: string;
  /** The attribute naming content only one arrangement shows, where the scope fades it. */
  presence?: string;
  /** Wears `MORPHING_ATTR` from the first measure to the second. */
  holder: () => Element | null;
  /** The box a scoped morph's pieces are seen in; one outside it neither leaves nor arrives. */
  clip?: () => VisualRect | null;
  /** The element a scoped morph's pieces are laid out in: a move of it (a panel a finger resizes) carries
   *  them as it carries the rest of its content, and a running pass follows only what moves inside it. */
  frame?: () => HTMLElement | null;
  /** Tells followers a pass started: the page's, and a scoped morph's own `play`. */
  tell?: (run: MorphRun) => void;
  running: Animation[];
  /** What the running morph stood back in to fade out, removed when it has. */
  leaving: HTMLElement[];
  /** Settles the current pass's run: a held one, or one whose animations have not started. */
  retire: (() => void) | null;
  /** The pieces the running pass draws, with the boxes the layout gives them. */
  pieces: Carried[];
  /** Layers the running pass stands on a higher rung. */
  raised: HTMLElement[];
  /** The running pass's clock (null while it is held): one of its moves on the time they set off at
   *  (`passClock`), whose start the compositor gives it, as it gives the others theirs. */
  clock: Animation | null;
  /** Whether its travelling pieces are drawn as copies in a lifted layer (`morphScope`'s `lift`). */
  lift?: boolean;
  /** What the running pass lifted: the layers its copies stand in, and the animations hiding the
   *  pieces they stand for; both go as the pass lands or ends. */
  lifted: { layers: HTMLElement[]; hides: Animation[] };
}

const page: Scope = {
  within: () => (typeof document === 'undefined' ? null : document), attr: MORPH_ATTR, presence: MORPH_PRESENCE_ATTR,
  holder: () => document.documentElement, tell: (run) => morphs.emit(run), running: [], leaving: [], retire: null, pieces: [], raised: [], clock: null,
  lifted: { layers: [], hides: [] },
};

/** Starts a pass: ends the one before and tells the followers of the new run, whose `settled`
 *  resolves through the returned function. */
function startPass(scope: Scope): (done: Promise<unknown>) => void {
  endPass(scope);
  let resolve!: () => void;
  const settled = new Promise<void>((r) => { resolve = r; });
  scope.retire = resolve;
  scope.tell?.({ settled });
  return (done) => { void done.then(resolve, resolve); };
}

function endPass(scope: Scope): void {
  for (const anim of scope.running) anim.cancel();
  scope.running = [];
  for (const el of scope.leaving) el.remove();
  scope.leaving = [];
  scope.retire?.();
  scope.retire = null;
  scope.pieces = [];
  scope.clock?.cancel();
  scope.clock = null;
  lower(scope);
  land(scope);
}

/** Shows the pieces the pass lifted again and takes their copies away, in one frame. */
function land(scope: Scope): void {
  for (const hide of scope.lifted.hides) hide.cancel();
  for (const layer of scope.lifted.layers) layer.remove();
  scope.lifted = { layers: [], hides: [] };
}

/** Gives each layer the running pass raised back its own rung. */
function lower(scope: Scope): void {
  for (const el of scope.raised) { el.removeAttribute(MORPH_RAISED_ATTR); el.style.removeProperty(MORPH_Z_VAR); }
  scope.raised = [];
}

/** Stands `el` on rung `z` until the pass lowers it, or on a higher one another piece raised it to. */
function raise(scope: Scope, el: HTMLElement, z: number): void {
  if (scope.raised.includes(el) && Number(el.style.getPropertyValue(MORPH_Z_VAR)) >= z) return;
  el.style.setProperty(MORPH_Z_VAR, String(z));
  el.setAttribute(MORPH_RAISED_ATTR, '');
  if (!scope.raised.includes(el)) scope.raised.push(el);
}

/** Where `el` stands once the page's running morph has drawn the piece it is, or is inside, to that
 *  piece's box, in screen px: its drawn box carried with that piece's (or, inside a card, with the
 *  card's child it is in) from where it is drawn to its box. Outside a moving piece it is where `el` is
 *  drawn. For a surface placed from an element inside a piece (the character on her seat). */
export function restingRect(el: Element): VisualRect {
  const r = visualRect(el);
  const piece = page.pieces.find((p) => p.anims.length && p.el.contains(el));
  if (!piece) return r;
  if (piece.el === el) return piece.box;
  // A card's content scales apart from its outline: carried with the child of the card it is in.
  const kid = piece.kids.length ? piece.kids.find((k) => k.el.contains(el)) : null;
  const moving = kid ? kid.el : piece.el, b = kid ? kid.box : piece.box;
  if (piece.kids.length && !kid) return r;
  const d = visualRect(moving);
  if (!drawn(d)) return r;
  const sx = b.width / d.width, sy = b.height / d.height;
  const left = b.left + (r.left - d.left) * sx, top = b.top + (r.top - d.top) * sy, width = r.width * sx, height = r.height * sy;
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
}

/** Ends whatever morph is running or held, at once: its pieces stand where the layout puts them, its
 *  stand-ins are gone and transitions inside pieces run again. For a host that unmounts. */
export function stopMorph(): void {
  undrawn = false;
  endPass(page);
  document.documentElement.removeAttribute(MORPHING_ATTR);
}

function marked(scope: Scope): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  const within = scope.within();
  if (!within) return out;
  for (const el of within.querySelectorAll<HTMLElement>(`[${scope.attr}]`)) {
    const outer = el.parentElement?.closest(`[${scope.attr}]`);
    if (outer && within.contains(outer)) continue;
    const id = el.getAttribute(scope.attr)!;
    if (!out.has(id)) out.set(id, el);
  }
  return out;
}

const drawn = (box: VisualRect) => box.width > 0 && box.height > 0;
const outside = (box: VisualRect, clip: VisualRect) => box.right <= clip.left || box.left >= clip.right || box.bottom <= clip.top || box.top >= clip.bottom;

function zoomOf(el: Element): number {
  const own = parseFloat(getComputedStyle(el).zoom);
  return own > 0 ? own : 1;
}

function inheritedOf(el: HTMLElement): Was['inherited'] {
  const zoom = el.parentElement ? effectiveZoom(el.parentElement) : 1;
  const vars = new Map<string, string>();
  for (let node = el.parentElement; node; node = node.parentElement) {
    for (let i = 0; i < node.style.length; i++) {
      const name = node.style[i]!;
      if (name.startsWith('--') && !vars.has(name)) vars.set(name, node.style.getPropertyValue(name));
    }
  }
  const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const type: [string, string][] = parent
    ? [['color', parent.color], ['font-family', parent.fontFamily], ['font-size', parent.fontSize], ['font-weight', parent.fontWeight], ['line-height', parent.lineHeight]]
    : [];
  return { zoom, style: [...type, ...vars] };
}

/** A computed opacity as a number; an engine that computes none draws it whole. */
const opacityOf = (v: string) => (v === '' ? 1 : Number(v));

/** How strongly a piece is drawn: its opacity, none where it stands hidden (a veiled control). */
const shownOpacity = (style: CSSStyleDeclaration) => (style.visibility === 'hidden' ? '0' : style.opacity);

/** Measures every piece where it stands now, a running morph included, and holds CSS transitions in
 *  pieces still until `playMorph`. Call it before the re-arrangement reaches the DOM. */
export function measureMorph(): MorphFirst {
  undrawn = true;
  return measure(page);
}

/** Set from the page's measure to the play that first draws its pieces where they stood. */
let undrawn = false;

/** Whether the page's morph is carrying the chrome: measured and not yet played, held, or running. A
 *  surface's own glide of a size the re-arrangement changes stands down meanwhile, since the morph
 *  draws the change. */
export function pageMorphCarrying(): boolean {
  return undrawn || pageMorphing() || page.running.some((anim) => anim.playState === 'running' || anim.playState === 'paused');
}

/** Whether the page's morph has measured a re-arrangement it has not yet drawn: what stands laid out
 *  now is the new arrangement, which no frame shows, so a surface placed from a piece waits a frame. */
export function pageUndrawn(): boolean {
  return undrawn;
}

/** Every piece of `scope` drawn on screen and inside its `clip`, where it has one: one outside it
 *  arrives as a piece found only after. */
function measure(scope: Scope): MorphFirst {
  const pieces = new Map<string, Was>();
  // How far each piece stood from where it is laid out now; content inside it stood as far off.
  const shifts = new Map<HTMLElement, { dx: number; dy: number }>();
  const clip = scope.clip?.() ?? null;
  // A window resized since the screen last showed the page (a turn the device reported before any
  // frame drew the old arrangement at the new size) lays out boxes no frame showed: the pieces start
  // from where they were last shown, in the window they were shown in.
  const view = { w: window.innerWidth, h: window.innerHeight };
  const last = scope === page && shownBoxes && (shownBoxes.view.w !== view.w || shownBoxes.view.h !== view.h) ? shownBoxes : null;
  const clips = new Map<Element, Element | null>();
  for (const [id, el] of marked(scope)) {
    const live = visualRect(el);
    // A piece a running lifted pass draws by a copy stands where that copy is drawn.
    const copy = scope.lift ? scope.pieces.find((p) => p.real === el && p.el.isConnected)?.el : undefined;
    const box = copy ? visualRect(copy) : (last?.boxes.get(id) ?? live);
    if (!drawn(box) || !drawn(live)) continue;
    if (clip && outside(box, clip)) continue;
    // A lifted copy is drawn over every clip, so a piece its scroller wholly cuts off was not shown: it arrives.
    if (scope.lift && !copy && cutOff(el, clips)) continue;
    const was = wasOf(el, box);
    const { dx, dy } = { dx: box.left - live.left, dy: box.top - live.top };
    shifts.set(el, { dx, dy });
    const face = el.querySelector(`[${MORPH_FACE_ATTR}]`);
    const faceBox = face ? visualRect(face) : null;
    if (faceBox && drawn(faceBox)) was.face = shifted(faceBox, dx, dy);
    if (scope.lift) was.picture = pictureOf(was.face ? face! : el);
    if (scope === page) was.layer = layerOf(el);
    const on = el.getAttribute(MORPH_RIDE_ATTR);
    if (on !== null) was.ride = { on, at: el.getAttribute(MORPH_RIDE_AT_ATTR), copy: snapshot(el) };
    else if (reflows(el)) {
      was.content = contentOf(el).map((copy) => ({ ...copy, box: shifted(copy.box, dx, dy) }));
      was.shares = layoutShares(el, el.getBoundingClientRect());
    }
    pieces.set(id, was);
  }
  const shown = new Map<string, Was>();
  for (const [id, { el, clip: around }] of shownContent(scope)) {
    const piece = el.closest<HTMLElement>(`[${scope.attr}]`);
    let outer: HTMLElement | null = piece;
    for (let n = piece; n; n = n.parentElement?.closest<HTMLElement>(`[${scope.attr}]`) ?? null) outer = n;
    const d = (outer && shifts.get(outer)) ?? { dx: 0, dy: 0 };
    shown.set(id, { ...wasOf(el, shifted(visualRect(el), d.dx, d.dy)), clip: around, piece: outer });
  }
  const guides = new Map<string, VisualRect>();
  for (const [id, el] of guidesOf(scope)) {
    const box = visualRect(el);
    if (drawn(box)) guides.set(id, box);
  }
  scope.holder()?.setAttribute(MORPHING_ATTR, '');
  const frame = scope.frame?.() ?? null;
  return { pieces, shown, guides, view: last ? last.view : view, scope, frame: frame ? visualRect(frame) : null };
}

/** Sets the piece `id` of `first` off from `box`, in screen px, where the screen drew it rather than
 *  where it is laid out (a carried card's copy under the pointer as a release drops it among the
 *  others): its face (`MORPH_FACE_ATTR`) as it is drawn then, where it has one, else the piece; one
 *  measured nowhere, scrolled out of view, sets off from there too. `drew` is what drew it
 *  there (that copy, standing over the page): a copy of it travels around the piece, standing about it
 *  as it stood about `box` on every frame, and fades out early. Call it with the measure, before the
 *  re-arrangement reaches the DOM. */
export function morphFrom(first: MorphFirst, id: string, box: VisualRect, { drew }: { drew?: HTMLElement | null } = {}): void {
  const was = first.pieces.get(id);
  const el = was?.el ?? marked(first.scope).get(id);
  if (!el?.isConnected) return;
  const stood = drew?.isConnected ? { ...wasOf(drew, visualRect(drew)), el: snapshot(drew), parent: null } : undefined;
  first.pieces.set(id, { ...(was ?? wasOf(el, box)), box, seen: true, ...(stood ? { drew: stood } : {}) });
}

/** The guides in `scope`, by id. */
function guidesOf(scope: Scope): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of scope.within()?.querySelectorAll<HTMLElement>(`[${MORPH_GUIDE_ATTR}]`) ?? []) {
    const id = el.getAttribute(MORPH_GUIDE_ATTR)!;
    if (!out.has(id)) out.set(id, el);
  }
  return out;
}

/** Where a riding piece holds to `box`: the edges `at` names, else its `share` of the box per axis. */
function ridePoint(box: VisualRect, at: string | null, share: { x: number; y: number }): { x: number; y: number } {
  const edges = at?.split(' ') ?? [];
  const sx = edges.includes('left') ? 0 : edges.includes('right') ? 1 : share.x;
  const sy = edges.includes('top') ? 0 : edges.includes('bottom') ? 1 : share.y;
  return { x: box.left + sx * box.width, y: box.top + sy * box.height };
}

/** Where the centre of `of` stands across `box` per axis, kept to the box's own edges. */
function shareIn(box: VisualRect, of: VisualRect): { x: number; y: number } {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
  return { x: clamp((of.left + of.width / 2 - box.left) / box.width), y: clamp((of.top + of.height / 2 - box.top) / box.height) };
}

/** `box` moved by `dx`, `dy`. */
function shifted(box: VisualRect, dx: number, dy: number): VisualRect {
  const left = box.left + dx, top = box.top + dy;
  return { x: left, y: top, left, top, width: box.width, height: box.height, right: left + box.width, bottom: top + box.height };
}

/** Each page piece's box as the screen last showed it, with the window it was shown in. */
let shownBoxes: { view: { w: number; h: number }; boxes: Map<string, VisualRect> } | null = null;

/**
 * Keeps the boxes the screen last showed the page's pieces in, for a turn whose resize lands before
 * the morph measures (`measure`). Read only when something that can move a piece changed: a style,
 * class or child list on a piece or around one, a piece's own size (content arriving or re-flowing
 * inside it, a font loading), a resize, or a pass settling, each read once at the next frame, so an
 * idle page reads nothing. Returns the stop function.
 */
export function watchShownBoxes(): () => void {
  if (typeof MutationObserver !== 'function' || typeof requestAnimationFrame !== 'function') return () => {};
  let frame = 0;
  const read = () => {
    frame = 0;
    if (pageMorphCarrying()) return;
    const boxes = new Map<string, VisualRect>();
    const pieces = marked(page);
    for (const [id, el] of pieces) boxes.set(id, visualRect(el));
    shownBoxes = { view: { w: window.innerWidth, h: window.innerHeight }, boxes };
    // Observed once each: observing again would report it again, and read again, every frame.
    const now = new Set(pieces.values());
    for (const el of sized) if (!now.has(el)) { sizes?.unobserve(el); sized.delete(el); }
    for (const el of now) if (!sized.has(el)) { sizes?.observe(el); sized.add(el); }
  };
  const ask = () => { if (!frame) frame = requestAnimationFrame(read); };
  const sized = new Set<HTMLElement>();
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(ask) : null;
  // Only a change on a piece or around one can move it; what changes inside a piece (a character's
  // pose, a clock's digits) leaves its box where it is.
  const moves = (target: Node) => target instanceof Element
    && (target.hasAttribute(MORPH_ATTR) || target.querySelector(`[${MORPH_ATTR}]`) !== null);
  const changes = new MutationObserver((records) => { if (records.some((r) => moves(r.target))) ask(); });
  changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', ask);
  const settled = onMorph((run) => { void run.settled.then(ask); });
  ask();
  return () => {
    changes.disconnect();
    sizes?.disconnect();
    window.removeEventListener('resize', ask);
    settled();
    if (frame) cancelAnimationFrame(frame);
    shownBoxes = null;
  };
}

function wasOf(el: HTMLElement, box: VisualRect): Was {
  const style = getComputedStyle(el);
  const inherited = inheritedOf(el);
  return { el, box, parent: el.parentElement, scale: inherited.zoom * zoomOf(el), opacity: shownOpacity(style), z: style.zIndex, inherited };
}

/** The outermost element between `el` (itself included) and the body with a z-index of its own. */
function layerOf(el: HTMLElement): { el: HTMLElement; z: number } | null {
  let found: { el: HTMLElement; z: number } | null = null;
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const z = Number(getComputedStyle(n).zIndex);
    if (Number.isFinite(z) && getComputedStyle(n).position !== 'static') found = { el: n, z };
  }
  return found;
}

/** How many of a piece's descendants its content's layout is read off, for a cheap comparison. */
const SHARED_MOST = 4000;

/** Where a piece's first descendants stand inside its box, as shares of it, the drawn ones only,
 *  stand-ins and what they hold left out. */
function layoutShares(el: HTMLElement, box: { left: number; top: number; width: number; height: number }): number[] {
  const out: number[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (isStandIn(n as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(), seen = 0; n && seen < SHARED_MOST; n = walk.nextNode(), seen++) {
    const r = (n as Element).getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push((r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height);
  }
  return out;
}

/** Whether a piece's content stands otherwise inside it than it stood: another count of drawn
 *  descendants, or one moved or resized by more than a pixel at the piece's size. Raw rects on both
 *  sides, which share one zoom convention. */
function contentMoved(was: Was, el: HTMLElement): boolean {
  const before = was.shares ?? [];
  const raw = el.getBoundingClientRect();
  const now = layoutShares(el, raw);
  if (now.length !== before.length) return true;
  return now.some((v, i) => Math.abs(v - before[i]!) * (i % 2 === 0 ? raw.width : raw.height) > 1);
}

/** A piece's drawn children, those of a child that draws no box of its own (`display: contents`)
 *  standing in for it. */
function drawnKids(el: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const kid of el.children) {
    if (!(kid instanceof HTMLElement) || isStandIn(kid)) continue;
    if (getComputedStyle(kid).display === 'contents') out.push(...drawnKids(kid));
    else if (drawn(visualRect(kid))) out.push(kid);
  }
  return out;
}

/** What marks an element as itself on the page or to the morph, which a copy of it never wears. */
const OWN_ATTRS = [
  'id', 'data-testid', MORPH_ATTR, MORPH_PIECE_ATTR, MORPH_PRESENCE_ATTR, MORPH_SHAPE_ATTR, MORPH_REFLOW_ATTR, MORPH_GROUP_ATTR, MORPH_RAISED_ATTR,
  MORPH_RIDE_ATTR, MORPH_RIDE_AT_ATTR, MORPH_GUIDE_ATTR,
];
const OWN_MARKED = OWN_ATTRS.map((attr) => `[${attr}]`).join(',');

/** Takes every mark in `root`'s subtree off, itself included. */
function unmark(root: HTMLElement): void {
  for (const el of [root, ...root.querySelectorAll(OWN_MARKED)]) for (const attr of OWN_ATTRS) el.removeAttribute(attr);
}

/** A copy of `el` as it shows now, inert and unmarked, its scrollers where they stood: a canvas with
 *  the pixels it shows (`copyCanvas`), a video as the frame it shows (its poster while it has none),
 *  neither playing. */
function snapshot(el: HTMLElement): HTMLElement {
  let copy = el.cloneNode(true) as HTMLElement;
  const lived = [el, ...el.querySelectorAll<HTMLElement>('*')];
  const copied = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  const scrolls: Scrolled[] = [];
  const media: [HTMLCanvasElement | HTMLVideoElement, HTMLElement][] = [];
  unmark(copy);
  copied.forEach((twin, i) => {
    const live = lived[i]!;
    if (live.scrollTop || live.scrollLeft) scrolls.push([twin, live.scrollLeft, live.scrollTop]);
    if (live instanceof HTMLCanvasElement || live instanceof HTMLVideoElement) media.push([live, twin]);
  });
  for (const [live, twin] of media) {
    if (live instanceof HTMLCanvasElement) { copyCanvas(twin as HTMLCanvasElement, live); continue; }
    const video = twin as HTMLVideoElement;
    video.removeAttribute('autoplay');
    video.preload = 'none';
    for (const source of video.querySelectorAll('source')) source.remove();
    // HAVE_CURRENT_DATA: the frame it shows can be drawn.
    if (live.readyState < 2 || !live.videoWidth) continue;
    const frame = document.createElement('canvas');
    for (const { name, value } of [...video.attributes]) if (!['src', 'poster', 'preload', 'width', 'height'].includes(name)) frame.setAttribute(name, value);
    if (!paint(frame, live, live.videoWidth, live.videoHeight)) continue;
    if (video === copy) copy = frame;
    else video.replaceWith(frame);
  }
  if (scrolls.length) scrolledIn.set(copy, scrolls);
  return copy;
}

/** A scroller in a copy, with where its original stood scrolled to. */
type Scrolled = [HTMLElement, number, number];
/** The scrollers in each copy, scrolled once the copy stands on the page: a clone starts unscrolled. */
const scrolledIn = new WeakMap<HTMLElement, Scrolled[]>();

/** Draws a canvas's pixels into its copy at one px per CSS px of the box it stands in, since the copy
 *  is drawn on the measure's frame and a full device-resolution read there costs that frame. A WebGL
 *  canvas stays a blank copy: what `drawImage` reads of it outside the frame it drew is unreliable. */
function copyCanvas(twin: HTMLCanvasElement, live: HTMLCanvasElement): void {
  // A canvas holding a WebGL context answers null, and the call creates nothing on it.
  if (!live.getContext('2d')) return;
  const w = live.offsetWidth, h = live.offsetHeight;
  if (!w || !h) return;
  twin.style.width = `${w}px`;
  twin.style.height = `${h}px`;
  paint(twin, live, Math.min(live.width, Math.ceil(w)), Math.min(live.height, Math.ceil(h)));
}

/** Draws `source` into `canvas` at `w` by `h` device px; false where it could not (a tainted or
 *  undrawable source, or no 2D context). */
function paint(canvas: HTMLCanvasElement, source: CanvasImageSource, w: number, h: number): boolean {
  if (!w || !h) return false;
  canvas.width = w;
  canvas.height = h;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(source, 0, 0, w, h);
    return true;
  } catch {
    return false;
  }
}

/** Copies of a piece's drawn children as they stand (`snapshot`). */
function contentOf(piece: HTMLElement): Was[] {
  return drawnKids(piece).map((kid) => ({ ...wasOf(kid, visualRect(kid)), el: snapshot(kid) }));
}

/** Whether an element cuts off what overflows it on either axis. */
function clips(style: CSSStyleDeclaration): boolean {
  return [style.overflowX, style.overflowY, style.overflow].some((v) => !!v && v.split(' ').some((axis) => axis !== 'visible'));
}

/** The nearest ancestor of `el` that cuts off what overflows it, cached per pass. */
function clipAround(el: Element, cache: Map<Element, Element | null>): Element | null {
  const parent = el.parentElement;
  // The page's own boxes clip nothing a fixed surface holds.
  if (!parent || parent === document.body || parent === document.documentElement) return null;
  const known = cache.get(parent);
  if (known !== undefined) return known;
  const found = clips(getComputedStyle(parent)) ? parent : clipAround(parent, cache);
  cache.set(parent, found);
  return found;
}

/** Whether the scroller or clip around `el` wholly cuts it off; rects are compared raw, as an element
 *  and its clip share one zoom convention. */
function cutOff(el: Element, cache: Map<Element, Element | null>): boolean {
  const around = clipAround(el, cache);
  return !!around && outside(el.getBoundingClientRect(), around.getBoundingClientRect());
}

/** The content of `scope` only one arrangement shows that is shown now, by id, with the clip around
 *  each. Rects are compared raw: an element and its clip share one zoom convention. */
function shownContent(scope: Scope): Map<string, { el: HTMLElement; clip: Element | null }> {
  const out = new Map<string, { el: HTMLElement; clip: Element | null }>();
  const within = scope.within();
  if (!scope.presence || !within) return out;
  const cache = new Map<Element, Element | null>();
  for (const el of within.querySelectorAll<HTMLElement>(`[${scope.presence}]`)) {
    const id = el.getAttribute(scope.presence)!;
    const r = el.getBoundingClientRect();
    if (out.has(id) || !drawn(r)) continue;
    const around = clipAround(el, cache);
    if (around && outside(r, around.getBoundingClientRect())) continue;
    out.set(id, { el, clip: around });
  }
  return out;
}

/** A morph confined to one element: its pieces wear `MORPH_PIECE_ATTR`, and its passes neither end
 *  the page's nor tell its followers. With `lift`, each piece that travels is drawn by a copy of it
 *  standing in a layer of its own over the element's surface, its scrollers and every clip around
 *  them, on the element's own rung, while the piece itself stands hidden in its place until the pass
 *  lands or ends: nothing a piece passes cuts it, and nothing changes the element's scrolling. */
interface MorphScope {
  /** Measures the pieces in `root`, those outside its own box (scrolled out of view) left to arrive. */
  measure(root: HTMLElement): MorphFirst;
  /** Plays a pass, which settles once it has run or a later pass or `stop` ended it. */
  play(first: MorphFirst, motion: MotionId): MorphRun;
  /** Ends a running pass at once, for a host that unmounts. */
  stop(): void;
}

export function morphScope({ lift = false }: { lift?: boolean } = {}): MorphScope {
  let root: HTMLElement | null = null;
  let last: MorphRun = { settled: Promise.resolve() };
  const scope: Scope = {
    within: () => root, attr: MORPH_PIECE_ATTR, holder: () => root, clip: () => (root ? visualRect(root) : null), frame: () => root,
    tell: (run) => { last = run; }, running: [], leaving: [], retire: null, pieces: [], raised: [], clock: null, lift, lifted: { layers: [], hides: [] },
  };
  return {
    measure(el) {
      root = el;
      return measure(scope);
    },
    play(first, motion) {
      playMorph(first, motion);
      return last;
    },
    stop() {
      endPass(scope);
      root?.removeAttribute(MORPHING_ATTR);
    },
  };
}

let additive: boolean | null = null;
/** Whether the engine adds an animated transform to the one a piece already wears (Chromium 103,
 *  Safari 16, Firefox 104); an older one would replace it, so it re-arranges without a morph. */
function addsTransforms(): boolean {
  if (additive === null) {
    try {
      additive = typeof KeyframeEffect === 'function' && new KeyframeEffect(null, [], { composite: 'add' }).composite === 'add';
    } catch {
      additive = false;
    }
  }
  return additive;
}

/** `box` with its centre carried across a window resized by `across`, its size kept. */
function carried(box: VisualRect, across: { x: number; y: number }): VisualRect {
  const left = (box.left + box.width / 2) * across.x - box.width / 2;
  const top = (box.top + box.height / 2) * across.y - box.height / 2;
  // Field by field: a DOMRect's fields are accessors, which a spread does not copy.
  return { x: left, y: top, left, top, width: box.width, height: box.height, right: left + box.width, bottom: top + box.height };
}

/** Where every move ends: no transform of the morph's own. */
const MORPH_REST = 'translate(0px, 0px) scale(1)';

/** The transform a copy wears, followed by a space, for a move written after it; empty for none. A
 *  copy's own transform never changes, so a move written after it draws what one added to it would, and
 *  the compositor runs it through a busy main thread, where Chromium runs an added move on the main
 *  thread alone, lagging the pieces it travels with. */
function copyTransform(el: HTMLElement): string {
  const own = getComputedStyle(el).transform;
  return !own || own === 'none' ? '' : `${own} `;
}

/** How far a `translate` of one px in a piece's own space moves it on screen, read off a probe. */
const PROBE_PX = 100;

/** How many steps a card's content counter-scale is sampled in: its scale is the ratio of two lerps,
 *  which keyframes interpolate only piecewise. */
const CARD_STEPS = 8;

/** A card's direct child, with where it stood laid out and the screen px per px of its own. */
/** A child a card carries at its content's even scale; `stood` for a copy of its old content, carried on
 *  the same path from the size it stood at, so the two stay one over the other as they crossfade. */
interface CardKid { el: HTMLElement; box: VisualRect; k: number; origin: Origin | null; stood?: boolean }

/**
 * Draws each piece from its box in `first` to where it stands now on `motion`, as its `MorphShape`
 * says: by default it moves its centre and scales evenly by the ratio of the two areas, so its content
 * never stretches, and its own opacity runs from the one it stood at. A window resized since `first`
 * (a turned device) carries the old centres across in proportion. A leaving piece fades out over the
 * motion's `outShare`, and an arriving one fades in over the rest. A re-flowing piece's old content
 * (`MORPH_REFLOW_ATTR`) fades out over `outShare` as its new content fades in, which carries
 * everything inside it; inside any other piece, content only one arrangement shows fades the same way.
 * Call it once the new arrangement is committed, before the frame that paints it.
 * `held` stands every piece where it stood until a later call plays the same `first`: the new
 * arrangement is committed but the window has not yet turned to it. `late` reads the page again a
 * frame on and sets off on the frame after, for what the commits size observers make after the
 * re-arrangement add, remove or re-flow. `fitCards` starts a card's content no larger than its old
 * outline holds it, so a card turning to another arrangement keeps its foot inside its outline (UI-28);
 * without it the content starts at the zoom it stood at, over its old content's copy, and the outline
 * cuts off what stands past it (an input mode's re-size, UI-27).
 */
export function playMorph(
  first: MorphFirst, motion: MotionId, { held = false, late = false, fitCards = true }: { held?: boolean; late?: boolean; fitCards?: boolean } = {},
): void {
  const { scope } = first;
  const settle = startPass(scope);
  if (scope === page) for (const place of layouts) place();
  if (!held) scope.holder()?.removeAttribute(MORPHING_ATTR);
  if (typeof Element.prototype.animate !== 'function' || !addsTransforms()) {
    if (scope === page) undrawn = false;
    if (!held) settle(Promise.resolve());
    return;
  }
  const across = { x: window.innerWidth / first.view.w, y: window.innerHeight / first.view.h };
  // How far a scoped morph's frame has moved since the measure, which carries what it holds: a piece
  // starts, and one that left fades, where it stood in the frame.
  let lag = { dx: 0, dy: 0 };
  const placeOf = (box: VisualRect) => carried(shifted(box, lag.dx, lag.dy), across);
  const duration = seconds(motion) * 1000;
  const out = outSeconds(motion) * 1000;
  const easing = easingCss(motion);
  // Every fade runs on the travel's own curve.
  const fade = easingCss(motion);
  // A scoped piece that arrives out of view has nothing to show, so it takes no animation.
  const clip = scope.clip?.() ?? null;
  const started: Animation[] = [];
  const followed: Carried[] = [];
  scope.running = started;
  /** What the pass has already drawn, so a second reading adds only what changed since. */
  const done = {
    pieces: new Map<string, HTMLElement>(), arrived: new Set<HTMLElement>(), crossfaded: new Set<HTMLElement>(),
    left: new Set<string>(), shownIn: new Set<HTMLElement>(), shownOut: new Set<string>(), kids: new Set<HTMLElement>(),
    landed: new Set<HTMLElement>(),
  };
  const shares = fadeShares(motion);
  // The rung a lifting scope's copies stand on: its element's own, over everything inside it.
  const liftRung = scope.lift ? liftRungOf(scope) : null;
  const fadeIn = (el: HTMLElement, { delay = 0, length = duration - delay }: { delay?: number; length?: number } = {}) => {
    const anim = el.animate([{ opacity: 0, offset: 0 }], { duration: length, delay, easing: fade, fill: 'backwards' });
    started.push(anim);
    return anim;
  };
  /** Fades in what only the new arrangement has where it stands, after `shares.in` of the travel, on
   *  the travel's own clock and curve. */
  const arrive = (el: HTMLElement) => {
    const anim = el.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: shares.in }], { duration, easing });
    started.push(anim);
    return anim;
  };
  /** Takes a stand-in away once `anim` has faded it out. */
  const goes = (el: HTMLElement, anim: Animation) => {
    const gone = () => { el.remove(); scope.leaving = scope.leaving.filter((g) => g !== el); };
    anim.finished.then(gone, () => {});
    scope.leaving.push(el);
    started.push(anim);
    return anim;
  };
  const fadeOut = (was: Was, el: HTMLElement) =>
    goes(el, was.el.animate([{ opacity: was.opacity }, { opacity: 0 }], { duration: out, easing: fade, fill: 'forwards' }));
  /** Fades out what only the old arrangement had where it stood, over the first `shares.out` of the
   *  travel, on the travel's own clock and curve. */
  const leave = (was: Was, el: HTMLElement) => goes(el, was.el.animate(
    [{ opacity: String(opacityOf(was.opacity)), offset: 0 }, { opacity: 0, offset: shares.out }, { opacity: 0, offset: 1 }], { duration, easing, fill: 'forwards' },
  ));
  /** Fades a re-flowing piece's old content out where it stood, carried with the piece (a card's along
   *  its content's path, `CardKid.stood`), as its new content fades in, inside `into`: the piece, or
   *  the copy a lifting scope draws it by. `under` is the scale `into` is drawn at as they stand in,
   *  which their zoom undoes: `restand` puts each box back where it stood under that scale, but would
   *  leave its type drawn that much smaller. Returns the copies standing in and their fades. */
  const crossfade = (was: Was, el: HTMLElement, into: HTMLElement, shift = { dx: 0, dy: 0 }, under = 1): { copy: HTMLElement; fade: Animation }[] => {
    done.crossfaded.add(el);
    done.crossfaded.add(into);
    const copies = was.content!.map((copy) => {
      copy.el.style.zoom = String(copy.scale / (effectiveZoom(into) * under));
      // Stood back in the piece itself, it keeps the type and custom properties its own parent gave it.
      for (const [name, value] of copy.inherited.style) if (!copy.el.style.getPropertyValue(name)) copy.el.style.setProperty(name, value);
      const stood: Was = { ...copy, parent: into };
      const fade = fadeOut(stood, standIn(stood, shifted(placeOf(copy.box), shift.dx, shift.dy)));
      return { copy: copy.el, fade };
    });
    fadeKids(into);
    return copies;
  };
  /** Fades in a re-flowing piece's new content it has not yet faded. */
  const fadeKids = (el: HTMLElement) => {
    for (const kid of drawnKids(el)) {
      if (done.kids.has(kid) || done.landed.has(kid)) continue;
      done.kids.add(kid);
      fadeIn(kid, { length: out });
    }
  };
  const within = (set: Set<HTMLElement>, el: Element) => { for (const piece of set) if (piece.contains(el)) return true; return false; };
  /** Draws `el` by a copy standing on `box` in the lifted layer, hiding it until the pass lands. */
  const liftOut = (el: HTMLElement, box: VisualRect): HTMLElement => {
    const copy = snapshot(el);
    const layer = standIn({ ...wasOf(el, box), el: copy, parent: null, z: String(liftRung) }, box);
    scope.lifted.layers.push(layer);
    scope.lifted.hides.push(el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 2 * duration + out }));
    return copy;
  };
  /** How a piece that left fades out in a lifting scope where its parent left with it: on the lifted
   *  rung, as everything travelling with it does, rather than on the page under the surface it stood on. */
  const onLiftedRung = (was: Was): Was => (liftRung !== null && !was.parent?.isConnected ? { ...was, parent: null, z: String(liftRung) } : was);
  /** Ids of the riding pieces whose new self stands where its old self stood beside what it rides, so
   *  it rides whole and nothing crosses over. */
  const solid = new Set<string>();

  /** Draws what the page shows now and the pass has not drawn yet. */
  const reconcile = () => {
    const now = marked(scope);
    const guides = guidesOf(scope);
    const boxes = new Map<string, VisualRect>();
    const fresh: [string, HTMLElement][] = [];
    for (const [id, el] of now) if (done.pieces.get(id) !== el) { fresh.push([id, el]); boxes.set(id, visualRect(el)); }
    // Read before anything moves a piece: whose content stands otherwise inside it. A piece the pass
    // already carries is read with its moves set aside.
    const reflowing = new Set<HTMLElement>();
    for (const [id, el] of now) {
      const was = first.pieces.get(id);
      if (!was?.content?.length || done.crossfaded.has(el)) continue;
      const carriedNow = done.pieces.get(id) === el ? followed.find((p) => (p.real ?? p.el) === el) : undefined;
      const moved = carriedNow
        ? bare(carriedNow.anims, () => drawn(visualRect(el)) && contentMoved(was, el))
        : !!boxes.get(id) && drawn(boxes.get(id)!) && contentMoved(was, el);
      if (moved) reflowing.add(el);
    }
    /** Where the piece or guide `id` that pieces ride stands laid out now, or null where it stands nowhere. */
    const anchorNow = (id: string): VisualRect | null => {
      const carriedNow = followed.find((p) => (p.real ?? p.el).getAttribute(scope.attr) === id);
      if (carriedNow) return carriedNow.box;
      const box = boxes.get(id) ?? (guides.get(id) ? visualRect(guides.get(id)!) : null);
      return box && drawn(box) ? box : null;
    };
    const anchorWas = (id: string): VisualRect | null => {
      const box = first.pieces.get(id)?.box ?? first.guides.get(id) ?? null;
      return box ? placeOf(box) : null;
    };
    // Every piece is read before any animation starts, then probed together and read once more: a read
    // after an animation starts recalculates the page's style, once per piece if they interleave.
    const reads: {
      /** It travels to a face from a piece that was that picture alone; `crosses` where the picture differs. */
      toFace: boolean; crosses: boolean;
      el: HTMLElement; was: Was; box: VisualRect; content: number; origin: Origin | null; opacity: string;
      layer: { el: HTMLElement; z: number } | null; layout: string; shape: string | null; start: { left: number; top: number; sx: number; sy: number };
    }[] = [];
    const arrivals: HTMLElement[] = [];
    /** Stand-ins travelling around a piece (`Was.face`, `Was.drew`): each stays about it as it goes from
     *  `from` to `to`, in screen px. */
    const trails: { el: HTMLElement; from: Box; to: Box }[] = [];
    /** Riding pieces found now: where each starts, as far from where it stands as what it rides moves. */
    const riders: { el: HTMLElement; box: VisualRect; dx: number; dy: number; crosses: boolean; guided: boolean }[] = [];
    const frame = scope.frame?.() ?? null;
    const frameAt = frame ? visualRect(frame) : null;
    lag = frameAt && first.frame ? { dx: frameAt.left - first.frame.left, dy: frameAt.top - first.frame.top } : { dx: 0, dy: 0 };
    const clips = new Map<Element, Element | null>();
    for (const [id, el] of fresh) {
      done.pieces.set(id, el);
      const box = boxes.get(id)!;
      if (!drawn(box)) continue;
      const was = first.pieces.get(id);
      // Lifted, a piece travelling to where its scroller cuts it off would vanish as it lands: it fades
      // out where it stood instead, as one only the old arrangement had.
      if (was && !was.ride && liftRung !== null && cutOff(el, clips)) {
        done.left.add(id);
        const stood = was.el.isConnected ? { ...was, el: snapshot(was.el) } : onLiftedRung(was);
        leave(stood, standIn(stood, placeOf(was.box)));
        continue;
      }
      const on = el.getAttribute(MORPH_RIDE_ATTR);
      if (on !== null) {
        if (clip && outside(box, clip)) continue;
        const from = anchorWas(on), to = anchorNow(on);
        const at = el.getAttribute(MORPH_RIDE_AT_ATTR);
        const share = to ? shareIn(to, box) : { x: 0.5, y: 0.5 };
        const a = from && to ? ridePoint(from, at, share) : null, b = to ? ridePoint(to, at, share) : null;
        const dx = a && b ? a.x - b.x : 0, dy = a && b ? a.y - b.y : 0;
        // Its old self stood where its new self starts, at its size: it rides whole.
        const stood = was ? placeOf(was.box) : null;
        const whole = !!stood && !!a && Math.abs(stood.left - (box.left + dx)) < 1 && Math.abs(stood.top - (box.top + dy)) < 1
          && Math.abs(stood.width - box.width) < 1 && Math.abs(stood.height - box.height) < 1;
        if (whole) solid.add(id);
        riders.push({ el, box, dx, dy, crosses: !whole, guided: !now.has(on) && guides.has(on) });
        continue;
      }
      if (!was) {
        if (!done.arrived.has(el) && (!clip || !outside(box, clip))) { done.arrived.add(el); arrivals.push(el); }
        continue;
      }
      // Between a piece with a face and one without, the picture travels between the face's box and the
      // other piece's, and the piece with the face travels around it.
      const face = liftRung !== null || was.seen ? el.querySelector<HTMLElement>(`[${MORPH_FACE_ATTR}]`) : null;
      const faceBox = face ? visualRect(face) : null;
      const facing = liftRung !== null && (was.face !== undefined) !== (faceBox !== null && drawn(faceBox));
      const toFace = facing && !was.face;
      // The same picture travels as itself; anything else crosses over from the old one as it departs.
      const crosses = facing && (was.picture == null || was.picture !== pictureOf(toFace ? face! : el));
      const shape = el.getAttribute(MORPH_SHAPE_ATTR);
      // Its face sets off from the face's old box, where it travels to its face or the screen drew it.
      const start = toFace || (was.seen && faceBox && drawn(faceBox))
        ? startAround(placeOf(was.box), box, faceBox!, face!.getAttribute(MORPH_SHAPE_ATTR))
        : startOf(placeOf(facing ? was.face! : was.box), box, shape);
      const from = { left: start.left, top: start.top, width: start.sx * box.width, height: start.sy * box.height };
      if (facing && (was.face || crosses)) {
        done.left.add(id);
        const own = was.el.isConnected ? { ...was, el: snapshot(was.el) } : was;
        // A piece leaving its face travels over every clip; an old picture crossing over stands where it
        // stood, on the lifted rung where its parent left with it.
        const stood = !was.face && own.parent?.isConnected ? own : { ...own, parent: null, z: String(liftRung) };
        const host = standIn(stood, placeOf(was.box));
        if (was.face) trails.push({ el: stood.el, from, to: box });
        leave(stood, host);
      }
      // What drew it where it sets off from travels around it, standing where it stood over the page, once.
      const drew = was.drew;
      if (drew) {
        was.drew = undefined;
        const host = standIn(drew, drew.box);
        trails.push({ el: drew.el, from, to: box });
        leave(drew, host);
      }
      if (toFace) done.arrived.add(el);
      reads.push({
        toFace, crosses, el, was, box, content: shape === 'card' ? was.scale / effectiveZoom(el) : 1, origin: bareOrigin(el),
        opacity: shownOpacity(getComputedStyle(el)), layer: was.layer ? layerOf(el) : null, layout: layoutIn(el, frame), shape, start,
      });
    }
    const still = ({ start: { left, top, sx, sy }, box }: { start: { left: number; top: number; sx: number; sy: number }; box: VisualRect }) =>
      Math.abs(left - box.left) < 0.5 && Math.abs(top - box.top) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005;
    // A lifting scope draws each piece that travels by a copy in its lifted layer; one standing still
    // stays itself.
    const targets = reads.map((read) => (liftRung !== null && !still(read) ? liftOut(read.el, read.box) : read.el));
    reads.forEach((read, i) => {
      const target = targets[i]!;
      // A piece travelling to its face arrives around it late, the face showing all the way.
      const face = read.toFace ? target.querySelector<HTMLElement>(`[${MORPH_FACE_ATTR}]`) : null;
      for (let n = face; n && n !== target && n.parentElement; n = n.parentElement) {
        for (const kin of n.parentElement.children) if (kin !== n && kin instanceof HTMLElement) arrive(kin);
      }
      if (read.crosses) fadeIn(face ?? target, { length: out });
    });
    const riderTargets = riders.map(({ el, box, dx, dy }) => (liftRung !== null && (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) ? liftOut(el, box) : el));
    const lifted = targets.map((t, i) => t !== reads[i]!.el);
    const shift = `translate(${PROBE_PX}px, ${PROBE_PX}px)`;
    const moving = [...targets, ...riderTargets];
    // A copy wears no transform of its own, and a card's children are read off what is drawn.
    const origins = targets.map((t, i) => (lifted[i] ? bareOrigin(t) : reads[i]!.origin));
    const kidsOf = targets.map((t, i) => (reads[i]!.shape === 'card' ? cardKids(t) : []));
    const probes = moving.map((el) => {
      const probe = el.animate([{ transform: shift }, { transform: shift }], { duration, composite: 'add' });
      probe.pause();
      return probe;
    });
    const probed = moving.map((el) => visualRect(el));
    const placed = moving.map((_, i) => (i < targets.length ? reads[i]!.box : riders[i - targets.length]!.box));
    for (const probe of probes) probe.cancel();
    for (const el of arrivals) arrive(el);
    // A stand-in travelling around a piece (one that left its face, or what drew it where it set off) is
    // carried with it: scaled with it from its own top left corner, after the transform it wears (a
    // carried copy is placed by one), it stands about the piece as it stood on every frame.
    const trailAt = trails.map(({ el }) => ({ at: visualRect(el), w: parseFloat(el.style.width), h: parseFloat(el.style.height), own: copyTransform(el) }));
    trails.forEach(({ el, from, to }, i) => {
      const { at, w, h, own } = trailAt[i]!;
      const sx = to.width / from.width, sy = to.height / from.height;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
      // Screen px per px of its own.
      const kx = w > 0 ? at.width / w : 1, ky = h > 0 ? at.height / h : 1;
      const tx = (to.left - at.left - sx * (from.left - at.left)) / kx, ty = (to.top - at.top - sy * (from.top - at.top)) / ky;
      el.style.transformOrigin = '0px 0px';
      const frames = [{ transform: `${own}${MORPH_REST}` }, { transform: `${own}translate(${tx}px, ${ty}px) scale(${sx}, ${sy})` }];
      started.push(el.animate(frames, { duration, easing, fill: 'forwards' }));
    });
    // A card's old content stands in before the card moves, as far from its new corner as it stood from
    // its old one, so the card's start and its content's carry together draw it where it stood.
    const stoodIn = new Map<HTMLElement, CardKid[]>();
    reads.forEach(({ el, was, box, shape }, i) => {
      if (!reflowing.has(el) || shape !== 'card') return;
      const into = targets[i]!;
      const stood = placeOf(was.box);
      // The card is the box its fixed copies stand in from the start, as its move would make it, without
      // a transform of its own that a re-aimed move would read; given back once the last has faded.
      const hint = into.style.willChange;
      into.style.willChange = 'transform';
      const copies = crossfade(was, el, into, { dx: box.left - stood.left, dy: box.top - stood.top });
      void Promise.allSettled(copies.map(({ fade }) => fade.finished)).then(() => { into.style.willChange = hint; });
      stoodIn.set(el, copies.map(({ copy }) => ({ el: copy, box: visualRect(copy), k: effectiveZoom(copy), origin: bareOrigin(copy), stood: true })));
    });
    reads.forEach(({ el, was, box, content, opacity, layer, layout, shape, start }, i) => {
      const target = targets[i]!;
      const kids = [...kidsOf[i]!, ...(stoodIn.get(el) ?? [])];
      // A piece that drops to a lower layer stands on its old one while it is carried, so it never
      // passes under what it stood over.
      if (layer && was.layer && layer.z < was.layer.z) raise(scope, layer.el, was.layer.z);
      // Its own opacity (a tile behind a folded stack, a control veiled or unveiled) runs from the one it
      // stood at; one veiled now stays drawn while it fades, wherever what holds it is drawn.
      if (Math.abs(opacityOf(was.opacity) - opacityOf(opacity)) > 0.005) {
        const drawnOn = opacityOf(opacity) === 0 ? { visibility: 'inherit' } : {};
        const frames = [{ opacity: String(opacityOf(was.opacity)), ...drawnOn }, { opacity: String(opacityOf(opacity)), ...drawnOn }];
        started.push(target.animate(frames, { duration, easing: fade }));
      }
      const kx = (probed[i]!.left - placed[i]!.left) / PROBE_PX;
      const ky = (probed[i]!.top - placed[i]!.top) / PROBE_PX;
      if (Math.abs(kx) < 1e-3 || Math.abs(ky) < 1e-3) return;
      const piece: Carried = {
        el: target, ...(lifted[i] ? { real: el } : {}), box, kx, ky, origin: origins[i]!, shape, wasScale: shape === 'card' ? was.scale : null, content,
        fit: fitCards, kids, anims: [], layout, frameAt, start: box, duration, since: 0,
      };
      // A piece standing still is followed too, so a later commit that lays it out elsewhere moves it on.
      followed.push(piece);
      if (still({ start, box })) return;
      piece.start = { left: start.left, top: start.top, width: start.sx * box.width, height: start.sy * box.height };
      piece.anims = movePiece(piece, start, kids, { duration, easing });
      started.push(...piece.anims);
    });
    // A riding piece is carried only as far as what it rides moves, on the travel's clock, crossing
    // over where its place beside it changed. A lifted copy riding a piece has its move written after
    // its own transform (`copyTransform`), so it keeps with that piece's; a live piece's move is added
    // to the transform it wears, which may change under it, and so is one riding a guide, which keeps
    // with the guide's own glide on the main thread.
    const riderOwn = riderTargets.map((target, j) => (target === riders[j]!.el || riders[j]!.guided ? null : copyTransform(target)));
    riders.forEach(({ el, dx, dy, crosses }, j) => {
      const target = riderTargets[j]!, i = targets.length + j, own = riderOwn[j]!;
      done.arrived.add(el);
      if (crosses) arrive(target);
      const kx = (probed[i]!.left - placed[i]!.left) / PROBE_PX, ky = (probed[i]!.top - placed[i]!.top) / PROBE_PX;
      if ((Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) || Math.abs(kx) < 1e-3 || Math.abs(ky) < 1e-3) return;
      const frames = [{ transform: `${own ?? ''}translate(${dx / kx}px, ${dy / ky}px)` }, { transform: `${own ?? ''}translate(0px, 0px)` }];
      started.push(target.animate(frames, own === null ? { duration, easing, composite: 'add' } : { duration, easing }));
    });
    // Any other piece's old content stands in under its move's start, which carries it from the scale
    // the piece starts at.
    for (const [id, el] of now) {
      const was = first.pieces.get(id);
      if (!was || !reflowing.has(el) || done.crossfaded.has(el)) continue;
      const read = reads.findIndex((r) => r.el === el);
      const into = read >= 0 ? targets[read]! : el;
      const carrier = followed.find((p) => p.el === into);
      const under = carrier ? Math.sqrt((carrier.start.width / carrier.box.width) * (carrier.start.height / carrier.box.height)) : 1;
      crossfade(was, el, into, undefined, under);
    }
    // A riding piece's old self crosses over: a copy of it, as it stood, rides what it rode to where
    // that stands now, fading out where its new self fades in.
    for (const [id, was] of first.pieces) {
      if (!was.ride || done.left.has(id) || solid.has(id)) continue;
      done.left.add(id);
      const box = placeOf(was.box);
      const from = anchorWas(was.ride.on), to = anchorNow(was.ride.on);
      const stood: Was = liftRung === null
        ? { ...was, el: was.ride.copy, parent: was.el.isConnected ? was.parent : null }
        : { ...was, el: was.ride.copy, parent: null, z: String(liftRung) };
      const host = standIn(stood, box);
      leave(stood, host);
      if (!from || !to) continue;
      const share = shareIn(from, box);
      const a = ridePoint(from, was.ride.at, share), b = ridePoint(to, was.ride.at, share);
      const own = parseFloat(stood.el.style.width), k = own > 0 ? visualRect(stood.el).width / own : 1;
      if (Math.abs(b.x - a.x) < 0.5 && Math.abs(b.y - a.y) < 0.5) continue;
      const guided = !now.has(was.ride.on) && guides.has(was.ride.on), worn = guided ? '' : copyTransform(stood.el);
      const frames = [{ transform: `${worn}translate(0px, 0px)` }, { transform: `${worn}translate(${(b.x - a.x) / k}px, ${(b.y - a.y) / k}px)` }];
      started.push(stood.el.animate(frames, guided ? { duration, easing, composite: 'add' } : { duration, easing }));
    }
    // A piece the re-arrangement removed, at once or a commit later, fades out where it stood.
    for (const [id, was] of first.pieces) {
      if (was.ride || now.has(id) || done.left.has(id) || was.el.isConnected) continue;
      done.left.add(id);
      const stood = onLiftedRung(was);
      leave(stood, standIn(stood, placeOf(was.box)));
    }
    if (!scope.presence) return;
    // Content inside an arriving piece arrives with it; inside a re-flowing one the crossfade carries it.
    const shownNow = shownContent(scope);
    for (const [id, { el }] of shownNow) {
      if (first.shown.has(id) || done.shownIn.has(el) || within(done.arrived, el) || within(done.crossfaded, el) || within(done.landed, el)) continue;
      done.shownIn.add(el);
      fadeIn(el, { length: out });
    }
    for (const [id, was] of first.shown) {
      if (shownNow.has(id) || done.shownOut.has(id)) continue;
      done.shownOut.add(id);
      // Content that left with its piece fades inside that piece's stand-in, and content of a
      // re-flowing piece inside the copy of its old content.
      if (scope.leaving.some((gone) => gone.contains(was.el)) || (was.piece && done.crossfaded.has(was.piece))) continue;
      const copy = was.el.isConnected ? copyOf(was) : null;
      if (copy && !copy.parent) continue;
      const stood = copy ? copy.was : was;
      fadeOut(stood, standIn(stood, placeOf(was.box)));
    }
  };
  reconcile();
  // Every piece stands where it stood through the frame that lays out and paints the new arrangement,
  // which can take far longer than a frame, and travels from the next one on, so none of the motion
  // is spent inside it.
  const hold = () => { for (const anim of started) { anim.id = MORPH_ANIMATION; if (anim.playState !== 'paused') anim.pause(); } };
  hold();
  if (scope === page) undrawn = false;
  scope.pieces = followed;
  // Whether the pass has set off and the timeline's time it did: until then, and for as long as a held
  // pass waits, what it adds stands paused with the rest; after, it runs, whatever its moves' clock.
  const pass: Pass = { off: false, at: null, timed: false };
  let following = false;
  const watch = () => {
    if (following || !followed.length) return;
    following = true;
    follow(scope, started, followed, { duration, easing, out, pass });
  };
  watch();
  if (held) return;
  if (!started.length && !late) { settle(Promise.resolve()); return; }
  // Content a carried piece mounts while the pass runs (a window's late controls) fades in over the
  // departure share from where it lands, as the content it joins did.
  const landing = typeof MutationObserver === 'function' ? new MutationObserver((records) => {
    if (scope.running !== started) { landing?.disconnect(); return; }
    const added = new Set<HTMLElement>();
    for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement && !isStandIn(n)) added.add(n);
    for (const el of added) {
      // Once for what lands together: the outermost of it, and inside a piece the pass carries.
      if (done.landed.has(el) || !followed.some((p) => p.el !== el && p.el.contains(el))) continue;
      let outer = false;
      for (let n = el.parentElement; n && !outer; n = n.parentElement) outer = added.has(n) || done.landed.has(n) || isStandIn(n);
      if (outer || !drawn(visualRect(el))) continue;
      done.landed.add(el);
      const anim = fadeIn(el, { length: out });
      anim.id = MORPH_ANIMATION;
      if (!pass.off) anim.pause();
    }
  }) : null;
  landing?.observe(document.body, { subtree: true, childList: true });
  const go = () => {
    if (scope.running !== started) return;
    pass.off = true;
    pass.at = timelineNow();
    for (const anim of started) anim.play();
    scope.clock = null;
    passClock(scope);
    const finished = allFinished(started);
    // A pass that has run carries nothing: a seat read inside a piece it drew (`restingRect`) is read
    // where the page lays it out again, so later resizes move the character with it.
    void finished.then(() => { landing?.disconnect(); if (scope.running === started) { scope.pieces = []; lower(scope); land(scope); } });
    settle(finished);
  };
  // A late pass reads the page again on the next frame, after the commits the first frame's size
  // observers make, and sets off on the one after, so the frame that lays out what it adds moves nothing.
  const again = () => {
    if (scope.running !== started) return;
    reconcile();
    hold();
    watch();
    requestAnimationFrame(go);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(late ? again : go);
  else go();
}

/** Runs `read` with `anims` set past their end, where they draw nothing, and puts them back. */
function bare<T>(anims: Animation[], read: () => T): T {
  const at = anims.map((anim) => anim.currentTime);
  for (const anim of anims) anim.currentTime = Number(anim.effect?.getComputedTiming().endTime ?? 0);
  try {
    return read();
  } finally {
    anims.forEach((anim, i) => { anim.currentTime = at[i] ?? 0; });
  }
}

/** A piece a pass draws, followed while it runs: the box the layout gives it, the screen px per px of
 *  its own on each axis, its transform origin where it wears no transform of its own, the zoom a card's
 *  content stood at as a share of its own, its animations, and its layout as `layoutIn` reads it. */
interface Carried {
  el: HTMLElement; box: VisualRect; kx: number; ky: number; origin: Origin | null;
  /** For a piece a lifting scope draws by a copy (`el`): the piece itself, whose layout it follows. */
  real?: HTMLElement;
  /** Its `MorphShape`, read off the piece, which a copy does not wear. */
  shape: string | null;
  /** A card's: the screen px per px of its own it stood at, its content's zoom as a share of its own, and
   *  whether that content starts within the old outline (`playMorph`'s `fitCards`). */
  wasScale: number | null; content: number; fit: boolean;
  kids: CardKid[]; anims: Animation[]; layout: string;
  /** Where its scope's frame stood drawn, screen px, when `box` was read; null for the page's pieces. */
  frameAt: VisualRect | null;
  /** The box its move starts from, in screen px, and the move's length. */
  start: { left: number; top: number; width: number; height: number }; duration: number;
  /** The pass's time its current move set off at: 0, or when a move all but run was re-aimed. */
  since: number;
}

/** Starts the animations that draw `piece` from `start` (its top left corner and its scale per axis)
 *  into its box, a card's `kids` carried at their even scale. */
function movePiece(
  piece: Carried, { left, top, sx, sy }: { left: number; top: number; sx: number; sy: number }, kids: CardKid[], timing: { duration: number; easing: string },
): Animation[] {
  const { el, box, kx, ky, origin } = piece;
  const tx = (left - box.left) / kx, ty = (top - box.top) / ky;
  const anims: Animation[] = [];
  if (origin) {
    // A piece with no transform of its own takes the move alone, which the compositor can run through
    // a busy main thread: its own origin is folded into the translation, so it still scales from its
    // top left corner.
    anims.push(el.animate([{ transform: `translate(${tx - origin.x * (1 - sx)}px, ${ty - origin.y * (1 - sy)}px) scale(${sx}, ${sy})` }, { transform: MORPH_REST }], timing));
  } else {
    // Added to the transform it wears, scaled from its top left corner, which the translation is
    // measured to; the origin animation holds that corner for exactly as long.
    if (sx !== 1 || sy !== 1) anims.push(el.animate([{ transformOrigin: '0px 0px' }, { transformOrigin: '0px 0px' }], { duration: timing.duration }));
    anims.push(el.animate([{ transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})` }, { transform: MORPH_REST }], { ...timing, composite: 'add' }));
  }
  if (kids.length) anims.push(...carryContent(el, box, kids, { sx, sy, content: piece.content, fit: piece.fit }, timing));
  if (piece.shape === 'fill') {
    const round = roundCorners(el, sx, sy, timing);
    if (round) anims.push(round);
  }
  return anims;
}

const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;

/**
 * A rounded plate stretched from `sx`, `sy` of its box keeps round corners: each corner's radius runs
 * against the plate's scale on each axis, sampled in `CARD_STEPS` on the move's own curve, so the drawn
 * corner stays the radius it wears. Null for a plate with square corners or no stretch.
 */
function roundCorners(el: HTMLElement, sx: number, sy: number, timing: { duration: number; easing: string }): Animation | null {
  if (sx === 1 && sy === 1) return null;
  const style = getComputedStyle(el);
  const radii = CORNERS.map((corner) => parseFloat(style[corner]) || 0);
  if (radii.every((r) => r === 0)) return null;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= CARD_STEPS; i++) {
    const p = i / CARD_STEPS;
    const x = sx + (1 - sx) * p, y = sy + (1 - sy) * p;
    const frame: Keyframe = { offset: p };
    CORNERS.forEach((corner, k) => { frame[corner] = `${radii[k]! / x}px ${radii[k]! / y}px`; });
    frames.push(frame);
  }
  return el.animate(frames, timing);
}

/** Where the layout puts `el`, transforms aside: its offsets up its offset parents and its size; inside
 *  `frame`, from the frame's own place, so a frame moving with all it holds moves none of its pieces. */
function layoutIn(el: HTMLElement, frame: HTMLElement | null): string {
  const at = (from: HTMLElement) => {
    let x = 0, y = 0;
    for (let n: HTMLElement | null = from; n; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y };
  };
  const own = at(el), base = frame ? at(frame) : { x: 0, y: 0 };
  return `${own.x - base.x},${own.y - base.y},${el.offsetWidth},${el.offsetHeight}`;
}

/** Settles once every animation in `started` has finished or been cancelled, those added to it while
 *  it runs included. */
async function allFinished(started: Animation[]): Promise<void> {
  for (;;) {
    const live = started.filter((anim) => anim.playState !== 'finished' && anim.playState !== 'idle');
    if (!live.length) return;
    await Promise.allSettled(live.map((anim) => anim.finished));
  }
}

/** The progress `x` of a CSS easing, for `cubic-bezier()` and `linear`; null for any other. */
function easingAt(css: string, x: number): number | null {
  if (css === 'linear') return x;
  const m = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(css.replace(/\s+/g, ''));
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
  const at = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < x) lo = mid; else hi = mid; }
  return at(y1, y2, (lo + hi) / 2);
}

/** Runs `check` on every frame after its animation frame callbacks and layout and before its paint (a
 *  size observer on a probe each frame resizes), so whatever a callback committed that frame is seen
 *  before it is drawn; stops once `check` returns false. */
function beforeEachPaint(check: () => boolean): void {
  if (typeof ResizeObserver !== 'function' || typeof requestAnimationFrame !== 'function') return;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const watch = new ResizeObserver(() => { if (!check()) { watch.disconnect(); probe.remove(); } });
  watch.observe(probe);
  const tick = () => {
    if (!probe.isConnected) return;
    probe.style.width = probe.style.width === '1px' ? '2px' : '1px';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Follows the pieces of a pass while it runs: one a later commit moves or resizes (a dock landing, a
 * panel's content arriving a frame late) is drawn on from where its move draws it to its new box, on
 * the same clock, from the start whose eased path passes through there, so it never jumps at the start,
 * midway or as the pass ends. A move all but run, or none, takes the motion's departure
 * share or what is left of the motion instead.
 */
function follow(
  scope: Scope, started: Animation[], pieces: Carried[], { duration, easing, out, pass }: { duration: number; easing: string; out: number; pass: Pass },
): void {
  beforeEachPaint(() => {
    if (scope.running !== started) return false;
    if (!started.some((anim) => anim.playState === 'running' || anim.playState === 'paused')) return false;
    const holding = !pass.off;
    // The pass's clock: the start time the compositor gave its first move, read before any move is
    // re-aimed this frame and kept once read, the time it set off at until then. Never a move's own
    // time, which stops at its end and restarts with a re-aimed move, so a piece re-aimed every frame
    // would start over every frame and the pass never end.
    if (pass.off && !pass.timed) {
      const first = passClock(scope)?.startTime;
      if (first != null) { pass.at = Number(first); pass.timed = true; }
    }
    const clockStart = pass.off ? pass.at : null;
    const passTime = clockStart === null ? 0 : Math.max(0, timelineNow() - clockStart);
    // A pass follows its pieces for its motion and the departure share past it, no longer: what a
    // commit moves after that lands at once.
    if (!holding && passTime > duration + out) return false;
    // Read every piece before any is re-aimed, then probe them together: a read after an animation
    // starts or ends recalculates the page's style, once per piece if they interleave.
    const frame = scope.frame?.() ?? null;
    const moved = pieces.flatMap((piece) => {
      const real = piece.real ?? piece.el;
      if (!real.isConnected || !piece.el.isConnected) return [];
      const layout = layoutIn(real, frame);
      return layout === piece.layout ? [] : [{ piece, layout }];
    });
    if (!moved.length) return true;
    const frameNow = frame ? visualRect(frame) : null;
    const aims = moved.map(({ piece, layout }) => {
      piece.layout = layout;
      const own = passTime - piece.since;
      // Where its move draws it now on its old box: read off the move, since a reading now would put
      // the old move on the new layout, which no frame showed; carried as far as its frame has moved.
      const was = piece.box, from = piece.start;
      const at = piece.anims.length ? easingAt(easing, Math.min(1, Math.max(0, own / piece.duration))) ?? 1 : 1;
      const dx = frameNow && piece.frameAt ? frameNow.left - piece.frameAt.left : 0;
      const dy = frameNow && piece.frameAt ? frameNow.top - piece.frameAt.top : 0;
      piece.frameAt = frameNow;
      for (const anim of piece.anims) { anim.cancel(); started.splice(started.indexOf(anim), 1); }
      return {
        piece,
        drawnNow: {
          left: from.left + (was.left - from.left) * at + dx, top: from.top + (was.top - from.top) * at + dy,
          width: from.width + (was.width - from.width) * at, height: from.height + (was.height - from.height) * at,
        },
      };
    });
    for (const { piece } of aims) {
      // A copy in the lifted layer stands on the piece's new box first.
      if (piece.real) restand(piece.el, visualRect(piece.real));
      piece.box = visualRect(piece.el);
      // Its size, and so its origin in px, and its zoom may have changed with its layout.
      piece.origin = bareOrigin(piece.el);
      if (piece.wasScale !== null) {
        piece.content = piece.wasScale / effectiveZoom(piece.el);
        piece.kids = [...cardKids(piece.el), ...piece.kids.filter((kid) => kid.stood && kid.el.isConnected)];
      }
    }
    const shift = `translate(${PROBE_PX}px, ${PROBE_PX}px)`;
    const probes = aims.map(({ piece }) => {
      const probe = piece.el.animate([{ transform: shift }, { transform: shift }], { duration, composite: 'add' });
      probe.pause();
      return probe;
    });
    const probed = aims.map(({ piece }) => visualRect(piece.el));
    for (const probe of probes) probe.cancel();
    const e = easingAt(easing, Math.min(1, Math.max(0, passTime / duration)));
    const along = e !== null && e < 0.9;
    const k = along ? e! : 0;
    aims.forEach(({ piece, drawnNow }, i) => {
      const box = piece.box;
      const kx = (probed[i]!.left - box.left) / PROBE_PX, ky = (probed[i]!.top - box.top) / PROBE_PX;
      if (Math.abs(kx) < 1e-3 || Math.abs(ky) < 1e-3) return;
      piece.kx = kx;
      piece.ky = ky;
      // The start whose eased path passes through where the piece is drawn now.
      const s = {
        left: (drawnNow.left - box.left * k) / (1 - k), top: (drawnNow.top - box.top * k) / (1 - k),
        sx: (drawnNow.width - box.width * k) / (1 - k) / box.width, sy: (drawnNow.height - box.height * k) / (1 - k) / box.height,
      };
      piece.start = { left: s.left, top: s.top, width: s.sx * box.width, height: s.sy * box.height };
      piece.duration = along ? duration : Math.max(out, duration - passTime);
      piece.since = along ? 0 : passTime;
      piece.anims = movePiece(piece, s, piece.kids, { duration: piece.duration, easing });
      for (const anim of piece.anims) {
        anim.id = MORPH_ANIMATION;
        // On the pass's own clock; while the clock waits to start, a new move starts with it.
        if (along && clockStart !== null) anim.startTime = clockStart;
        if (holding) anim.pause();
        started.push(anim);
      }
    });
    // What stands on a re-aimed piece (the character on her seat) takes its place on the new box, and
    // is followed from where it is drawn on the next frame.
    if (scope === page) for (const place of layouts) place();
    return true;
  });
}

/** Whether a pass has set off, the document timeline's time it did, and whether that time is the
 *  start the compositor gave its moves rather than the frame `go` ran in. */
interface Pass { off: boolean; at: number | null; timed: boolean }

/** The document timeline's time now, in ms. */
function timelineNow(): number {
  const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  return t == null ? performance.now() : Number(t);
}

/** A move of the running pass still on the time its moves set off at: a piece's that was never
 *  re-aimed but along its path. Null while the pass is held, or with no move. */
function passClock(scope: Scope): Animation | null {
  const live = (anim: Animation | null) => !!anim && anim.playState !== 'idle' && anim.playState !== 'paused';
  if (live(scope.clock)) return scope.clock;
  scope.clock = null;
  for (const piece of scope.pieces) {
    if (piece.since !== 0) continue;
    // A move of its transform, which the compositor runs, rather than a held origin or clip.
    const move = piece.anims.find((anim) => live(anim) && !!(anim.effect as KeyframeEffect | null)?.getKeyframes?.().some((k) => k.transform != null));
    if (move) return (scope.clock = move);
  }
  return null;
}

/** Where a transform scales an element from, in its own px from its top left corner. */
interface Origin { x: number; y: number }

/** The transform origin of an element that wears no transform of its own, or null where it wears one,
 *  read before anything moves it. */
function bareOrigin(el: HTMLElement): Origin | null {
  const style = getComputedStyle(el);
  const none = (v: string | undefined) => !v || v === 'none';
  if (!none(style.transform) || !none(style.translate) || !none(style.scale) || !none(style.rotate)) return null;
  const [x, y] = style.transformOrigin.split(' ').map((v) => parseFloat(v));
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null;
}

/** A card's children as they stand laid out, before anything moves them. */
function cardKids(card: HTMLElement): CardKid[] {
  const kids: CardKid[] = [];
  for (const el of card.children) {
    // A stand-in fading inside the card is carried by its own fade, not counter-scaled.
    if (!(el instanceof HTMLElement) || isStandIn(el)) continue;
    const box = visualRect(el);
    if (drawn(box)) kids.push({ el, box, k: effectiveZoom(el), origin: bareOrigin(el) });
  }
  return kids;
}

/**
 * A card drawn from its old outline exactly (`sx`, `sy` of its own box) carries its content at an even
 * scale running from `content` to 1: each child takes the ratio of the two about the card's top left
 * corner, sampled in `CARD_STEPS`. With `fit` the scale starts no larger than the old outline holds the
 * content at, so all of it stands inside the outline the whole way (a sheet's foot as well as its head);
 * the card cuts off whatever stands past its outline: by its own overflow where it clips, or else by a
 * clip held for the motion, which repaints each frame.
 */
function carryContent(
  card: HTMLElement, box: VisualRect, kids: CardKid[], { sx, sy, content, fit }: { sx: number; sy: number; content: number; fit: boolean },
  timing: { duration: number; easing: string },
): Animation[] {
  const style = getComputedStyle(card);
  const started: Animation[] = [];
  const clipped = clips(style);
  if (!clipped) {
    const cut = `inset(0px round ${style.borderRadius || '0px'})`;
    started.push(card.animate([{ clipPath: cut }, { clipPath: cut }], { duration: timing.duration }));
  }
  // How far the content reaches from the card's top left corner, as shares of the old outline on each
  // axis. Content that fits the new box and starts within the old outline stays within it all the way;
  // a card that clips (a scroller) shows nothing past its own box, so its content reaches no further.
  let reach = 0;
  for (const { box: at, stood } of kids) {
    if (stood) continue;
    const right = clipped ? Math.min(at.right, box.right) : at.right;
    const bottom = clipped ? Math.min(at.bottom, box.bottom) : at.bottom;
    reach = Math.max(reach, (right - box.left) / box.width / sx, (bottom - box.top) / box.height / sy);
  }
  const from = fit && reach > 0 ? Math.min(content, 1 / reach) : content;
  const scales: { offset: number; x: number; y: number }[] = [];
  for (let i = 0; i <= CARD_STEPS; i++) {
    const p = i / CARD_STEPS;
    const c = from + (1 - from) * p;
    scales.push(i === CARD_STEPS ? { offset: 1, x: 1, y: 1 } : { offset: p, x: c / (sx + (1 - sx) * p), y: c / (sy + (1 - sy) * p) });
  }
  for (const { el, box: at, k, origin, stood } of kids) {
    // The card's top left corner, in the child's own px from its own.
    const ox = (box.left - at.left) / k, oy = (box.top - at.top) / k;
    // A copy of the old content stood at its old size, `1 / from` of the new content's at the start.
    const f = stood ? 1 / from : 1;
    const rest = (offset: number) => offset === 1 && f === 1;
    if (origin) {
      // A child with no transform of its own scales about its own origin, the translation holding
      // the card's corner still, so the compositor can run it.
      started.push(el.animate(scales.map(({ offset, x, y }) => ({
        offset, transform: rest(offset) ? MORPH_REST : `translate(${(ox - origin.x) * (1 - x * f)}px, ${(oy - origin.y) * (1 - y * f)}px) scale(${x * f}, ${y * f})`,
      })), timing));
    } else {
      started.push(el.animate([{ transformOrigin: `${ox}px ${oy}px` }, { transformOrigin: `${ox}px ${oy}px` }], { duration: timing.duration }));
      started.push(el.animate(scales.map(({ offset, x, y }) => ({ offset, transform: rest(offset) ? MORPH_REST : `translate(0px, 0px) scale(${x * f}, ${y * f})` })), { ...timing, composite: 'add' }));
    }
  }
  return started;
}

/**
 * A copy of content still on the page that is no longer shown (cut off by its scroller, or renamed
 * for what it shows now), to fade out where it stood: standing outside the clip that hides it, so
 * that clip does not cut the copy too. Its parent is null where there is nowhere to stand it.
 */
function copyOf(was: Was): { was: Was; parent: HTMLElement | null } {
  const copy = snapshot(was.el);
  const around = was.clip?.isConnected ? was.clip.parentElement : was.el.parentElement;
  return { was: { ...was, el: copy, parent: around }, parent: around };
}

/**
 * Stands a piece the re-arrangement removed back on `box`, inert and unmarked: in its old parent where
 * that stayed, so it keeps its zoom, type and stacking, or else in a layer of its own carrying what it
 * inherited. Returns what to remove once it has faded.
 */
function standIn(was: Was, box: VisualRect): HTMLElement {
  const el = was.el;
  unmark(el);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('inert', '');
  el.setAttribute(MORPH_STAND_IN_ATTR, '');
  let host = was.parent?.isConnected ? was.parent : null;
  let removable: HTMLElement = el;
  if (!host) {
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;zoom:${was.inherited.zoom};z-index:${was.z}`;
    for (const [name, value] of was.inherited.style) layer.style.setProperty(name, value);
    document.body.appendChild(layer);
    host = layer;
    removable = layer;
  }
  const own = { w: box.width / was.scale, h: box.height / was.scale, left: box.left / was.scale, top: box.top / was.scale };
  Object.assign(el.style, {
    position: 'fixed', left: `${own.left}px`, top: `${own.top}px`, right: 'auto', bottom: 'auto',
    margin: '0px', width: `${own.w}px`, height: `${own.h}px`, boxSizing: 'border-box', pointerEvents: 'none',
  });
  host.appendChild(el);
  restand(el, box, was.scale);
  for (const [scroller, left, top] of scrolledIn.get(el) ?? []) { scroller.scrollLeft = left; scroller.scrollTop = top; }
  return removable;
}

/** Stands a stand-in placed `position: fixed` on `box`: whatever its containing block, its zoom and the
 *  transform a running morph draws it under, one reading gives the screen px per px of its own on each
 *  axis. `scale` is the guess where it draws nothing. */
function restand(el: HTMLElement, box: VisualRect, scale = 1): void {
  const px = (v: string) => parseFloat(v) || 0;
  const own = { left: px(el.style.left), top: px(el.style.top), w: px(el.style.width), h: px(el.style.height) };
  const at = visualRect(el);
  const kx = at.width > 0 && own.w > 0 ? at.width / own.w : scale;
  const ky = at.height > 0 && own.h > 0 ? at.height / own.h : scale;
  Object.assign(el.style, {
    left: `${own.left + (box.left - at.left) / kx}px`, top: `${own.top + (box.top - at.top) / ky}px`,
    width: `${box.width / kx}px`, height: `${box.height / ky}px`,
  });
}

/** The rung a lifting scope's layer stands on: that of the outermost layer its element stands in, over
 *  everything of that layer as it comes later on the page, or what a control opened stands on. */
function liftRungOf(scope: Scope): number {
  const root = scope.holder();
  return (root instanceof HTMLElement ? layerOf(root)?.z : null) ?? rungs.opened;
}
