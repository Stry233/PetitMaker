/*
 * The generation pages' posed figures beyond the demo scenes: picture-kind and designed runs built
 * and photographed below this layer (`editor/sandbox/shots.ts`), so each figure is a dealt card's
 * own build, and the shelf itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../../../i18n/context';
import { layerName } from '../../../../i18n/terms/layer-name';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { PLATE_INK } from '../../../design/tokens';
import { figureCaption } from '../caption';
import { samplePool } from '../../../../editor/editing/generate-batch';
import { islandShot, stencilShot, type StencilShotAsk } from '../../../../editor/sandbox/shots';
import { fillKindsFor, fillLabelKey, type StencilFillKind } from '../../../shell/bars/generate/generate-shelf';
import { GenerateShelf } from '../../../shell/bars/generate/GenerateShelf';
import { useInView } from '../use-in-view';
import { PreviewFrame } from './PreviewFrame';
import { CONTRAST_SHOTS, HEIGHT_SHOTS, RELIEF_SHOTS, RICHNESS_SHOTS } from './generate-shots';
import type { TextKey } from '../../../../i18n/keys';

/** The one item a letter tiles with when its material is Objects: a flower, the classic choice. */
const LETTER_TILE_ITEM = 'flower-daisy';

/** The picture the figures build from: a neighbor portrait with a bold silhouette and strong
 *  internal contrast, which survives the trip down to map cells better than a line mark does. */
const PICTURE_SAMPLE = 'yunguo';

interface FigureShot extends Pick<StencilShotAsk, 'fill' | 'compact' | 'contrast' | 'maxElevation'> {
  sampleId: 'picture' | 'letter';
  text?: string;
}

/** The figures' subject built with `shot`'s material and knobs; null where the picture is not in the pool. */
function figureShot({ sampleId, text, ...knobs }: FigureShot): Promise<string | null> {
  const sample = sampleId === 'picture' ? samplePool('image').find((s) => s.id === PICTURE_SAMPLE) : { id: 'help-letter', text: text ?? 'A' };
  if (!sample) return Promise.resolve(null);
  return stencilShot({ kind: sampleId === 'picture' ? 'image' : 'text', sample, item: LETTER_TILE_ITEM, ...knobs });
}

function ShotImg({ shot, height }: { shot: string | null; height: number }) {
  return shot
    ? <img src={shot} alt="" draggable={false} style={{ maxWidth: '96%', maxHeight: height, borderRadius: 10 }} />
    : null;
}

export function PictureStencilPreview() {
  const [shot, setShot] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef);
  useEffect(() => {
    if (!inView) return undefined;
    let live = true;
    void figureShot({ sampleId: 'picture', fill: 'object' }).then((png) => { if (live && png) setShot(png); });
    return () => { live = false; };
  }, [inView]);
  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <PreviewFrame height={330}>
        <ShotImg shot={shot} height={306} />
      </PreviewFrame>
    </div>
  );
}

/** The narrowest a comparison build stands before its row wraps. */
const SHOT_LEAST_W = 100;

/** One comparison slot: a build to run and the chip that names what was varied. */
interface ShotSlot { id: string; label: string; build: () => Promise<string | null> }

/** A row of builds that differ in one thing, side by side, sequential so the frame stays live. */
function ShotRow({ slots, height }: { slots: ReadonlyArray<ShotSlot>; height: number }) {
  const [shots, setShots] = useState<Array<string | null>>(() => slots.map(() => null));
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef);
  useEffect(() => {
    if (!inView) return undefined;
    setShots(slots.map(() => null));
    let live = true;
    let chain = Promise.resolve();
    slots.forEach((slot, i) => {
      chain = chain.then(async () => {
        if (!live) return;
        const png = await slot.build();
        if (live && png) setShots((prev) => prev.map((s, j) => (j === i ? png : s)));
      });
    });
    return () => { live = false; };
  }, [slots, inView]);
  return (
    // A narrow column wraps the row rather than squeezing each build and its chip below reading size.
    <PreviewFrame height={height * slots.length} fit>
      {/* Full width, stated: the frame centers its child with shrink-to-fit sizing, and a row
          without a width would collapse the flexible figures (and their images) with it.
          The image caps at the row's height so any drawn aspect fits above its chip. */}
      {/* The ref rides the row rather than the frame: PreviewFrame keeps no forwarded ref. */}
      <div ref={hostRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start', justifyContent: 'center', width: '100%' }}>
        {slots.map((slot, i) => (
          <figure key={slot.id} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: `1 1 ${SHOT_LEAST_W}px`, maxWidth: `${Math.floor(96 / slots.length)}%`, minWidth: SHOT_LEAST_W }}>
            {shots[i]
              ? <img src={shots[i]!} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: height - 52, borderRadius: 8 }} />
              : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 90 }}><LoadingDots color={PLATE_INK} /></span>}
            <figcaption style={{ ...figureCaption({ role: 'chip', padding: '3px 10px' }), textAlign: 'center' }}>{slot.label}</figcaption>
          </figure>
        ))}
      </div>
    </PreviewFrame>
  );
}

