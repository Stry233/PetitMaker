/**
 * Illustration directions in display order. `fragment` is sent to image providers; `paper` and
 * `palette` render the local preview. `elementStyles` groups trees and flora as `plant` and derives
 * `water-feature` from terrain water, matching the categories emitted by the scene summarizer.
 */
export interface StylePack {
  id: 'watercolor' | 'coastal' | 'sakura' | 'autumn' | 'pencil' | 'fairytale' | 'inkwash' | 'vintage' | 'crayon' | 'night';
  /** Literal i18n key naming this direction (name); scanned as source text by the i18n drift test. */
  nameKey: string;
  fragment: string;        // English style fragment sent to the model
  paper: string;           // letterbox fill, hex
  palette: string[];       // 4-6 hex swatches driving fallback thumbnail art
  /** Per-category appearance clauses, emitted only for categories PRESENT on the map. */
  elementStyles: Partial<Record<string, string>>;
}

export const STYLE_PACKS: readonly StylePack[] = [
  {
    id: 'watercolor',
    nameKey: 'stylize.dir_watercolor',
    paper: '#F7F5EC',
    palette: ['#8A9A68', '#5C6B4A', '#C9AE83', '#D9A8A8', '#F7F5EC', '#A8C0AE'],
    fragment:
      'Muted watercolor on warm cream paper with a visible fine grain. A hushed palette of sage, moss and olive greens with dusty rose and blush accents. Paths in soft clay-brown brick. Trees as layered rounded canopies with delicate speckled blossom highlights; flower beds as dotted drifts. Water in pale celadon with fine hand-drawn contour lines. Gentle shadows, pressed-flower calm, vintage botanical mood.',
    elementStyles: {
      building: 'cottages in cream and warm timber with soft brown roofs',
      plant: 'tree crowns as layered rounded watercolor masses, never individual leaves',
      road: 'paths as soft clay-brown brick with irregular hand-drawn edges',
      'water-feature': 'water in pale celadon with fine contour lines',
    },
  },
  {
    id: 'coastal',
    nameKey: 'stylize.dir_coastal',
    paper: '#A9C7D8',
    palette: ['#A9C7D8', '#E9DFC8', '#77875B', '#41597E', '#F4F0E2', '#C8B98F'],
    fragment:
      'Airy seaside gouache. Dusty cornflower-blue water with tiny hand-drawn wave squiggles, sandy cream shores, olive and pine greens for palms and conifers. Cottages with slate-blue and navy roofs, white picket fences, weathered timber piers. Sun-bleached colors, fresh breezy light, calm holiday-postcard mood.',
    elementStyles: {
      building: 'cottages with slate-blue and navy roofs and white picket fences',
      plant: 'palms and pine conifers in olive and pine green as soft rounded masses',
      road: 'weathered timber piers and sandy cream shorelines standing in for paths',
      'water-feature': 'dusty cornflower-blue water with tiny hand-drawn wave squiggles',
    },
  },
  {
    id: 'sakura',
    nameKey: 'stylize.dir_sakura',
    paper: '#EFDFD6',
    palette: ['#F2C4C4', '#EFDFD6', '#6E7F5B', '#3E5240', '#FDF6F0', '#8C6F5A'],
    fragment:
      'Soft pastel spring illustration. Cherry blossoms as plump rounded pink puffs massed into clouds, warm blush-beige ground tone, deep matcha and forest greens beneath the pink. Simple white cottages, stone-gray steps and small shrine accents. Petal-strewn paths, tranquil hazy light, gentle storybook flatness.',
    elementStyles: {
      building: 'simple white cottages with stone-gray steps and small shrine accents',
      plant: 'cherry blossoms as plump rounded pink puffs massed into clouds over deep matcha and forest greens',
      road: 'petal-strewn paths in warm blush-beige tones',
    },
  },
  {
    id: 'autumn',
    nameKey: 'stylize.dir_autumn',
    paper: '#B0491F',
    palette: ['#B0491F', '#E8C46A', '#C23B22', '#E07B24', '#F2E3B8', '#6B4A2B'],
    fragment:
      'Cozy autumn harvest illustration. Pale golden-straw ground, muted and calm, never saturated orange; the strong color lives in the tree canopies: scarlet, pumpkin orange and amber masses with scattered fallen leaves. Water in soft grey-blue. Cream and timber cottages with warm brown roofs, split-rail fences, sunflowers and white daisies in the beds. Low warm afternoon light, harvest-festival mood.',
    elementStyles: {
      building: 'cream and timber cottages with warm brown roofs and split-rail fences',
      plant: 'tree canopies in scarlet, pumpkin orange and amber, massed with scattered fallen leaves rather than drawn leaf by leaf; sunflowers and white daisies filling the beds',
      road: 'golden straw paths across toasted rust-and-honey ground',
      'water-feature': 'water in soft muted grey-blue',
    },
  },
  {
    id: 'pencil',
    nameKey: 'stylize.dir_pencil',
    paper: '#F6F1E3',
    palette: ['#B8C4A2', '#D9A7A0', '#9DB3C8', '#C9BA8F', '#F6F1E3', '#6B5D4F'],
    fragment:
      'Colored-pencil illustration on lightly toothed cream paper. Soft directional pencil strokes with visible grain, gentle layered hatching, powdery muted colors with white paper breathing through. Edges sketched, never inked; shading built from strokes, not gradients. Warm handmade sketchbook mood.',
    elementStyles: {
      building: 'cottages sketched with fine pencil edges and softly hatched roofs',
      plant: 'tree crowns as round pencil-shaded masses with looping stroke texture',
      road: 'paths in warm ochre pencil, grain following their direction',
      'water-feature': 'water in pale layered blue strokes left airy at the center',
    },
  },
  {
    id: 'fairytale',
    nameKey: 'stylize.dir_fairytale',
    paper: '#FBF3DC',
    palette: ['#F5C74C', '#E98A79', '#7FC7A4', '#7FA8E0', '#FBF3DC', '#4A4038'],
    fragment:
      'Storybook cartoon with clean rounded dark-cocoa outlines and flat candy-bright fills. Simple bold shapes, thick friendly linework, soft two-tone shading only, big readable silhouettes. A cheerful picture-book page.',
    elementStyles: {
      building: 'houses as chunky rounded storybook cottages with bold outlines',
      plant: 'trees as simple lollipop crowns with one darker shade',
      road: 'paths as smooth outlined ribbons',
      'water-feature': 'water as flat bright blue with a single white outline wave',
    },
  },
  {
    id: 'inkwash',
    nameKey: 'stylize.dir_inkwash',
    paper: '#F7F4EA',
    palette: ['#54524E', '#A8C0BD', '#C9B891', '#DE9F8A', '#F7F4EA', '#7E937F'],
    fragment:
      'Fine-line ink drawing with loose watercolor washes. Confident thin sepia-ink contours over airy transparent color that escapes the lines, white paper showing between washes, urban-sketchbook looseness with delicate hatching in the shadows.',
    elementStyles: {
      building: 'cottages in fine ink contour with one loose wash of wall color',
      plant: 'foliage as scribbled ink loops under a single green wash',
      road: 'paths as two ink lines with a dry pale wash between',
      'water-feature': 'ponds as pale washes ringed by one fine ink line',
    },
  },
  {
    id: 'vintage',
    nameKey: 'stylize.dir_vintage',
    paper: '#E8D9B5',
    palette: ['#8A6F47', '#5C4B32', '#A98C5F', '#C3B08A', '#E8D9B5', '#6E7F6A'],
    fragment:
      'Antique cartographic illustration on aged parchment. Sepia and umber engraved linework, fine hatching for relief, muted heraldic color tints, gently darkened sheet edges, an atlas plate from an old library.',
    elementStyles: {
      building: 'buildings as small engraved elevations with hatched shadow',
      plant: 'woods as clustered engraved tree symbols',
      road: 'roads as double-ruled brown lines',
      'water-feature': 'water in fine parallel engraving lines tinted pale blue-green',
    },
  },
  {
    id: 'crayon',
    nameKey: 'stylize.dir_crayon',
    paper: '#FCF7E8',
    palette: ['#F2A65A', '#8AC1E3', '#F27E7E', '#93C77E', '#F7E48B', '#7C6BA8'],
    fragment:
      'Waxy crayon drawing full of childlike joy. Thick uneven crayon strokes that wobble and overlap, bright colors laid with visible pressure changes, paper white sparkling through the wax, playful naive shapes.',
    elementStyles: {
      building: 'houses with wobbling crayon walls and scribble-filled roofs',
      plant: 'trees as spiral-scribbled crowns',
      road: 'paths as chunky crayon bands with rough edges',
      'water-feature': 'water scribbled in two blues with waxy white gaps',
    },
  },
  {
    id: 'night',
    nameKey: 'stylize.dir_night',
    paper: '#26324B',
    palette: ['#26324B', '#F5C860', '#8FA6C9', '#3E5470', '#E08A4E', '#152238'],
    fragment:
      'Evening illustration at blue dusk. Deep indigo ambient light over the whole map, warm golden lamplight spilling from windows and lanterns along the paths, soft glows with gentle falloff, a calm festival night.',
    elementStyles: {
      building: 'cottages as dusk silhouettes with warmly lit windows',
      plant: 'trees as deep blue-green night masses',
      road: 'paths softly lit by a chain of warm lanterns',
      'water-feature': 'water as a dark mirror catching the lamplight',
    },
  },
];

export const CUSTOM_DIRECTION_ID = 'custom';
export type DirectionId = StylePack['id'] | typeof CUSTOM_DIRECTION_ID;
