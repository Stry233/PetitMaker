import type { LocalizedName } from '../core/model/locale';

/** A neighbour as the game describes them, for dressing their home: the house of theirs the catalog
 *  carries, their role, what they love and like, and the game's words for their house. */
interface NeighborProfile {
  house: string;
  role: string;
  loves: readonly string[];
  likes: readonly string[];
  home?: string;
}

/** The game's neighbours whose portraits ship verbatim beside the catalog art (`assets/neighbors/<id>-icon.png`),
 *  with their localized names. Profiles follow each neighbour's Petit Planet Wiki page as read on
 *  2026-11-20 (Heyu's, Manna's and Tika's on 2026-11-23); Msafiri's, Harpeno's, Heyu's and Tika's
 *  pages were confirmed for the third closed beta when read. */
export const NEIGHBORS: readonly { id: string; name: LocalizedName; profile?: NeighborProfile }[] = [
  { id: 'dorjelang', name: { en: 'Dorjelang', zh: '多杰朗', ja: 'ドジェロ', ru: 'Дорджеланг', th: 'ดอร์เจลาง', id: 'Dorjelang', fr: 'Dorjelang' },
    profile: {
      house: 'building-boat-cabin', role: 'a hatmaker',
      loves: ['his hatmaking chest'], likes: ['red', 'orange', 'romance', 'natural fibre', 'headwear'],
      home: 'He pictures his home as a tiny raft on the plateau under a straw hat, sailing with the clouds toward the burning sunset.',
    } },
  { id: 'elsasani', name: { en: 'Elsasani', zh: '艾莎莎尼', ja: 'エササーニ', ru: 'Эльзасани', th: 'เอลซาซานี', id: 'Elsasani', fr: 'Elsasani' } },
  // Frostia's recorded names cover English, Chinese and Japanese only; the other locales read the English.
  { id: 'frostia', name: { en: 'Frostia', zh: '幻雪', ja: 'フロスティア' } },
  { id: 'glenn', name: { en: 'Glenn', zh: '格连', ja: 'グレン', ru: 'Гленн', th: 'เกล็น', id: 'Glenn', fr: 'Glenn' } },
  { id: 'harpeno', name: { en: 'Harpeno', zh: '哈佩诺', ja: 'ハーペノ', ru: 'Харпено', th: 'ฮาร์เปโน', id: 'Harpeno', fr: 'Harpeno' },
    profile: {
      house: 'building-starbay-cabin', role: 'a Starsea patrol officer',
      loves: ['harbour signal lights'], likes: ['wood', 'glasses', 'many colours'],
      home: 'A harbour amid the boundless expanse where a guiding beacon twinkles day and night, so you never lose your way home.',
    } },
  { id: 'heyu', name: { en: 'Heyu', zh: '鹤玉', ja: 'ホーユイ', ru: 'Хэюй', th: 'เฮ่ออวี้', id: 'Heyu', fr: 'Heyu' },
    profile: {
      house: 'building-pine-cabin', role: 'a hot spring innkeeper',
      loves: ['a crane calligraphy set', 'di san xian', 'a tea stove'], likes: ['white', 'black', 'dessert', 'bathtubs', 'water features'],
    } },
  { id: 'isaki', name: { en: 'Isaki', zh: '伊佐奇', ja: 'イサキ', ru: 'Исаки', th: 'อิซากิ', id: 'Isaki', fr: 'Isaki' },
    profile: {
      house: 'building-forest-cabin', role: 'a battle-beetle trainer',
      loves: ['kabuto beetles', 'a rustic dog house'], likes: ['beetles', 'yellow', 'street decor', 'wood', 'sport'],
      home: 'A cozy house of natural charm, dressed in lush greenery that insects love.',
    } },
  { id: 'manna', name: { en: 'Manna', zh: '蛮蛮', ja: 'マーナ', ru: 'Манна', th: 'แมนนา', id: 'Manna', fr: 'Manna' },
    profile: {
      house: 'building-peach-cabin', role: 'an action actor',
      loves: ['a wooden training dummy', 'plum blossom poles', 'a projector'], likes: ['black', 'white', 'fruit', 'slippers'],
    } },
  { id: 'medowlyn', name: { en: 'Medowlyn', zh: '绵朵莉', ja: 'メードリン', ru: 'Мэдоулин', th: 'เมโดว์ลิน', id: 'Medowlyn', fr: 'Medowlyn' },
    profile: {
      house: 'building-plush-cabin', role: 'a plushie designer',
      loves: ['wild grass', 'cloud plushies'], likes: ['plushies', 'blue', 'white', 'flowers'],
      home: 'A fluffy, cloud-like house she imagined while gazing at the sky, where she lives with her plushie friends.',
    } },
  { id: 'mobai', name: { en: 'Mobai', zh: '莫白', ja: 'モーバ', ru: 'Мобай', th: 'ไม่ป้าย', id: 'Mobai', fr: 'Mobai' } },
  { id: 'mors', name: { en: 'Mors', zh: '墨尔斯', ja: 'モルス', ru: 'Морз', th: 'มอร์ส', id: 'Mors', fr: 'Mors' } },
  { id: 'msafiri', name: { en: 'Msafiri', zh: '萨飞里', ja: 'サフィール', ru: 'Мсафири', th: 'มาซาฟิริ', id: 'Msafiri', fr: 'Msafiri' },
    profile: {
      house: 'building-sunset-cabin', role: 'an adventure guide of the golden savanna',
      loves: ['haystacks', 'potted cactus', 'tumbleweed'], likes: ['brown', 'natural fibre'],
      home: 'It glows with the colours of the most beautiful sunset on the savanna, a beacon and an anchor he always returns to.',
    } },
  { id: 'nerina', name: { en: 'Nerina', zh: '纳蕾娜', ja: 'ネレイナ', ru: 'Нерина', th: 'เนริน่า', id: 'Nerina', fr: 'Nerina' },
    profile: {
      house: 'building-wave-cabin', role: 'a composer who sings by the sea',
      loves: ['a seaside music stand'], likes: ['seashells', 'blue', 'artistry'],
      home: 'A house of soothing melody with flowers under blue-purple eaves, the summer seaside she holds dear.',
    } },
  { id: 'rebella', name: { en: 'Rebella', zh: '热贝尔', ja: 'リベーラ', ru: 'Ребелла', th: 'เรเบลล่า', id: 'Rebella', fr: 'Rebella' },
    profile: {
      house: 'building-fluorite-cabin', role: 'a gemsmith who asks the stones for luck',
      loves: ['goldflux ore'], likes: ['green', 'teal', 'stone'],
    } },
  { id: 'tika', name: { en: 'Tika', zh: '缇卡', ja: 'ティカ', ru: 'Тика', th: 'ทิก้า', id: 'Tika', fr: 'Tika' },
    profile: {
      house: 'building-orchard-cabin', role: 'an agriculture student',
      loves: ['avocados', 'cat-eye sunglasses', 'fruit donuts', 'a planter box'], likes: ['yarn', 'wood', 'green', 'tree fruit', 'farm decor'],
    } },
  { id: 'trixie', name: { en: 'Trixie', zh: '鹊可', ja: 'トリクシー', ru: 'Трикси', th: 'ทริกซี่', id: 'Trixie', fr: 'Trixie' } },
  { id: 'yunguo', name: { en: 'Yunguo', zh: '云果', ja: 'ユンカ', ru: 'Юньго', th: 'อวิ๋นกั่ว', id: 'Yunguo', fr: 'Yunguo' },
    profile: {
      house: 'building-bamboo-cabin', role: 'a cultivator',
      loves: ['apples', 'bamboo logs'], likes: ['bamboo', 'farm decor', 'green', 'red', 'fertilizer'],
      home: 'She misses leaning by the window in the sun, listening to wind chimes and the scent of bamboo leaves, awaiting another bountiful harvest.',
    } },
];
