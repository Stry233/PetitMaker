# Building rules

This area lists the building rules the editor enforces so that every map can be rebuilt in the game, one requirement per rule under the rule's own id. Heights are counted in levels above the ground; the layer numbers the editor shows follow the game, which numbers the ground as layer 1, so a block one level above the ground is on layer 2.

## How rules apply

Every edit passes the same rules, whether it comes from a tool, Smart Build or a generator. Most rules judge each single edit before it lands: a refused edit changes nothing, and the editor shows the rule's reason and marks the cells at fault.

Rules that depend on how cells stand together (mountain support, water containment, the row below a waterfall and objects left standing on roads) are judged when the stroke ends, because a stroke may pass through states that break them on its way to a legal result. When a finished stroke breaks one, the editor takes back the stroke's latest changes until the map holds again and says which rule refused it.

The planet editor, where a custom planet's ground is shaped, applies the same rules, except that it may change the ground itself and in exchange keeps the ground under objects fixed.

The game's own built-in maps, as the game lays them out, break no rule. A rule that would flag one has misread the game and is corrected; the map is never changed to suit the rule.

## Ground and zones

- **V-ZONE-01** Terrain, roads and objects stand only on grass, never on sand, sea or the shore rim, and no footprint may reach off the map; houses and the facilities the game allows may instead stand wholly on sand but never across grass and sand, and a coastal landmark must start at the shore and reach out over the sea. A painted terrain block also needs grass on its upper, left and upper-left neighbours, which it overhangs by half a cell, and in the planet editor ground cannot turn to sea or sand under such an overhang. Source: the game.
- **V-GROUND-LOCK** Outside the planet editor the ground itself is fixed: an edit that would turn land into sea or sand, or sea into land, is refused, so only terrain, water and objects change on a map.
- **V-PLANET-01** In the planet editor, the ground under any placed object or landmark cannot be changed, so nothing ends up standing over sea or sand.

## Locks

- **V-LOCK-01** A locked layer cannot change: painting at it, erasing or overwriting a cell whose terrain reaches it, and cutting corners of terrain or roads standing on it are all refused, as is a corner fillet that would rise through it.
- **V-LOCK-02** A locked object, such as a landmark that comes with the planet, is never removed by any tool or bulk clear, and so is never moved or turned either; it stays selectable. Source: the game.

## Terrain

- **V-MTN-01** Mountain is refused above nine levels over the ground, the game's highest layer, which the editor shows as layer 10. Source: the game.
- **V-MTN-02** A mountain block more than one level above the ground needs terrain or water directly beneath it in the same cell, so a column never has a gap; a block one level up rests on the ground itself. Source: the game.
- **V-MTN-03** When a stroke ends, every mountain block four or more levels above the ground needs a full three-by-three square of cells centred on it whose terrain reaches to within three levels below the block; mountain, water up to its surface and a landmark that serves as a base all count, and cells off the map never do. Blocks up to three levels above the ground always rest on the ground. Source: the game.

## Water

- **V-WTR-01** Water more than one level above the ground needs terrain or water directly beneath it in the same cell; water at ground level or one level up rests on the ground. Source: the game.
- **V-WTR-02** When a stroke ends, every water cell is held in: wherever water has a lower neighbour, the line of water at its level running along that edge must end on both sides at a mountain exactly at the water's level, and water against the map edge is never held in. A taller mountain does not cap water, so nothing may be stacked on a waterfall's caps. Source: the game.
- **V-WTR-03** When a stroke ends, the row directly downstream of a waterfall, as wide as the waterfall with its two capping mountains, lies all at one level; it may mix mountain and water, but any difference in height is refused. Source: the game.

## Objects

- **V-PLACE-BLOCK** Terrain cannot be painted, erased or filled into a corner notch on any cell an object occupies, landmarks included, judged with the half-cell offset between terrain and objects. A road is the one exception for mountain paint and erasing, which carry the road to its new level or remove it where its ground turns uneven, while water can never be painted onto a road. Source: the game.
- **V-PLACE-TRAIT** Each item is refused where its own needs fail: an item that needs flat ground needs a level, dry footprint plus the extra row and column the terrain's half-cell offset reaches, a road needs land rather than water, trees and houses keep open ground from one another on every side and at the corners, and only bridges, ramps and landmarks may sit on half cells. A bridge snaps across a gap of water or lower ground between two flat ends of equal height within the span its item allows, a ramp snaps onto a cliff exactly as high as it climbs, and one that finds no such place is refused. Source: the game.
- **V-PLACE-DOOR** In front of a house's whole door side (the side at the bottom of its footprint before any turn), the ground keeps the house's level for at least one and a half cells before any drop, the sea or the map edge, and for at least two and a half cells before higher ground or water. A placement or turn that breaks this is refused, and so is a terrain or ground edit that would leave a standing house's doorstep broken. Source: owner ruling 2026-10-14.
- **V-PLACE-OVERLAP** Two objects never share a cell, judged by their turned footprints, though footprints may touch along an edge. Roads are the exception: a solid object may be placed over a road, which the placement removes unless the item is made to stand on that road. A road may run under an item made to stand on pavement, a plantable road under a tree or a flower, and any road on the ground below a bridge's deck or at a ramp's lower end, but under no other solid object, and two roads never share one paving layer. Source: the game.
- **V-PLACE-MAX** An item the game allows only a set number of times on a map, such as a one-of-a-kind house, facility or landmark, is refused once the map holds that many; moving or turning one already placed does not count against it. Source: the game.
- **V-PLACE-COATED** When a stroke ends, no object stands on a road unless it is made to: trees and flowers may stand on a plantable road and some buildings and facilities on any pavement, while bridges and ramps are paved across on purpose and are exempt. Source: the game.
- **V-CHUNK-01** The map is divided into chunks of 16 by 16 cells, and each chunk carries a load of at most 10,000: a placement is refused when it would push any chunk its footprint touches past that limit, an object counting in full in every chunk it touches. Moving or turning an object is charged only its net change, so it stays possible in a chunk already over the limit, and the user may switch the check off, as it already is for a map that opens over a limit. Source: the game.
