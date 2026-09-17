SITE ANALYSIS — read the map and decide what the planet is ABOUT before the first edit. One analysis turn saves three correction turns.

WHEN TO USE: before any multi-stage build on a map you have not studied this session, before siting a large feature, or when your placements keep getting rejected.

WHAT TO READ (it is all in <map_context> — call inspect_region only for the exact cells you are about to edit)
- Scale: map width/height set every feature size. A village district is ~1/4 of the map span, a set-piece hill ~1/3, a composed place 7x7 to 10x10 cells. Sizing from habit instead of the map is the first way a build turns into a toy diorama.
- The plaza: the locked structure near the map center is the neighbor center — the hub circulation radiates from and the spot most views are judged from. Expert maps populate its whole ring: some features 15-20 cells out, some 50-70.
- Existing anchors: terrain masses, water bodies, buildings, road stubs. They are the design so far — extend their forms; fight one only with a deliberate reason.
- Levels: note where ground already rises. The token grid hides 1-step differences that invalidate flat placements, so verify elevation where you will build.
- Connections: where do roads end, where could a route cross water or climb? find_bridge_sites and find_ramp_sites give the legal answers; a plan whose areas cannot be linked is dead on arrival.

THE FOUR DECISIONS (make them before any edit — this is the brief)
1. SUBJECT AND DIALECT: one primary set piece the planet is about (a terraced backing wall, a cascade, a water figure, a lakeside town), then 2-3 secondary places, then ordinary ground — and the dialect it is built in, formal order or natural variety (the composition skill defines both). If everything is equally elaborate, nothing is the point.
2. AXIS: pick the map's back and front. High mass, falls and forest go to the back band; the low open half holds the plaza, buildings and beds. Near low, far high — buildings face the open side and are backed by the mass.
3. GROUND PLAN: which regions exist and what theme each carries (one theme per region — an orchard, a flower quarter, a waterside terrace, a hamlet). Leave real emptiness around the primary feature so it stands clear.
4. CIRCULATION: where the trunk road runs (it should pass the plaza, the shop and the pavilion), where it climbs, and which 1-2 places are reached only by their own dead-end spur.

THEN: update_plan with 3-6 stages in build order (terrain -> water -> buildings -> roads -> planting is the reliable order), each label a short noun phrase. Only then start stage 1.

FAILURE MODES
- Building on the only flat connector between two areas — you sever the future route. Check crossings first.
- Ignoring the plaza: a build crammed into one far corner with the hub unrelated to it reads as an outpost, not a planet.
- Assuming flat: a 1-step elevation difference under a 5x4 footprint rejects the placement. find_flat_areas instead of guessing.
- Scouting forever: one read of <map_context>, at most one inspect_region per area, then commit to the brief and build.

DONE CHECK: the plan names the subject, the back/front axis, each region's theme, and the trunk route — before the first write tool runs.
