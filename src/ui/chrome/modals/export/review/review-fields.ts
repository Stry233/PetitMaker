import type { TextField } from '../../../../../pipelines/moderation';
import type { I18nKey } from '../../../../../i18n/keys';

/** The label refusal feedback names each reviewed field by. */
export const REVIEW_FIELD_LABEL: Record<TextField, I18nKey> = {
  title: 'export.field_title',
  description: 'export.field_desc',
  footer: 'export.opt_footer',
  // No export sentence names the planet: its name field shows its own refusal, `planet.review_refused`.
  stencil: 'generate.kind_text',
  planet: 'planet.name_field',
  // A custom note tag's field shows its own refusal, `annot.tag_refused`.
  tag: 'annot.tag',
  // A blueprint's imported texts are checked in the background and never named in an export refusal.
  'blueprint-name': 'blueprint.field_name',
  'blueprint-author': 'blueprint.field_author',
  'blueprint-folder': 'blueprint.field_folder',
};
