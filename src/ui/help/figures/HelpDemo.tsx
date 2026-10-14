/*
 * Help figures run the real 2D renderer and tool paths against an isolated demo world. DOM overlays
 * reuse the app's pointer, hints, captions, notices, and controls. Pointer positions use figure pixels
 * so scenes can cross between map and shelf, converting through the live viewport when cell data is
 * needed. Pixi loads only when canvas exists. Reduced motion renders the settled end state once.
 */
import { useEffect, useRef, useState } from 'react';
import { TILE_SIZE } from '../../../view/map2d/geometry/world';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { useKeybinds } from '../../../state/keymap/store';
import { useLocale, useT } from '../../../i18n/context';
import { resolveTokenSpecs } from '../hints/catalogue';
import { HintTokens } from '../hints/hint-marks';
import { helpFacts } from '../facts';
import { ACTIVE, FRAME_INK, INK, OVERLAY_DIM, PLATE, PLATE_INK } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { LoadingDots } from '../../primitives/LoadingDots';
import { face as handleFace, GRAB, KNOB } from '../../chrome/floating/CurveHandles';
import { anchorHandles } from '../../../core/base/spline';
import { gateMarkStyle, MIN_PX } from '../../shell/bars/generate/MazeEndpoints';
import { ToastFace } from '../../chrome/floating/Toast';
import { figureCaption, pressPulseFace } from './caption';
import { useInView } from './use-in-view';
import { TerrainToolsStrip, ShelfStrip } from './previews/strips';
import type { HelpScene, Stage } from './scenes';
import { refusalKey, ruleToast } from '../../../i18n/rule-copy';
import { cellCentre } from '../../../core/grid/grid-convert';
import { FURNITURE_REST, standUpDemo, type Furniture } from './demo-player';
import { LoadDisc, BuiltCard } from './demo-cards';



