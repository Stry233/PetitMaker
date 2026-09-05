/*
 * manifest.ts — what the rest of the app may know about a pack WITHOUT loading its renderer.
 *
 * The export controls, the persisted settings and the booklet rows all need a pack's identity,
 * name, cost and palette; none of them need a line of drawing code. Splitting the two is what
 * keeps the draw engine out of the main bundle: everything below is data, and the functions that
 * consume it live behind `loadProcRenderer` on the module door.
 */
import type { PackPalette } from '../palette';
import type { NeuralStyle } from '../../neural/models';

interface PackMetaShape {
  id: string;
  /** Literal i18n key naming this pack. Scanned as source text by the i18n drift test. */
  nameKey: string;
  /** Render work in device-independent units, bucketed 1 to 5. Seconds are not portable across
   *  machines, so the shelf sorts and filters on this and shows a calibrated estimate separately. */
  cost: 1 | 2 | 3 | 4 | 5;
  palette: PackPalette;
  /** The on-device model this pack draws through. A pack with one is drawn by a neural network from
   *  the map's own render, on this machine; its take carries the AI disclosure like a provider's. */
  neural?: NeuralStyle;
}

export interface ProcPackMeta extends PackMetaShape {
  id: ProcPackId;
}

const META = [
  {
    id: 'aquarelle' as const,
    nameKey: 'stylize.proc_aquarelle',
    cost: 3,
    palette: {
      /* The map's own hues, watercolour-soft: game-green ground per terrace, sea blue, and the
         path lattice reserved as bare paper, read by the ink contour. */
      paper: '#F7F4EA',
      ground: ['#8FBF6A', '#7DAF58', '#6B9E48', '#5A8D3A'],
      water: '#5390BC',
      waterDeep: '#3F7BAA',
      road: '#EFE8D2',
      roadShade: '#D9C29A',
      roadTreatment: 'reserved',
      dark: '#293425',
    },
  },
  {
    id: 'coloredpencil' as const,
    nameKey: 'stylize.proc_coloredpencil',
    cost: 3,
    palette: {
      /* Chalky pencil pigment over strong tooth; the lattice stays paper, read by the graphite ink. */
      paper: '#F7F3E8',
      ground: ['#A9C089', '#93AC74', '#7D9760', '#68824C'],
      water: '#6E96B8',
      waterDeep: '#5B84A8',
      road: '#F2EDDD',
      roadShade: '#D9CDB2',
      roadTreatment: 'reserved',
      dark: '#312E27',
    },
  },
  /* The five distilled styles. Their palettes only paint the placeholder thumbnail and the version
     card's band; the picture itself comes from the model. */
  {
    id: 'neural-watercolor' as const,
    nameKey: 'stylize.proc_neural_watercolor',
    cost: 5,
    neural: 'watercolor' as const,
    palette: {
      paper: '#F7F5EC',
      ground: ['#B9C98F', '#A3B87A', '#8DA466', '#768F53'],
      water: '#5F93AA',
      waterDeep: '#4A7D95',
      road: '#F3E9D6',
      roadShade: '#D9C29A',
      roadTreatment: 'reserved',
      dark: '#28321F',
    },
  },
  {
    id: 'neural-inkwash' as const,
    nameKey: 'stylize.proc_neural_inkwash',
    cost: 5,
    neural: 'inkwash' as const,
    palette: {
      paper: '#F4F1E8',
      ground: ['#D8D9CC', '#C2C5B3', '#ABB09B', '#949B84'],
      water: '#A9B8C2',
      waterDeep: '#8DA0AE',
      road: '#F0EBDD',
      roadShade: '#CFC7B3',
      roadTreatment: 'reserved',
      dark: '#2B2E2A',
    },
  },
  {
    id: 'neural-night' as const,
    nameKey: 'stylize.proc_neural_night',
    cost: 5,
    neural: 'night' as const,
    palette: {
      paper: '#1E2233',
      ground: ['#4A5A5B', '#3F4E50', '#344245', '#2A363A'],
      water: '#16294A',
      waterDeep: '#0F1F3A',
      road: '#C9A45A',
      roadShade: '#A8853F',
      roadTreatment: 'filled',
      dark: '#12141E',
    },
  },
  {
    id: 'neural-crayon' as const,
    nameKey: 'stylize.proc_neural_crayon',
    cost: 5,
    neural: 'crayon' as const,
    palette: {
      paper: '#FBF6EA',
      ground: ['#A9D27B', '#94C266', '#7FB054', '#6A9C44'],
      water: '#4FA6DE',
      waterDeep: '#3A8EC6',
      road: '#FBF0DC',
      roadShade: '#D9955C',
      roadTreatment: 'reserved',
      dark: '#2E2826',
    },
  },
  {
    id: 'neural-vintage' as const,
    nameKey: 'stylize.proc_neural_vintage',
    cost: 5,
    neural: 'vintage' as const,
    palette: {
      paper: '#EFE3C8',
      ground: ['#C8BC92', '#B5A97E', '#A2966C', '#8E835B'],
      water: '#6E8A7E',
      waterDeep: '#587368',
      road: '#7A573A',
      roadShade: '#5E4229',
      roadTreatment: 'filled',
      dark: '#33291B',
    },
  },
] satisfies readonly PackMetaShape[];

/** The id union is DERIVED from the rows above, so it cannot drift from what actually exists:
 *  adding a pack is adding a row, and every switch over the union follows by type error. */
export type ProcPackId = (typeof META)[number]['id'];

export const PROC_PACK_META: readonly ProcPackMeta[] = META;

const metaById = new Map<string, ProcPackMeta>(PROC_PACK_META.map((m) => [m.id, m]));

export function procPackMeta(id: string): ProcPackMeta | undefined {
  return metaById.get(id);
}
export function isProcPackId(id: string): id is ProcPackId {
  return metaById.has(id);
}
