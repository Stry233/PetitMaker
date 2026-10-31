/**
 * One re-arrangement drawn as a move (FLIP): the pieces marked through `useMorph` are measured before
 * the commit that re-arranges them (`measureMorph`), and once the new arrangement is laid out each is
 * drawn from the box it stood in to the one it stands in now on Web Animations (`playMorph`). The
 * animations draw a transform that runs out to none (added to one a piece wears, or alone, which the
 * compositor runs through a busy main thread), and a piece a later commit moves while they run is drawn
 * on to its new box, so every piece ends exactly where the layout puts it; a piece found only after
 * fades in, and one found only before fades out where it stood.
 * Content inside a piece that only one arrangement shows (`useMorphPresence`) fades the same way
 * within its piece. The page's morph (`measureMorph`, `playMorph`) carries the chrome's pieces; `morphScope` runs the
 * same morph inside one element apart from it, for a re-arrangement inside a piece.
 */
import { createSignal } from '../../core/base/signal';
import { easingCss, fadeEasingCss, outSeconds, seconds } from '../design/motion';
import type { MotionId } from '../design/motion/registry';
import { useUiPreview } from '../design/preview';
import { effectiveZoom, visualRect, type VisualRect } from '../design/visual-rect';

/** The attribute naming a piece; a piece inside another piece moves with it and is not one itself. */
export const MORPH_ATTR = 'data-morph';
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
export const MORPH_GROUP_ATTR = 'data-morph-group';

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
export const MORPH_REFLOW_ATTR = 'data-morph-reflow';

/** What a piece's root wears: its id, unique on the page, its `shape` where it has one, and whether
 *  its content `reflows` where its shape does not say so. A pictured subtree marks nothing. */
export function useMorph(id: string, shape?: MorphShape, { reflows = false }: { reflows?: boolean } = {}): {
  [MORPH_ATTR]?: string; [MORPH_SHAPE_ATTR]?: MorphShape; [MORPH_REFLOW_ATTR]?: '';
} {
  if (useUiPreview()) return {};
  return { [MORPH_ATTR]: id, ...(shape ? { [MORPH_SHAPE_ATTR]: shape } : {}), ...(reflows ? { [MORPH_REFLOW_ATTR]: '' } : {}) };
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
}

/** The pieces measured before a re-arrangement, by id, the content shown in only one arrangement that
 *  stood shown, by id, and the window they were measured in. */
export interface MorphFirst {
  pieces: Map<string, Was>; shown: Map<string, Was>; view: { w: number; h: number }; scope: Scope;
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

/** Calls `place` just before a morph measures where its pieces end, for a piece placed from another
 *  piece's box (the character on her seat), so it stands at its new place when measured. */
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
}

const page: Scope = {
  within: () => (typeof document === 'undefined' ? null : document), attr: MORPH_ATTR, presence: MORPH_PRESENCE_ATTR,
  holder: () => document.documentElement, tell: (run) => morphs.emit(run), running: [], leaving: [], retire: null, pieces: [], raised: [], clock: null,
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
    ? [['color', parent.color], ['font-family', parent.fontFamily], ['font-size', parent.fontSize], ['line-height', parent.lineHeight]]
    : [];
  return { zoom, style: [...type, ...vars] };
}

