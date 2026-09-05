// src/__tests__/i18n/export-keys-parity.test.ts
import { describe, it, expect } from 'vitest';
import { translations } from '../../i18n/translations';
const KEYS = [
  'export.title','export.field_title','export.field_desc','export.optional',
  'export.opt_badge','export.opt_layer','export.opt_3d','export.opt_grid','export.opt_footer',
  'export.shot_add','export.shot_delete','export.shot_edit_hint','export.use_this_view',
  'export.res_compact','export.res_standard','export.res_high','export.res_original',
  'export.btn_export','export.btn_cancel','export.exporting',
  'export.load_t','export.fail_t',
  'export.layer_ground','export.layer_level','export.card_3d','export.layers_title',
  'export.preset','export.preset_share','export.preset_plain',
  'export.preset_share_desc','export.preset_plain_desc',
  'export.sec_size','export.importability','export.importable','export.importable_sub','export.code_size_warn',
  'export.code_label','export.code_dense','export.code_too_small',
  'export.appearance',
  'export.preview_reset_hint',
  'export.tok_date','export.tok_time','export.tok_weekday','export.tok_peak','export.tok_seed','export.tok_dims','export.tok_name','export.tok_cells','export.tok_layers','export.tok_objects','export.tok_title','export.tok_brand',
  'export.tok_ai','export.tok_proc',
  'export.footer_fill','export.footer_fill_hint','export.footer_insert','export.footer_ph','export.footer_slash_hint','export.badge_help','export.badge_why',
  'toast.exported_image','toast.exported_embedded',
  'import.title','import.drop','import.paste_hint','import.busy','import.note','import.success','import.warn_template','import.warn_catalog','import.warn_section','import.warn_modified','import.fail_none','import.fail_future','import.fail_corrupt','import.fail_generic',
  'prov.badge_ai','prov.badge_proc',
  'exportjson.title','exportjson.core','exportjson.core_desc','exportjson.notes','exportjson.notes_desc',
  'exportjson.generation','exportjson.generation_desc','exportjson.no_generation',
  'exportjson.provenance','exportjson.provenance_desc','exportjson.no_provenance',
  'exportjson.history','exportjson.history_desc','exportjson.steps','exportjson.depth_all','exportjson.depth_last',
  'exportjson.session','exportjson.session_desc','exportjson.stats','exportjson.stats_desc',
  'exportjson.catalog','exportjson.catalog_desc','exportjson.pretty','exportjson.total',
  'exportjson.btn_export','exportjson.btn_cancel','exportjson.author',
  'exportjson.pretty_help',
];
describe('export i18n parity', () => {
  it('every export/prov key exists in every locale', () => {
    for (const locale of Object.keys(translations)) {
      const map = translations[locale as keyof typeof translations];
      for (const k of KEYS) expect(map[k], `${locale} missing ${k}`).toBeTruthy();
    }
  });
  it('never ships a negative AI label', () => {
    for (const locale of Object.keys(translations)) {
      const map = translations[locale as keyof typeof translations];
      for (const k of KEYS) expect(String(map[k]).toLowerCase()).not.toContain('no ai');
    }
  });
});
