/**
 * The video import while it runs: a live picture of the ground read so far beside its three stages
 * in order, the one under way marked (a spinner while its share cannot be told), the stages behind
 * it ticked. The share done of the stage under way fills a groove under its label. Once the planet
 * is read it takes the picture's place, its landmark with it. The picture stands on the stage the
 * other planet pictures use.
 */
import { useObservedSize } from '../../../primitives/use-observed-size';
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { type MapTemplate } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import {
  SCAN_STAGES, scanPicturePainter, type ScanPictureLook, type ScanPreview, type ScanPreviewPainter, type ScanProgress, type ScanStage,
} from '../../../../editor/session/planet-scan';
import { cssMotion, framerMotion, seconds } from '../../../design/motion';
import { radii } from '../../../design/styles';
import { roleFont } from '../../../design/text-weight';
import { skin } from '../../../design/window-skin';
import { ON_DARK } from '../../../design/tokens';
import { CheckIcon } from '../../../primitives/line-glyphs';
import { paintPlanet } from '../../../../view/map2d/capture/planet-painter';
import { Spinner } from '../../../primitives/Spinner';
import { stageOutline } from '../export/pan-zoom-stage';
import { SEA } from '../../../design/tokens';

/** Each stage's copy key. */
const STAGE_COPY = {
  reading: 'planet.scan_stage_reading',
  tracking: 'planet.scan_stage_tracking',
  ground: 'planet.scan_stage_ground',
} as const satisfies Record<ScanStage, `planet.scan_stage_${string}`>;

/** The stage's label; reading again through playback says so, since its share starts over. */
const copyOf = (stage: ScanStage, progress: ScanProgress) => (stage === 'reading' && progress.again ? 'planet.scan_stage_reading_again' : STAGE_COPY[stage]);

const MARK = 22;
/** The picture's shape, as wide as the game's view of the ground. */
const PICTURE_ASPECT = '16 / 10';
/** The share done's groove, in css px. */
const METER = 6;
/** The finished planet's margin around its land, in css px. */
const FINISHED_MARGIN = 18;

const rowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: `${MARK}px minmax(0, 1fr)`, alignItems: 'center', columnGap: 12, rowGap: 8, minHeight: 36 };
const markStyle: CSSProperties = { width: MARK, height: MARK, flex: 'none', display: 'grid', placeItems: 'center' };
const pendingDot: CSSProperties = { width: 8, height: 8, borderRadius: '50%', background: skin.line };
const pictureStyle: CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: PICTURE_ASPECT, borderRadius: radii.lg, overflow: 'hidden',
  background: skin.inset,
};
const fillStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };
const meterStyle: CSSProperties = { gridColumn: 2, height: METER, borderRadius: radii.pill, background: skin.track, overflow: 'hidden' };

/** The window's colours and timings the picture is drawn in. */
const scanLook = (): ScanPictureLook => ({
  inset: skin.inset, line: skin.line, viewInk: ON_DARK,
  revealMs: seconds('scan.preview.reveal') * 1000, followMs: seconds('scan.preview.follow') * 1000,
});

/** The ground read so far, drawn by `ScanPreviewPainter`, one frame a display frame while it moves. */
function ScanPicture({ preview }: { preview: ScanPreview | undefined }) {
  const reduced = useReducedMotionConfig() === true;
  const painter = useRef<ScanPreviewPainter<ScanPreview> | null>(null);
  painter.current ??= scanPicturePainter(scanLook());
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const draw = () => {
    const canvas = ref.current;
    if (!canvas) return;
    if (reducedRef.current) { painter.current!.draw(canvas, performance.now(), false); return; }
    if (frame.current) return;
    const step = (now: number) => {
      frame.current = 0;
      const c = ref.current;
      if (c && painter.current!.draw(c, now, !reducedRef.current)) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    if (!preview) return;
    painter.current!.ingest(preview, performance.now(), !reducedRef.current);
    drawRef.current();
  }, [preview]);

  useObservedSize(() => ref.current, () => drawRef.current(), []);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); frame.current = 0; }, []);

  return <canvas ref={ref} aria-hidden data-testid="scan-picture" style={fillStyle} />;
}

/** The planet as the editor will open it, with its landmark. */
function FinishedPlanet({ template }: { template: MapTemplate }) {
  const reduced = useReducedMotionConfig() === true;
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current) paintPlanet(ref.current, { template }, { tx: 0, ty: 0, scale: 1 }, { margin: FINISHED_MARGIN });
  }, [template]);
  return (
    <motion.div data-testid="scan-finished" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={framerMotion('scan.preview.finish', reduced)}
      style={{ position: 'absolute', inset: 0, background: SEA }}>
      <canvas ref={ref} aria-hidden style={fillStyle} />
    </motion.div>
  );
}

export function VideoImportProgress({ progress, finished = null, stacked = false }: {
  progress: ScanProgress;
  /** The planet read, shown in place of the picture before the editor opens. */
  finished?: MapTemplate | null;
  /** The stages stand under the picture where the window is narrow. */
  stacked?: boolean;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const at = finished ? SCAN_STAGES.length : SCAN_STAGES.indexOf(progress.stage);
  const share = finished ? 1 : progress.share;
  return (
    <div role="status" aria-live="polite" data-testid="scan-progress"
      style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'stretch' : 'center', gap: stacked ? 16 : 24 }}>
      <div style={{ ...pictureStyle, flex: stacked ? 'none' : '1 1 0', minWidth: 0 }}>
        <ScanPicture preview={progress.preview} />
        {finished && <FinishedPlanet template={finished} />}
        <div style={stageOutline} aria-hidden />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: stacked ? 'none' : '0 0 220px', minWidth: 0, padding: stacked ? '0 4px' : 0 }}>
        {SCAN_STAGES.map((stage, i) => {
          const state = i < at ? 'done' : i === at ? 'active' : 'pending';
          return (
            <div key={stage} data-testid={`scan-stage-${stage}`} data-state={state} style={rowStyle}>
              <span aria-hidden style={markStyle}>
                {state === 'done' ? <CheckIcon size={MARK} /> : state === 'active' && share === null ? <Spinner size={18} /> : <span style={state === 'active' ? { ...pendingDot, background: skin.active } : pendingDot} />}
              </span>
              <span style={{ ...roleFont(state === 'active' ? 'head' : 'label'), color: state === 'pending' ? skin.muted : skin.ink }}>{t(copyOf(stage, progress))}</span>
              {state === 'active' && share !== null && (
                <div style={meterStyle} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}
                  aria-label={t(copyOf(progress.stage, progress))}>
                  {/* The fill slides in from the start, clipped by the groove: a transform, which the
                      compositor moves without repainting. */}
                  <div style={{ height: '100%', width: '100%', borderRadius: radii.pill, transform: `translateX(${(share - 1) * 100}%)`, background: skin.active, transition: cssMotion('meter.fill', ['transform'], reduced) }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
