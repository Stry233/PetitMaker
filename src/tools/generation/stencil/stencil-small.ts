/*
 * stencil-small.ts — WHAT A SMALL BOX DOES DIFFERENTLY, and why only a small box does it.
 *
 * A picture fitted to a whole island has a cell for nearly every feature it holds. A picture in a
 * sixteen-cell box has about 150 cells for a subject whose outline and the rim inside it take most of
 * them, and the reduction that is right at the first size is what deletes the subject at the second.
 * Measured over the benchmark matrix: at 16 cells a picture's coherent areas arrive as fragments, and
 * two areas the source separates by HUE at the same lightness land on the same tier about half the
 * time — against one time in twenty when the same picture is paved in paths, whose palette has real
 * hues in it. The green ramp is eight greens: hue is the one distinction it cannot make, so hue has
 * to be spent on the distinction it CAN make, which is lightness.
 *
 * EVERYTHING HERE IS GATED ON THE BOX (`smallBoxWeight`): full at or below `SMALL_BOX_FULL`, blended
 * to nothing by `SMALL_BOX_OFF`, and absent above it. A caller reading weight 0 must do exactly what
 * it did before — not something arithmetically equal, the same code path — because the large-scale
 * output of this generator is frozen by fingerprint and a picture told over a whole island is already
 * legible. The gate is the SHORTER side, since that is what a picture is fitted to.
 *
 * Pure arithmetic over the stencil, deterministic, no state and no rules: what reaches the map is
 * whatever the palette match and the executor make of the reading this produces.
 */
import type { Stencil } from '../../../core/model/types';
import { covered, luma, type ToneRange } from './stencil';

/**
 * The box a picture is SMALL in, and the box it is no longer small in, as cells on the shorter side.
 *
 * 24 is the small-box end because it is where measurement says a picture stops being
 * able to say what it is: the coherent areas that survive fall away steeply from there down, and the
 * engine's own image floor (`STENCIL_MIN_SIDE.image`, 20) sits inside it. 32 is the other end because
 * that is the first size in the matrix where the failures the levers here answer are no longer the
 * dominant ones — a 32-cell box holds four times the cells of a 16-cell one — and because a threshold
 * has to be somewhere a measurement puts it rather than at a round number.
 *
 * BETWEEN THEM THE EFFECT IS BLENDED rather than switched, so a region painted one cell wider cannot
 * change the picture's whole treatment.
 */
export const SMALL_BOX_FULL = 24;
export const SMALL_BOX_OFF = 32;

/** How much of the small-box treatment a box of this shape gets: 1 at or below `SMALL_BOX_FULL`, 0 at
 *  or above `SMALL_BOX_OFF`, straight between. */
export function smallBoxWeight(box: { width: number; height: number }): number {
  const side = Math.min(box.width, box.height);
  if (side <= SMALL_BOX_FULL) return 1;
  if (side >= SMALL_BOX_OFF) return 0;
  return (SMALL_BOX_OFF - side) / (SMALL_BOX_OFF - SMALL_BOX_FULL);
}

/**
 * How much of the palette's own tonal range a small box spends on HUE rather than on tone.
 *
 * HUE IS PAID FOR OUT OF THE RANGE, NOT ADDED PAST ITS ENDS. A palette has one axis and both the
 * picture's lightness and its colours want it, so the two share it: the tonal fit targets a range
 * inset by this much at each end and the hue term moves a cell within what was reserved. Adding the
 * term on top instead pushes cells past the darkest and brightest entries, where they pile up on one
 * answer — measured on a pastel fixture at twenty cells, the palette's own use fell while the hue
 * separation rose, which is trading one legibility failure for another.
 *
 * A HALF is what a sixteen-cell box is worth spending. Half the ramp is ±1.7 tiers of room, so two
 * areas a third of the circle apart land two tiers away from each other and opposite hues three and
 * a half — and the tone that pays for it was shading inside areas of ten to forty cells, which at
 * this size nobody was reading. The gate is what keeps that trade to the sizes it is true at: the
 * share is scaled by the box's weight, so a 32-cell box spends none of its range on hue.
 */
export const HUE_RANGE_SHARE = 0.5;

/** The most tone a hue difference may claim, either side of where the picture's own tone landed. */
export function hueReach(weight: number, palette: ToneRange): number {
  return weight <= 0 ? 0 : (HUE_RANGE_SHARE * weight * (palette.hi - palette.lo)) / 2;
}

/** The chroma at which a colour's whole hue offset is spent, and the chroma below which it has none.
 *  A grey has no hue to be separated by, and a nearly-grey has nearly none. */
export const HUE_CHROMA_FULL = 60;
export const HUE_CHROMA_MIN = 16;

/**
 * How much of a picture has to be in a DIFFERENT colour family from its dominant one before any tone
 * is spent on hue at all.
 *
 * A PICTURE OF ONE FAMILY HAS NO HUE DIFFERENCE TO SPEND, and spending tone on it is a pure loss: a
 * pastel sticker is cream, pink and a little rose, so every cell's turn from the dominant hue is small
 * and noisy, and moving each cell by its own small amount scrambles the shading that WAS carrying the
 * subject (measured: the palette's own use fell on exactly that fixture, while nothing separated). So
 * the lever asks first whether there are two families here at all — mass outside the dominant sector
 * and its two neighbours, which is a sixth of the circle either side — and declines where there are
 * not. A twelfth is small enough for a bow on a coat and large enough to exclude a stray antialiased
 * pixel.
 */
export const HUE_FAMILY_MIN = 1 / 12;

/** How many sectors the hue circle is counted in when the picture's own dominant hue is found.
 *  Twelve is 30 degrees each: finer than the eye needs to name a colour family, coarse enough that
 *  one sector holds a whole one. */
const HUE_SECTORS = 12;

/** Hue in degrees and chroma as the channel spread — enough of HSV for "is this a different colour,
 *  or the same colour darker". */
export function hueOf(rgb: number): { hue: number; chroma: number } {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c === 0) return { hue: 0, chroma: 0 };
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { hue: ((h * 60) % 360 + 360) % 360, chroma: c };
}

/** The turn from `from` to `to`, signed, in (-180, 180]. */
export function signedTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * A turn round the hue circle as a signed share of the tone reserved for hue, in [-1, 1].
 *
 * COMPRESSIVE, not proportional: what the eye reads is THAT two colours differ rather than how far
 * apart they are on a wheel, and a proportional term spends nearly all its room on the rare pair of
 * opposites while leaving the common pair — a third of a turn or less, a bow against a coat, a petal
 * against a stem — inside one palette step, which is no separation at all. The square root puts a
 * sixth of a turn most of the way to half the room and still reaches its limit only at the far side.
 */
export function hueLift(turn: number): number {
  const share = Math.min(1, Math.abs(turn) / 180);
  return Math.sign(turn) * Math.sqrt(share);
}

/**
 * The TONE each cell's colour should be moved by so that areas the picture separates by hue arrive as
 * different palette entries — null where the picture has no hue to spend.
 *
 * WHY A LINE THROUGH THE PICTURE'S OWN DOMINANT HUE. A palette of one hue orders its entries by
 * lightness alone, so carrying hue into the result means laying the hue circle on a line, and every
 * way of doing that has one cut where two neighbouring hues land at opposite ends. This puts the cut
 * diametrically OPPOSITE the picture's commonest hue — the emptiest part of its own colour circle —
 * and measures every cell as the turn from that dominant hue, so the offsets are one function of the
 * picture and the cut falls where the picture has least to lose. A cell is weighted by its chroma, so
 * a grey keeps its tone exactly and the dominant area itself barely moves.
 *
 * `reach` is the tone a half-turn of hue is worth (`hueReach`), which the caller has already taken out
 * of the palette's range: every offset is inside ±reach, so nothing here can push a cell past an end
 * of the palette.
 */
