/** A blueprint's two pictures: the blank ones the library holds drawn on the open map's template, and
 *  the save step's live pictures of its frame, laid alone on one stage the step's map shows too. */
import type { Rect } from '../../../core/grid/rect';
import type { GridState, MapTemplate } from '../../../core/model/types';
import { blueprintThumbPreview, blueprintThumbs, stageBlueprint, type BlueprintRecord, type Staged, type ThumbView } from '../../../io/blueprint';
import { THUMB_ASPECT } from '../../../io/blueprint/facts';
import type { BlueprintLibrary } from '../../../io/storage/blueprint-library';
import type { ViewMode } from '../../../platform/storage/prefs';
import { useEditorStore } from '../../../state/store';
import { captureBlueprint } from '../../../tools/blueprint';
import type { ActiveView, ScreenBox } from '../../../tools/pointer/runtime';
import { getActiveView, onActiveViewChange, onProjectionChange } from '../../../view/active-view';
import { seen3D } from '../../../view/map3d/scene/renderer-registry';
import { getMapRenderer, onMapRenderer } from '../../../view/map2d/scene/renderer-registry';
import { editorBlueprintLibrary } from './library';

const store = () => useEditorStore.getState();

/** A record's two pictures. */
export type BlueprintThumbs = BlueprintRecord['thumbs'];

/** Per library, the ids whose blank pictures this page has drawn or is drawing, with the template
 *  each is drawn on, so none is drawn twice on one template. */
const redrawnIn = new WeakMap<BlueprintLibrary, Map<string, MapTemplate>>();
/** The redraws, one after another. */
let redraws: Promise<void> = Promise.resolve();

/**
 * Draws the pictures of every record holding a blank one (imported or saved where none could be
 * drawn) on the open map's template and stores them back, once per record a page; nothing without
 * a map or a renderer. A redraw whose template is no longer open by its turn or its landing is
 * dropped and drawn again once that template is open again. Resolves when every redraw asked so far has landed.
 */
export function redrawBlankThumbs(): Promise<void> {
  const template = store().gridState?.template;
  if (!template || !getMapRenderer()) return redraws;
  const lib = editorBlueprintLibrary();
  const redrawn = redrawnIn.get(lib) ?? new Map<string, MapTemplate>();
  redrawnIn.set(lib, redrawn);
  const shown = (): boolean => store().gridState?.template === template;
  for (const r of lib.records()) {
    if ((r.thumbs.flat && r.thumbs.lifted) || redrawn.get(r.id) === template) continue;
    redrawn.set(r.id, template);
    const drop = (): void => { if (redrawn.get(r.id) === template) redrawn.delete(r.id); };
    redraws = redraws.then(async () => {
      const held = lib.records().find((x) => x.id === r.id);
      if (!held || (held.thumbs.flat && held.thumbs.lifted)) return;
      if (!shown()) { drop(); return; }
      const drawn = await blueprintThumbs(held.body, template);
      if (!shown()) { drop(); return; }
      const thumbs = { flat: held.thumbs.flat || drawn.flat, lifted: held.thumbs.lifted || drawn.lifted };
      if (thumbs.flat !== held.thumbs.flat || thumbs.lifted !== held.thumbs.lifted) await lib.setThumbs(r.id, thumbs);
    }).catch(() => {});
  }
  return redraws;
}

/** Redraws blank pictures whenever the library, the open map's template or the renderer changes; returns the stop. */
export function watchBlankThumbs(): () => void {
  let template = store().gridState?.template;
  const redraw = (): void => { void redrawBlankThumbs(); };
  const stops = [
    editorBlueprintLibrary().subscribe(redraw),
    onMapRenderer(redraw),
    useEditorStore.subscribe((s) => {
      if (s.gridState?.template === template) return;
      template = s.gridState?.template;
      redraw();
    }),
  ];
  redraw();
  return () => { for (const stop of stops) stop(); };
}

/** The last frame laid alone: the map and frame it was captured from, the body's text and its stage. */
let laid: { map: GridState; frame: Rect; text: string; stage: Staged } | null = null;

/** What `frame` of `map` holds, laid alone on the empty map of its template where it stands: the one
 *  stage the save step's pictures draw and its map shows, laid again only when what the frame holds
 *  changes. Null for a frame the capture refuses. */
export function framedStage(map: GridState, frame: Rect): Staged | null {
  const out = captureBlueprint(map, frame);
  if ('refusal' in out) return null;
  const text = JSON.stringify(out.body);
  if (laid && laid.map === map && laid.text === text && sameRect(laid.frame, frame)) return laid.stage;
  const stage = stageBlueprint(out.body, map.template, { x: frame.x, y: frame.y });
  laid = { map, frame, text, stage };
  return stage;
}

/** Lets go of the stage `framedStage` keeps, as the save step's end does. */
export function forgetFramedStage(): void {
  laid = null;
}

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** The framing the save step's live pictures last showed their frame with, while they are drawn. */
let shown: { frame: Rect; framing: ThumbView } | null = null;

/** How the save step's live pictures of `frame` last framed the two views (`watchFramedThumbs`), which
 *  a save of that frame draws its pictures with; undefined where none were drawn. */
export function framedView(frame: Rect): ThumbView | undefined {
  return shown && sameRect(shown.frame, frame) ? shown.framing : undefined;
}

