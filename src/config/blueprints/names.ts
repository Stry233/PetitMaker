/** The names of the app's own blueprints and folders, shown in the interface language. */
import type { I18nKey } from '../../i18n/keys';

/** The name of each of the app's own folders: the examples, the player's own, an author's blueprints
 *  (with the author as `{author}`), an anonymous author's, and the one blueprints set aside for
 *  deletion are filed under. */
export const FOLDER_NAMES = {
  examples: 'blueprint.examples_folder',
  mine: 'blueprint.my_folder',
  author: 'blueprint.author_folder',
  anonymous: 'blueprint.anonymous_folder',
  pendingDelete: 'blueprint.pending_delete_folder',
} as const satisfies Record<string, I18nKey>;

/** The name key of each example, by its record id. */
export const EXAMPLE_BLUEPRINT_NAMES: Readonly<Record<string, I18nKey>> = {
  'example-tree-bed': 'blueprint.example_tree_bed',
  'example-garden-steps': 'blueprint.example_garden_steps',
  'example-flower-garden': 'blueprint.example_flower_garden',
  'example-pond-bridge': 'blueprint.example_pond_bridge',
  'example-hilltop-cottage': 'blueprint.example_hilltop_cottage',
  'example-orchard': 'blueprint.example_orchard',
  'example-waterfall-garden': 'blueprint.example_waterfall_garden',
  'example-stream-crossing': 'blueprint.example_stream_crossing',
  'example-terraced-hill': 'blueprint.example_terraced_hill',
  'example-village-square': 'blueprint.example_village_square',
  'example-desert-oasis': 'blueprint.example_desert_oasis',
  'example-sports-field': 'blueprint.example_sports_field',
};
