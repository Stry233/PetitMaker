/*
 * Real crops of the real composed share picture, one per band the export
 * lays out. The picture is painted once by the export's own pipeline (`paintPreviewLayout` over a
 * posed built map), and each figure slices it by the composition's own rects, so a crop can
 * never drift from where the band truly sits or how it truly looks. The pose: a titled, badged,
 * importable Standard export with the layer column, the 3D card and the footer on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInView } from '../use-in-view';
import type { Locale } from '../../../../core/model/locale';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import { useLocale, useT } from '../../../../i18n/context';
import { DEFAULT_EXPORT_OPTIONS as DEFAULT_OPTIONS } from '../../../../io/export/facts';
import type { PictureChoices } from '../../../../io/export/facts';
import { useShareCode } from '../../../chrome/modals/export/use-share-code';
import type { PaintedPreview } from '../../../../editor/export/preview';
import { paintPicture, paintedPicture } from '../../../../editor/sandbox/picture-shots';
import { finishedMap } from '../../../../editor/sandbox/shots';
import { LEGAL } from '../../../../legal/config';
import { PreviewFrame } from './PreviewFrame';

/** The subject map is procedurally generated (the session's designed build), and the posed
 *  summary says exactly that, so the header wears the real Procedural badge. */
const POSED_SUMMARY: MapProvenanceSummary = {
  containsAi: false, containsProcedural: true,
  aiEverUsed: false, aiUsedNoRemaining: false,
  aiTerrainPct: 0, aiObjectCount: 0, proceduralAreaPct: 64,
  humanAfterAi: false, aiAfterHuman: false,
  exportDisclosure: 'procedural',
};

/** One creation stamp for the whole pose, so every figure's code band is the same band. */
const POSED_CREATED_AT = new Date(0).toISOString();

const POSED_OPTIONS: PictureChoices = {
  ...DEFAULT_OPTIONS,
  layerPreview: true, card3d: true, footer: true, showBadge: true,
  // The posed base map is a thumbnail render, which carries no grid lines: a legend around a
  // gridless bitmap would label nothing.
  grid: false, annotations: false,
};

/** The composed picture, one finished painting per locale shared by all six band figures on the
 *  page, painted through the export pipeline once the code band has settled. `active` holds the
 *  work until the figure nears the viewport. */
function usePaintedPicture(active: boolean): PaintedPreview | null {
  const t = useT();
  const locale = useLocale();
  const cached = paintedPicture(locale);
  const run = active && !cached;
  const island = useMemo(() => (run ? finishedMap() : null), [run]);
  const words = useMemo(() => ({ title: t('help.fig.pic_title'), description: t('help.fig.pic_desc') }), [t]);
  const code = useShareCode(run, island, { summary: POSED_SUMMARY, importable: true, resolution: 'standard', createdAt: POSED_CREATED_AT });
  const [painted, setPainted] = useState<PaintedPreview | null>(cached);
  const codeCanvas = code.asset?.canvas ?? null;
  const codeSettled = !code.pending;
  useEffect(() => {
    if (cached) { setPainted(cached); return undefined; }
    if (!run || !island || !codeSettled) return undefined;
    let live = true;
    void paintPicture(locale, {
      options: POSED_OPTIONS, words, summary: POSED_SUMMARY, state: island, locale: locale as Locale, codeImg: codeCanvas, site: LEGAL.canonicalOrigin,
    }, () => live).then((next) => { if (live && next) setPainted(next); });
    return () => { live = false; };
  }, [run, cached, island, words, locale, codeCanvas, codeSettled]);
  return painted;
}

type PictureBand = 'header' | 'layers' | 'shots' | 'code' | 'footer' | 'brand';

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
