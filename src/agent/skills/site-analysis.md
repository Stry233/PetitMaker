SITE ANALYSIS — read the site before building; the map tells you what it wants.

WHEN TO USE: before any edit on an unfamiliar map, before placing a large feature, or
whenever the first approach keeps getting rejected. One analysis turn saves three correction turns.

PRINCIPLES
- The map is already a design: existing terrain, water, roads, and buildings are anchors, not obstacles.
- A constraint (zone boundary, locked object, narrow corridor) is a composition hint.
- Connection points (ramps, bridges, road ends) define where new areas must attach.
- Extend existing forms; fight them only with a deliberate reason.

METHOD
1. Read <map_context> first: note map dimensions, occupied zones, existing objects, and
   the terrain token grid. Extract: anchor count, approximate flat area, rough topology.
2. inspect_region the specific sub-area you intend to modify — only that area.
   Identify: (a) anchors (any plaza, existing building cluster, water body, cliff top),
   (b) constraints (boundary/void zones, locked objects, elevation steps > 1),
   (c) connection points (road stubs, find_ramp_sites returns, find_bridge_sites returns),
   (d) what the terrain "wants" (ridge running NE? continue it. River bending SW? follow the bend).
3. Check crossings: call find_ramp_sites and find_bridge_sites scoped near the edit area.
   Record the returned anchors — your plan MUST include a route to every planned sub-area.
4. Write a one-paragraph site brief in update_plan:
   - What are the 1-2 anchors the design will pivot on?
   - Where does circulation enter and exit the area?
   - What is the single biggest constraint (zone, locked object, narrow flat, water body)?
   - What style cue does the existing map give (cozy hamlet? alpine? waterfront)?
5. Only after the brief: define stages in the plan (terrain → buildings → roads → planting)
   and begin stage 1.

FAILURE MODES TO AVOID
- Building on the only flat connector between two map areas — lose connectivity dimension.
- Ignoring existing style: a modern pavilion dropped into a farm hamlet reads as an error.
- Orphaning regions: any edit that blocks the single path between two grass zones will
  trigger post-stroke revert; find_ramp_sites or find_bridge_sites before you commit.
- Assuming flat: always verify elevation from <map_context> or inspect_region;
  the token grid may hide 1-2 elevation differences that invalidate placement.

DONE CHECK
- update_plan has a brief with anchors + circulation + constraint + style cue.
- find_ramp_sites and find_bridge_sites called; results noted in the plan.
- No stage begins without the brief written first.
