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

export interface AgentSkill {
  kind: 'method' | 'style';
  description: string;
  body: string;
}

export const SKILLS: Record<string, AgentSkill> = {
  // --- METHOD skills: transferable craft, compose with any request ---
  'site-analysis': {
    kind: 'method',
    description: 'Read the site before building: inspect anchors, constraints, and connections; write a site brief before any edit.',
    body: siteAnalysis,
  },
  'composition': {
    kind: 'method',
    description: 'Arrange any scene like a designer: one focal point, asymmetric balance, framing lines, and deliberate negative space.',
    body: composition,
  },
  'terrain-shaping': {
    kind: 'method',
    description: 'Landform first, any style: macro silhouette before micro detail, tier rhythm, drainage logic, and edge treatment.',
    body: terrainShaping,
  },
  'settlement-design': {
    kind: 'method',
    description: 'Any inhabited area: hierarchy from a single heart, density gradient, roads before/after buildings, mixed scale.',
    body: settlementDesign,
  },
  'ecology-planting': {
    kind: 'method',
    description: 'Plant like nature works: elevation bands, drifts not confetti, ecotones, clearings, and thinning toward settlements.',
    body: ecologyPlanting,
  },
  'design-review': {
    kind: 'method',
    description: 'The finishing crit before calling a build done: trend check, silhouette/focal/balance review from view_map, symptom→tool fix playbook.',
    body: designReview,
  },
  // --- STYLE set pieces: reference layouts for specific aesthetics ---
  'cozy-village': {
    kind: 'style',
    description: 'A small believable village: staggered houses around a green, a road spine with spurs, hedged farm plots, layered planting.',
    body: cozyVillage,
  },
  'terraced-hill-park': {
    kind: 'style',
    description: 'A scenic terraced hill with a lookout, ramps between levels, and an elevated pond or waterfall.',
    body: terracedHillPark,
  },
  'pro-terraforming': {
    kind: 'method',
    description: 'Professional cozy island-builder landscaping: organic terraced cliffs, meandering rivers, elevated ponds and waterfalls, coastline shaping.',
    body: proTerraforming,
  },
  'river-crossing': {
    kind: 'style',
    description: 'A clean river through the map with a road crossing it on a bridge — the reliable bridge recipe.',
    body: riverCrossing,
  },
  'alpine-cascade': {
    kind: 'style',
    description: 'A dramatic multi-tier mountain with a summit pool, chained waterfalls, switchback ramps, conifer forest slopes, and a peak lookout.',
    body: alpineCascade,
  },
  'zen-garden': {
    kind: 'style',
    description: 'A restrained enclosed garden: hedge rows, a single focal specimen tree, asymmetric flower beds, and an intentional open ground.',
    body: zenGarden,
  },
  'rice-terraces': {
    kind: 'style',
    description: 'Stepped cultivation terraces each holding a contained pond, with farm fields, a hamlet at the foot, and ramp bench links.',
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
