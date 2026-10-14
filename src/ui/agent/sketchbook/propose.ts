/* The map's sketch proposals with the words the card says them in. */
import type { GridState } from '../../../core/model/types';
import {
  proposeSketches as proposeOn, type SketchArt, type SketchDir, type SketchKind, type SketchProposal,
} from '../../../agent/panel';
import type { I18nKey } from '../../../i18n/keys';

export type { SketchArt };

export interface SketchIdea extends SketchProposal {
  /** What she says she sees, and what a press hands the composer; resolved at render. */
  capKey: I18nKey;
  orderKey: I18nKey;
  /** The compass quarter, as the word the sentence takes. */
  dirKey: I18nKey;
}

/** Literal keys, so the i18n drift scan sees every one. */
const WORDS: Record<SketchKind, { capKey: I18nKey; orderKey: I18nKey }> = {
  lane: { capKey: 'agent.sketch_lane_cap', orderKey: 'agent.sketch_lane_order' },
  pond: { capKey: 'agent.sketch_pond_cap', orderKey: 'agent.sketch_pond_order' },
  bridge: { capKey: 'agent.sketch_bridge_cap', orderKey: 'agent.sketch_bridge_order' },
  grove: { capKey: 'agent.sketch_grove_cap', orderKey: 'agent.sketch_grove_order' },
};

const DIR_KEY: Record<SketchDir, I18nKey> = {
  north: 'agent.sketch_dir_north',
  south: 'agent.sketch_dir_south',
  east: 'agent.sketch_dir_east',
  west: 'agent.sketch_dir_west',
  middle: 'agent.sketch_dir_middle',
};

/** The proposals the map offers, in the order the card cycles them. */
export function proposeSketches(state: GridState): SketchIdea[] {
  return proposeOn(state).map((p) => ({ ...p, ...WORDS[p.kind], dirKey: DIR_KEY[p.dir] }));
}