export function hueToneOffsets(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  reach: number,
): Float32Array | null {
  if (reach <= 0) return null;
  const { width, height } = stencil;
  const n = width * height;
  const sectors = new Float64Array(HUE_SECTORS);
  const sectorX = new Float64Array(HUE_SECTORS), sectorY = new Float64Array(HUE_SECTORS);
  const hue = new Float32Array(n), pull = new Float32Array(n);
  let coloured = 0;
  for (let i = 0; i < n; i++) {
    if (!matchable(i)) continue;
    const { hue: h, chroma } = hueOf(stencil.color[i] ?? 0);
    if (chroma < HUE_CHROMA_MIN) continue;
    const share = Math.min(1, chroma / HUE_CHROMA_FULL);
    hue[i] = h;
    pull[i] = share;
    const sector = Math.min(HUE_SECTORS - 1, Math.floor((h / 360) * HUE_SECTORS));
    sectors[sector] = sectors[sector]! + share;
    sectorX[sector] = sectorX[sector]! + share * Math.cos((h * Math.PI) / 180);
    sectorY[sector] = sectorY[sector]! + share * Math.sin((h * Math.PI) / 180);
    coloured++;
  }
  if (coloured === 0) return null;
  // The commonest hue FAMILY, then that family's own mean direction — not the sector's middle, which
  // would leave a picture of a single colour shifted by however far that colour sits from a sector
  // boundary. Ties between sectors go to the lower one, so the answer is one function of the picture
  // rather than of the walk.
  let best = 0;
  for (let s = 1; s < HUE_SECTORS; s++) if (sectors[s]! > sectors[best]!) best = s;
  const dominant = ((Math.atan2(sectorY[best]!, sectorX[best]!) * 180) / Math.PI + 360) % 360;

  // Is there a second colour family here at all? Everything outside the dominant sector and the two
  // beside it, against everything coloured.
  let total = 0, elsewhere = 0;
  for (let s = 0; s < HUE_SECTORS; s++) {
    total += sectors[s]!;
    const away = Math.min(Math.abs(s - best), HUE_SECTORS - Math.abs(s - best));
    if (away > 1) elsewhere += sectors[s]!;
  }
  if (total <= 0 || elsewhere / total < HUE_FAMILY_MIN) return null;

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (pull[i] === 0) continue;
    out[i] = hueLift(signedTurn(dominant, hue[i]!)) * reach * pull[i]!;
  }
  return out;
}

/**
 * The fewest cells a body of WATER may be in a small box, and how far below the water's own tone a cell
 * may be and still be sunk to make one up.
 *
 * A POND IS A SHAPE, A SPECK IS DAMAGE. Water is chosen by nearest tone over the picture's light areas,
 * and at 62 cells a highlight is an area — a muzzle, a drink's surface — so it lands as one pond with a
 * bank. At 16 the same highlight is four scattered cells and lands as four one-cell ponds, which read
 * as holes rather than as a figure: measured over the matrix, 43% of pictures at 16 cells hold more than
 * a seventh of their water in pieces of one or two cells, against 8% at 62.
 *
 * Three is the smallest count that can hold a shape at all, and it is the floor the offline
 * measures count a body at. The tolerance is a whole palette step: a cell that far below the water's
 * tone is the next-lightest thing the picture has there, so sinking it is something the SOURCE
 * supports; past that the speck has nothing to grow into and goes back to being land.
 */
export const WATER_BODY_MIN = 3;
export const WATER_GROW_STEPS = 1;

/**
 * Settle the water a small box would otherwise lay as specks: every body under `WATER_BODY_MIN` either
 * grows to it out of the lightest cells beside it, or goes back to land. Mutates `isWater` and returns
 * how many cells changed hands.
 *
 * `tone` is what each cell asked the palette for, `cut` the tone at which water begins and `step` the
 * palette's own tone between neighbouring entries, so what a speck may grow into is decided by the
 * PICTURE rather than by the shape of the speck. `open` is the cells water may take at all — the
 * caller's own rule, which for the primary water role keeps the figure's silhouette dry so a pond
 * always has a bank.
 *
 * Bodies are walked largest first, so a speck beside a real pond joins the pond rather than the two
 * growing separately, and the whole pass is one function of the picture: no randomness, ties by index.
 */
export function settleWaterBodies(
  stencil: Stencil,
  isWater: Uint8Array,
  weight: number,
  tone: (index: number) => number | null,
  cut: number,
  step: number,
  open: (index: number) => boolean,
): number {
  if (weight <= 0) return 0;
  const { width, height } = stencil;
  const n = width * height;
  const floor = Number.isFinite(cut) ? cut - WATER_GROW_STEPS * step : cut;
  let moved = 0;

  const bodies = (): number[][] => {
    const seen = new Uint8Array(n);
    const out: number[][] = [];
    for (let start = 0; start < n; start++) {
      if (seen[start] || !isWater[start]) continue;
      const body = [start];
      seen[start] = 1;
      const stack = [start];
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % width, y = (i / width) | 0;
        for (const [dx, dy] of EDGES) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || !isWater[next]) continue;
          seen[next] = 1;
          body.push(next);
          stack.push(next);
        }
      }
      out.push(body);
    }
    return out;
  };

  for (const body of bodies().sort((a, b) => (b.length - a.length) || (a[0]! - b[0]!))) {
    if (body.length >= WATER_BODY_MIN) continue;
    if (body.some((i) => !isWater[i])) continue;             // already grown into by a larger body
    // The lightest cells beside it that the picture would let be water, brightest first.
    const beside = new Map<number, number>();
    for (const i of body) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (isWater[next] || beside.has(next) || !open(next)) continue;
        const own = tone(next);
        if (own === null || own < floor) continue;
        beside.set(next, own);
      }
    }
    const grow = [...beside.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
    if (body.length + grow.length < WATER_BODY_MIN) {
      for (const i of body) { isWater[i] = 0; moved++; }
      continue;
    }
    for (const [i] of grow.slice(0, WATER_BODY_MIN - body.length)) { isWater[i] = 1; moved++; }
  }
  return moved;
}

/** A colour moved `weight` of the way toward another, per channel. 0 is the first colour exactly and 1
 *  is the second exactly, which is what lets the whole treatment fade out across the gate. */
export function blendColour(from: number, to: number, weight: number): number {
  if (weight <= 0) return from;
  if (weight >= 1) return to;
  const mix = (shift: number): number => {
    const a = (from >> shift) & 0xff, b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * weight);
  };
  return ((mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
}

/**
 * WHAT A SMALL BOX ASKS THE PALETTE FOR, per cell: its AREA's answer rather than its own.
 *
 * THE FAILURE THIS IS FOR. A per-cell match spends the palette on a tonal ramp and rounds every cell
 * against it, so a picture's interior arrives as fragments of two tiers with the quantisation error
 * dithered across them: measured at 16 cells, the result held twice as many coherent areas as the
 * source's own reading has, while keeping under a fifth of the areas the picture actually holds. Both
 * halves of that are the same mistake — cells were the unit. Here the AREA is: the picture is read as
 * the few coherent areas a small box can hold (`coherentAreas`), each is given one palette entry
 * (`allocateEntries` where the palette is a tonal ramp, its own nearest colour where the palette has
 * hues of its own), and every cell of it asks for that.
 *
 * `distinct` is the difference between the two palettes, and it is not a preference. A ramp of one hue
 * can only separate two areas by spending two ENTRIES on them, so the allocation is what makes them
 * different at all; a palette with real hues in it already answers two colours differently, and
 * forcing distinctness there would move an area off its own colour for nothing.
 *
 * Null where the box is not small: a caller must then do exactly what it did before.
 */
/**
 * How much of a cell's answer the AREA gives at full weight, the rest being the cell's own colour.
 *
 * NOT ALL OF IT. An area reading is the right unit for the features a small box has to keep and the
 * wrong one for what is genuinely continuous: a photograph's gradient posterised to its own areas loses
 * the palette use the dither was buying it (measured on the synthetic continuous-tone fixture, palette
 * use fell by a third), and our own pixel-art heart lost a fifth of its tonal reading. Left at a share,
 * each cell asks mostly for its area's entry and a little for its own colour, and the error still worth
 * spending goes to the neighbours as before — so a flat area comes out flat while a real gradient keeps
 * its shading.
 */
export const AREA_SHARE = 1;

/**
 * WHICH REGIONS ARE TOLD FLAT AND WHICH KEEP THEIR OWN SHADING — the per-region half of that answer.
 *
 * A REGION READING IS RIGHT FOR A DRAWN AREA AND WRONG FOR A GRADIENT. Posterising a soft pastel body
 * to one entry loses exactly what the dither was carrying: measured on our own pastel fixtures at twenty
 * cells, the palette's own use fell by a third and the tonal reading with it, while the same treatment on
 * a flat-coloured icon is what makes it legible. The picture's `nature` cannot decide this — a pastel
 * sticker reads as a DRAWING by its colour count, and it is one, with soft shading inside it.
 *
 * SO THE REGION DECIDES, and the discriminator is ROUGHNESS rather than range: a gradient covers a wide
 * range in small steps between neighbouring cells, while a region that covers a wide range in big steps
 * is holding several things the merge had no budget to separate. Measured over our fixtures in palette
 * steps: a pastel body runs 2 to 5 steps of range at 0.45 to 0.67 of a step between neighbours, and the
 * icons that want composing run 6 to 16 steps of range at 1.5 to 6 — the two do not overlap, and the
 * threshold sits in the gap. A region with nothing to grade (`RANGE_MIN`) is flat whatever its roughness.
 */
export const REGION_RANGE_MIN = 2;
export const REGION_SMOOTH_MAX = 0.7;
export const REGION_ROUGH_MIN = 1.4;

export function regionFlatness(
  stencil: Stencil, areas: readonly Area[], colourAt: (index: number) => number, step: number,
): number[] {
  if (!(step > 0)) return areas.map(() => 1);
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  return areas.map((area, id) => {
    const tones = area.cells.map((i) => luma(colourAt(i))).sort((a, b) => a - b);
    const range = (tones[Math.floor(tones.length * 0.9)]! - tones[Math.floor(tones.length * 0.1)]!) / step;
    if (range < REGION_RANGE_MIN) return 1;
    let pairs = 0, sum = 0;
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (owner[next] !== id) continue;
        pairs++;
        sum += Math.abs(luma(colourAt(i)) - luma(colourAt(next)));
      }
    }
    if (pairs === 0) return 1;
    const rough = sum / pairs / step;
    return Math.min(1, Math.max(0, (rough - REGION_SMOOTH_MAX) / (REGION_ROUGH_MIN - REGION_SMOOTH_MAX)));
  });
}

