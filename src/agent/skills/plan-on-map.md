PLAN ON THE MAP

WHEN TO USE: a layout across several areas or the whole island, or an order asking for a plan. Draw it with set_annotation before any terrain or object edit; the written plan is a short legend. Stages 1 to 3 are thinking, not calls. To build from annotations later, load build-from-plan.

1. SITE: from the map context take the open ground, the fixed structures (the plaza and every other arrival point, such as a station), the coast, existing terrain and standing annotations (the user's requirements: plan around them, never change them unless asked). The planned area is the selection when there is one; an order for the island, the map or a place on it as a whole (a village, a park, a farm island) plans all of its open ground; only an order for one spot or feature (a picnic spot, a corner, a single garden) gets a small plan there.

2. PROGRAMME TABLE, for every function asked and the support it needs:
- instances: what comes in numbers is several parcels. Homes are plots in clusters of three to six around a lane or green; fields and orchards are strips or blocks; forest is belts and groves; water is several pieces, each with a job. A venue (cafe, library, stage) is one parcel; one that serves several districts may repeat. Never promise more of an item than its catalog max allows.
- size, from what will stand there: a home plot is its house plus a yard and a margin, a venue its building plus a forecourt; the main attraction gets the most room.
- totals: paths take a tenth to a fifth of the planned ground and parcels share the rest; a whole island is usually one parcel per few hundred cells, no parcel a large share unless it is the main attraction. Leftover ground never becomes one catch-all zone; reserved means kept free on purpose.

3. ADJACENCY: homes with gardens and a short walk to services; cafes and shops on a main route or at the plaza; farms with orchards and water; a sequence the order names in order along one walk. Noisy uses (stages, markets) away from homes, rest areas and libraries, with a path, forest belt or water between. Forest along the coast and between conflicts; quiet places at branch ends.

4. PATHS FIRST, as zones tagged entrance (never a customTag): a main route 4 to 5 wide joining the plaza to every arrival point and crossing the area; branches 2 to 3 wide that cut the ground into blocks a parcel or two deep, so every parcel will front a path; lanes 1 to 2 wide into clusters. Every path joins another. A walk or loop is itself a zone (a ring or a closed band for a loop); a route arrow only adds direction to a drawn path. One zone per route or level, numbered first; band and polygon shapes follow the coast and the ground.

5. BLOCKS INTO PARCELS: divide each block between paths into parcels that meet the paths and each other edge to edge: neighbouring rects share an edge (one ends at x, the next starts at x+1), a polygon follows a diagonal path, fill with a box takes what a block has left. Draw generously over paths and coast: clip keeps unclaimed open ground only, so paths stay whole. Edges mostly straight along paths and coast; no slivers unless a channel or hedge on purpose. Blocks take the size of what they hold: an even grid of identical blocks means the programme did not size them.

6. ASSIGN the programme to blocks by adjacency, each function in its instance count.

7. REFINE: water with jobs (a focus pond, channels between plots, irrigation by fields), forest belts as edges and buffers, a readable forecourt at the plaza, chips only for points (a viewpoint, a gate), routes only where direction matters.

8. CHECK with get_annotations against the table and the survey: the survey's count by label matches each item's instances (a dozen homes in clusters is a dozen plots, not three blocks); the main route reads 4 to 5 wide in the survey, branches 2 to 3; every parcel touches a path (extend one with mode add); edges facing open unplanned ground, or unplanned pieces inside the area, mean the tiling is unfinished; split an oversized parcel; cut overlaps; one colour per label.

9. FILE update_plan with stages naming zone numbers ("Main route #1-#3", "Homes #8-#13"). Filing is how the user approves the drawing; do not ask in text.

LEGIBILITY: one colour per function (every forest one green, every path one grey); different facilities, different colours. Facilities take a customTag in the user's language, generic functions a preset. Number in reading order. Size s on a dense plan or a small area; paths in a plan of more than a dozen zones take size none, so their captions do not crowd the parcels; in a row of plots too narrow for their caption, one plot per cluster keeps it. No chip as a label, no label on the fixed plaza.
