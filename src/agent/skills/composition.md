COMPOSITION — arrange any scene like a designer; applies to every build, any style.

WHEN TO USE: before placing any multi-element scene (settlement, park, garden, cascade)
and after a view_map reveals that something "looks off" without an obvious rule failure.

PRINCIPLES
1. One focal point per scene: the largest, highest, or most-contrasting element. Everything
   else supports it; nothing competes with equal weight.
2. Asymmetric balance: 2/3 vs 1/3 split (off-center hill, angled road spine). Centered
   grids work only for formal plazas with deliberate symmetry.
3. Framing: paths and tree rows lead the eye toward the focal point. A road that aims
   nowhere reads as unfinished.
4. Negative space is a feature: open meadows give dense areas their meaning.
   A full map with no breathing room reads as noise. Reserve at least 1/3 of the scene
   as empty (or low-decoration) ground.
5. Scale rhythm: vary heights and footprint sizes. Repeat motifs in groups of 3 or 5,
   never 2 or 4 (pairs read as symmetry; even grids look engineered).
6. Depth layering: foreground = low flora (scatter_objects flowers, shrubs);
   midground = structures and trees; background = elevated terrain or tall forest.
   All three layers in the same scene create the illusion of distance.

METHOD
1. Block masses first: place approximate terrain shapes with paint_terrain (no smoothing
   yet) to establish the focal point location, mass ratio, and edge treatment.
2. Call view_map. Assess: Is there one dominant element? Does it sit off-center?
   Is there clear foreground, midground, background?
3. Adjust masses — extend or reduce terrain, reposition the focal structure — before
   adding any detail objects.
4. Place structures and roads against the settled masses, respecting framing lines.
5. Finish with flora: foreground drifts first (scatter_objects), then background forest
   (plant_forest), then trim toward inhabited areas.

FAILURE MODES TO AVOID
- Even sprinkling ("confetti"): scatter_objects over the entire region produces no
  focal zone — cluster instead, leaving gaps.
- Centered everything: one centered hill + centered lake + centered building = a map
  that looks like a diagram, not a place.
- Horror vacui: filling every cell with objects removes breathing space and makes the
  map unreadable from view_map; stop adding when evaluate_map decoration >= 7.
- Competing focal points: two equal-sized hills flanking the center produce visual
  confusion; let one dominate.

DONE CHECK
- view_map output shows one clear focal element.
- Evaluate that the scene has foreground / midground / background distinction.
- At least 1/3 of the buildable area is low-decoration open ground.