export function readSmallBox(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  colourAt: (index: number) => number,
  weight: number,
  entries: readonly { rgb: number }[],
  distinct: boolean,
  damping: number,
  minTone?: (depth: number) => number,
): SmallBoxRead | null {
  if (weight <= 0 || entries.length === 0) return null;
  // A DRAWING HAS AREAS AND A PHOTOGRAPH HAS GRADIENTS, and the question is asked PER REGION rather than
  // per picture (`regionFlatness`): a per-picture label misreads shaded sprites as photographs and
  // declines two thirds of a benchmark that way, while posterising a genuinely smooth gradient loses
  // exactly what the dither was carrying. A region that is genuinely smooth keeps its own shading
  // whatever the picture is called; a flat area is told in one entry for the same reason. Neither
  // answer needs the label.
  const read0 = coherentAreas(stencil, matchable, colourAt);
  if (read0.length === 0) return null;
  // THE PICTURE IS TOLD IN A FEW SPATIAL REGIONS WHERE THE PALETTE IS SCARCE, and that is only the
  // ramp: a palette with real hues of its own answers every area's colour already, so there is nothing
  // for a region budget to buy there and the picture keeps the resolution the box gave it.
  const outline = distinct ? fuseAreas(read0, figureRim(stencil, read0)) : { areas: read0, at: -1 };
  const grouped = distinct
    ? mergeToTarget(stencil, outline.areas, regionTarget(stencil, outline.areas, weight), outline.at)
    : { areas: read0, protect: -1 };
  const areas = grouped.areas;
  const rim = grouped.protect;
  const target = new Uint32Array(stencil.width * stencil.height);
  const has = new Uint8Array(stencil.width * stencil.height);
  let slots: number[] | null = null;
  if (distinct) {
    const read = areaSalience(stencil, areas);
    slots = allocateEntries(
      areas, read, entries.map((entry) => luma(entry.rgb)),
      minTone ? read.depth.map(minTone) : [], rim,
    );
  }
  const tones = entries.map((entry) => luma(entry.rgb)).sort((a, b) => a - b);
  const step = entries.length > 1 ? (tones[tones.length - 1]! - tones[0]!) / (entries.length - 1) : 0;
  const flat = regionFlatness(stencil, areas, colourAt, step);
  const told = new Float32Array(stencil.width * stencil.height);
  for (const [id, area] of areas.entries()) {
    const want = slots ? entries[slots[id]!]!.rgb : area.rgb;
    for (const i of area.cells) { target[i] = want; has[i] = 1; told[i] = flat[id]!; }
  }
  const share = weight * AREA_SHARE;
  const mean = areas.reduce((sum, area, id) => sum + flat[id]! * area.cells.length, 0)
    / Math.max(1, areas.reduce((sum, area) => sum + area.cells.length, 0));
  return {
    regions: areas,
    rim,
    wanted: (i) => {
      if (!matchable(i)) return null;
      const own = colourAt(i);
      return has[i] ? blendColour(own, target[i]!, share * told[i]!) : own;
    },
    // A DITHER IS A PER-CELL DEVICE and this reading is not per cell: where a region is told flat, every
    // cell of it asks for the same entry and an error spent on the neighbours is noise laid over an
    // answer that was already exact. It fades back in as the box grows, on the same gate — and in
    // proportion to how much of the picture is a gradient rather than an area, which is what still wants
    // it (`regionFlatness`).
    damping: damping * (1 - share * mean),
  };
}

/** What a small box's reading of a picture is: the answer per cell, the dither that is left, and the
 *  REGIONS it was told in — which is what lets a caller spend something other than a tier on one. */
export interface SmallBoxRead {
  wanted: (index: number) => number | null;
  damping: number;
  /** The regions the picture was read as, in ascending first-cell order. */
  regions: Area[];
  /** The enclosing rim region's index, or -1 where the picture has no such region. */
  rim: number;
}

/**
 * HOW MANY REGIONS A SMALL BOX TELLS A PICTURE IN: three to six, by the size of the figure.
 *
 * A COMPOSITION, NOT A QUANTISATION. Segmented at five bits a channel a real icon at sixteen cells is
 * twenty to seventy areas of four or five cells each, and a palette of eight greens cannot say twenty
 * things: the allocation ends up merging them on TONE, which is a decision about lightness taken over
 * a picture whose subject is WHERE its parts are. So the areas are merged SPATIALLY first, down to the
 * few the box can actually hold, and the palette is spent on those.
 *
 * THREE TO SIX IS THE PICTURE'S OWN READING, not a taste: measured over the benchmark, the coherent
 * areas a source holds AT THE BOX'S OWN CELL COUNT fall to about four at sixteen cells (and to ninety
 * at sixty-two, which is why none of this applies there). One region per four cells of the box's
 * shorter SIDE is that reading — a box twice as wide holds about twice as many things, not four times
 * — and it is blended back toward the unmerged reading as the gate closes, so a box one cell wider
 * cannot re-compose the picture.
 */
export const REGION_TARGET_MIN = 3;
export const REGION_TARGET_MAX = 6;
export const REGION_CELLS_PER = 4;

export function regionTarget(box: { width: number; height: number }, areas: readonly Area[], weight: number): number {
  const side = Math.min(box.width, box.height);
  const base = Math.min(REGION_TARGET_MAX, Math.max(REGION_TARGET_MIN, Math.round(side / REGION_CELLS_PER)));
  const held = Math.max(base, areas.length);
  return Math.round(base + (1 - Math.min(1, Math.max(0, weight))) * (held - base));
}

/**
 * Merge adjacent areas until there are `target` of them: cheapest pair first, cost being how far
 * apart the two are in COLOUR times how much of the picture the smaller of them is.
 *
 * WHY SIZE IS IN THE COST. Two large areas of nearly one colour are what a small box has no room to
 * distinguish, and merging them costs the picture nothing; a three-cell eye against a face is a large
 * colour distance over a tiny area, and merging it costs the picture the eye. The harmonic mean of the
 * two sizes is what says that — it tracks the SMALLER area, so a feature is expensive to lose whatever
 * it sits in — and it is why this is not a quantisation with a different threshold: the same colour
 * difference is worth keeping in one place and not in another.
 *
 * `protect` is an area no merge may consume (the enclosing rim, `figureRim`), because its whole value
 * is that it is one region: merged into the mass it surrounds, the figure loses its outline, which is
 * the one thing a small box reliably keeps. Returns where it ended up.
 *
 * Deterministic: pairs are scanned in index order and the first strictly-cheapest wins.
 */
