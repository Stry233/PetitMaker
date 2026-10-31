/*
 * The tour: its cards in the order a first visit needs them, and each card's Show me, which has the
 * visitor try the live controls step by step. A change worth showing again raises `version.ts:TOUR_VERSION`.
 *
 * Copy written for a mouse has its touch reading in `i18n/terms/device-readings.ts`; the deck reads
 * every key through `useReadingT`. A card's reel is found by its kind (`reels.ts`).
 */
import { forEdition, type EditionVariant } from '../../../platform/build/edition';
import type { CommandId } from '../../../state/keymap/registry';
import type { TourPose } from '../../../state/slices/shell';
import type { Arming, BuildMode } from '../../../state/editing/edit-mode';
import type { InputMode } from '../../../platform/device/input-mode';
import type { I18nKey } from '../../../i18n/keys';
import type { TourWatch } from '../../session/tour-watch';
import type { TourTargetId } from './steps';

export const TOUR_KINDS = ['welcome', 'move', 'shape', 'objects', 'view3d', 'generate', 'assistant', 'share'] as const;
export type TourKind = (typeof TOUR_KINDS)[number];

/** A keyboard hint on a card: the live bindings of `commands`, then what they do. Shown in PC mode only. */
export interface KeyHint { commands: readonly CommandId[]; labelKey: I18nKey }

type Side = 'left' | 'right' | 'above' | 'below';

/** What a try did beyond the interface's state: whether Fit ran, which a view fitted already never shows. */
export interface TourTry { fit: boolean }

/** One step of a Show me. */
export interface ShowStep {
  id: string;
  textKey: I18nKey;
  /** The controls the step rings, as one box around those shown; a step with none rings nothing
   *  and stands its callout near the top of the screen. */
  ring: readonly TourTargetId[];
  /** What it rings when nothing of `ring` is shown (a folded mode row stands for its tiles). */
  or?: readonly TourTargetId[];
  /** What the interface shows for the step, applied as it becomes current. */
  pose?: TourPose;
  /** The step waits for the visitor to do what it says, and moves on once this holds of the live
   *  interface, the gesture that did it has let go and no edit is still landing. `from` is the
   *  interface right after the step's pose, its cameras as the visitor's hand first acts (or as a
   *  view's camera first stands), so a glide still running is not theirs. Without it the step only
   *  points, and Next moves on. */
  done?: (from: TourWatch, now: TourWatch, tried: TourTry) => boolean;
  /** Whether a change from one reading to the next starts the try afresh: its baseline moves to
   *  `now`, so what the step counts is only what was done since. */
  rebase?: (last: TourWatch, now: TourWatch) => boolean;
  /** The step's action is on the map: no dim stands, so the map, its keys and every control take
   *  presses, and the ring is drawn round its controls alone. */
  map?: true;
  /** The one input mode the step is for, where the other has no way to do what it asks. */
  input?: InputMode;
  /** Where its callout prefers to stand beside the ring. */
  side: Side;
}

type ShowEntry = ShowStep & EditionVariant<ShowStep>;

export interface TourCard {
  kind: TourKind;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  /** The recap tile's name. Absent on the welcome card, which the recap does not repeat. */
  tileKey?: I18nKey;
  keys: readonly KeyHint[];
  show?: readonly ShowStep[];
}

type CardEntry = Omit<TourCard, 'show'> & EditionVariant<Omit<TourCard, 'show'>> & { show?: readonly ShowEntry[]; needsWebGL2?: true };

const PAN: readonly CommandId[] = ['camera.pan_up', 'camera.pan_left', 'camera.pan_down', 'camera.pan_right'];

/** How far a try must move the camera to count: screen px of a 2D pan, a zoom factor (a 2D wheel
 *  notch is 1.1), degrees of turn and of tilt, and scene units of a 3D move. */
const TRY = { pan: 48, zoom: 1.08, turn: 15, tilt: 6, move: 1.5 } as const;

type Done = NonNullable<ShowStep['done']>;
const zoomedBy = (a: number, b: number): boolean => Math.abs(Math.log(b / a)) >= Math.log(TRY.zoom);
const opened = (mode: BuildMode): Done => (_from, now) => now.mode === mode;
const shown = (view: TourWatch['view']): Done => (_from, now) => now.view === view;
/** An edit stood since the step began, made with one of `armings`. */
const built = (...armings: Arming['kind'][]): Done => (from, now) => now.edits > from.edits && armings.includes(now.arming);
/** Whether the 2D camera stands where Fit lands it, within half a screen px and a thousandth of its zoom. */
const fitted = (w: TourWatch): boolean => !!w.camera2d && !!w.fit2d
  && Math.abs(w.camera2d.x - w.fit2d.x) < 0.5 && Math.abs(w.camera2d.y - w.fit2d.y) < 0.5 && Math.abs(Math.log(w.camera2d.zoom / w.fit2d.zoom)) < 1e-3;
