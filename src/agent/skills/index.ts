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

import proTerraforming from './pro-terraforming.md?raw';
import type { SkillKind } from '../core/types';
import type { SkillName } from './titles';
import figureLandscape from './figure-landscape.md?raw';
import planOnMap from './plan-on-map.md?raw';
import planIsland from './plan-island.md?raw';
import buildFromPlan from './build-from-plan.md?raw';
import terrainShaping from './terrain-shaping.md?raw';
import layoutPatterns from './layout-patterns.md?raw';
import regionKinds from './region-kinds.md?raw';
import neighborsIntro from './neighbors.md?raw';
import { NEIGHBORS } from '../../config/neighbors';

/** The neighbors skill: its fixed prose, then each neighbour with a house, drawn from the neighbour
 *  data so that names and profiles have one owner. */
function neighborsBody(): string {
  const lines = NEIGHBORS.flatMap(({ name, profile }) => {
    if (!profile) return [];
    const names = [...new Set(Object.values(name))].join(' / ');
    const home = profile.home ? ` Their house: ${profile.home}` : '';
    return [`- ${profile.house}: ${names}, ${profile.role}. Loves ${profile.loves.join(', ')}; likes ${profile.likes.join(', ')}.${home}`];
  });
  return `${neighborsIntro.trimEnd()}\n\n${lines.join('\n')}\n`;
}

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
  'layout-patterns': {
    kind: 'method',
    title: 'Layout Patterns',
    description: 'Design and build any place the request leaves open as a drawing: idea, parts, ground, paving, planting; mirror and repeat; composition devices.',
    body: layoutPatterns,
  },
  'plan-island': {
    kind: 'method',
    title: 'Plan an Island',
    description: 'Design a whole island: its idea, levels, main route and four to six districts, each handed to a lead of its own, then joined and finished.',
    body: planIsland,
  },
  'region-kinds': {
    kind: 'method',
    title: 'Region Kinds',
    description: 'Choose what each district or place is: kinds of place by group, each resident\'s home themed for its owner, taste examples.',
    body: regionKinds,
  },
  neighbors: {
    kind: 'method',
    title: 'Neighbors',
    description: 'Who lives in each house of the catalogue and what they love, from the game\'s own profiles, to dress each home for its owner.',
    body: neighborsBody(),
  },
  'plan-on-map': {
    kind: 'method',
    title: 'Plan on the Map',
    description: 'Design one district or several areas: idea, ground as one drawing, paths, places drawn as annotations, each place handed to a helper, halves mirrored.',
    body: planOnMap,
  },
  'build-from-plan': {
    kind: 'method',
    title: 'Build from the Plan',
    description: 'Build what annotations describe, an approved plan or the user\'s drawing: read each zone, build it inside its cells, roads on paths, report gaps.',
    body: buildFromPlan,
  },
  'terrain-shaping': {
    kind: 'method',
    title: 'Terrain Shaping',
    description: 'Build the landform: near-low-far-high grading, terraces as walkable floors, a water shape vocabulary, legal ponds and waterfall lips.',
    body: terrainShaping,
  },
  'pro-terraforming': {
    kind: 'method',
    title: 'Pro Terraforming',
    description: 'Advanced terrain moves: backing walls above 3 tiers, terraced cascades, sunk ponds, coves, and the waterfall patterns that pass validation.',
    body: proTerraforming,
  },
  // --- style set pieces: reference layouts ---
  'figure-landscape': {
    kind: 'method',
    title: 'Figure Landscape',
    description: 'Shape land and water into the design of a place with a drawing: terraces, a stage, pools with an outline, islands, channels, figures.',
    body: figureLandscape,
  },
} satisfies Record<SkillName, AgentSkill>;
