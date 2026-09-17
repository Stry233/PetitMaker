/*
 * picture-bands.tsx — real crops of the real composed share picture, one per band the export
 * lays out. The picture is painted ONCE by the export's own pipeline (`paintPreviewLayout` over a
 * posed built map), and each figure slices it by the composition's own rects, so a crop can
 * never drift from where the band truly sits or how it truly looks. The pose: a titled, badged,
 * importable Standard export with the layer column, the 3D card and the footer on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInView } from '../use-in-view';
import type { GridState, Locale } from '../../../../../../core/model/types';
import type { MapProvenanceSummary } from '../../../../../../core/provenance/types';
import { renderThumbnail } from '../../../../../../canvas/thumbnail';
import { useEditorStore } from '../../../../../../state/store';
import { useT } from '../../../../../../i18n/context';
import { DEFAULT_OPTIONS } from '../../../export/ExportModal';
import type { ExportOptions } from '../../../../../../io/export/types';
import { useShareCode } from '../../../export/use-share-code';
import { loadBrandLockup } from '../../../export/brand';
import {
  captureCard3dAngles, paintPreviewLayout, type PaintedPreview,
} from '../../../export/render-preview-bridge';
import { PreviewFrame } from './PreviewFrame';
import { fullIslandState } from './share';

/** The subject map is procedurally generated (the session's designed build), and the posed
 *  summary says exactly that, so the header wears the real Procedural badge. */
const POSED_SUMMARY: MapProvenanceSummary = {
  containsAi: false, containsProcedural: true,
  aiEverUsed: false, aiUsedNoRemaining: false,
  aiTerrainPct: 0, aiObjectCount: 0, aiAreaPct: 0, proceduralAreaPct: 64,
  counts: { aiWrites: 0, aiAccepted: 0, proceduralRuns: 1, analysisOnlyCalls: 0 },
  humanAfterAi: false, aiAfterHuman: false,
  dominant: 'procedural', exportDisclosure: 'procedural',
};

/** One creation stamp for the whole pose, so every figure's code band is the same band. */
const POSED_CREATED_AT = new Date(0).toISOString();

/** The 3D card's stills, captured once per map: every band figure shares the one set. */
let anglesCache: { island: GridState; promise: Promise<HTMLImageElement[]> } | null = null;
function cardAngles(island: GridState): Promise<HTMLImageElement[]> {
  if (anglesCache?.island !== island) {
    anglesCache = { island, promise: captureCard3dAngles(island).catch(() => []) };
  }
  return anglesCache.promise;
}

function posedOptions(title: string, description: string): ExportOptions {
  return {
    ...DEFAULT_OPTIONS,
    title, description,
    layerPreview: true, card3d: true, footer: true, showBadge: true,
    // The posed base map is a thumbnail render, which carries no grid lines: a legend around a
    // gridless bitmap would label nothing.
    grid: false, annotations: false,
  };
}

/** One finished painting per locale, shared by all six band figures on the page. */
const paintedByLocale = new Map<string, PaintedPreview>();

/** The composed picture, painted once per (locale, code readiness) through the export pipeline.
 *  `active` holds the work until the figure nears the viewport. */
function usePaintedPicture(active: boolean): PaintedPreview | null {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const cached = paintedByLocale.get(locale) ?? null;
  const run = active && !cached;
  const island = useMemo(() => (run ? fullIslandState() : null), [run]);
  const options = useMemo(
    () => posedOptions(t('help.fig.pic_title'), t('help.fig.pic_desc')),
    [t],
  );
  const code = useShareCode(run, island, POSED_SUMMARY, true, 'standard', POSED_CREATED_AT);
  const [painted, setPainted] = useState<PaintedPreview | null>(cached);
  const codeCanvas = code.asset?.canvas ?? null;
  const codeSettled = !code.pending;
  useEffect(() => {
    if (cached) { setPainted(cached); return undefined; }
    if (!run || !island || !codeSettled) return undefined;
    let live = true;
    void (async () => {
      const [shotUrl, angles, lockup] = await Promise.all([
        renderThumbnail(island, 1200), cardAngles(island), loadBrandLockup(locale as Locale),
      ]);
      if (!live || !shotUrl) return;
      const baseMap = new Image();
      baseMap.src = shotUrl;
      await baseMap.decode().catch(() => {});
      if (!live || !baseMap.width) return;
      const next = paintPreviewLayout({
        options, summary: POSED_SUMMARY, state: island, locale: locale as Locale,
        baseMap, card3dAngles: angles, codeImg: codeCanvas, brandLockup: lockup,
      });
      if (live && next) { paintedByLocale.set(locale, next); setPainted(next); }
    })();
    return () => { live = false; };
  }, [run, cached, island, options, locale, codeCanvas, codeSettled]);
  return painted;
}

export type PictureBand = 'header' | 'layers' | 'shots' | 'code' | 'footer' | 'brand';

function bandRect(p: PaintedPreview, band: PictureBand) {
  const { comp } = p;
  switch (band) {
    case 'header': return comp.header;
    case 'layers': {
      const col = comp.layerCol;
      if (!col) return undefined;
      const label = comp.layerLabel;
      if (!label) return col;
      const x = Math.min(col.x, label.x); const y = Math.min(col.y, label.y);
      return { x, y, w: Math.max(col.x + col.w, label.x + label.w) - x, h: Math.max(col.y + col.h, label.y + label.h) - y };
    }
    case 'shots': return comp.card3d;
    case 'code': return comp.codeBand;
    case 'footer': return comp.footer;
    case 'brand': return comp.brand;
  }
}

/** A little card air around the band, so the crop reads as a place on the picture, not a sliver. */
const CROP_PAD = 12;

function BandCrop({ band, height }: { band: PictureBand; height: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef);
  const painted = usePaintedPicture(inView);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !painted) return;
    const rect = bandRect(painted, band);
    const img = new Image();
    img.src = painted.url;
    void img.decode().catch(() => {}).then(() => {
      const g = canvas.getContext('2d');
      if (!g) return;
      const S = painted.scale;
      const r = rect
        ? {
            x: Math.max(0, rect.x * S - CROP_PAD), y: Math.max(0, rect.y * S - CROP_PAD),
            w: Math.min(img.width, (rect.x + rect.w) * S + CROP_PAD) - Math.max(0, rect.x * S - CROP_PAD),
            h: Math.min(img.height, (rect.y + rect.h) * S + CROP_PAD) - Math.max(0, rect.y * S - CROP_PAD),
          }
        : { x: 0, y: 0, w: img.width, h: img.height };
      canvas.width = Math.round(r.w); canvas.height = Math.round(r.h);
      g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    });
  }, [painted, band]);
  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <PreviewFrame height={height}>
        <canvas ref={canvasRef} style={{ maxWidth: '92%', maxHeight: height - 24, objectFit: 'contain' }} />
      </PreviewFrame>
    </div>
  );
}

export function PicHeaderPreview() { return <BandCrop band="header" height={120} />; }
export function PicLayersPreview() { return <BandCrop band="layers" height={300} />; }
export function PicShotsPreview() { return <BandCrop band="shots" height={190} />; }
export function PicCodePreview() { return <BandCrop band="code" height={150} />; }
export function PicBrandPreview() { return <BandCrop band="brand" height={120} />; }
export function PicFooterBandPreview() { return <BandCrop band="footer" height={110} />; }
