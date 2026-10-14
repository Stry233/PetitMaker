/**
 * The assistant's build playbooks for this game, with progressive disclosure: only name and
 * description reach the model through list_skills, and load_skill returns a skill's full body when
 * the task matches. Bodies are written for the model: concrete tool sequences with the assistant's
 * tool names and legal-by-construction patterns for this game's rules.
 *
 * Playbook prose lives in the Markdown files beside this one (imported via ?raw). The `SKILLS` record
 * is the metadata source of truth (name, description, kind, body reference).
 *
 * kind:
 *   'method' — transferable craft guidance; applies to any request, any style.
 *   'style'  — set-piece reference layout for a specific aesthetic.
 */

import cozyVillage from './cozy-village.md?raw';
import terracedHillPark from './terraced-hill-park.md?raw';
import proTerraforming from './pro-terraforming.md?raw';
import gardenTown from './garden-town.md?raw';
import waterGarden from './water-garden.md?raw';
import type { SkillKind } from '../core/types';
import type { SkillName } from './titles';
import figureLandscape from './figure-landscape.md?raw';
import siteAnalysis from './site-analysis.md?raw';
import composition from './composition.md?raw';
import designReview from './design-review.md?raw';
import terrainShaping from './terrain-shaping.md?raw';
import settlementDesign from './settlement-design.md?raw';
import ecologyPlanting from './ecology-planting.md?raw';
import streetGrammar from './street-grammar.md?raw';

export interface AgentSkill {
  kind: SkillKind;
  /** The name the model reads. The panel shows it in the interface language through
   *  `titles.ts:skillTitleKey`, whose en copy is this title. */
  title: string;
  description: string;
  body: string;
}

export const SKILLS: Record<string, AgentSkill> = {
  // --- method skills: transferable craft, compose with any request ---
  'site-analysis': {
    kind: 'method',
    title: 'Site Analysis',
    description: 'Read the map before building: scale, plaza, anchors, levels; decide the subject, the back/front axis and the routes, then plan.',
    body: siteAnalysis,
  },
  'composition': {
    kind: 'method',
    title: 'Composition',
    description: 'Compose a requested scene around its purpose, approach, clear foreground and supporting background while preserving existing work.',
    body: composition,
  },
  'terrain-shaping': {
    kind: 'method',
    title: 'Terrain Shaping',
    description: 'Build the landform: near-low-far-high grading, terraces as walkable floors, a water shape vocabulary, legal ponds and waterfall lips.',
    body: terrainShaping,
  },
  'settlement-design': {
    kind: 'method',
    title: 'Settlement Design',
    description: 'Site requested homes with usable yards and accessible entrances; connect destinations while preserving building counts and existing work.',
    body: settlementDesign,
  },
  'ecology-planting': {
    kind: 'method',
    title: 'Ecology Planting',
    description: 'Arrange beds, rows, groves and specimens at the requested scale, preserve intentional palettes and repair partial placements locally.',
    body: ecologyPlanting,
  },
  'street-grammar': {
    kind: 'method',
    title: 'Street Grammar',
    description: 'Roads as streets: a 3-wide trunk through the destinations, 2-wide lanes, T and offset junctions, spurs that arrive, ramps stitched inline.',
    body: streetGrammar,
  },
  'design-review': {
    kind: 'method',
    title: 'Design Review',
    description: 'Verify requested outcomes, preserved features and composition; repair only actual gaps and stop when the brief is satisfied.',
    body: designReview,
  },
  'pro-terraforming': {
    kind: 'method',
    title: 'Pro Terraforming',
    description: 'Advanced terrain moves: backing walls above 3 tiers, terraced cascades, sunk ponds, coves, and the waterfall patterns that pass validation.',
    body: proTerraforming,
  },
  // --- style set pieces: reference layouts, each grounded in a hand-built expert map ---
  'garden-town': {
    kind: 'style',
    title: 'Garden Town',
    description: 'The flat formal dialect: a street partition with flower edging on every walk, walled courts, orchard grids, one iconic water figure.',
    body: gardenTown,
  },
  'water-garden': {
    kind: 'style',
    title: 'Water Garden',
    description: 'The terraced water-court dialect: a flooded backing wall, formal pools sunk in benches, an islet-grid parterre, crop plots in color blocks.',
    body: waterGarden,
  },
  'figure-landscape': {
    kind: 'style',
    title: 'Figure Landscape',
    description: 'A picture or word drawn into the ground: water hearts and rings, a flooded terrace banner with dry-bench lettering, flower marks.',
    body: figureLandscape,
  },
  'cozy-village': {
    kind: 'style',
    title: 'Cozy Village',
    description: 'A small village district: distinct cabins with themed yards around a half-open green, a 3-wide spine with lanes, a farm band.',
    body: cozyVillage,
  },
  'terraced-hill-park': {
    kind: 'style',
    title: 'Terraced Hill Park',
    description: 'A walkable park hill: organic benches with a paved switchback climb, a lookout court on top, a sunk pond on the way up.',
    body: terracedHillPark,
  },
} satisfies Record<SkillName, AgentSkill>;