/** A computed opacity as a number; an engine that computes none draws it whole. */
const opacityOf = (v: string) => (v === '' ? 1 : Number(v));

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
  for (const [id, el] of marked(scope)) {
    const live = visualRect(el);
    const box = last?.boxes.get(id) ?? live;
    if (!drawn(box) || !drawn(live)) continue;
    if (clip && outside(box, clip)) continue;
    const was = wasOf(el, box);
    const { dx, dy } = { dx: box.left - live.left, dy: box.top - live.top };
    shifts.set(el, { dx, dy });
    if (scope === page) was.layer = layerOf(el);
    if (reflows(el)) {
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
  scope.holder()?.setAttribute(MORPHING_ATTR, '');
  const frame = scope.frame?.() ?? null;
  return { pieces, shown, view: last ? last.view : view, scope, frame: frame ? visualRect(frame) : null };
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
  return { el, box, parent: el.parentElement, scale: inherited.zoom * zoomOf(el), opacity: style.opacity, z: style.zIndex, inherited };
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
const OWN_ATTRS = ['id', 'data-testid', MORPH_ATTR, MORPH_PIECE_ATTR, MORPH_PRESENCE_ATTR, MORPH_SHAPE_ATTR, MORPH_REFLOW_ATTR, MORPH_GROUP_ATTR, MORPH_RAISED_ATTR];
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
 *  the page's nor tell its followers. */
export interface MorphScope {
  /** Measures the pieces in `root`, those outside its own box (scrolled out of view) left to arrive. */
  measure(root: HTMLElement): MorphFirst;
  /** Plays a pass, which settles once it has run or a later pass or `stop` ended it. */
  play(first: MorphFirst, motion: MotionId): MorphRun;
  /** Ends a running pass at once, for a host that unmounts. */
  stop(): void;
}

export function morphScope(): MorphScope {
  let root: HTMLElement | null = null;
  let last: MorphRun = { settled: Promise.resolve() };
  const scope: Scope = {
    within: () => root, attr: MORPH_PIECE_ATTR, holder: () => root, clip: () => (root ? visualRect(root) : null), frame: () => root,
    tell: (run) => { last = run; }, running: [], leaving: [], retire: null, pieces: [], raised: [], clock: null,
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

/** How far a `translate` of one px in a piece's own space moves it on screen, read off a probe. */
const PROBE_PX = 100;

/** How many steps a card's content counter-scale is sampled in: its scale is the ratio of two lerps,
 *  which keyframes interpolate only piecewise. */
const CARD_STEPS = 8;

/** A card's direct child, with where it stood laid out and the screen px per px of its own. */
interface CardKid { el: HTMLElement; box: VisualRect; k: number; origin: Origin | null }

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
 * re-arrangement add, remove or re-flow.
 */
export function playMorph(first: MorphFirst, motion: MotionId, { held = false, late = false }: { held?: boolean; late?: boolean } = {}): void {
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
  // A fade on the travel's curve can cross most of its range in one frame; fades take their own.
  const fade = fadeEasingCss(motion);
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
  const fadeIn = (el: HTMLElement, { delay = 0, length = duration - delay }: { delay?: number; length?: number } = {}) => {
    const anim = el.animate([{ opacity: 0, offset: 0 }], { duration: length, delay, easing: fade, fill: 'backwards' });
    started.push(anim);
    return anim;
  };
  const fadeOut = (was: Was, el: HTMLElement) => {
    const leave = was.el.animate([{ opacity: was.opacity }, { opacity: 0 }], { duration: out, easing: fade, fill: 'forwards' });
    const gone = () => { el.remove(); scope.leaving = scope.leaving.filter((g) => g !== el); };
    leave.finished.then(gone, () => {});
    scope.leaving.push(el);
    started.push(leave);
  };
  /** Fades a re-flowing piece's old content out where it stood, carried with the piece (a card's
   *  stretching with its outline for as long as it shows), as its new content fades in. */
  const crossfade = (was: Was, el: HTMLElement) => {
    done.crossfaded.add(el);
    for (const copy of was.content!) {
      copy.el.style.zoom = String(copy.scale / effectiveZoom(el));
      // Stood back in the piece itself, it keeps the type and custom properties its own parent gave it.
      for (const [name, value] of copy.inherited.style) if (!copy.el.style.getPropertyValue(name)) copy.el.style.setProperty(name, value);
      const stood: Was = { ...copy, parent: el };
      fadeOut(stood, standIn(stood, placeOf(copy.box)));
    }
    fadeKids(el);
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

  /** Draws what the page shows now and the pass has not drawn yet. */
  const reconcile = () => {
    const now = marked(scope);
    const boxes = new Map<string, VisualRect>();
    const fresh: [string, HTMLElement][] = [];
    for (const [id, el] of now) if (done.pieces.get(id) !== el) { fresh.push([id, el]); boxes.set(id, visualRect(el)); }
    // Read before anything moves a piece: whose content stands otherwise inside it. A piece the pass
    // already carries is read with its moves set aside.
    const reflowing = new Set<HTMLElement>();
    for (const [id, el] of now) {
      const was = first.pieces.get(id);
      if (!was?.content?.length || done.crossfaded.has(el)) continue;
      const carriedNow = done.pieces.get(id) === el ? followed.find((p) => p.el === el) : undefined;
      const moved = carriedNow
        ? bare(carriedNow.anims, () => drawn(visualRect(el)) && contentMoved(was, el))
        : !!boxes.get(id) && drawn(boxes.get(id)!) && contentMoved(was, el);
      if (moved) reflowing.add(el);
    }
    // Every piece is read before any animation starts, then probed together and read once more: a read
    // after an animation starts recalculates the page's style, once per piece if they interleave.
    const reads: {
      el: HTMLElement; was: Was; box: VisualRect; content: number; kids: CardKid[]; origin: Origin | null; opacity: string;
      layer: { el: HTMLElement; z: number } | null; layout: string;
    }[] = [];
    const arrivals: HTMLElement[] = [];
    const frame = scope.frame?.() ?? null;
    const frameAt = frame ? visualRect(frame) : null;
    lag = frameAt && first.frame ? { dx: frameAt.left - first.frame.left, dy: frameAt.top - first.frame.top } : { dx: 0, dy: 0 };
    for (const [id, el] of fresh) {
      done.pieces.set(id, el);
      const box = boxes.get(id)!;
      if (!drawn(box)) continue;
      const was = first.pieces.get(id);
      if (!was) {
        if (!done.arrived.has(el) && (!clip || !outside(box, clip))) { done.arrived.add(el); arrivals.push(el); }
        continue;
      }
      // A card's content keeps the zoom it stood at, measured before any probe moves it.
      const card = el.getAttribute(MORPH_SHAPE_ATTR) === 'card';
      reads.push({
        el, was, box, content: card ? was.scale / effectiveZoom(el) : 1, kids: card ? cardKids(el) : [], origin: bareOrigin(el),
        opacity: getComputedStyle(el).opacity, layer: was.layer ? layerOf(el) : null, layout: layoutIn(el, frame),
      });
    }
    const shift = `translate(${PROBE_PX}px, ${PROBE_PX}px)`;
    const probes = reads.map(({ el }) => {
      const probe = el.animate([{ transform: shift }, { transform: shift }], { duration, composite: 'add' });
      probe.pause();
      return probe;
    });
    const probed = reads.map(({ el }) => visualRect(el));
    for (const probe of probes) probe.cancel();
    for (const el of arrivals) fadeIn(el, { delay: out });
    reads.forEach(({ el, was, box, content, kids, origin, opacity, layer, layout }, i) => {
      // A piece that drops to a lower layer stands on its old one while it is carried, so it never
      // passes under what it stood over.
      if (layer && was.layer && layer.z < was.layer.z) raise(scope, layer.el, was.layer.z);
      // Its own opacity (a tile behind a folded stack) runs from the one it stood at.
      if (Math.abs(opacityOf(was.opacity) - opacityOf(opacity)) > 0.005) {
        started.push(el.animate([{ opacity: was.opacity }, { opacity }], { duration, easing: fade }));
      }
      const kx = (probed[i]!.left - box.left) / PROBE_PX;
      const ky = (probed[i]!.top - box.top) / PROBE_PX;
      if (Math.abs(kx) < 1e-3 || Math.abs(ky) < 1e-3) return;
      const shape = el.getAttribute(MORPH_SHAPE_ATTR);
      const { left, top, sx, sy } = startOf(placeOf(was.box), box, shape);
      const piece: Carried = {
        el, box, kx, ky, origin, wasScale: shape === 'card' ? was.scale : null, content, kids, anims: [], layout, frameAt,
        start: box, duration, since: 0,
      };
      // A piece standing still is followed too, so a later commit that lays it out elsewhere moves it on.
      followed.push(piece);
      if (Math.abs(left - box.left) < 0.5 && Math.abs(top - box.top) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return;
      piece.start = { left, top, width: sx * box.width, height: sy * box.height };
      piece.anims = movePiece(piece, { left, top, sx, sy }, kids, { duration, easing });
      started.push(...piece.anims);
    });
    for (const [id, el] of now) {
      const was = first.pieces.get(id);
      if (was && reflowing.has(el)) crossfade(was, el);
    }
    // A piece the re-arrangement removed, at once or a commit later, fades out where it stood.
    for (const [id, was] of first.pieces) {
      if (now.has(id) || done.left.has(id) || was.el.isConnected) continue;
      done.left.add(id);
      fadeOut(was, standIn(was, placeOf(was.box)));
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
    void finished.then(() => { landing?.disconnect(); if (scope.running === started) { scope.pieces = []; lower(scope); } });
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
  /** A card's: the screen px per px of its own it stood at, and its content's zoom as a share of its own. */
  wasScale: number | null; content: number;
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
  if (kids.length) anims.push(...carryContent(el, box, kids, { sx, sy, content: piece.content }, timing));
  return anims;
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
export function easingAt(css: string, x: number): number | null {
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
      if (!piece.el.isConnected) return [];
      const layout = layoutIn(piece.el, frame);
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
      piece.box = visualRect(piece.el);
      // Its size, and so its origin in px, and its zoom may have changed with its layout.
      piece.origin = bareOrigin(piece.el);
      if (piece.wasScale !== null) {
        piece.content = piece.wasScale / effectiveZoom(piece.el);
        piece.kids = cardKids(piece.el);
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
 * corner, sampled in `CARD_STEPS`. The scale starts no larger than the old outline holds the content
 * at, so all of it stands inside the outline the whole way (a sheet's foot as well as its head); the
 * card still cuts off whatever stands past its outline: by its own overflow where it clips, or else by
 * a clip held for the motion, which repaints each frame.
 */
function carryContent(
  card: HTMLElement, box: VisualRect, kids: CardKid[], { sx, sy, content }: { sx: number; sy: number; content: number },
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
  for (const { box: at } of kids) {
    const right = clipped ? Math.min(at.right, box.right) : at.right;
    const bottom = clipped ? Math.min(at.bottom, box.bottom) : at.bottom;
    reach = Math.max(reach, (right - box.left) / box.width / sx, (bottom - box.top) / box.height / sy);
  }
  const from = reach > 0 ? Math.min(content, 1 / reach) : content;
  const scales: { offset: number; x: number; y: number }[] = [];
  for (let i = 0; i <= CARD_STEPS; i++) {
    const p = i / CARD_STEPS;
    const c = from + (1 - from) * p;
    scales.push(i === CARD_STEPS ? { offset: 1, x: 1, y: 1 } : { offset: p, x: c / (sx + (1 - sx) * p), y: c / (sy + (1 - sy) * p) });
  }
  for (const { el, box: at, k, origin } of kids) {
    // The card's top left corner, in the child's own px from its own.
    const ox = (box.left - at.left) / k, oy = (box.top - at.top) / k;
    if (origin) {
      // A child with no transform of its own scales about its own origin, the translation holding
      // the card's corner still, so the compositor can run it.
      started.push(el.animate(scales.map(({ offset, x, y }) => ({
        offset, transform: offset === 1 ? MORPH_REST : `translate(${(ox - origin.x) * (1 - x)}px, ${(oy - origin.y) * (1 - y)}px) scale(${x}, ${y})`,
      })), timing));
    } else {
      started.push(el.animate([{ transformOrigin: `${ox}px ${oy}px` }, { transformOrigin: `${ox}px ${oy}px` }], { duration: timing.duration }));
      started.push(el.animate(scales.map(({ offset, x, y }) => ({ offset, transform: offset === 1 ? MORPH_REST : `translate(0px, 0px) scale(${x}, ${y})` })), { ...timing, composite: 'add' }));
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
  // Whatever its containing block, its zoom and the transform a running morph draws it under, the
  // stand-in lands on its old box: one reading gives the screen px per px of its own on each axis.
  const at = visualRect(el);
  const kx = at.width > 0 ? at.width / own.w : was.scale;
  const ky = at.height > 0 ? at.height / own.h : was.scale;
  Object.assign(el.style, {
    left: `${own.left + (box.left - at.left) / kx}px`, top: `${own.top + (box.top - at.top) / ky}px`,
    width: `${box.width / kx}px`, height: `${box.height / ky}px`,
  });
  for (const [scroller, left, top] of scrolledIn.get(el) ?? []) { scroller.scrollLeft = left; scroller.scrollTop = top; }
  return removable;
}
