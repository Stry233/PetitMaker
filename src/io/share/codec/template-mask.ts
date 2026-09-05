import type { MapTemplate } from '../../../core/model/types';

interface MaskSpec {
  readonly width: number;
  readonly height: number;
  /** Semicolon-separated rows of inclusive base-36 x ranges. */
  readonly rows: string;
}

/** Frozen buildable-coordinate masks. Revisions are append-only wire data. */
const MASK_REVISIONS: Readonly<Record<number, Readonly<Record<string, MaskSpec>>>> = {
  1: {
    hexia: {
      width: 169,
      height: 140,
      rows: ';;;;;;n-q,10-1a,1k-1o,1v-1w,25-27,33-38,3n-3o;j-2b,2j-2p,33-47;i-48;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-4a;h-49;h-49;h-49;g-49;g-49;g-49;g-49;g-49;g-4a;f-4a;f-4a;f-4a;f-49;f-49;f-48;f-48;f-48;f-48;f-48;f-48;f-48;f-48;f-48;f-48;f-49;g-49;g-49;g-49;g-48;g-48;g-48;g-48;g-48;g-48;g-48;g-48;g-48;g-48;f-24,2o-47;f-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;d-24,2o-47;d-24,2o-47;d-24,2o-48;d-24,2o-48;d-24,2o-48;d-24,2o-48;d-24,2o-48;e-24,2o-48;e-24,2o-48;e-24,2o-48;e-24,2o-48;e-24,2o-48;e-24,2o-49;e-49;e-49;e-49;e-49;e-49;e-48;d-48;d-48;d-48;d-48;d-48;d-48;e-48;e-48;e-48;e-48;e-48;e-49;e-49;e-49;e-49;e-49;e-49;e-49;e-49;e-48;e-48;e-48;e-48;d-48;d-48;d-48;d-48;d-48;e-48;e-48;e-48;f-48;l-n,v-z,14-48;1h-1l,26-2e,2p-48;2w-47;38-3f,40-44;;;;;;;;;;;;;',
    },
    tafa: {
      width: 169,
      height: 140,
      rows: ';;;32-33;32-39;2z-39;n-q,10-1a,1k-1o,1v-27,2y-39,3n-3o;j-2b,2j-2p,2y-47;i-48;h-4a;h-4a;h-4a;g-4a;g-4a;g-4a;g-4a;g-4a;g-4a;g-4a;g-4a;g-4a;g-49;g-49;g-49;g-49;g-49;g-49;g-49;g-49;g-49;f-4a;f-4a;f-4a;f-49;f-49;f-48;e-48;e-48;e-48;e-48;e-48;e-48;e-48;e-48;e-48;e-49;e-49;e-49;e-49;f-48;g-48;g-48;g-48;g-48;g-48;g-48;g-48;g-48;g-48;f-47;f-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;e-24,2o-47;d-24,2o-47;d-24,2o-47;d-24,2o-48;d-24,2o-48;d-24,2o-48;d-24,2o-48;d-24,2o-48;e-24,2o-49;e-24,2o-49;e-24,2o-49;e-24,2o-49;e-24,2o-49;e-24,2o-49;e-24,2o-49;e-49;e-49;e-49;e-49;e-48;e-48;f-48;f-48;f-48;f-48;g-48;g-48;g-48;g-48;g-48;g-48;f-49;f-49;f-49;f-49;f-49;e-49;e-49;e-49;e-48;e-48;e-48;e-48;d-48;d-48;d-48;d-48;d-48;e-48;e-48;e-48;f-48;l-n,s-z,14-16,1c-48;t-w,1c-1l,26-2e,2p-48;1e-1k,2t-47;2u-2y,38-3f,40-44;;;;;;;;;;;;;',
    },
  },
};

const CACHE = new Map<string, Uint8Array>();

/** Resolve a frozen mask only when its template identity and dimensions match. */
export function frozenTemplateMask(template: Pick<MapTemplate, 'id' | 'width' | 'height'>, revision: number): Readonly<Uint8Array> | null {
  const spec = MASK_REVISIONS[revision]?.[template.id];
  if (!spec || spec.width !== template.width || spec.height !== template.height) return null;
  const key = `${revision}:${template.id}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const rows = spec.rows.split(';');
  if (rows.length !== spec.height) throw new Error(`template-mask: invalid row count for ${template.id}`);
  const mask = new Uint8Array(spec.width * spec.height);
  rows.forEach((row, y) => {
    if (!row) return;
    for (const range of row.split(',')) {
      const [firstText, lastText] = range.split('-');
      const first = Number.parseInt(firstText!, 36);
      const last = lastText === undefined ? first : Number.parseInt(lastText, 36);
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= spec.width) {
        throw new Error(`template-mask: invalid range for ${template.id}`);
      }
      mask.fill(1, y * spec.width + first, y * spec.width + last + 1);
    }
  });
  CACHE.set(key, mask);
  return mask;
}
