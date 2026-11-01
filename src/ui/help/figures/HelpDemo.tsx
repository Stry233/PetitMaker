/*
 * Help figures run the real 2D renderer and tool paths against an isolated demo world. Everything on
 * the map is the app's own: the overlay, the curve handles, the maze marks, the load meter, the bar or
 * shelf standing over the map's foot and the toast, each mounted on the figure's world and view. The
 * narration (caption, key chips, pointer) stands apart: the caption above the map, so it never covers
 * what the map shows. Pointer positions use figure pixels so scenes can cross between map and bar.
 * Pixi loads only when canvas exists. Reduced motion renders the settled end state once.
 */
import { useReducedMotionConfig } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKeybinds } from '../../../state/keymap/store';
import { useObservedSize } from '../../primitives/use-observed-size';
import { TILE_SIZE, ZOOM_MIN } from '../../../view/map2d/geometry/world';
import { useLocale } from '../../../i18n/context';
import { useReadingT } from '../../design/reading';
import { useLayoutShape, useTouchMode } from '../../design/input-mode';
import { resolveTokenSpecs } from '../hints/catalogue';
import { HintTokens } from '../hints/hint-marks';
import { helpFacts } from '../facts';
import { EDGE_VIGNETTE, INK, OVERLAY_DIM, PLATE, PLATE_INK, VIGNETTE_DEPTH } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { LoadingDots } from '../../primitives/LoadingDots';
import { CurveHandleLayer, type CurveHandleSource } from '../../chrome/floating/CurveHandles';
import { MazeEndpoints } from '../../shell/bars/generate/MazeEndpoints';
import { LoadMeter } from '../../shell/controls/LoadMeter';
import { PicturedSelection } from './PicturedSelection';
import { cornerArt } from '../../shell/frame';
import { BuildChecklist } from '../../chrome/modals/export/BuildChecklist';
import { ToastFace } from '../../chrome/floating/Toast';
import { figureCaption, pressPulseFace } from './caption';
import { useInView } from './use-in-view';
import { publishBarHeight, useReservedBarHeight } from './bar-height';
import { TerrainToolsStrip, ShelfStrip } from './previews/strips';
import type { HelpScene, SceneForm, Stage } from './scenes';
import { refusalKey, ruleToast } from '../../../i18n/terms/rule-copy';
import { FURNITURE_REST, standUpDemo, type DemoMap, type Furniture } from './demo-player';
import { useFigureRoom, useLiveFrameZoom } from './figure-scale';

const noop = () => {};

/** The load meter's art, the corner's own disc (`frame.ts:cornerArt`). */
const LOAD_ART = cornerArt(false).find((art) => art.src === undefined);

/** The smallest cell a demo's map draws, the editor's own furthest zoom out. */
const MIN_TILE = ZOOM_MIN * TILE_SIZE;

/** The space between the map's top-right corner and the meter, in frame px, as the corner stands. */
const CORNER_INSET = 10;

/** How far below its top an element reaches with the captions that hang under its cells, in its own px. */
function hangingHeight(el: HTMLElement): number {
  const top = el.getBoundingClientRect().top;
  const k = el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1;
  let bottom = el.getBoundingClientRect().bottom;
  for (const caption of el.querySelectorAll('[data-map-caption]')) bottom = Math.max(bottom, caption.getBoundingClientRect().bottom);
  return (bottom - top) / (k || 1);
}