export function mergeToTarget(
  stencil: Stencil, areas: readonly Area[], target: number, protect = -1,
): { areas: Area[]; protect: number } {
  const n = areas.length;
  if (n <= Math.max(1, target)) return { areas: [...areas], protect };
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const near: Set<number>[] = areas.map(() => new Set<number>());
  for (let i = 0; i < width * height; i++) {
    const own = owner[i]!;
    if (own < 0) continue;
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = owner[ny * width + nx]!;
      if (other < 0 || other === own) continue;
      near[own]!.add(other);
      near[other]!.add(own);
    }
  }
  const cells = areas.map((area) => [...area.cells]);
  const sums = areas.map((area) => ({
    r: ((area.rgb >> 16) & 0xff) * area.cells.length,
    g: ((area.rgb >> 8) & 0xff) * area.cells.length,
    b: (area.rgb & 0xff) * area.cells.length,
  }));
  const alive = areas.map(() => true);
  const meanOf = (id: number): number => {
    const size = Math.max(1, cells[id]!.length), s = sums[id]!;
    return ((Math.round(s.r / size) << 16) | (Math.round(s.g / size) << 8) | Math.round(s.b / size)) >>> 0;
  };

  let count = n;
  while (count > target) {
    let from = -1, into = -1, best = Infinity;
    for (let a = 0; a < n; a++) {
      if (!alive[a] || a === protect) continue;
      for (const b of near[a]!) {
        if (b <= a || !alive[b] || b === protect) continue;
        const sa = cells[a]!.length, sb = cells[b]!.length;
        const cost = Math.sqrt(colourDistance(meanOf(a), meanOf(b))) * ((sa * sb) / (sa + sb));
        if (cost < best) { best = cost; into = a; from = b; }
      }
    }
    if (from < 0 || into < 0) break;   // every pair left touches the protected region: nothing to do
    for (const i of cells[from]!) { owner[i] = into; cells[into]!.push(i); }
    sums[into]!.r += sums[from]!.r; sums[into]!.g += sums[from]!.g; sums[into]!.b += sums[from]!.b;
    cells[into]!.sort((a, b) => a - b);
    cells[from]!.length = 0;
    alive[from] = false;
    for (const b of near[from]!) { if (b !== into) { near[into]!.add(b); near[b]!.add(into); } near[b]!.delete(from); }
    count--;
  }

  const kept = areas.map((_, id) => id).filter((id) => alive[id] && cells[id]!.length > 0);
  const out = kept.map((id) => {
    const rgb = meanOf(id);
    return { cells: cells[id]!, rgb, tone: luma(rgb) };
  });
  const order = kept.map((id, at) => ({ id, at })).sort((a, b) => out[a.at]!.cells[0]! - out[b.at]!.cells[0]!);
  return {
    areas: order.map((o) => out[o.at]!),
    protect: order.findIndex((o) => o.id === protect),
  };
}

/**
 * The areas that together make the figure's OUTLINE — the dark line drawn round a subject — or an
 * empty list where the picture has none.
 *
 * IT IS ONE REGION AND IT IS NEVER FOUND AS ONE. A one-cell outline is a chain of one- and two-cell
 * pieces under 4-connectivity (two cells meeting at a corner are two blocks), so no single coherent
 * area is ever the outline: measured on the seed picture at sixteen cells, twenty separate areas hold
 * it. Every one of them is small and unlike its neighbour, which is what makes each individually cheap
 * to merge away — so the outline is CONSTRUCTED here, protected from merging as one, and allocated
 * apart. What it costs to lose is the silhouette, which is the one thing a small box reliably keeps.
 *
 * Two tests, both about being a line round the figure rather than a part of it: the cells sit at the
 * figure's EDGE rather than inside it, and they are DARKER than the figure's own mean. The union then
 * has to go most of the way round (`RIM_ENCLOSE_MIN`) and to be a line rather than the subject
 * (`RIM_SHARE_MAX`), or the picture is read as having no outline at all.
 */
export const RIM_ENCLOSE_MIN = 0.4;
export const RIM_DEPTH_MAX = 2;
export const RIM_SHARE_MAX = 0.4;
/** How much of the figure an outline may be and still be given its own tier rather than kept in the
 *  picture's order (`allocateEntries`, where the arithmetic behind the fifth is). */
export const RIM_SPEND_MAX = 0.2;

export function figureRim(stencil: Stencil, areas: readonly Area[]): number[] {
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  let figure = 0;
  for (const [id, area] of areas.entries()) {
    for (const i of area.cells) owner[i] = id;
    figure += area.cells.length;
  }
  if (figure === 0) return [];
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);
  let boundary = 0;
  for (let i = 0; i < width * height; i++) if (owner[i]! >= 0 && depth[i] === 1) boundary++;
  if (boundary === 0) return [];
  const mean = areas.reduce((sum, area) => sum + area.tone * area.cells.length, 0) / figure;

  const out: number[] = [];
  let cells = 0, edge = 0;
  for (const [id, area] of areas.entries()) {
    if (area.tone >= mean) continue;
    if (area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length > RIM_DEPTH_MAX) continue;
    out.push(id);
    cells += area.cells.length;
    edge += area.cells.filter((i) => depth[i] === 1).length;
  }
  if (out.length === 0) return [];
  if (edge / boundary < RIM_ENCLOSE_MIN || cells > figure * RIM_SHARE_MAX) return [];
  return out;
}

/** Several areas told as one, in place of the several: the mean colour over all their cells, and the
 *  list back in ascending first-cell order with the fused region's own index. */
export function fuseAreas(areas: readonly Area[], ids: readonly number[]): { areas: Area[]; at: number } {
  const taken = new Set(ids);
  if (taken.size === 0) return { areas: [...areas], at: -1 };
  // One area is already the region it would be fused into: a closed ring survives 4-connectivity whole,
  // and it wants naming rather than rebuilding.
  if (taken.size === 1) return { areas: [...areas], at: ids[0]! };
  const cells: number[] = [];
  let r = 0, g = 0, b = 0;
  for (const id of taken) {
    const area = areas[id];
    if (!area) continue;
    cells.push(...area.cells);
    r += ((area.rgb >> 16) & 0xff) * area.cells.length;
    g += ((area.rgb >> 8) & 0xff) * area.cells.length;
    b += (area.rgb & 0xff) * area.cells.length;
  }
  if (cells.length === 0) return { areas: [...areas], at: -1 };
  cells.sort((a, b2) => a - b2);
  const rgb = ((Math.round(r / cells.length) << 16) | (Math.round(g / cells.length) << 8) | Math.round(b / cells.length)) >>> 0;
  const fused: Area = { cells, rgb, tone: luma(rgb) };
  const out = [...areas.filter((_, id) => !taken.has(id)), fused]
    .sort((a, b2) => a.cells[0]! - b2.cells[0]!);
  return { areas: out, at: out.indexOf(fused) };
}

/**
 * The picture's coherent colour AREAS at this cell count: 4-connected runs of cells the eye would
 * read as one colour, with anything under `AREA_MIN` folded into the neighbour it is nearest in
 * colour.
 *
 * FOUR-CONNECTED AND AT FIVE BITS A CHANNEL, which is what the map itself does with a shape (two
 * cells meeting at a corner are two blocks with ground between them) and what the sampler already
 * counts colours at (`bucketOf`): near-identical shades — a JPEG's noise, a scaler's blend — have to
 * share a label or every gradient is a thousand areas.
 */
export interface Area {
  /** Cell indices, in ascending order. */
  cells: number[];
  /** The mean colour of the source over them, which is what the area is matched by. */
  rgb: number;
  /** The area's own tone, and the tone offset applied to it (already inside `rgb`). */
  tone: number;
}

/** The fewest cells that make an AREA rather than a speck: three, the smallest count that can hold a
 *  shape at all, and the same floor the offline measures count areas at. */
export const AREA_MIN = 3;

/** How near in colour a speck has to be to a neighbour to be folded into it: about two palette steps
 *  of the terrain ramp, in the channel-weighted units every colour distance here uses. Past that the
 *  speck is a feature the picture drew rather than noise inside an area. */
export const FOLD_MAX = 30;

const bucketOf = (rgb: number): number =>
  ((((rgb >> 19) & 0x1f) << 10) | (((rgb >> 11) & 0x1f) << 5) | ((rgb >> 3) & 0x1f)) >>> 0;

/** How far apart two colours are, channel-weighted and NOT squared — the units every colour gap in
 *  this system is stated in (`BORROW_MIN_GAIN`, `COLLIDE_MIN`, `FOLD_MAX`), so two of them compare. */
export function colourGap(a: number, b: number): number {
  return Math.sqrt(colourDistance(a, b));
}

