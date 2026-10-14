/* The preset planning vocabulary a note's tag names; `i18n/annotation-tags.ts` gives each its label. */
import type { I18nKey } from '../i18n/keys';

/** The preset planning ids. A note carries one of these or a map's own custom tag. */
export type TagId =
  | 'homes' | 'shops' | 'workshop' | 'farm' | 'orchard' | 'ranch' | 'garden'
  | 'forest' | 'plaza' | 'landmark' | 'dock' | 'water' | 'entrance' | 'reserved';

export interface AnnotationTag {
  id: TagId;
  labelKey: I18nKey;
  /** Retained for saved notes, omitted from the creation picker. */
  legacy?: boolean;
}

/** The tag a new zone or chip carries until another is armed. */
export const DEFAULT_TAG: TagId = 'homes';

export const ANNOTATION_TAGS: readonly AnnotationTag[] = [
  { id: 'homes', labelKey: 'annot.tag_homes' },
  { id: 'shops', labelKey: 'annot.tag_shops' },
  { id: 'workshop', labelKey: 'annot.tag_workshop', legacy: true },
  { id: 'farm', labelKey: 'annot.tag_farm' },
  { id: 'orchard', labelKey: 'annot.tag_orchard' },
  { id: 'ranch', labelKey: 'annot.tag_ranch', legacy: true },
  { id: 'garden', labelKey: 'annot.tag_garden' },
  { id: 'forest', labelKey: 'annot.tag_forest' },
  { id: 'plaza', labelKey: 'annot.tag_plaza' },
  { id: 'landmark', labelKey: 'annot.tag_landmark' },
  { id: 'dock', labelKey: 'annot.tag_dock' },
  { id: 'water', labelKey: 'annot.tag_water' },
  { id: 'entrance', labelKey: 'annot.tag_entrance' },
  { id: 'reserved', labelKey: 'annot.tag_reserved' },
];

export const SELECTABLE_ANNOTATION_TAGS = ANNOTATION_TAGS.filter((tag) => !tag.legacy);

export const TAG_IDS: readonly TagId[] = ANNOTATION_TAGS.map((t) => t.id);

export function isTagId(v: unknown): v is TagId {
  return typeof v === 'string' && (TAG_IDS as readonly string[]).includes(v);
}
