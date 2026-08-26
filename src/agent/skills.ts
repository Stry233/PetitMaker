/**
 * Agent skill system — reusable build playbooks with progressive disclosure
 * (the Claude Code model): only name+description sit in the system prompt's
 * tool description; the model loads a skill's full body on demand via
 * load_skill when the task matches. Bodies are written FOR the model: concrete
 * tool sequences with our actual tool names and legal-by-construction patterns.
 *
 * Playbook prose lives in src/agent/skills/*.md (imported via ?raw) for easy
 * iteration without touching TS. The SKILLS record stays here as the metadata
 * source of truth (name, description, kind, body reference).
 *
 * kind:
 *   'method' — transferable craft guidance; applies to any request, any style.
 *   'style'  — set-piece reference layout for a specific aesthetic.
 */

import cozyVillage from './skills/cozy-village.md?raw';
import terracedHillPark from './skills/terraced-hill-park.md?raw';
import proTerraforming from './skills/pro-terraforming.md?raw';
import riverCrossing from './skills/river-crossing.md?raw';
import alpineCascade from './skills/alpine-cascade.md?raw';
import zenGarden from './skills/zen-garden.md?raw';
import riceTerraces from './skills/rice-terraces.md?raw';
import siteAnalysis from './skills/site-analysis.md?raw';
import composition from './skills/composition.md?raw';
import designReview from './skills/design-review.md?raw';
import terrainShaping from './skills/terrain-shaping.md?raw';
import settlementDesign from './skills/settlement-design.md?raw';
import ecologyPlanting from './skills/ecology-planting.md?raw';
import streetGrammar from './skills/street-grammar.md?raw';

export interface AgentSkill {
  kind: 'method' | 'style';
  /** A proper noun like a catalog item name, for the panel to show (the chip, the dock's playbook
   *  line, the record line) — no per-locale key, same as an item's own `name` map is not one. */
  title: string;
  description: string;
  body: string;
}

export const SKILLS: Record<string, AgentSkill> = {
  // --- METHOD skills: transferable craft, compose with any request ---
  'site-analysis': {
    kind: 'method',
    title: 'Site Analysis',
    description: 'Read the map before building: scale, plaza, anchors, levels; decide the subject, the back/front axis and the routes, then plan.',
    body: siteAnalysis,
  },
  'composition': {
    kind: 'method',
    title: 'Composition',
    description: 'Arrange any scene: one primary set piece, views out front with backing behind, local mirrors, pinch-and-release, nothing stamped twice.',
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
    description: 'Place buildings as homes: one themed district each, doors facing the view with backing behind, the plaza ring populated near and far.',
    body: settlementDesign,
  },
  'ecology-planting': {
    kind: 'method',
    title: 'Ecology Planting',
    description: 'Plant at two grains only: solid one-species beds and orchards plus lone specimens, one palette per place, no mid-size confetti.',
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
    description: 'The finishing crit: evaluate_map trend first, then view_map against the expert tells (subject, climb, arrival, stamps, grain), symptom-to-tool fixes.',
    body: designReview,
  },
  'pro-terraforming': {
    kind: 'method',
    title: 'Pro Terraforming',
    description: 'Advanced terrain moves: backing walls above 3 tiers, terraced cascades, sunk ponds, coves, and the waterfall patterns that pass validation.',
    body: proTerraforming,
  },
  // --- STYLE set pieces: reference layouts for specific aesthetics ---
  'cozy-village': {
    kind: 'style',
    title: 'Cozy Village',
    description: 'A small village district: one-of-each cabins with themed yards around a half-open green, a 3-wide spine with lanes, a farm band.',
    body: cozyVillage,
  },
  'terraced-hill-park': {
    kind: 'style',
    title: 'Terraced Hill Park',
    description: 'A walkable park hill: organic benches with a paved switchback climb, a lookout court on top, a sunk pond on the way up.',
    body: terracedHillPark,
  },
  'river-crossing': {
    kind: 'style',
    title: 'River Crossing',
    description: 'A meandering river with a straight crossing waist, a bridge on a found anchor, and roads that arrive at both banks.',
    body: riverCrossing,
  },
  'alpine-cascade': {
    kind: 'style',
    title: 'Alpine Cascade',
    description: 'A summit massif with a crown pool, chained offset falls, a paved switchback ascent, forest slopes and a bare summit court.',
    body: alpineCascade,
  },
  'zen-garden': {
    kind: 'style',
    title: 'Zen Garden',
    description: 'A quiet garden: one specimen tree off-center, same-species hedges on two sides, a single stepping-stone path, ground kept empty.',
    body: zenGarden,
  },
  'rice-terraces': {
    kind: 'style',
    title: 'Rice Terraces',
    description: 'Farm benches climbing a slope, each with a sunk pond and a dry field strip, a zigzag ramp path, and a hamlet at the foot.',
    body: riceTerraces,
  },
};

export function listSkills(): string {
  const methods = Object.entries(SKILLS).filter(([, s]) => s.kind === 'method');
  const styles = Object.entries(SKILLS).filter(([, s]) => s.kind === 'style');
  const fmt = ([name, s]: [string, AgentSkill]) => `- ${name}: ${s.description}`;
  return [
    'METHOD skills (transferable craft, compose with any request):',
    ...methods.map(fmt),
    '',
    'STYLE set pieces (reference layouts for specific aesthetics):',
    ...styles.map(fmt),
  ].join('\n');
}
