import { describe, it, expect } from 'vitest';
import { translations } from '../_support/locale-tables';
const KEYS = [
  'export.field_title','export.field_desc','export.optional',
  'export.opt_badge','export.opt_layer','export.opt_3d','export.opt_grid','export.opt_footer',
  'export.shot_add','export.shot_delete','export.shot_edit_hint','export.use_this_view',
  'export.res_compact','export.res_standard','export.res_high','export.res_original',
  'export.btn_export','export.btn_cancel','export.exporting',
  'export.load_t','export.fail_t',
  'export.card_3d','export.layers_title',
  'export.preset','export.preset_share','export.preset_plain',
  'export.preset_share_desc','export.preset_plain_desc',
  'export.sec_size','export.importability','export.importable','export.importable_sub','export.code_size_warn',
  'export.code_label','export.code_dense','export.notes_omitted','export.code_too_small',
  'export.appearance',
  'export.preview_reset_hint',
  'export.tok_date','export.tok_time','export.tok_weekday','export.tok_peak','export.tok_seed','export.tok_dims','export.tok_name','export.tok_cells','export.tok_layers','export.tok_objects','export.tok_title','export.tok_brand',
  'export.tok_ai','export.tok_proc',
  'export.footer_fill','export.footer_fill_hint','export.footer_insert','export.footer_ph','export.footer_slash_hint','export.badge_help','export.badge_why',
  'toast.exported_image','toast.exported_embedded',
  'import.title','import.drop','import.paste_hint','import.busy','import.note','import.success','import.warn_template','import.warn_catalog','import.warn_section','import.warn_modified','import.fail_none','import.fail_future','import.fail_corrupt','import.fail_generic',
  'export.badge_ai','export.badge_proc',
  'export.json_core','export.json_core_desc','export.json_notes','export.json_notes_desc',
  'export.json_generation','export.json_generation_desc','export.json_no_generation',
  'export.json_provenance','export.json_provenance_desc','export.json_no_provenance',
  'export.json_history','export.json_history_desc','export.json_depth_all','export.json_depth_last',
  'export.json_session','export.json_session_desc','export.json_stats','export.json_stats_desc',
  'export.json_catalog','export.json_catalog_desc','export.json_pretty','export.json_total',
  'export.json_btn_export','export.json_btn_cancel',
  'export.json_pretty_help',
];
describe('export copy', () => {
  it('never ships a negative AI label', () => {
    for (const locale of Object.keys(translations)) {
      const map = translations[locale as keyof typeof translations];
      for (const k of KEYS) expect(String(map[k]).toLowerCase()).not.toContain('no ai');
    }
  });
});
