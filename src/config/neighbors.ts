import type { LocalizedName } from '../core/model/locale';

/** The game's neighbours whose portraits ship verbatim beside the catalog art (`assets/neighbors/<id>-icon.png`),
 *  with their localized names. */
export const NEIGHBORS: readonly { id: string; name: LocalizedName }[] = [
  { id: 'dorjelang', name: { en: 'Dorjelang', zh: '多杰朗', ja: 'ドジェロ', ru: 'Дорджеланг', th: 'ดอร์เจลาง', id: 'Dorjelang', fr: 'Dorjelang' } },
  { id: 'elsasani', name: { en: 'Elsasani', zh: '艾莎莎尼', ja: 'エササーニ', ru: 'Эльзасани', th: 'เอลซาซานี', id: 'Elsasani', fr: 'Elsasani' } },
  // Frostia's recorded names cover English, Chinese and Japanese only; the other locales read the English.
  { id: 'frostia', name: { en: 'Frostia', zh: '幻雪', ja: 'フロスティア' } },
  { id: 'glenn', name: { en: 'Glenn', zh: '格连', ja: 'グレン', ru: 'Гленн', th: 'เกล็น', id: 'Glenn', fr: 'Glenn' } },
  { id: 'harpeno', name: { en: 'Harpeno', zh: '哈佩诺', ja: 'ハーペノ', ru: 'Харпено', th: 'ฮาร์เปโน', id: 'Harpeno', fr: 'Harpeno' } },
  { id: 'heyu', name: { en: 'Heyu', zh: '鹤玉', ja: 'ホーユイ', ru: 'Хэюй', th: 'เฮ่ออวี้', id: 'Heyu', fr: 'Heyu' } },
  { id: 'isaki', name: { en: 'Isaki', zh: '伊佐奇', ja: 'イサキ', ru: 'Исаки', th: 'อิซากิ', id: 'Isaki', fr: 'Isaki' } },
  { id: 'manna', name: { en: 'Manna', zh: '蛮蛮', ja: 'マーナ', ru: 'Манна', th: 'แมนนา', id: 'Manna', fr: 'Manna' } },
  { id: 'medowlyn', name: { en: 'Medowlyn', zh: '绵朵莉', ja: 'メードリン', ru: 'Мэдоулин', th: 'เมโดว์ลิน', id: 'Medowlyn', fr: 'Medowlyn' } },
  { id: 'mobai', name: { en: 'Mobai', zh: '莫白', ja: 'モーバ', ru: 'Мобай', th: 'ไม่ป้าย', id: 'Mobai', fr: 'Mobai' } },
  { id: 'mors', name: { en: 'Mors', zh: '墨尔斯', ja: 'モルス', ru: 'Морз', th: 'มอร์ส', id: 'Mors', fr: 'Mors' } },
  { id: 'msafiri', name: { en: 'Msafiri', zh: '萨飞里', ja: 'サフィール', ru: 'Мсафири', th: 'มาซาฟิริ', id: 'Msafiri', fr: 'Msafiri' } },
  { id: 'nerina', name: { en: 'Nerina', zh: '纳蕾娜', ja: 'ネレイナ', ru: 'Нерина', th: 'เนริน่า', id: 'Nerina', fr: 'Nerina' } },
  { id: 'rebella', name: { en: 'Rebella', zh: '热贝尔', ja: 'リベーラ', ru: 'Ребелла', th: 'เรเบลล่า', id: 'Rebella', fr: 'Rebella' } },
  { id: 'tika', name: { en: 'Tika', zh: '缇卡', ja: 'ティカ', ru: 'Тика', th: 'ทิก้า', id: 'Tika', fr: 'Tika' } },
  { id: 'trixie', name: { en: 'Trixie', zh: '鹊可', ja: 'トリクシー', ru: 'Трикси', th: 'ทริกซี่', id: 'Trixie', fr: 'Trixie' } },
  { id: 'yunguo', name: { en: 'Yunguo', zh: '云果', ja: 'ユンカ', ru: 'Юньго', th: 'อวิ๋นกั่ว', id: 'Yunguo', fr: 'Yunguo' } },
];
