TERRACED HILL PARK PLAYBOOK
1. Site: find_flat_areas minWidth 16 minHeight 16. The hill needs breathing room.
2. Terraces bottom-up, each tier 3+ cells smaller per side (3x3 base rule headroom):
   - paint_terrain circle r=8 elevation 1
   - paint_terrain circle r=5 elevation 2 (same center)
   - paint_terrain circle r=3 elevation 3 (optional)
3. Access: place_object a ramp (heightDrop) aiming AT a cliff-edge cell of each tier — it snaps. One ramp per tier, on different sides for a winding path.
4. Lookout: place_object facility-pavilion on the top tier if it fits (5x4 + margin needs the top tier ~7x6 — use find_flat_areas elevation=2 or 3 to confirm), else a tree ring: scatter_objects one tree species count 5 spacing 1 on the top tier rect.
5. Elevated pond (optional, reads beautifully): on a tier with 3+ cells of flat interior, paint_terrain water elevation=<tier> on INTERIOR cells only, keeping a 1+ cell ring of that tier's mountain around it (V-WTR-02 satisfied by the ring).
6. Dressing: scatter_objects flowers at the hill foot (drift on the road-facing side); a build_road path from the nearest village/road to the bottom ramp.
7. Done-check: every tier reachable via ramps? pond enclosed? then stop.