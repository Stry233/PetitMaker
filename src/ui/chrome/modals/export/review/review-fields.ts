import type { TextField } from '../../../../../io/moderation/text/policy';

/** The label refusal feedback names each reviewed field by. */
export const REVIEW_FIELD_LABEL: Record<TextField, string> = {
  title: 'export.field_title',
  description: 'export.field_desc',
  footer: 'export.opt_footer',
  author: 'exportjson.author',
  // No export sentence names the planet: its name field shows its own refusal, `planet.review_refused`.
  planet: 'planet.name_field',
};