const colourDistance = (a: number, b: number): number => {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
};

/**
 * Segment the cells a reading may write into coherent colour areas, smallest ones absorbed.
 *
 * `colourAt` is the colour each cell is read as — the tone-fitted, hue-lifted one, so the areas are
 * the ones the palette is about to be asked for rather than the ones the file happens to hold.
 */
export function coherentAreas(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  colourAt: (index: number) => number,
): Area[] {
  const { width, height } = stencil;
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const areas: { cells: number[]; r: number; g: number; b: number }[] = [];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || !matchable(start) || !covered(stencil, start % width, (start / width) | 0)) continue;
    const bucket = bucketOf(colourAt(start));
    const id = areas.length;
    const area = { cells: [start], r: 0, g: 0, b: 0 };
    areas.push(area);
    label[start] = id;
    const stack = [start];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (label[next] !== -1 || !matchable(next) || !covered(stencil, nx, ny)) continue;
        if (bucketOf(colourAt(next)) !== bucket) continue;
        label[next] = id;
        area.cells.push(next);
        stack.push(next);
      }
    }
  }
  for (const area of areas) {
    area.cells.sort((a, b) => a - b);
    for (const i of area.cells) {
      const rgb = colourAt(i);
      area.r += (rgb >> 16) & 0xff; area.g += (rgb >> 8) & 0xff; area.b += rgb & 0xff;
    }
  }
  const mean = (a: { cells: number[]; r: number; g: number; b: number }): number => {
    const size = a.cells.length;
    return ((Math.round(a.r / size) << 16) | (Math.round(a.g / size) << 8) | Math.round(a.b / size)) >>> 0;
  };

  // A SPECK OF THE SAME COLOUR AS WHAT IT SITS IN IS NOT A FEATURE, so it joins the neighbouring area
  // it is nearest in colour rather than spending a palette entry of its own — largest first, so a chain
  // of specks resolves against real areas before it resolves against other specks. An area with no
  // neighbour at all (a lone cell in the middle of ground) keeps itself: there is nothing to fold it
  // into, and dropping it would take a cell of the picture off the map.
  //
  // A SPECK THAT IS NOTHING LIKE ITS NEIGHBOUR IS KEPT (`FOLD_MAX`), and that test is what saves a
  // drawing's outline. A one-cell dark rim is a CHAIN of one- and two-cell pieces under 4-connectivity
  // — the map's own connectivity, since two cells meeting at a corner are two blocks — so a fold that
  // asked only about size swallowed the outline into the body it surrounds, and our own heart fixture
  // came back with a third of its rim drawn as its middle. What a small box has left to say is mostly
  // small: an eye, a nose, a line round a shape.
  const order = areas.map((_, id) => id)
    .filter((id) => areas[id]!.cells.length < AREA_MIN)
    .sort((a, b) => (areas[b]!.cells.length - areas[a]!.cells.length) || (areas[a]!.cells[0]! - areas[b]!.cells[0]!));
  for (const id of order) {
    const area = areas[id]!;
    if (area.cells.length === 0 || area.cells.length >= AREA_MIN) continue;
    const own = mean(area);
    let host = -1, bestD = Infinity;
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = label[ny * width + nx]!;
        if (other < 0 || other === id || areas[other]!.cells.length === 0) continue;
        const d = colourDistance(own, mean(areas[other]!));
        if (d < bestD || (d === bestD && (host < 0 || areas[other]!.cells[0]! < areas[host]!.cells[0]!))) {
          bestD = d; host = other;
        }
      }
    }
    if (host < 0 || bestD > FOLD_MAX * FOLD_MAX) continue;
    const into = areas[host]!;
    for (const i of area.cells) { label[i] = host; into.cells.push(i); }
    into.r += area.r; into.g += area.g; into.b += area.b;
    into.cells.sort((a, b) => a - b);
    area.cells = [];
  }

  return areas
    .filter((a) => a.cells.length > 0)
    .map((a) => ({ cells: a.cells, rgb: mean(a), tone: luma(mean(a)) }))
    .sort((a, b) => a.cells[0]! - b.cells[0]!);
}

const EDGES: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** The first entry, in tone order, at least this light — 0 where nothing is asked. */
function indexAtLeast(byTone: readonly { tone: number }[], tone: number | undefined): number {
  if (tone === undefined || !Number.isFinite(tone)) return 0;
  for (const [index, entry] of byTone.entries()) if (entry.tone >= tone) return index;
  return byTone.length - 1;
}

/**
 * How deep inside the figure each cell sits: 0 outside it, 1 on its rim, upward inward — the plain
 * 4-connected distance to the nearest cell the reading does not write.
 *
 * WHY A READING NEEDS THIS AT ALL. A small box spends most of itself on the outline, so "how much of
 * this area is interior" is the difference between a feature and a fringe: a four-cell sliver along
 * the silhouette cannot hold a tier of its own without the support rules lowering half of it, and an
 * area in the middle of the subject can. It is the third term of an area's salience:
 * size times contrast times interiority.
 */
export function cellDepths(
  stencil: Stencil,
  inFigure: (index: number) => boolean,
): Int32Array {
  const { width, height } = stencil;
  const depth = new Int32Array(width * height);
  const queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (!inFigure(i)) continue;
    const x = i % width, y = (i / width) | 0;
    let rim = false;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !inFigure(ny * width + nx)) { rim = true; break; }
    }
    if (rim) { depth[i] = 1; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!inFigure(next) || depth[next] !== 0) continue;
      depth[next] = depth[i]! + 1;
      queue.push(next);
    }
  }
  return depth;
}

/**
 * How much each area is worth a palette entry of its own: SIZE times CONTRAST times INTERIORITY, each
 * as a share of the most any area of this picture has.
 *
 * THREE TERMS, and each answers a way an area can fail to matter. SIZE
 * because a palette entry spent on four cells says less than one spent on forty. CONTRAST — the
 * largest colour distance to an area it actually touches — because an area that is nearly its
 * neighbour's colour loses nothing by sharing its entry, while the eye reads a hard boundary as the
 * subject's own line. INTERIORITY because a sliver along the silhouette is a fringe of the outline
 * rather than a region of the picture.
 *
 * Multiplied rather than added: an area that fails ANY of the three is not a feature, and a sum would
 * let a large enough fringe outrank a small hard-edged eye.
 */
export function areaSalience(stencil: Stencil, areas: readonly Area[]): AreaReading {
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);

  const size: number[] = [], contrast: number[] = [], inside: number[] = [], deepest: number[] = [];
  const touches: number[][] = [];
  for (const [id, area] of areas.entries()) {
    let worst = 0;
    const near = new Set<number>();
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = owner[ny * width + nx]!;
        if (other < 0 || other === id) continue;
        near.add(other);
        const d = Math.sqrt(colourDistance(area.rgb, areas[other]!.rgb));
        if (d > worst) worst = d;
      }
    }
    size.push(area.cells.length);
    contrast.push(worst);
    inside.push(area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length);
    // WHAT THE WHOLE AREA CAN STAND AT: its SHALLOWEST cell. An area is told in one tier, and a tier
    // its rim cannot hold is one the support rules carve out of it — a mass given the top of the ramp
    // comes back as a gradient from its own edge inward, a relief the picture never had, and next to a
    // lighter area that kept its tier the picture reads upside down (measured on our own arrow fixture:
    // 0.57 fidelity before the allocation, 0.28 with the deepest cell deciding, 0.15 with the median).
    deepest.push(area.cells.reduce((least, i) => Math.min(least, depth[i]!), Infinity));
    touches.push([...near].sort((a, b) => a - b));
  }
  const share = (xs: number[]): number[] => {
    const top = Math.max(...xs, 0);
    // An area with no neighbour has no contrast to measure, and a picture whose areas all touch
    // nothing is one area: either way the term says nothing and is left at 1 rather than at 0.
    return top <= 0 ? xs.map(() => 1) : xs.map((v) => v / top);
  };
  const [s, c, d] = [share(size), share(contrast), share(inside)];
  return { salience: areas.map((_, id) => s[id]! * c[id]! * d[id]!), depth: deepest, touches };
}

/** What an area reading says about each area beyond its own cells: how much it is worth an entry of its
 *  own, how deep inside the figure its SHALLOWEST cell sits (which is what it can stand at), and which
 *  areas it touches. */
export interface AreaReading { salience: number[]; depth: number[]; touches: number[][] }

