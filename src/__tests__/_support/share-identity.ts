/**
 * The maps whose share codes and saves the identity pins hold fixed: every built-in planet fresh and
 * generated, the save fixtures, and a drawn and a scanned custom planet. `share-identity.json` beside
 * the fixtures records what today's build writes for each.
 */
import { readFileSync } from 'node:fs';
import { createGridState } from '../../core/model/template';
import { cropPlanet } from '../../core/model/planet';
import { planetLandmarkObject } from '../../core/model/landmarks';
import { createDefaultTerrainCell } from '../../core/model/grid-model';
import { LANDMARKS } from '../../core/game/profile';
import { CellZone } from '../../core/game/zones';
import { TerrainType, type GridState, type MapTemplate } from '../../core/model/types';
import { canonicalBytes, canonicalize, toSaveJSON } from '../../io/save/canonical';
import { clearUnderLandmarks } from '../../tools/generation/transfer';
import { openSave } from '../../io/import/open-save';
import { decodeSave } from '../../io/save/json-codec';
import { parseSave } from '../../io/save/parse';
import { isGenerationConfig } from '../../io/save/generation-record';
import { decodeMapPayload, encodeMapPayload, type DecodedMapPayload } from '../../io/share/codec/payload';
import { scannedPlanet } from '../../pipelines/planet-scan/to-template';
import { GRASS, SAND, SEA } from '../../pipelines/planet-scan/ground/color';
import type { GroundReading } from '../../pipelines/planet-scan/ground/classify';
import { getMapTemplate, MAP_LIST } from '../../config/maps';
import { resolveTemplate } from '../../config/maps/resolve';
import { upgradeLandmarks } from '../../core/model/planet';
import { runCandidateOn } from '../../tools/generation/run/generation-run';
import { sha256 } from '../../core/base/sha256';
import { defaultConfig } from '../../tools/generation/recipe';

export const SHARE_META = { appVersion: 'pin', saveVersion: 3 } as const;

/** The save fixtures that are whole maps; the ramp fixtures are migration inputs on a test grid. */
export const SAVE_FIXTURES = [
  'landmarks-v2.json', 'landmarks-v3.json', 'legacy-v1-no-provenance.json', 'petit-planet-hexia-1782022830197.json',
] as const;

/** Save fixture `name` loaded the way a dropped save file is. */
export function loadSaveFixture(name: string): GridState {
  const raw = readFileSync(`src/__tests__/fixtures/saves/${name}`, 'utf8');
  return openSave(raw, getMapTemplate((JSON.parse(raw) as { templateId?: string }).templateId));
}

/** A rounded grass field in a sand ring with a pond, cropped as the planet editor saves a drawn planet,
 *  every landmark the profile has placed on it. */
export function drawnPlanet(): MapTemplate {
  const cols = 112, rows = 96;
  const ground = Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x): CellZone => {
    const d = Math.hypot((x - cols / 2) / (cols * 0.45), (y - rows / 2) / (rows * 0.45));
    return d < 0.9 ? CellZone.Grass : d < 0.97 ? CellZone.Beach : CellZone.Void;
  }));
  const anchor = LANDMARKS.find((l) => l.ground === 'grass');
  const landmarks = anchor ? [planetLandmarkObject(anchor, { x: 40, y: 30 }, 0)] : [];
  const pond = (x: number, y: number) => (Math.hypot(x - 80, y - 66) < 6 ? createDefaultTerrainCell(TerrainType.Water, 1) : null);
  const crop = cropPlanet(ground, landmarks, pond, 'Drawn');
  if (!crop) throw new Error('the drawn planet has no ground');
  return crop.template;
}

/** A video-import planet over an oval island of grass in sand on open sea. */
export function scannedIsland(): MapTemplate {
  const cols = 120, rows = 100;
  const ground = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const reach = Math.hypot((c - cols / 2) / (cols * 0.36), (r - rows / 2) / (rows * 0.36));
      ground[r * cols + c] = reach < 0.86 ? GRASS : reach < 0.95 ? SAND : SEA;
    }
  }
  const empty = new Uint8Array(cols * rows);
  const reading: GroundReading = { cols, rows, ground, inferred: empty, unseen: empty, readings: undefined as unknown as GroundReading['readings'] };
  return scannedPlanet(reading, [], 'Scanned').template;
}

async function generated(template: MapTemplate, seed: number): Promise<GridState> {
  const state = createGridState(template);
  await runCandidateOn(state, {
    config: defaultConfig('designed', { seed, richness: 0.7, maxElevation: 6 }),
    region: null,
    rules: 'default',
  });
  return state;
}

/** Every pinned map by name. */
export async function identityCases(): Promise<[string, GridState][]> {
  const out: [string, GridState][] = [];
  for (const t of MAP_LIST) {
    out.push([`${t.id}/fresh`, createGridState(t)]);
    out.push([`${t.id}/designed-4`, await generated(t, 4)]);
  }
  for (const name of SAVE_FIXTURES) out.push([`save/${name}`, loadSaveFixture(name)]);
  out.push(['drawn/designed-4', await generated(drawnPlanet(), 4)]);
  out.push(['scanned/fresh', createGridState(scannedIsland())]);
  return out;
}

export const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The SHA-256 of a map's canonical save bytes, as hex. */
export async function canonicalSha(state: GridState): Promise<string> {
  return hex(await sha256(canonicalBytes(canonicalize(state))));
}

/** The map a decoded share payload opens as, by the share import's own steps. */
export function importPayload(dec: DecodedMapPayload): GridState {
  const planet = dec.template && upgradeLandmarks(dec.template);
  const templateId = planet ? planet.id : dec.canonical.templateId;
  const json = toSaveJSON({ ...dec.canonical, templateId }, dec.annotations);
  const state = decodeSave(parseSave(JSON.parse(json), { template: resolveTemplate(templateId, planet) }));
  clearUnderLandmarks(state);
  if (isGenerationConfig(dec.generation)) state.generation = dec.generation;
  return state;
}

export { decodeMapPayload, encodeMapPayload };