export function HelpDemo({ scene }: { scene: HelpScene }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const locale = useLocale();
  const overrides = useKeybinds((s) => s.overrides);
  const outerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const [furniture, setFurniture] = useState<Furniture>(FURNITURE_REST);
  /** The first frame is on the canvas. Until then the box holds the app's own dots: a demo that
   *  starts as the reader arrives (`use-in-view`) has a beat of import and world-building first,
   *  and an empty box for that beat reads as a figure that failed. */
  const [ready, setReady] = useState(false);

  const stage: Stage = scene.stage;
  const W = Math.round((stage.x2 - stage.x1 + 1) * stage.tile);
  const H = Math.round((stage.y2 - stage.y1 + 1) * stage.tile);

  const inView = useInView(outerRef);

  useEffect(() => {
    // The renderer, the world and the timeline stand up only once the figure nears the viewport:
    // a page mounts every demo at once, and a reader arrives at the top.
    if (!inView) return undefined;
    const outer = outerRef.current;
    const canvasHost = canvasHostRef.current;
    const cursorEl = cursorRef.current;
    const pulseEl = pulseRef.current;
    if (!outer || !canvasHost || !cursorEl || !pulseEl) return undefined;
    return standUpDemo({
      scene, W, H, outer, canvasHost, cursorEl, pulseEl,
      strip: () => stripRef.current, box: () => boxRef.current,
      t: (key, params) => tRef.current(key, params), onFurniture: setFurniture, onReady: setReady,
    });
  }, [scene, W, H, inView]);

  const facts = helpFacts(locale);
  const toastText = furniture.toast
    ? furniture.toast.kind === 'key'
      ? t(furniture.toast.key, { ...facts, ...furniture.toast.params })
      : ruleToast(t, refusalKey(furniture.toast.message), { ...facts, ...furniture.toast.params })
    : null;
  const keyTokens = furniture.keys ? resolveTokenSpecs(furniture.keys, overrides) : null;
  const stagePx = (x: number, y: number) => {
    const mid = cellCentre({ x, y });
    return { left: (mid.x - stage.x1) * stage.tile, top: (mid.y - stage.y1) * stage.tile };
  };
  const strip = scene.strip;

  return (
    <div
      ref={outerRef}
      aria-hidden
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: font.family }}
    >
      <div
        ref={boxRef}
        style={{
          position: 'relative', width: W, height: H, flex: 'none',
          borderRadius: radii.md, overflow: 'hidden', contain: 'paint',
        }}
      >
        <div ref={canvasHostRef} style={{ position: 'absolute', inset: 0 }} />
        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <LoadingDots color={PLATE_INK} />
          </div>
        )}
        {/* Gate pills, the way MazeEndpoints shows them. Positioned against the stage frame: the
            scenes that carry marks hold their camera still. */}
        {furniture.marks.map((m, i) => (
          <div
            key={`${m.labelKey}-${i}`}
            style={{
              position: 'absolute', ...stagePx(m.x, m.y), transform: 'translate(-50%, -50%)',
              display: 'flex', alignItems: 'center', pointerEvents: 'none',
              ...gateMarkStyle(Math.max(MIN_PX, stage.tile)),
            }}
          >
            {t(m.labelKey)}
          </div>
        ))}
        {/* A finished curve's adjust handles: the live controls' own faces and direction lines
            (`CurveHandles.tsx`), positioned against the stage frame the way the gate pills are.
            Terrain anchors sit on the micro grid, half a cell up-left of the macro centre, so
            they project without the pills' half-cell shift. */}
        {furniture.curveHandles && (() => {
          const k = Math.min(1, Math.max(0.45, stage.tile / TILE_SIZE));
          const hs = anchorHandles(furniture.curveHandles);
          const px = (x: number, y: number) => ({ x: (x - stage.x1) * stage.tile, y: (y - stage.y1) * stage.tile });
          const dot = (x: number, y: number, size: number, fill: string, key: string) => {
            const p = px(x, y);
            return (
              <span key={key} style={{ position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
                <span style={{ ...handleFace(size, fill), display: 'block' }} />
              </span>
            );
          };
          return (
            <>
              <svg width={W} height={H} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
                {furniture.curveHandles.map((a, i) => {
                  const h = hs[i]!;
                  const into = px(a.x + h.ihx, a.y + h.ihy);
                  const at = px(a.x, a.y);
                  const out = px(a.x + h.hx, a.y + h.hy);
                  return (
                    <polyline
                      key={i}
                      points={`${into.x},${into.y} ${at.x},${at.y} ${out.x},${out.y}`}
                      fill="none" stroke={FRAME_INK} strokeWidth={3 * k} strokeOpacity={0.35}
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  );
                })}
              </svg>
              {furniture.curveHandles.map((a, i) => {
                const h = hs[i]!;
                return [
                  dot(a.x + h.ihx, a.y + h.ihy, KNOB * k, PLATE, `${i}-into`),
                  dot(a.x + h.hx, a.y + h.hy, KNOB * k, PLATE, `${i}-out`),
                  dot(a.x, a.y, GRAB * k, ACTIVE, `${i}-grab`),
                ];
              })}
            </>
          );
        })()}
        {furniture.gauge >= 0 && (
          <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none' }}>
            <LoadDisc fill={furniture.gauge} />
          </div>
        )}
        {furniture.checklist && furniture.checklist.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div
              ref={(el) => {
                if (!el || typeof el.animate !== 'function' || isMotionReduced()) return;
                el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
              }}
              style={{ position: 'absolute', inset: 0, background: OVERLAY_DIM }}
            />
            <BuiltCard rows={furniture.checklist} title={t('help.fig.built_title', facts)} />
          </div>
        )}
        {/* Caption, key chips and toast share one stacked column, so none can cover another. */}
        {(furniture.capKey || keyTokens || toastText) && (
          <div
            style={{
              position: 'absolute', top: 6, left: 0, right: 0, display: 'flex',
              flexDirection: 'column', alignItems: 'center', gap: 5, pointerEvents: 'none',
            }}
          >
            {furniture.capKey && (
              <span style={figureCaption({ role: 'small', padding: '4px 12px', ink: INK, alpha: 0.92, maxWidth: '92%' })}>
                {t(furniture.capKey, facts)}
              </span>
            )}
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
      {/* The strip stands below the map box rather than over it: it is often wider than the crop,
          and inside the box the crop's own overflow would cut its ends. */}
      {strip && (
        <div ref={stripRef} style={{ display: 'flex', justifyContent: 'center', pointerEvents: 'none', marginTop: 6 }}>
          {strip.kind === 'tools'
            ? <TerrainToolsStrip active={furniture.toolsActive ?? strip.active} surface={strip.surface} size={furniture.stripSize ?? undefined} />
            : <ShelfStrip items={strip.items} smart={strip.smart} selected={furniture.stripSelected} counts={furniture.shelfCounts} />}
        </div>
      )}
      <div ref={pulseRef} style={{ position: 'absolute', zIndex: 2, ...pressPulseFace }} />
      <div ref={cursorRef} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 2 }} />
      {/* `PLATE` anchors the pointer's fallback tint while its art decodes. */}
      <span style={{ display: 'none', color: PLATE }} />
    </div>
  );
}