/**
 * WHICH PALETTE ENTRY EACH AREA IS TOLD IN — the allocation this file exists for.
 *
 * EVERY AREA STARTS AT THE ENTRY NEAREST ITS OWN TONE, which is the faithful answer and the one a
 * per-cell match would have given it; what an area reading adds is that the whole area gets that ONE
 * answer instead of being rounded cell by cell with the error dithered across it. Two things are then
 * spent on top of that, and both are small on purpose — spreading the areas across the whole ramp by
 * rank trades a tenth of the tonal reading for nothing (measured over the matrix): a cream face is a
 * dozen areas of nearly one colour, and the noise in their means becomes a relief the picture never
 * had.
 *
 *  - A COLLISION IS BROKEN WHERE IT MATTERS. Two areas the picture separates but the palette rounds
 *    onto one entry are the T2 failure in miniature, so the more salient of the pair is moved one
 *    entry, in the direction that keeps the picture's own light and dark in order, and only into an
 *    entry nothing else is using. Ordered by salience (`areaSalience`: size times contrast times
 *    interiority), so the spare entries go to the areas that carry the subject.
 *  - AN AREA MAY NOT BE GIVEN A TIER ITS OWN CELLS CANNOT STAND AT (`minTone`). A drawing's outline is
 *    the darkest thing in it and therefore wants the tallest tier, and it is one cell wide at the
 *    figure's edge, where the support rules cap it three layers above the ground beside it: allocated
 *    the top of the ramp it is lowered to a third of it while the mass inside it keeps what it was
 *    given, and the picture arrives with its outline lighter than its body. Measured on our own heart
 *    fixture: 0.47 fidelity before the allocation, 0.00 with it and without this floor.
 *  - AND THE OUTLINE IS SPENT APART (`rim`). The floor above is a CAP, and while the picture is kept in
 *    one order the cap the outline takes is the cap the whole picture takes: an outline that can stand
 *    three layers holds the mass it encloses to four, whatever range the drawing had (measured on the
 *    seed picture: the tier spread fell from 0.61 to 0.52 when the areas started being told one entry
 *    each, and the panels read visibly flat). An outline's job at this size is the BOUNDARY rather than
 *    the tone, so it is given one dark tier — the darkest it can legally stand at — and the amplitude is
 *    spent on what it encloses. That inverts the picture's own light and dark at exactly one boundary,
 *    deliberately: the figure reads as a low wall round a taller mass instead of one flat plate. It is
 *    also why it is never merged away: a silhouette told in the tier beside it is a figure with no line
 *    round it.
 */
export function allocateEntries(
  areas: readonly Area[],
  read: AreaReading,
  entryTones: readonly number[],
  minTone: readonly number[] = [],
  rim = -1,
): number[] {
  const { salience } = read;
  const out = new Array<number>(areas.length).fill(0);
  if (areas.length === 0 || entryTones.length === 0) return out;
  const byTone = entryTones.map((tone, index) => ({ tone, index })).sort((a, b) => a.tone - b.tone);

  // The tone two areas have to differ by to be worth two entries: one step of the palette. Anything
  // closer rounds to the same entry or its neighbour, and FORCING those apart is how this allocation
  // can do real damage — a cream face is a dozen areas of nearly one colour, and spreading them across
  // the ramp turns the noise in their means into a relief (measured: a neighbour icon came back at 0.01
  // fidelity, its pattern scrambled rather than merely flattened). Merged on the whole GROUP's range
  // rather than pairwise, since single linkage folds a gradient into one tier.
  const step = byTone.length > 1
    ? (byTone[byTone.length - 1]!.tone - byTone[0]!.tone) / (byTone.length - 1)
    : Infinity;

  let groups = areas.map((area, id) => ({
    ids: [id], tone: area.tone, lo: area.tone, hi: area.tone,
    cells: area.cells.length, salience: salience[id] ?? 0,
    floor: indexAtLeast(byTone, minTone[id]),
  })).sort((a, b) => (a.tone - b.tone) || (areas[a.ids[0]!]!.cells[0]! - areas[b.ids[0]!]!.cells[0]!));

  // The outline is a region because it is the silhouette, and it is one ENTRY for the same reason.
  const holdsRim = (group: { ids: number[] }): boolean => rim >= 0 && group.ids.includes(rim);
  // AND IT IS GIVEN ITS OWN TIER ONLY WHERE IT IS A LINE. Being one region costs the picture nothing;
  // being spent apart costs the picture's own order over exactly the outline's cells, since the mass it
  // encloses is then free to stand taller than it. A fifth of the figure is where the two meet — the
  // interior gains about twice the tonal range and the order lost is worth about twice the outline's
  // share — and past it the trade is the wrong way round (measured on our own heart fixture, whose rim
  // is a quarter of it: 0.47 fidelity kept in order, 0.00 inverted, its correlation going negative).
  const rimShare = rim >= 0
    ? (areas[rim]?.cells.length ?? 0) / Math.max(1, areas.reduce((sum, area) => sum + area.cells.length, 0))
    : 1;
  const apart = rim >= 0 && rimShare <= RIM_SPEND_MAX;
  const joinable = (i: number): boolean => !holdsRim(groups[i]!) && !holdsRim(groups[i + 1]!);
  const nearest = (): { at: number; span: number } => {
    let at = -1, span = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      const a = groups[i]!, b = groups[i + 1]!;
      if (!joinable(i)) continue;
      const own = Math.max(a.hi, b.hi) - Math.min(a.lo, b.lo);
      if (own < span) { span = own; at = i; }
    }
    return { at, span };
  };
  const cheapest = (): number => {
    let at = -1, best = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      if (!joinable(i)) continue;
      const cost = (groups[i + 1]!.tone - groups[i]!.tone) * Math.min(groups[i]!.salience, groups[i + 1]!.salience);
      if (cost < best) { best = cost; at = i; }
    }
    return at;
  };
  while (groups.length > 1) {
    const near = nearest();
    const at = near.at >= 0 && near.span < step ? near.at
      : groups.length > byTone.length ? cheapest()
        : -1;
    if (at < 0) break;
    const a = groups[at]!, b = groups[at + 1]!;
    const cells = a.cells + b.cells;
    groups.splice(at, 2, {
      ids: [...a.ids, ...b.ids],
      tone: (a.tone * a.cells + b.tone * b.cells) / cells,
      lo: Math.min(a.lo, b.lo),
      hi: Math.max(a.hi, b.hi),
      cells,
      salience: Math.max(a.salience, b.salience),
      floor: Math.max(a.floor, b.floor),
    });
  }

  // ONE AREA HAS NOTHING TO KEEP IN ORDER, so the floor is not asked of it: what the support rules make
  // of a single mass is the terracing this generator has always produced, and the material's promise is
  // that a picture reaches the layers it was given.
  const single = groups.length === 1;

  // Where each group would go on its own: the entry nearest its own tone, which is the faithful answer
  // and the one a per-cell match would have given every one of its cells.
  const want = groups.map((group) => {
    let at = 0, bestD = Infinity;
    for (const [index, entry] of byTone.entries()) {
      const d = Math.abs(entry.tone - group.tone);
      if (d < bestD) { bestD = d; at = index; }
    }
    return at;
  });

  // THE FLOOR MOVES THE WHOLE PICTURE RATHER THAN ONE AREA. A thin dark area cannot stand at the tier its
  // tone asks for, and lifting only that area leaves the mass inside it darker than itself: the picture
  // upside down. So the tightest floor shifts the darkest group, and the rest are carried up with it,
  // compressed into the room that is left. What that costs is amplitude — a small figure has three tiers
  // of headroom and not eight — and what it buys is a picture the right way up.
  //
  // THE OUTLINE IS TAKEN OUT OF THIS ARITHMETIC where it is a line: the shift is measured over what it
  // encloses, and the order is kept among THOSE. It then takes its own floor below.
  const spent = apart ? groups.map((_, k) => k).filter((k) => !holdsRim(groups[k]!)) : [];
  const carried = spent.length > 0 ? spent : groups.map((_, k) => k);
  const first = carried[0]!, last = carried[carried.length - 1]!;
  const shift = single ? 0 : carried.reduce((most, k) => Math.max(most, groups[k]!.floor - want[k]!), 0);
  const base = Math.min(byTone.length - 1, want[first]! + shift);
  const span = Math.max(1, want[last]! - want[first]!);
  let previous = -1;
  for (const [seat, k] of carried.entries()) {
    const group = groups[k]!;
    const room = byTone.length - 1 - base;
    const spread = base + ((want[k]! - want[first]!) / span) * room;
    // Room for the groups still to come, so the last one is never pushed off the end of the palette.
    const ceiling = byTone.length - 1 - (carried.length - 1 - seat);
    const at = Math.min(byTone.length - 1, Math.max(Math.min(ceiling, Math.max(Math.round(spread), previous + 1)), single ? 0 : group.floor));
    previous = at;
    for (const id of group.ids) out[id] = byTone[at]!.index;
  }
  // The outline: the darkest tier it can stand at, and nothing about the rest of the picture in it.
  for (const [k, group] of groups.entries()) {
    if (!holdsRim(group) || carried.includes(k)) continue;
    for (const id of group.ids) out[id] = byTone[group.floor]!.index;
  }
  return out;
}


