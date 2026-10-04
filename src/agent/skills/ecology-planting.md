ECOLOGY PLANTING

WHEN TO USE: arranging beds, orchards, groves or a planting scheme. A request for a few precisely placed plants can use place_object directly.

PATTERNS TO ADAPT
- Bed: a coherent patch of one species or a deliberate limited palette. scatter_objects pattern "fill" packs eligible cells; match count to the intended bed area. A small shore clump can be only a few flowers.
- Row or orchard: scatter_objects pattern "grid" with step 2 or 3 makes repeated spacing. For exact counts and positions, place_object is easier to verify.
- Specimen: one tree or plant at an entrance, bend or viewpoint. Open space around it makes it readable; no surrounding bed is mandatory.
- Grove: plant_forest makes a varied stand with glades when the brief calls for woodland. Keep important paths and foreground views clear.

METHOD
1. Locate the requested planting area, existing plants and routes. Preserve them unless the user asked for replacement. Choose a palette that fits the existing scene and the user's preferences.
2. Reserve circulation and viewing space. Place taller trees behind a building or away from an important approach, lower beds in front or beside a destination. A waterside bed must have enough dry ground for each plant's footprint and placement margin.
3. Build the requested groups with bounded calls. Keep one group per call when the positions or species matter. Use explicit cells or placements if a scatter's eligible cells would distribute a bed too widely.
4. Read the placed/requested counts. If some plants were rejected, keep those already placed and fill only verified gaps. Do not clear and resow the bed.
5. Check counts and arrangement. Use get_objects or view_map if the result is unclear. Stop when the requested planting is complete.

TASTE
Coherent beds, rows and individual trees give a place structure. Vary the palette between areas while keeping each area readable. Natural mixed gardens and small clumps are valid when intentional; reference bed sizes and species ratios are not targets. Leave ground open when no further planting is needed.

DIAGNOSTICS
find_speckle is optional for reviewing a broad planting scheme. Inspect a relevant finding before acting: an intentional mixed group is not a defect. Correct individual plants when needed; clear_area also removes terrain and other objects and is inappropriate for ordinary bed cleanup.
