// The layout condition's legend: the flat colour each kind of ground or object fills, and the words
// the prompt describes it with. The segmentation image and the prompt's layout label both read it.

/** Each legend kind's colour, its name and what it marks, in the order the prompt lists them. */
const KINDS = {
  plant: { hex: '#2E8B57', colour: 'green', marks: 'trees' },
  water: { hex: '#3B7BD4', colour: 'blue', marks: 'water' },
  building: { hex: '#D94F4F', colour: 'red', marks: 'buildings' },
  road: { hex: '#B98A5A', colour: 'tan', marks: 'roads' },
  ground: { hex: '#EFE3B8', colour: 'cream', marks: 'open ground' },
  bridge: { hex: '#8A5AB9', colour: 'purple', marks: 'bridges' },
} as const;

type Kind = keyof typeof KINDS;

/** The fill colour of each legend kind. */
export const LEGEND = Object.fromEntries(Object.entries(KINDS).map(([kind, { hex }]) => [kind, hex])) as { readonly [K in Kind]: (typeof KINDS)[K]['hex'] };

/** The legend in words: "green means trees, blue water, ...". */
export const LEGEND_WORDS = Object.values(KINDS)
  .map(({ colour, marks }, i) => (i === 0 ? `${colour} means ${marks}` : `${colour} ${marks}`))
  .join(', ');