/**
 * WHAT A MATERIAL LETS A PICTURE BORROW from another family's palette, and it is a promise about the
 * material rather than a quality knob. Both instruments read it: the paved REGION (`planBorrow`) and the
 * bed inside a body (`planColourFill`).
 *
 * A visitor who asks for a mountain picture is owed a mountain and one who asks for water is owed water
 * and its banks, so both borrow NOTHING — a picture told in the material that was asked for and no road
 * in it (maintainer's ruling, 2026-08-19). A palette that already has hues of its own (the paths, the
 * item catalogue) borrows nothing either: a colour match there already said what the picture said. The
 * MIXED material is the one that has asked for whatever says the picture best, and it borrows FREELY.
 *
 * `accent` is a borrow bounded to `BORROW_ACCENT_SHARE` of the figure, which is what the mountain and
 * water materials carried between stages 2c and 2e. No material asks for it today.
 */
export type BorrowPolicy = 'none' | 'accent' | 'free';

/**
 * How much of the figure an ACCENT may cover, how much better the other palette has to say a region's
 * colour before anything is borrowed at all, and the fewest cells worth borrowing for.
 *
 * A THIRD IS WHERE AN ACCENT STOPS LEADING. Measured over the benchmark, a figure's largest region is
 * about half of it and the next two about a fifth each, so a third lets the second and third regions be
 * paved while the subject's own mass stays in the material that was asked for.
 *
 * THE GAIN IS IN THE SAME CHANNEL-WEIGHTED UNITS every colour distance here uses, and 24 is about a
 * step and a half of the terrain ramp: below it the two palettes say the region's colour about equally
 * well and the borrow would only cost the picture its tier.
 */
export const BORROW_ACCENT_SHARE = 1 / 3;
export const BORROW_MIN_GAIN = 24;
/**
 * How much of a region the borrowed material has to actually REACH before the borrow is taken at all.
 *
 * A coating wants flat ground and a region is a plateau, so its right and bottom edge rows sit against
 * the next tier and refuse (terrain renders half a cell off the macro grid, so a footprint's flat check
 * sweeps one cell past each end) — and a real region is a blob rather than a rectangle, so it loses that
 * fringe along every boundary it has with another region, not just along two sides. Measured on the seed
 * picture at sixteen cells, the face keeps 0.4 to 0.5 of itself; a rectangle four cells across keeps
 * 0.56. TWO FIFTHS is under both and well above a scatter, and the knee is real: at eleven twentieths the
 * seed picture's face pays its whole statement to the threshold and comes back green.
 *
 * Read by the caller, since the built surface is what decides it and only the caller has that.
 */
export const BORROW_COVER_MIN = 0.4;

/** The nearest entry of a palette to a colour, and how far off it is (channel-weighted, not squared). */
export function nearestEntry(
  entries: readonly { rgb: number }[], rgb: number,
): { at: number; off: number } {
  let at = -1, best = Infinity;
  for (const [index, entry] of entries.entries()) {
    const d = colourDistance(entry.rgb, rgb);
    if (d < best) { best = d; at = index; }
  }
  return { at, off: at < 0 ? Infinity : Math.sqrt(best) };
}

/**
 * WHICH REGIONS ARE TOLD IN A BORROWED MATERIAL, and in which of its entries.
 *
 * The measured prize this answers: the same picture paved in paths separates two areas the source tells
 * apart by hue 0.95 of the time against the green ramp's 0.55, because the paths have real hues. Once a
 * picture is a few REGIONS rather than a field of cells, that hue can be spent where it belongs — one
 * region at a time, in the family whose own colour is nearest to it — instead of on every cell's tone.
 *
 * `own` is the region's colour in the PICTURE, not the tone-fitted one the ramp is asked for: what is
 * being decided is which palette can say what the source said. The outline is never borrowed: its job is
 * the boundary, and a paved silhouette is a figure with no line round it.
 *
 * Ordered by how much of the picture each borrow buys (the gain times the cells it covers), so an accent
 * that has to stop somewhere stops after the regions that carry the most colour. Ties by first cell:
 * one answer per picture.
 */
export function planBorrow(
  regions: readonly Area[],
  rim: number,
  own: (area: Area) => number,
  ramp: readonly { rgb: number }[],
  coatings: readonly { catalogId: string; rgb: number }[],
  policy: BorrowPolicy,
): Map<number, string> {
  const out = new Map<number, string>();
  if (policy === 'none' || coatings.length === 0 || ramp.length === 0) return out;
  const figure = regions.reduce((sum, area) => sum + area.cells.length, 0);
  if (figure === 0) return out;

  const offers: { id: number; gain: number; at: number }[] = [];
  for (const [id, area] of regions.entries()) {
    if (id === rim || area.cells.length < AREA_MIN) continue;
    const rgb = own(area);
    const mine = nearestEntry(ramp, rgb), theirs = nearestEntry(coatings, rgb);
    const gain = mine.off - theirs.off;
    if (gain < BORROW_MIN_GAIN || theirs.at < 0) continue;
    offers.push({ id, gain, at: theirs.at });
  }
  offers.sort((a, b) => (b.gain * regions[b.id]!.cells.length - a.gain * regions[a.id]!.cells.length)
    || (regions[a.id]!.cells[0]! - regions[b.id]!.cells[0]!));

  const cap = policy === 'free' ? figure : figure * BORROW_ACCENT_SHARE;
  let spent = 0;
  for (const offer of offers) {
    const cells = regions[offer.id]!.cells.length;
    if (spent + cells > cap) continue;
    spent += cells;
    out.set(offer.id, coatings[offer.at]!.catalogId);
  }
  return out;
}

/**
 * How far round the hue circle a bed's own material may sit from the region's colour, the fewest cells a
 * bed may be, how much of the figure every bed together may cover, and how many bodies one picture may
 * fill.
 *
 * THE HUE IS WHAT A BED SAYS, so the material is chosen among the entries whose hue is the region's and
 * whose own chroma makes them a colour at all — forty degrees is a colour FAMILY (the twelve-sector
 * reading above is thirty), and a grey tile on a red body says lightness, which the ramp already said.
 * There is no second test of how far off the ramp itself is: `BORROW_MIN_GAIN` is that test, and measured
 * over the benchmark an absolute floor on top of it either rejected nothing (a colour the ramp is within
 * two steps of cannot be beaten by a step and a half) or rejected the silver-blue and brown subjects the
 * beds exist to colour.
 *
 * TWO CELLS, because one is a stray tile and two are a patch. A SIXTEENTH of the figure over at most TWO
 * bodies: the same share the accent spends on features (`stencil-feature.ts:FEATURE_BUDGET_SHARE`), so a
 * picture's whole colour statement stays an eighth of it, and a subject has one or two bodies — a third
 * bed is the picture's shading rather than its colour.
 */
export const FILL_HUE_MAX = 40;
export const FILL_BED_MIN = 2;
export const FILL_BUDGET_SHARE = 1 / 16;
export const FILL_MAX_REGIONS = 2;

/** One body filled: which region, the coating that says its colour, and how many cells the bed may take. */
export interface ColourFill { region: number; catalogId: string; want: number }

/** What the caller knows about the map and the material that this reading cannot: which regions a
 *  coating already covers, how many cells of a region will take one, what the material lets the picture
 *  borrow, and where a BODY starts (the share `stencil-feature.ts:FEATURE_MAX_SHARE` calls too big to be
 *  a feature — that module is built on this one, so the share arrives as an argument rather than as a
 *  second number here). */