/** The same subject rebuilt once per material, side by side. */
function MaterialsRow({ variants, height }: {
  variants: ReadonlyArray<{ fill: StencilFillKind; labelKey: TextKey; sampleId: 'picture' | 'letter'; text?: string }>;
  height: number;
}) {
  const t = useT();
  const slots = useMemo<ShotSlot[]>(() => variants.map((v) => ({
    id: v.fill,
    label: t(v.labelKey),
    build: () => figureShot({ sampleId: v.sampleId, fill: v.fill, compact: true, ...(v.text ? { text: v.text } : {}) }),
  })), [variants, t]);
  return <ShotRow slots={slots} height={height} />;
}

const LETTER_TEXT = 'G';
const LETTER_VARIANTS = fillKindsFor('text').map(fill => ({ fill, labelKey: fillLabelKey('text', fill), sampleId: 'letter' as const, text: LETTER_TEXT }));

export function LetterMaterialsPreview() {
  return <MaterialsRow variants={LETTER_VARIANTS} height={190} />;
}

const PICTURE_VARIANTS = [
  { fill: 'mountain', labelKey: 'generate.fill_mountain', sampleId: 'picture' },
  { fill: 'water', labelKey: 'generate.fill_water', sampleId: 'picture' },
  { fill: 'object', labelKey: 'generate.fill_mixed', sampleId: 'picture' },
  { fill: 'flora', labelKey: 'generate.fill_flora', sampleId: 'picture' },
  { fill: 'trees', labelKey: 'generate.fill_trees', sampleId: 'picture' },
  { fill: 'road', labelKey: 'generate.fill_road', sampleId: 'picture' },
] as const;

export function PictureMaterialsPreview() {
  // Full width, stated: the figure box centers its child with shrink-to-fit sizing, and this
  // wrapper without a width would collapse both rows (every size inside is a percentage).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <MaterialsRow variants={PICTURE_VARIANTS.slice(0, 3)} height={185} />
      <MaterialsRow variants={PICTURE_VARIANTS.slice(3)} height={185} />
    </div>
  );
}

/* ── one knob, three readings: the planet designer swept along a slider ───── */

/** Scenery richness 20, 60, 100 on one recipe number: the knob's whole travel at a glance. */
export function IslandRichnessPreview() {
  const t = useT();
  const slots = useMemo<ShotSlot[]>(() => RICHNESS_SHOTS.map((n) => ({
    id: `rich-${n}`,
    label: t('generate.knob_reading', { knob: t('generate.richness'), reading: t('generate.percent', { n }) }),
    build: () => islandShot(n / 100, 4),
  })), [t]);
  return <ShotRow slots={slots} height={200} />;
}

/** The tallest-layer cap at each of `HEIGHT_SHOTS` on one recipe number: the lower the cap, the flatter. */
export function IslandHeightPreview() {
  const t = useT();
  const slots = useMemo<ShotSlot[]>(() => HEIGHT_SHOTS.map((n) => ({
    id: `tall-${n}`,
    label: t('generate.knob_reading', { knob: t('generate.max_layer'), reading: layerName(t, n) }),
    build: () => islandShot(0.7, n),
  })), [t]);
  return <ShotRow slots={slots} height={200} />;
}

/** The picture kind's two number knobs, each swept over one subject: contrast on the Mixed
 *  material, then the relief cap on Mountain, where depth is what the knob carves. */
export function PictureTuningPreview() {
  const t = useT();
  const contrast = useMemo<ShotSlot[]>(() => CONTRAST_SHOTS.map((n) => ({
    id: `c-${n}`,
    label: t('generate.knob_reading', { knob: t('generate.contrast'), reading: t('generate.percent', { n }) }),
    build: () => figureShot({ sampleId: 'picture', fill: 'object', compact: true, contrast: n / 100 }),
  })), [t]);
  const relief = useMemo<ShotSlot[]>(() => RELIEF_SHOTS.map((n) => ({
    id: `h-${n}`,
    label: t('generate.knob_reading', { knob: t('generate.max_layer'), reading: layerName(t, n) }),
    build: () => figureShot({ sampleId: 'picture', fill: 'mountain', compact: true, maxElevation: n }),
  })), [t]);
  // Full width, stated: the figure box centers its child with shrink-to-fit sizing, and this
  // wrapper without a width would collapse both rows (every size inside is a percentage).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <ShotRow slots={contrast} height={185} />
      <ShotRow slots={relief} height={185} />
    </div>
  );
}

/* ── the shelf itself, whole: tabs, cards, tiles and the knob strip ───────── */

/** The real Generate shelf at a posed kind. Its batch runs the real candidate pipeline against a
 *  clone of the open map, exactly as the live shelf does; nothing lands without a click, and the
 *  figure is inert. */
function GenerateShelfPreview({ kind }: { kind?: 'maze' | 'island' }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // The shelf deals a real five-candidate batch the moment it mounts; it waits for the reader.
  const inView = useInView(hostRef);
  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <PreviewFrame height={371}>
        {inView && <GenerateShelf {...(kind ? { initialKind: kind } : {})} />}
      </PreviewFrame>
    </div>
  );
}

export const GenerateShelfMazePreview = () => <GenerateShelfPreview />;
export const GenerateShelfIslandPreview = () => <GenerateShelfPreview kind="island" />;
