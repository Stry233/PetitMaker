/*
 * The generation pages' posed figures beyond the demo scenes: a Picture-kind run,
 * built by the shelf's own plan pipeline (sample → rasterize → plan → candidate) on a demo world
 * and photographed by the real renderer, so the figure is a dealt card's own build.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { templateAnchor } from '../../../../core/model/landmarks';
import { isBuildableZone } from '../../../../core/game/zones';
import { renderThumbnail } from '../../../../view/map2d/capture/thumbnail';
import { useT } from '../../../../i18n/context';
import { layerName } from '../../../../i18n/terms/layer-name';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { PLATE_INK } from '../../../design/tokens';
import { figureCaption } from '../caption';
import { kindCandidate } from '../../../../editor/editing/generate-batch';
import { IMAGE_POOL } from '../../../shell/bars/generate/stencil-samples';
import type { StencilBox } from '../../../../tools/generation/stencil';
import { buildableBox, cellsBox, stencilPlanOn } from '../../../../editor/sandbox/stencil-shots';
import {
  CONTRAST, CORRIDOR, GENERATE_KIND, RICHNESS, fillKindsFor, fillLabelKey, maxElevationFor, type StencilFillKind,
} from '../../../shell/bars/generate/generate-shelf';
import { GenerateShelf } from '../../../shell/bars/generate/GenerateShelf';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { useInView } from '../use-in-view';
import { PreviewFrame } from './PreviewFrame';
import { CONTRAST_SHOTS, HEIGHT_SHOTS, RELIEF_SHOTS, RICHNESS_SHOTS } from './generate-shots';
import type { TextKey } from '../../../../i18n/keys';

/** One built shot per (kind, sample, fill), cached for the session: each is a real run through
 *  the shelf's own plan pipeline over the whole map (the same footprint a no-region run takes),
 *  which is what gives a letter its size and a picture its fidelity. */
const stencilShots = new Map<string, Promise<string | null>>();

/** The shelf's own picture defaults: its contrast as the engine's factor, and the picture kinds' ceiling. */
const SHOT_CONTRAST = CONTRAST.default / 100;
const SHOT_RELIEF = maxElevationFor('image');

interface StencilShotArgs {
  sampleId: 'picture' | 'letter';
  fill: StencilFillKind;
  text?: string;
  compact?: boolean;
  /** The picture knobs, at the shelf's own defaults when absent. */
  contrast?: number;
  maxElevation?: number;
}

function stencilShot(args: StencilShotArgs): Promise<string | null> {
  const key = `${args.sampleId}|${args.fill}|${args.text ?? ''}|${args.compact ? 'c' : 'f'}|${args.contrast ?? SHOT_CONTRAST}|${args.maxElevation ?? SHOT_RELIEF}`;
  let hit = stencilShots.get(key);
  if (!hit) {
    // A failed build must not poison the cache or vanish silently: log it, resolve null, retry
    // on the next mount.
    hit = buildStencilShot(args).catch((err) => {
      console.error('help stencil shot failed', key, err);
      stencilShots.delete(key);
      return null;
    });
    stencilShots.set(key, hit);
  }
  return hit;
}

/** The one item a letter tiles with when its material is Objects: a flower, the classic choice. */
const LETTER_TILE_ITEM = 'flower-daisy';

/** The picture the figures build from: a neighbor portrait with a bold silhouette and strong
 *  internal contrast, which survives the trip down to map cells better than a line mark does. */
const PICTURE_SAMPLE = 'yunguo';

/** The tall buildable block west of the plaza: as much room as a region can give a letter or a
 *  picture without wrapping the locked plaza, which would stand as a hole in the figure's middle.
 *  The plaza rect can sit on the half grid, so its edge rounds to whole cells before the walk. */
function westBlock(world: SandboxWorld, clamp?: { maxW: number; maxH: number }): { cells: MacroCoord[]; box: StencilBox; allow: Set<number> } | null {
  const island = buildableBox(world);
  const anchor = templateAnchor(world.state.template);
  if (!island) return null;
  const right = anchor ? Math.floor(anchor.x) - 3 : island.origin.x + island.width;
  // A comparison thumbnail does not need the whole block: a clamped window centred in it builds
  // several times faster at the size the row shows.
  const fullW = Math.min(right, island.origin.x + island.width) - island.origin.x;
  const x0 = clamp ? island.origin.x + Math.max(0, Math.floor((fullW - clamp.maxW) / 2)) : island.origin.x;
  const x1 = clamp ? Math.min(right, x0 + clamp.maxW) : Math.min(right, island.origin.x + island.width);
  const y0 = clamp ? island.origin.y + Math.max(0, Math.floor((island.height - clamp.maxH) / 2)) : island.origin.y;
  const y1 = clamp ? Math.min(island.origin.y + island.height, y0 + clamp.maxH) : island.origin.y + island.height;
  const cells: MacroCoord[] = [];
  const allow = new Set<number>();
  const mapW = world.state.template.width;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const zone = world.state.cells[y]?.[x]?.zone;
      if (zone === undefined || !isBuildableZone(zone)) continue;
      cells.push({ x, y });
      allow.add(y * mapW + x);
    }
  }
  const box = cellsBox(cells);
  if (!box) return null;
  return { cells, box, allow };
}