export function HelpDemo({ scene }: { scene: HelpScene }) {
  const t = useReadingT();
  const touch = useTouchMode();
  const upright = useLayoutShape() === 'portrait';
  const tRef = useRef(t);
  tRef.current = t;
  const locale = useLocale();
  const overrides = useKeybinds((s) => s.overrides);
  // The checklist dim is DOM motion; the demo's canvas keeps the canvas gate (`demo-player.ts`).
  const reduced = useReducedMotionConfig() === true;
  const frameZoom = useLiveFrameZoom();
  const outerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stripPanRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const fingerRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const [furniture, setFurniture] = useState<Furniture>(FURNITURE_REST);
  /** The first frame is on the canvas. Until then the box holds the app's own dots: a demo that
   *  starts as the reader arrives (`use-in-view`) has a beat of import and world-building first,
   *  and an empty box for that beat reads as a figure that failed. */
  const [ready, setReady] = useState(false);
  const [map, setMap] = useState<DemoMap | null>(null);

  // The map shrinks to a narrow column, cells and all; the interface over it keeps its live size
  // (UI-63), so a phone reader's bar and handles read as they do on the phone.
  const room = useFigureRoom();
  const natural = scene.stage;
  // The map keeps the cell size its scene frames it at, the size objects read at in the editor, and
  // a column narrower than the stage crops its sides about the stage's middle; the camera never zooms
  // out past the editor's own floor (`ZOOM_MIN`).
  const tile = Math.max(natural.tile, MIN_TILE);
  const stage: Stage = useMemo(() => ({ ...natural, tile }), [natural, tile]);
  const fitted = useMemo<HelpScene>(() => (tile === natural.tile ? scene : { ...scene, stage }), [scene, stage, tile, natural.tile]);
  const W = Math.min(Math.round((stage.x2 - stage.x1 + 1) * stage.tile), room > 0 ? Math.floor(room) : Infinity);
  const H = Math.round((stage.y2 - stage.y1 + 1) * stage.tile);
  const inView = useInView(outerRef);

  // The bar stands over the map's foot, as in the app; the box grows by the bar's height so the
  // stage keeps all of its rows above it. A bar mounts only as its figure nears the viewport; until
  // then the box reserves the height one figure measured for the same bar look and form.
  const strip = scene.strip;
  const barKey = strip
    ? [strip.kind, strip.kind === 'tools' ? strip.surface : String(strip.smart), frameZoom, touch, upright, locale, W].join('|')
    : null;
  const { reserved, measure } = useReservedBarHeight(barKey);
  const showStrip = !!strip && (inView || measure);
  const [measured, setMeasured] = useState(0);
  const barH = Math.max(measured, reserved);
  // The bar's names hang below its cells, outside its box; the height counts them so they stay in the figure.
  useObservedSize(() => stripRef.current, ([el]) => {
    if (!el) return;
    const h = Math.ceil(hangingHeight(el));
    setMeasured((was) => Math.max(was, h));
    if (barKey) publishBarHeight(barKey, h);
  }, [frameZoom, showStrip, barKey]);

  useEffect(() => {
    // The renderer, the world and the timeline stand up only once the figure nears the viewport:
    // a page mounts every demo at once, and a reader arrives at the top.
    if (!inView) return undefined;
    const outer = outerRef.current;
    const canvasHost = canvasHostRef.current;
    const cursorEl = cursorRef.current;
    const fingerEl = fingerRef.current;
    const pulseEl = pulseRef.current;
    if (!outer || !canvasHost || !cursorEl || !fingerEl || !pulseEl) return undefined;
    // The canvas is cut once the bar's height is known, so the map reaches under it.
    if (scene.strip && barH === 0) return undefined;
    // A switch of input mode or a turned screen stands the demo up again in the new form.
    const form: SceneForm = { touch, upright };
    return standUpDemo({
      scene: fitted, W, H, barH, outer, canvasHost, cursorEl, fingerEl, pulseEl, form,
      strip: () => stripRef.current, stripPan: () => stripPanRef.current, box: () => boxRef.current,
      t: (key, params) => tRef.current(key, params), onFurniture: setFurniture, onReady: setReady, onMap: setMap,
    });
  }, [fitted, scene.strip, W, H, barH, inView, touch, upright]);

  const curveSource = useMemo<CurveHandleSource | null>(
    () => (map ? { sessions: map.curves, view: map.view, watch: map.watch, revision: 0, zoom: 1 } : null),
    [map],
  );
  const pictured = useMemo(() => (map ? { projection: () => map.view().projection, watch: map.watch } : undefined), [map]);

  const facts = helpFacts(locale);
  const toastText = furniture.toast
    ? furniture.toast.kind === 'key'
      ? t(furniture.toast.key, { ...facts, ...furniture.toast.params })
      : ruleToast(t, refusalKey(furniture.toast.message), { ...facts, ...furniture.toast.params })
    : null;
  // A touch reader presses no keys, so a figure in touch mode shows none.
  const keyTokens = furniture.keys && !touch ? resolveTokenSpecs(furniture.keys, overrides) : null;

  return (
    <div
      ref={outerRef}
      data-figure-width
      data-figure-sized
      aria-hidden
      // A stage cropped to the column can send the pointer past the map's sides; it is cut there
      // rather than widening the figure.
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: font.family, width: W, overflowX: 'clip' }}
    >
      {/* The narration stands above the map, every line it will say stacked in one cell so the
          tallest holds the room and a change of line moves nothing (UI-62). */}
      {furniture.captions.length > 0 && (
        <div style={{ display: 'grid', width: W, marginBottom: 8, pointerEvents: 'none' }}>
          {furniture.captions.map((key) => (
            <span
              key={key}
              style={{
                gridArea: '1 / 1', justifySelf: 'center', alignSelf: 'end', textAlign: 'center',
                visibility: key === furniture.capKey ? 'visible' : 'hidden',
                ...figureCaption({ role: 'small', padding: '4px 12px', ink: INK, alpha: 0.92, maxWidth: '100%' }),
              }}
            >
              {t(key, facts)}
            </span>
          ))}
        </div>
      )}
      <div
        ref={boxRef}
        style={{
          position: 'relative', width: W, height: H + barH, flex: 'none',
          borderRadius: radii.md, overflow: 'hidden', contain: 'paint',
        }}
      >
        <div ref={canvasHostRef} style={{ position: 'absolute', inset: 0 }} />
        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <LoadingDots color={PLATE_INK} />
          </div>
        )}
        {/* The map's own controls, on the figure's world and view. */}
        {curveSource && <CurveHandleLayer source={curveSource} pictured />}
        {pictured && <MazeEndpoints ends={furniture.marks} onMove={noop} pictured={pictured} />}
        {map && <PicturedSelection map={map} W={W} H={H} barH={barH} zoom={frameZoom} />}
        {map && furniture.loadMeter && LOAD_ART && (
          <div style={{ position: 'absolute', top: 0, right: 0, zoom: frameZoom, padding: CORNER_INSET, pointerEvents: 'none' }}>
            <LoadMeter art={LOAD_ART} reading={{ state: map.state, region: furniture.loadRegion }} />
          </div>
        )}
        {/* The shade the editor lays under its bars, so their names read over the map as they do there. */}
        {strip && barH > 0 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: VIGNETTE_DEPTH, background: EDGE_VIGNETTE, pointerEvents: 'none' }} />
        )}
        {strip && showStrip && (
          // The bar stands on the map's foot at its live size, cropped to the map's width; the
          // player pans it so the cell the pointer is heading for stands in the crop.
          <div ref={stripRef} style={{ position: 'absolute', left: 0, right: 0, top: H, pointerEvents: 'none' }}>
            <div ref={stripPanRef} style={{ width: 'max-content' }}>
              <div style={{ zoom: frameZoom }}>
                {strip.kind === 'tools'
                  ? <TerrainToolsStrip
                    active={furniture.toolsActive ?? strip.active} surface={strip.surface} size={furniture.stripSize ?? undefined} fill={W / frameZoom} />
                  : <ShelfStrip
                    items={strip.items} smart={strip.smart} selected={furniture.stripSelected} counts={furniture.shelfCounts} fill={W / frameZoom} />}
              </div>
            </div>
          </div>
        )}
        {map && furniture.checklist && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div
              ref={(el) => {
                if (!el || typeof el.animate !== 'function' || reduced) return;
                el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
              }}
              style={{ position: 'absolute', inset: 0, background: OVERLAY_DIM }}
            />
            <div style={{ position: 'relative', maxHeight: '100%', overflow: 'hidden' }}>
              <BuildChecklist subject={map.state} />
            </div>
          </div>
        )}
        {/* Key chips and the toast stand at the map's top, where the app's notices stand. */}
        {(keyTokens || toastText) && (
          <div
            style={{
              position: 'absolute', top: 6, left: 0, right: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', gap: 5, pointerEvents: 'none',
            }}
          >
            {keyTokens && <HintTokens tokens={keyTokens} />}
            {/* A scripted notice keeps the live raiser's 'info'; a refusal carries the world's own tone. */}
            {furniture.toast && toastText && (
              <ToastFace
                text={toastText}
                type={furniture.toast.kind === 'refusal' ? furniture.toast.tone : 'info'}
                count={1}
              />
            )}
          </div>
        )}
      </div>
      <div ref={pulseRef} style={{ position: 'absolute', zIndex: 2, ...pressPulseFace }} />
      <div ref={cursorRef} data-figure-pointer style={{ position: 'absolute', pointerEvents: 'none', zIndex: 2 }} />
      <div ref={fingerRef} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 2, display: 'none' }} />
      {/* `PLATE` anchors the pointer's fallback tint while its art decodes. */}
      <span style={{ display: 'none', color: PLATE }} />
    </div>
  );
}
