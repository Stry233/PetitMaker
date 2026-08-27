ECOLOGY PLANTING — plant at exactly TWO grains, the bed and the specimen. The middle grain (little 4-7 plant clumps everywhere) is what makes a map read as generated dust; the expert maps almost never use it.

WHEN TO USE: any planting pass, after terrain and buildings are settled; also when view_map shows pink speckle outlining every edge.

THE TWO GRAINS
- THE BED: one species, solid block. The reference habit is a 5x6 bed of 30 flowers (scatter_objects pattern "fill" with ONE catalogId, rect 5x6, count 30); fields scale the same move up. A two-species bed is already a mixture — keep beds pure and let COLOR do the theming (flower-daisy-yellow, flower-sunflower, flower-rose, flower-violet-pink, plant-azalea...).
- THE ORCHARD: one tree species on an open lattice, 18-48 trees in a rect from 11x5 to 23x7 — scatter_objects pattern "grid" step 2 (or 3 for a looser grove) with one tree id lays the even rows the reference orchards wear.
- THE SPECIMEN: a single deliberate placement (place_object, or scatter count 1) — one tree beside a door, one at the tip of a peninsula, one on the lookout. Specimens only work because the beds exist; contrast between the grains is what makes either legible.
- Nothing in between. Replace every "sprinkle a few here" urge with "draw a bed of size S, or place one specimen" — and for open ground you are not composing, the right planting is ONE specimen and a lot of nothing: a lone tree marking deliberate emptiness beats any density of scatter.

ONE PALETTE PER PLACE
- Each region commits to 1-2 species; the VARIETY lives between regions, not inside one. Map-wide, no flower species should dominate unless that is the style (a garden-town can commit half its planting to one yellow field on purpose — but then that is the map's one big statement, not a default).
- Elevation bands keep it natural: waterside flowers along banks, broadleaf and fruit trees (tree-peach, tree-apple, tree-plum) on the working benches, conifers (tree-fir) and bare rock up high. Trees-to-flowers is roughly 1:1 on a terraced map and can run to 1:6 on a flat garden map.

WHERE PLANTS STAND
- Beds sit INSIDE regions (a courtyard, a bench, a clearing), not strung along every street. On the terraced reference only ~15% of plants touch pavement. The opposite dialect — a 1-wide flower border escorting the streets in alternating colors — is legitimate for a formal garden-town look, but choose one dialect per map, never both.
- Lines are deliberate in the natural dialect: a single-species row of 6-10 lining ONE approach is an event; rows along everything are noise. In the FORMAL dialect the edging ribbon along every street IS the style — one species per straight run, alternating run by run — and crop PLOTS (solid one-color rectangles side by side, one call each) and the islet grid (one species over a pool's islet lattice) are its field patterns.
- Wild slopes, NATURAL DIALECT ONLY: plant_forest (rect + density 0.4-0.7) plants layered mixed stands with glades — on a FORMAL map its drift is the exact noise the dialect forbids, so there it touches nothing but ground outside the composition (a backing wall's flanks); formal ground gets lattices, fills and specimens or stays lawn. Never hand-scatter on top of a stand. Leave summits and the primary feature's surroundings nearly bare.

METHOD
1. Decide the palette per region first (write it in the plan): which species owns each place.
2. plant_forest the wild areas (backing slopes, map edges), density lower near the built areas.
3. Beds: one scatter_objects call per bed, one species each, placed at the spots people look at (in front of doors, beside the plaza, at a pond's viewing side).
4. Orchards/rows: one species per block or line, at region scale.
5. Specimens last, at the composition's focal points.
6. END EVERY PLANTING PASS WITH find_speckle and clear or replant each patch it names BEFORE moving to the next stage — a sweep saved for the deathbed meets the turn cap instead (a live run was handed 12 noisy rects at turn 68 and could fix none). After a clean sweep, STOP.

FAILURE MODES
- One scatter over the whole map: confetti by construction. Every call gets a small rect and one species.
- Outlining: tracing building footprints and road edges with plants makes nothing an accent because everything is.
- Planting over a future road line — roads need flat clear cells; lay routes first or keep corridors clear.
- Density chasing: evaluate_map decoration saturates around 7-8; past that you are deleting negative space, not adding beauty.

DONE CHECK: every planted area is nameable as a bed, an orchard, a row, a forest stand, or a specimen; each region reads as one palette; the map still has large deliberately empty ground.