/** The rect the run actually drew (terrain raised or sunk, objects placed), for the photograph:
 *  the stencil fits the image's own aspect inside the region, so the region's box over-frames. */
function drawnFrame(state: GridState, box: StencilBox): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (let y = box.origin.y; y < box.origin.y + box.height; y++) {
    for (let x = box.origin.x; x < box.origin.x + box.width; x++) {
      const t = state.cells[y]?.[x]?.terrain;
      if (t && (t.elevation > 0 || t.type !== TerrainType.None)) mark(x, y);
    }
  }
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    mark(Math.floor(o.position.x), Math.floor(o.position.y));
  }
  if (minX > maxX) return { x: box.origin.x, y: box.origin.y, width: box.width, height: box.height };
  const pad = 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 1 + 2 * pad, height: maxY - minY + 1 + 2 * pad };
}

async function buildStencilShot({ sampleId, fill, text, compact, contrast, maxElevation }: StencilShotArgs): Promise<string | null> {
  const sample = sampleId === 'picture' ? IMAGE_POOL.find((s) => s.id === PICTURE_SAMPLE) : { id: 'help-letter', text: text ?? 'A' };
  if (!sample) return null;
  const world = new SandboxWorld();
  const band = westBlock(world, compact ? { maxW: 44, maxH: 56 } : undefined);
  if (!band) return null;
  const { cells, box, allow } = band;
  const kind = sampleId === 'picture' ? 'image' : 'text';
  const plan = await stencilPlanOn(sample, GENERATE_KIND[kind].input!, box, {
    fill, item: LETTER_TILE_ITEM, contrast: contrast ?? SHOT_CONTRAST, allow,
  });
  if (!plan) return null;
  const candidate = await kindCandidate(world.kit, {
    kind, seed: 7, richness: RICHNESS.default, maxElevation: maxElevation ?? SHOT_RELIEF, corridorWidth: CORRIDOR.min,
    gates: null, stencilPlan: plan,
  }, cells);
  if (!candidate) return null;
  const frame = drawnFrame(candidate.state, box);
  return renderThumbnail(candidate.state, 760, { aspect: frame.width / frame.height, frame });
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
    void stencilShot({ sampleId: 'picture', fill: 'object' }).then((png) => { if (live && png) setShot(png); });
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
    <PreviewFrame height={height}>
      {/* Full width, stated: the frame centers its child with shrink-to-fit sizing, and a row
          without a width would collapse the percent-sized figures (and their images) with it.
          The image caps at the row's height so any drawn aspect fits above its chip. */}
      {/* The ref rides the row rather than the frame: PreviewFrame keeps no forwarded ref. */}
      <div ref={hostRef} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', justifyContent: 'center', width: '100%' }}>
        {slots.map((slot, i) => (
          <figure key={slot.id} style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: `${Math.floor(92 / slots.length)}%` }}>
            {shots[i]
              ? <img src={shots[i]!} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: height - 52, borderRadius: 8 }} />
              : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 90 }}><LoadingDots color={PLATE_INK} /></span>}
            <figcaption style={figureCaption({ role: 'chip', padding: '3px 10px', nowrap: true })}>{slot.label}</figcaption>
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
    build: () => stencilShot({ sampleId: v.sampleId, fill: v.fill, compact: true, ...(v.text ? { text: v.text } : {}) }),
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

/** One designed run per (richness, tallest layer), cached for the session, photographed whole. */
const islandShots = new Map<string, Promise<string | null>>();

/** The seed every sweep shares, so the only difference between neighbours is the knob. */
const SWEEP_SEED = 20260830;

function islandShot(richness: number, maxElevation: number): Promise<string | null> {
  const key = `${richness}|${maxElevation}`;
  let hit = islandShots.get(key);
  if (!hit) {
    hit = buildIslandShot(richness, maxElevation).catch((err) => {
      console.error('help planet shot failed', key, err);
      islandShots.delete(key);
      return null;
    });
    islandShots.set(key, hit);
  }
  return hit;
}

async function buildIslandShot(richness: number, maxElevation: number): Promise<string | null> {
  const world = new SandboxWorld();
  world.beginStroke();
  world.generateDesigned({ seed: SWEEP_SEED, richness, maxElevation, mode: 'mixed', region: null });
  world.commit();
  return renderThumbnail(world.state, 520, { aspect: world.state.template.width / world.state.template.height });
}

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
    build: () => stencilShot({ sampleId: 'picture', fill: 'object', compact: true, contrast: n / 100 }),
  })), [t]);
  const relief = useMemo<ShotSlot[]>(() => RELIEF_SHOTS.map((n) => ({
    id: `h-${n}`,
    label: t('generate.knob_reading', { knob: t('generate.max_layer'), reading: layerName(t, n) }),
    build: () => stencilShot({ sampleId: 'picture', fill: 'mountain', compact: true, maxElevation: n }),
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
      <PreviewFrame height={230} zoom={0.62}>
        {inView && <GenerateShelf {...(kind ? { initialKind: kind } : {})} />}
      </PreviewFrame>
    </div>
  );
}

export const GenerateShelfMazePreview = () => <GenerateShelfPreview />;
export const GenerateShelfIslandPreview = () => <GenerateShelfPreview kind="island" />;
