import type { Migration } from '../types';

const RAMPS = new Set([
  'ramp-green-steps', 'ramp-light-stair', 'ramp-moss-ramp', 'ramp-park-steps',
  'ramp-plank', 'ramp-retro-steps', 'ramp-teak-stair',
]);

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** V1 ramps are four cells long; v2 keeps their cliff end while shortening the lower run by two. */
export function reanchorV1Ramp(catalogId: unknown, rotation: unknown, point: unknown): unknown {
  if (typeof catalogId !== 'string' || !RAMPS.has(catalogId) || !record(point)) return point;
  const axis = rotation === 180 ? 'y' : rotation === 270 ? 'x' : null;
  if (!axis || typeof point[axis] !== 'number' || !Number.isFinite(point[axis])) return point;
  return { ...point, [axis]: point[axis] + 2 };
}

function historyObject(value: unknown): unknown {
  if (!record(value)) return value;
  return { ...value, position: reanchorV1Ramp(value.catalogId, value.rotation, value.position) };
}

/** History has an independent version because autosaves can restore it as a separate record. */
export function migrateV1RampHistory(value: unknown): unknown {
  if (!record(value) || value.v !== 1 || !Array.isArray(value.entries)) return value;
  return {
    ...value, v: 2,
    entries: value.entries.map((entry: unknown) => {
      if (!record(entry)) return entry;
      const result = { ...entry };
      if (record(entry.cmd)) {
        result.cmd = { ...entry.cmd };
        for (const key of ['object', 'removedObject']) {
          if (key in entry.cmd) (result.cmd as RecordValue)[key] = historyObject(entry.cmd[key]);
        }
      }
      if (record(entry.objectOps)) {
        result.objectOps = { ...entry.objectOps };
        for (const key of ['added', 'removed']) {
          const objects = entry.objectOps[key];
          if (Array.isArray(objects)) (result.objectOps as RecordValue)[key] = objects.map(historyObject);
        }
      }
      return result;
    }),
  };
}

export const v1ToV2: Migration = {
  from: 1,
  description: 'Shorten ramps while retaining their upper cliff connection',
  migrate: (raw) => ({
    ...raw,
    ...(Array.isArray(raw.objects) ? {
      objects: raw.objects.map((obj: unknown) => record(obj)
        ? reanchorV1Ramp(obj.catalogId, obj.rotation, obj) : obj),
    } : {}),
    ...(raw.history !== undefined ? { history: migrateV1RampHistory(raw.history) } : {}),
  }),
};