/**
 * How the live view shown now frames the box `crop` on the screen: in 2D the map cells the box
 * covers, at the pictures' shape, turned as the view is; in 3D the part of the live view the box
 * holds, seen from where the view stands. Null with no view to ask.
 */
function cropFraming(crop: ScreenBox): Partial<Pick<ThumbView, 'flat' | 'lifted'>> | null {
  if (store().viewMode !== '2d') {
    const lifted = seen3D(crop);
    return lifted ? { lifted } : null;
  }
  const view = getActiveView();
  if (!view) return null;
  const centre = view.projection.screenToPoint(crop.left + crop.width / 2, crop.top + crop.height / 2);
  // The box's own width on the map, which a turned view leaves as long as it is, and the way the
  // screen's rightward runs there, which is the view's turn.
  const a = view.projection.screenToPoint(crop.left, crop.top + crop.height / 2);
  const b = view.projection.screenToPoint(crop.left + crop.width, crop.top + crop.height / 2);
  const width = Math.hypot(b.x - a.x, b.y - a.y), height = width / THUMB_ASPECT;
  const turn = Math.atan2(b.y - a.y, b.x - a.x);
  return { flat: { x: centre.x - width / 2, y: centre.y - height / 2, width, height, turn } };
}

/**
 * Brings `frame` to fill the box `box()` gives on the screen (the save step's viewfinder) in each map
 * view once: the view shown now, and each other the first time it is shown; nothing while the box
 * is null or the view cannot frame a box. Returns the stop.
 */
export function fitFrameToViewfinder(frame: Rect, box: () => ScreenBox | null): () => void {
  const fitted = new WeakSet<ActiveView>();
  const fit = (): void => {
    const view = getActiveView(), into = box();
    if (!view?.camera.fitBox || !into || fitted.has(view)) return;
    fitted.add(view);
    view.camera.fitBox(frame, into);
  };
  fit();
  return onActiveViewChange(fit);
}

/** The live pictures of a frame being saved: the view shown, each view's picture as last drawn (null
 *  until drawn), and the framing each was drawn with, which the save hands on as its draft's `framing`. */
export interface FramedPictures { view: ViewMode; flat: string | null; lifted: string | null; framing: ThumbView }

/**
 * Draws the pictures of `frame` as the live views frame the box `crop()` gives (none: as last
 * framed), and again, at most once every `wait` ms, whenever the camera, the window or the view changes: the view shown is drawn
 * through its live camera, the other keeps its last framing (its default aim until it was shown). The
 * body is laid on its empty map once (`framedStage`, the map the save step shows), and again only
 * when an edit of the map changes what the frame holds. Each picture has one draw in flight and at
 * most one waiting. Tells each time a picture lands; returns the stop. Nothing for a frame the
 * capture refuses.
 */
export function watchFramedThumbs(
  frame: Rect, crop: () => ScreenBox | null, tell: (p: FramedPictures) => void, wait = 250,
): () => void {
  const state = store().gridState;
  const first = state ? framedStage(state, frame) : null;
  if (!first) return () => {};
  let stage = first;
  const at = { x: frame.x, y: frame.y };
  const now: FramedPictures = { view: store().viewMode, flat: null, lifted: null, framing: { at } };
  let stopped = false, timer: ReturnType<typeof setTimeout> | null = null;
  let told: typeof shown = null;
  const busy = { flat: false, lifted: false }, queued = { flat: false, lifted: false };
  const draw = (which: 'flat' | 'lifted'): void => {
    if (busy[which]) { queued[which] = true; return; }
    busy[which] = true;
    void blueprintThumbPreview(stage, now.framing, which).catch(() => '').then((url) => {
      busy[which] = false;
      if (stopped) return;
      now[which] = url;
      told = { frame, framing: now.framing };
      shown = told;
      tell({ ...now });
      if (queued[which]) { queued[which] = false; draw(which); }
    });
  };
  const update = (): void => {
    timer = null;
    if (stopped) return;
    now.view = store().viewMode;
    const seen = crop();
    if (seen) now.framing = { ...now.framing, ...cropFraming(seen) };
    draw(now.view === '2d' ? 'flat' : 'lifted');
  };
  const later = (): void => { if (!timer && !stopped) timer = setTimeout(update, wait); };
  /** An edit of the map: the pictures change only when what the frame holds does. */
  const edited = (): void => {
    const s = store().gridState;
    const next = s ? framedStage(s, frame) : null;
    if (!next || next === stage) return;
    stage = next;
    draw('flat');
    draw('lifted');
  };
  const bus = store().eventBus;
  const stops = [
    onProjectionChange(bus, later, { cells: false }),
    useEditorStore.subscribe((next, was) => { if (next.viewMode !== was.viewMode) later(); }),
  ];
  bus.on('cells-changed', edited);
  bus.on('objects-changed', edited);
  update();
  // The other view's picture from its default framing until it is shown.
  draw(now.view === '2d' ? 'lifted' : 'flat');
  return () => {
    stopped = true;
    if (shown === told) shown = null;
    if (timer) clearTimeout(timer);
    for (const stop of stops) stop();
    bus.off('cells-changed', edited);
    bus.off('objects-changed', edited);
  };
}
