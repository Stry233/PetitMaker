STREET GRAMMAR — roads are a settlement's streets, with grades, junctions and arrivals; a lattice of equal paths is the tell of a machine.

WHEN TO USE: any road work beyond a single doorstep path — connecting a settlement, gridding a town, paving a climb; also when evaluate_map roads or connectivity is weak.

THE GRADE LADDER (measured from the expert maps)
- TRUNK: 3 wide (build_road line with width 3), ONE continuous route that passes the daily destinations — the plaza (neighbor center), facility-shop, facility-pavilion — and keeps going, widening to 4-6 only at approaches and squares.
- BRANCH: 2 wide, leaving the trunk toward each district and most doors. Trunk and branch carry roughly equal length overall.
- PATH: 1 wide is RARE (about 5% of pavement) and means one thing: a stepping-stone garden walk (path-garden-stone through a garden). Never build the network out of 1-wide paths.
- MATERIAL: one material carries ~90% of the network (path-rustic-dirt is the humble default); other materials are accents AT places — a brick forecourt at the shop, a stone square at the plaza, slate stones in the garden.

JUNCTIONS AND LINE
- Prefer T-junctions, Y-forks and OFFSET crossings (split a would-be crossroads into two T-junctions a few cells apart, a Z-shaped jog) over four-way crossings; avoid any large regular grid.
- Never let one direction run too long: insert a bend, a jog around a tree stand, or a pinch between a hedge and a terrace edge. The route should alternate tight and open.
- A road cell needs its right and bottom neighbors level and dry (the flat trait checks a +1 margin), so pavement stops one cell short of a south/east cliff lip or waterline — end the road there and let the crossing take over.

ARRIVAL (what makes a network feel designed)
- Streets must ARRIVE, not only pass: give the map ~6 terminal spurs, each ENDING within a couple of cells of something — a door, a lookout, a waterside platform, a composed pond. A dead end at nothing is a bug; a dead end at a destination is a place.
- Make 1-2 destinations reachable ONLY by their spur (a peninsula over one bridge, a summit court up one ramp line). Seclusion is a feature the through-grid cannot fake.

THE WALK MUST CLIMB
- On any terraced map, route streets ACROSS the benches, not around the mass: pave the benches themselves and stitch levels inline. Every catalog ramp climbs exactly one layer, so a climb of N layers is N ramps — find_ramp_sites per transition, place_object at returned anchors, alternating faces so the route switchbacks. Expert terraced maps run ~10 ramps per bridge and mix ramp styles (ramp-teak-stair, ramp-plank, ramp-moss-ramp...).
- Bridges: find_bridge_sites first, always (a legal site needs a straight 3-6 cell gap with flat equal banks; bridge-plank is the 1-wide deck, the others are 2-wide). frame_crossing realizes the nearest crossing and dresses both ends — use it to make one crossing an event.

METHOD
1. Bootstrap: build_road_network routes everything through validated crossings in one call — a correct network, but an ungraded one.
2. Grade it: widen the trunk route to 3 with parallel build_road lines along the main run; confirm shop, pavilion and plaza sit on it.
3. Rework junctions: clear_area a crossroads and relay it as two offset Ts where the grid feels engineered.
4. Add the spurs: 2-wide dead-end runs to doors, lookouts and water — the arrivals the router does not invent.
5. Climb: pave the benches, then ramps at staggered faces per level.

FAILURE MODES
- Perimeter ring + inner grid: every building on a through street, nothing arrived at. Break the ring, add spurs.
- Uniform width everywhere: no hierarchy, no order. The trunk must be visibly wider than the lanes.
- Roads fighting terrain: pavement that dead-ends into a cliff face mid-run means the bench plan and the street plan were made separately — plan them together.

DONE CHECK: one continuous 3-wide trunk through the destinations; 2-wide lanes; spurs that end AT things; on terraced ground the route changes level several times; evaluate_map connectivity >= 8.