export interface FillGate {
  bodyShare: number;
  paved: ReadonlySet<number>;
  ground: (region: number) => number;
  /** The SAME answer `planBorrow` is given, so the two instruments cannot promise different materials. */
  policy: BorrowPolicy;
  /** Cells the paving already laid, charged against what an accent material may spend. */
  coated: number;
}

/**
 * WHICH BODIES GET A BED OF BORROWED COLOUR, and in which entry — the answer for a region the paving
 * wanted and the GROUND refused.
 *
 * THE FAILURE THIS IS FOR. A picture has three colour
 * instruments: the ramp, which says lightness; the paving, which says a whole REGION's colour and is
 * taken only where it can COVER one (`BORROW_COVER_MIN` — a scatter of paving over a tier of green reads
 * as neither material); and the accent, which says a FEATURE and is refused a body outright
 * (`FEATURE_MAX_SHARE`). A subject whose own mass is a colour no green can approximate, on ground too
 * broken to hold a paved region, was therefore told entirely in green: measured over the benchmark, a
 * quarter of the pictures at sixteen cells said nothing about their own colour at all. A viewer reads
 * the two halves of that apart — a mark whose colour the SUBJECT has reads as the subject's colour
 * arriving, a mark whose colour it does not have reads as speckle — so a bed is laid only where the
 * borrowed material says the region's OWN hue, and a body no instrument can say gets nothing.
 *
 * A BED IS NOT A SMALLER BORROW. The borrow claims to be the region's SURFACE, which is why it has to
 * cover it; a bed claims one block inside the body, and it is bounded to a sixteenth of the figure over
 * two bodies precisely so it cannot be read as the surface it stands on. Everything else is the borrow's
 * own arithmetic — the same gain against the ramp (`BORROW_MIN_GAIN`), the same ordering by how much
 * colour a spend buys, the same `BorrowPolicy` and the same cap it sets — so the two cannot disagree
 * about which palette says a region better, nor about whether the material may borrow at all.
 *
 * Deterministic: offers ordered by gain times cells with ties by first cell, the budget divided evenly
 * and its remainder handed down the ranking (`planFeatureMarks`'s own arithmetic, for its own reason —
 * a plain walk gives the first body everything and the second nothing).
 */
export function planColourFill(
  regions: readonly Area[],
  rim: number,
  own: (area: Area) => number,
  ramp: readonly { rgb: number }[],
  coatings: readonly { catalogId: string; rgb: number }[],
  gate: FillGate,
): ColourFill[] {
  if (coatings.length === 0 || ramp.length === 0 || gate.policy === 'none') return [];
  const figure = regions.reduce((sum, area) => sum + area.cells.length, 0);
  // What the material still allows to be borrowed: everything under a free borrow, and otherwise what
  // the accent's own share has not already been paved with.
  const room = gate.policy === 'free' ? Infinity
    : Math.floor(figure * BORROW_ACCENT_SHARE) - gate.coated;
  const budget = Math.min(room, Math.round(figure * FILL_BUDGET_SHARE));
  if (figure === 0 || budget < FILL_BED_MIN) return [];

  const offers: { id: number; gain: number; at: number; ground: number }[] = [];
  for (const [id, area] of regions.entries()) {
    if (id === rim || gate.paved.has(id)) continue;
    if (area.cells.length <= figure * gate.bodyShare) continue;   // a feature, and the accent's business
    const rgb = own(area);
    if (hueOf(rgb).chroma < HUE_CHROMA_MIN) continue;             // a grey has no hue for a bed to say
    const mine = nearestEntry(ramp, rgb);
    const theirs = hueMatched(coatings, rgb, FILL_HUE_MAX);
    if (theirs === null || mine.off - theirs.off < BORROW_MIN_GAIN) continue;
    const ground = gate.ground(id);
    if (ground < FILL_BED_MIN) continue;                          // no ground will hold a bed here
    offers.push({ id, gain: mine.off - theirs.off, at: theirs.at, ground });
  }
  offers.sort((a, b) => (b.gain * regions[b.id]!.cells.length - a.gain * regions[a.id]!.cells.length)
    || (regions[a.id]!.cells[0]! - regions[b.id]!.cells[0]!));

  const taken = offers.slice(0, FILL_MAX_REGIONS);
  if (taken.length === 0) return [];
  const share = Math.max(FILL_BED_MIN, Math.floor(budget / taken.length));
  let left = budget;
  const want = taken.map((offer) => {
    const take = Math.min(share, offer.ground, left);
    left -= take;
    return take;
  });
  for (const [at, offer] of taken.entries()) {
    if (left <= 0) break;
    const more = Math.min(left, offer.ground - want[at]!);
    want[at] = want[at]! + more;
    left -= more;
  }
  return taken
    .map((offer, at) => ({ region: offer.id, catalogId: coatings[offer.at]!.catalogId, want: want[at]! }))
    .filter((fill) => fill.want >= FILL_BED_MIN);
}

/**
 * The nearest entry to a colour AMONG THE ENTRIES OF ITS OWN HUE — null where the palette has none.
 *
 * Two tests, and both are about saying a colour rather than a lightness: the entry's hue is within
 * `maxTurn` of the colour's, and the entry HAS a hue (`HUE_CHROMA_MIN`, the chroma below which a colour
 * is a grey). Nearest in the ordinary channel-weighted distance among those, so the lightness is as
 * close as the hue allows.
 */
export function hueMatched(
  entries: readonly { rgb: number }[], rgb: number, maxTurn: number,
): { at: number; off: number } | null {
  const own = hueOf(rgb);
  let at = -1, best = Infinity;
  for (const [index, entry] of entries.entries()) {
    const theirs = hueOf(entry.rgb);
    if (theirs.chroma < HUE_CHROMA_MIN) continue;
    if (Math.abs(signedTurn(own.hue, theirs.hue)) > maxTurn) continue;
    const d = colourDistance(entry.rgb, rgb);
    if (d < best) { best = d; at = index; }
  }
  return at < 0 ? null : { at, off: Math.sqrt(best) };
}

/**
 * The cells one BED takes: `want` of the region's own cells that the ground will hold, gathered around
 * ONE seed rather than spread over the body.
 *
 * A BED IS A BLOCK, AND THE GROUND DECIDES HOW MUCH OF ONE. A coating wants flat ground and a region
 * built in terrain is flat only in patches, so the cells that will hold one are scattered through the
 * body — and a spend spread over all of them reads as speckle rather than a bed. So the walk starts
 * at the DEEPEST cell of the region that will hold a mark (deepest inside the region, which is where the
 * ground is flattest and a block reads as being in the body rather than on its edge) and spends outward
 * from there in breadth-first order through the region, taking the cells that hold: whatever the ground
 * allows comes out as one cluster around one point.
 *
 * Deterministic: the seed is the lowest-indexed of the deepest cells, and the walk takes its neighbours
 * in one fixed order, so a picture beds the same way every time.
 */
export function bedCells(
  stencil: Stencil, area: Area, open: (index: number) => boolean, want: number,
): number[] {
  if (want <= 0) return [];
  const { width, height } = stencil;
  const mine = new Set(area.cells);
  const depth = cellDepths(stencil, (i) => mine.has(i));
  let seed = -1, deepest = -1;
  for (const i of area.cells) {
    if (!open(i)) continue;
    if (depth[i]! > deepest) { deepest = depth[i]!; seed = i; }
  }
  if (seed < 0) return [];

  const out: number[] = [];
  const seen = new Set<number>([seed]);
  const queue = [seed];
  for (let head = 0; head < queue.length && out.length < want; head++) {
    const i = queue[head]!;
    if (open(i)) out.push(i);
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!mine.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return out;
}

/** The picture's own mean colour over a region — what the source said there, before any fit. */
export function sourceColour(stencil: Stencil, area: Area): number {
  let r = 0, g = 0, b = 0;
  for (const i of area.cells) {
    const rgb = stencil.color[i] ?? 0;
    r += (rgb >> 16) & 0xff; g += (rgb >> 8) & 0xff; b += rgb & 0xff;
  }
  const n = Math.max(1, area.cells.length);
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
}

/**
 * How far apart two areas' colours have to be for the palette rounding them together to count as a
 * failure rather than as the right answer.
 *
 * In the same channel-weighted units every colour distance in this system uses. Twelve is about a
 * palette step of the terrain ramp: below it the two areas are one colour as far as any palette here
 * can say, and spending an entry on the difference would move one of them off its own tone for nothing.
 */
export const COLLIDE_MIN = 12;