const camera2d = (moved: (a: NonNullable<TourWatch['camera2d']>, b: NonNullable<TourWatch['camera2d']>) => boolean): Done =>
  (from, now) => !!from.camera2d && !!now.camera2d && moved(from.camera2d, now.camera2d);
const camera3d = (moved: (a: NonNullable<TourWatch['camera3d']>, b: NonNullable<TourWatch['camera3d']>) => boolean): Done =>
  (from, now) => !!from.camera3d && !!now.camera3d && moved(from.camera3d, now.camera3d);
/** The shorter way round between two azimuths, in degrees. */
const turnBetween = (a: number, b: number): number => Math.abs(((b - a + 540) % 360) - 180);

/** A step that has the visitor open a mode: its tile is ringed with no mode open. */
const openMode = (mode: 'mountain' | 'object' | 'generate', textKey: I18nKey): ShowEntry => ({
  id: `open-${mode}`, textKey, ring: [`mode:${mode}`], or: ['modes'], pose: { mode: null }, done: opened(mode), side: 'above',
});
const FLAT: TourPose = { mode: null, view: '2d' };
const STANDING: TourPose = { mode: null, view: '3d' };

const CARDS: readonly CardEntry[] = [
  { kind: 'welcome', titleKey: 'tour.welcome_title', bodyKey: 'tour.welcome_body', keys: [] },
  {
    kind: 'move', titleKey: 'tour.move_title', bodyKey: 'tour.move_body', tileKey: 'tour.move_tile',
    keys: [
      { commands: ['camera.pan_drag'], labelKey: 'tour.key_pan_drag' }, { commands: PAN, labelKey: 'tour.key_move' },
      { commands: ['camera.fit'], labelKey: 'tour.key_fit' },
    ],
    show: [
      // Moving the offset at one zoom is a pan; a zoom moves it too, wherever it is aimed, so a zoom
      // starts the pan afresh.
      { id: 'pan', textKey: 'tour.show.move_pan', ring: [], map: true, pose: FLAT, side: 'below',
        done: camera2d((a, b) => a.zoom === b.zoom && Math.hypot(b.x - a.x, b.y - a.y) >= TRY.pan),
        rebase: (last, now) => !!last.camera2d && !!now.camera2d && last.camera2d.zoom !== now.camera2d.zoom },
      { id: 'zoom', textKey: 'tour.show.move_zoom', ring: ['zoom-in', 'zoom-out'], map: true, pose: FLAT, side: 'left',
        done: camera2d((a, b) => zoomedBy(a.zoom, b.zoom)) },
      // Done once the camera stands fitted; a view fitted already waits for Fit itself, by button or key.
      { id: 'fit', textKey: 'tour.show.move_fit', ring: ['fit'], pose: FLAT, side: 'left',
        done: (from, now, tried) => fitted(now) && (tried.fit || !fitted(from)) },
    ],
  },
  {
    kind: 'shape', titleKey: 'tour.shape_title', bodyKey: 'tour.shape_body', tileKey: 'tour.shape_tile',
    keys: [{ commands: ['history.undo'], labelKey: 'tour.key_undo' }],
    show: [
      openMode('mountain', 'tour.show.mountain_open'),
      { id: 'paint', textKey: 'tour.show.mountain_paint', ring: ['brush'], map: true, pose: { mode: 'mountain' }, side: 'above', done: built('brush', 'shape') },
      { id: 'erase', textKey: 'tour.show.mountain_erase', ring: ['eraser'], map: true, pose: { mode: 'mountain' }, side: 'above', done: built('erase') },
      { id: 'layer', textKey: 'tour.show.mountain_layer', ring: ['add-layer'], pose: { mode: 'mountain' }, side: 'left',
        done: (from, now) => now.layer > from.layer },
      { id: 'higher', textKey: 'tour.show.mountain_higher', ring: ['brush'], map: true, pose: { mode: 'mountain' }, side: 'above', done: built('brush', 'shape') },
    ],
  },
  {
    kind: 'objects', titleKey: 'tour.objects_title', bodyKey: 'tour.objects_body', tileKey: 'tour.objects_tile',
    keys: [{ commands: ['selection.rotate_cw'], labelKey: 'tour.key_turn' }, { commands: ['selection.deselect'], labelKey: 'tour.key_put_down' }],
    show: [
      openMode('object', 'tour.show.objects_open'),
      { id: 'card', textKey: 'tour.show.objects_card', ring: ['shelf-card'], pose: { mode: 'object' }, side: 'above',
        done: (_from, now) => now.mode === 'object' && (now.arming === 'item' || now.arming === 'macro') },
      { id: 'place', textKey: 'tour.show.objects_place', ring: [], map: true, pose: { mode: 'object' }, side: 'below', done: built('item', 'macro') },
    ],
  },
  {
    kind: 'view3d', titleKey: 'tour.view3d_title', bodyKey: 'tour.view3d_body', tileKey: 'tour.view3d_tile', needsWebGL2: true,
    keys: [{ commands: ['view.toggle'], labelKey: 'tour.key_view' }, { commands: PAN, labelKey: 'tour.key_move' }],
    show: [
      { id: 'switch', textKey: 'tour.show.view3d_switch', ring: ['view3d'], pose: FLAT, side: 'left', done: shown('3d') },
      { id: 'turn', textKey: 'tour.show.view3d_turn', ring: ['turn-left', 'turn-right'], map: true, pose: STANDING, side: 'left',
        done: camera3d((a, b) => turnBetween(a.az, b.az) >= TRY.turn) },
      { id: 'tilt', textKey: 'tour.show.view3d_tilt', ring: [], map: true, pose: STANDING, side: 'below', input: 'pc',
        done: camera3d((a, b) => Math.abs(b.el - a.el) >= TRY.tilt) },
      { id: 'zoom', textKey: 'tour.show.view3d_zoom', ring: ['zoom-in', 'zoom-out'], map: true, pose: STANDING, side: 'left',
        done: camera3d((a, b) => zoomedBy(a.dist, b.dist)) },
      { id: 'move', textKey: 'tour.show.view3d_move', ring: [], map: true, pose: STANDING, side: 'below',
        done: camera3d((a, b) => Math.hypot((b.tx ?? 0) - (a.tx ?? 0), (b.tz ?? 0) - (a.tz ?? 0)) >= TRY.move) },
      { id: 'flat', textKey: 'tour.show.view3d_flat', ring: ['view3d'], pose: STANDING, side: 'left', done: shown('2d') },
    ],
  },
  {
    kind: 'generate', titleKey: 'tour.generate_title', bodyKey: 'tour.generate_body', tileKey: 'tour.generate_tile', keys: [],
    lite: { bodyKey: 'lite.tour_generate' },
    show: [
      openMode('generate', 'tour.show.generate_open'),
      { id: 'kinds', textKey: 'tour.show.generate_kinds', ring: ['generate-kinds'], pose: { mode: 'generate' }, side: 'above', lite: { textKey: 'lite.tour_generate_kinds' } },
      { id: 'recipe', textKey: 'tour.show.generate_recipe', ring: ['recipe'], pose: { mode: 'generate' }, side: 'above',
        done: (from, now) => now.edits > from.edits },
    ],
  },
  {
    kind: 'assistant', titleKey: 'tour.assistant_title', bodyKey: 'tour.assistant_body', tileKey: 'tour.assistant_tile', keys: [], lite: false,
  },
  {
    kind: 'share', titleKey: 'tour.share_title', bodyKey: 'tour.share_body', tileKey: 'tour.share_tile', keys: [],
    lite: { bodyKey: 'lite.save_hint' },
    show: [
      { id: 'open', textKey: 'tour.show.share_open', ring: ['share'], pose: { mode: null, share: null }, side: 'below', lite: false,
        done: (_from, now) => now.share },
      { id: 'tabs', textKey: 'tour.show.share_tabs', ring: ['share-tabs'], pose: { share: 'keep' }, side: 'below', lite: false },
    ],
  },
];

const bare = ({ needsWebGL2: _needs, show, ...card }: CardEntry & { lite?: unknown }): TourCard => ({
  ...card, ...(show ? { show: forEdition<ShowStep>(show) } : {}),
} as TourCard);

const DECKS = {
  webgl2: forEdition<CardEntry>(CARDS).map(bare),
  flat: forEdition<CardEntry>(CARDS.filter((card) => !card.needsWebGL2)).map(bare),
};

/** The cards this edition and device offer: without WebGL2 the 3D card is left out (UI-24), and the
 *  offline edition leaves out the assistant's. */
export function tourCards(webgl2: boolean): readonly TourCard[] {
  return webgl2 ? DECKS.webgl2 : DECKS.flat;
}
