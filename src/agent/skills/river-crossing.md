RIVER + BRIDGE PLAYBOOK
Bridges are the most constraint-heavy object: a STRAIGHT 3-6 cell gap with flat EQUAL-height banks. Build the river FOR the bridge, not the other way round.
1. Route: pick start/end on opposite map edges or between two features. paint_terrain water elevation 0 as a line width 4 — ONE call. Slight bends = 2-3 line calls sharing endpoints; keep each segment straight.
2. Verify nothing reverted (the result snapshot shows the channel; ground-level water needs no caps on open flat grass).
3. find_bridge_sites catalogId <bridge-of-choice> near the intended crossing — it returns exact anchors.
4. place_object the bridge AT a returned anchor (position/rotation/span snap).
5. Road: build_road road-dirt from each bank end of the bridge toward the destinations (the bridge deck itself is walkable; roads stop at the banks).
6. Dressing: scatter_objects waterside flowers (2 species, count 8-10) along ONE bank; 2-3 trees on the outer bend.
7. If find_bridge_sites returns nothing: the channel is too wide/narrow or banks uneven — clear_area the crossing zone and repaint that segment straight at width 4, then retry once.