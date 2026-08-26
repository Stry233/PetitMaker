SETTLEMENT DESIGN — every building is somebody's home, and the expert maps treat each one as its own small composed place.

WHEN TO USE: whenever you place buildings, regardless of style — hamlet, hillside town, waterfront.

WHO LIVES HERE
- The catalog's buildings are one-of-each (max=1): eight neighbor cabins (~5x4), building-myhouse (7x4), building-stall, plus facility-shop (7x7) and facility-pavilion (6x5). A settlement mixes DISTINCT buildings; there is no repeating a house style.
- ONE DISTRICT PER BUILDING: give each cabin its own small yard (a composed place is roughly 7x7 to 10x10 cells) with a theme of its own — a crop patch, a bamboo corner, a flower dooryard, a jetty. Never butt two cabins wall to wall; 4-8 cells of themed ground between neighbors.
- The plaza (the locked structure near map center) is the neighbor center. Populate its WHOLE ring: on the reference island building distances from the plaza run from 13 to 69 cells — a few close, a few far, none bunched.
- facility-shop and facility-pavilion are daily destinations: put them ON the trunk road. One or two homes may instead be deliberately secluded — reached only by a bridge or a dead-end spur — and those become the most memorable places on the map.

FACING AND BACKING (what makes it look inhabited)
- The door faces the view: open low ground, water, beds, the sea. The back gets the backing: higher terrain, a fall, or a tree stand 2-8 cells behind. Rotate the building (place_object rotation 0/90/180/270) to aim the front at the scenery, and only then build the backing behind it.
- Beside a building, plant FEW species repeated: 1-3 species within reach of the door, ideally as a mirrored pair flanking the entrance (4 trees each side is the reference's habit). A dooryard bed is one species, solid.
- Buildings sit happily on terraces: find_flat_areas with elevation=N finds bench spots, and a home one bench up with a view over the lower ground beats another home on the plain.

METHOD
1. Site: find_flat_areas for each footprint (it includes the flat trait's +1 margin, so returned anchors place cleanly). Choose spots at varied plaza distances and varied elevations.
2. Landmark first: the primary public building (shop or pavilion) at the heart, on flat open ground the trunk can reach.
3. Homes: place cabins one by one, each rotated toward its view, each with its yard theme decided. A rejection names the blocker — shift a few cells, never brute-force the same spot.
4. Roads: build_road_network to connect everything through validated crossings, then re-grade by hand (see the street-grammar skill): trunk 3 wide past shop/pavilion/plaza, 2-wide lanes to doors, and make at least two routes END at a door.
5. Yards: decorate_zone hamlet over the settlement body; garden or farm behind the back sides; then per-door species-pure beds and the mirrored entrance pairs with scatter_objects.
6. Edges: a loose tree band (spacing 2-3) where the settlement meets wild ground; leave every road approach open.

FAILURE MODES
- Grid barracks: equal spacing on shared rows reads as a camp. Stagger positions, vary rotations and plaza distances.
- Doors to nowhere: pavement should arrive within ~3 cells of most doors (the reference: 9 of 12 buildings). The exceptions must be deliberate seclusion, not oversight.
- Backing forgotten: a house with mass in FRONT of its door and open ground behind is composed backwards — rotate it or move the mass.
- Species soup at every door: one palette per place; the mixture belongs at region boundaries, not in a dooryard.

DONE CHECK: evaluate_map buildings and connectivity >= 6; every building either road-adjacent or deliberately spur-served; each home names its yard theme; at least one mirrored entrance pair on the map.
