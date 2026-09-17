/**
 * Manifest facts folded into plain relational English, most salient first: water and its bridges,
 * road coverage, clusters, terracing, islet shape. At most 3 water bodies, 1 road clause, 2
 * clusters, 1 terrace clause and 1 islet clause — 8 by construction, matching the interface cap.
 */
import type { Cluster, SceneManifest, WaterBody } from './manifest';

const RUNS_PHRASE: Record<'north-south' | 'east-west', string> = {
  'north-south': 'north to south',
  'east-west': 'east to west',
};

function waterClause(body: WaterBody, bridges: number, mentionBridges: boolean): string {
  if (body.kind === 'river') {
    const runs = body.runs ? RUNS_PHRASE[body.runs] : null;
    const crossing = mentionBridges && bridges > 0 ? `, crossed by ${bridges} bridge${bridges === 1 ? '' : 's'}` : '';
    return runs
      ? `a river runs ${runs} across the map${crossing}`
      : `a river crosses the map${crossing}`;
  }
  if (body.kind === 'lake') return `a lake spreads across the ${body.at}`;
  return `a small pond sits at the ${body.at}`;
}

function clusterClause(cluster: Cluster): string {
  if (cluster.category === 'building') return `a village of ${cluster.count} buildings gathers at the ${cluster.at}`;
  if (cluster.category === 'plant') return `dense planting fills the ${cluster.at}`;
  return `a cluster of ${cluster.category} gathers at the ${cluster.at}`;
}

export function verbalizeScene(m: SceneManifest): string[] {
  const clauses: string[] = [];
  const firstRiverIndex = m.water.findIndex((b) => b.kind === 'river');
  m.water.forEach((body, i) => clauses.push(waterClause(body, m.bridges, i === firstRiverIndex)));

  if (m.roadCoverage === 'sparse') clauses.push('a few paths cross the map');
  else if (m.roadCoverage === 'connected network') clauses.push('a connected road network threads the map');

  for (const cluster of m.clusters) clauses.push(clusterClause(cluster));

  if (m.terraces > 0) {
    clauses.push(m.peakAt
      ? `the ground steps through ${m.terraces} terraces, highest at the ${m.peakAt}`
      : `the ground steps through ${m.terraces} terraces`);
  }

  if (m.islandShaped) clauses.push('the land reads as an islet with open water at its edges');

  return clauses.slice(0, 8);
}
