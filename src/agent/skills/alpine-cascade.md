ALPINE CASCADE PLAYBOOK — a dramatic mountain with a summit pool feeding chained waterfalls and a switchback ascent. Work in 5 STAGES, in order.

STAGE 0 — SIZE & SITE (1-2 tool calls)
- SIZE FROM THE MAP: massif = clamp(round(min(mapW, mapH) / 3), 28, 52) cells diameter.
  The feature needs space on all sides — place the center at least (massif/2 + 4) cells from the map edge.
- update_plan: record the five stages and the massif center before touching anything.
- find_flat_areas minWidth equal to massif — pick the most open anchor, avoiding immovable structures.

STAGE 1 — TERRAIN (2-4 tool calls) — shape first, decorate later
- Main massif: sculpt_terrace cx=<center> cy=<center> baseRadius=<massif/2> tiers=3 seed=<any>.
  One call builds all three tiers (elevations 1, 2, 3) with blob-shaped organic cliffs.
  tiers is capped at 3 by the tool; 3 is the dramatic maximum.
  Offset the center 2-3 cells from the map centroid so the massif sits asymmetrically.
- summit_elev = the tiers value you chose (max 3).
- Summit pool: paint_terrain water elevation=<summit_elev> on INTERIOR cells only (keep a >= 1-cell mountain ring at summit_elev around the water — this is the contained-pond recipe: all pool neighbours must be that tier's own mountain mass, so no face is exposed). Use a circle r=2-3 at the summit interior.
- Waterfall cascade: a waterfall is ONE high water cell at each tier's cliff edge — the fall animates itself. Do NOT carve_river down the slope and do NOT paint water flowing downward (it reverts on V-WTR-03). For each tier drop: the lower tier in front is already the uniform landing, so just paint_terrain water at THAT tier's elevation on 1-3 lip cells at the edge, framed by mountain at the same elevation on both perpendicular sides. Repeat per tier down the massif. If REVERTED, the lip frame or the landing tier is uneven — square that cliff segment with paint_terrain (no smooth) and retry once.
- evaluate_map after terrain. Target: terrainInterest >= 6. If it scores below 5, add a foothill: sculpt_terrace baseRadius=4 tiers=1 seed=<seed+10> at a point 12-16 cells from the main massif center — a tiers=1 call beside the massif is fine as an accent.

STAGE 2 — ACCESS (2-3 tool calls)
- find_ramp_sites to locate validated cliff-edge anchors and the matching ramp item for each tier transition.
  Pick anchors that form a SWITCHBACK: if tier 1 ramp is on the south face, put tier 2 ramp on the north or east face — a direct vertical stack is a ladder, not a path.
- place_object each ramp at a returned anchor (the heightDrop snap orients it automatically).
- One ramp per tier transition. Use find_ramp_sites near= a different cardinal offset per tier.

STAGE 3 — FOREST SLOPES (1-2 tool calls)
- plant_forest over the mid-tier and base slopes: the rect should cover the tier 1 + tier 2 footprint minus the summit (x=<cx - massif/2 + 2>, y same, w=<massif - 4>, h=<massif - 4>), density=0.55.
  plant_forest handles stand-with-glade ecology; do NOT scatter individual trees on top.
- Leave the summit (tier 3+) bare or nearly bare — a treeless peak reads as alpine.

STAGE 4 — SUMMIT & VIEWS (2-3 tool calls)
- decorate_zone x=<summit_rect> theme=peak — places the lookout ring (symmetric tree ring + any peak facilities).
  The summit rect should be the top-tier interior, roughly (cx - 4) to (cx + 4).
- view_map to judge composition: the waterfall line should be visible as a diagonal stripe; the forest should frame the base without smothering it. If the summit decor overwrites the pool, the pool was too close to the rect edge — shrink the decorate_zone rect by 2 cells per side and retry.
- evaluate_map after finishing. Check scores and fix any dimension below 5.

STAGE 5 — DONE-CHECK
Quality bars (use evaluate_map scores):
- terrainInterest >= 6: three distinct elevation tiers visible, waterfall present.
- connectivity: every tier reachable via placed ramps (score 10/10 on a map where only this feature exists).
- decoration >= 3: summit ring + forest slopes placed.
- Summit pool enclosed: no REVERTED on the water paint; the pool persists in the token snapshot.
- Waterfall present: carve_river did not fully revert; at least one water cell per tier step in the cascade.
Then STOP — over-sculpting turns a dramatic peak into a noisy hill.