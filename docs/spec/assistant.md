# Assistant

This area covers the AI assistant that edits the open map on the user's instructions: how it connects to the user's own provider and protects the key, how its edits undo and roll back, how a painted region and the map rules bound it, how a job is paused, stopped and steered, and how approvals and text screening gate its work.

## Providers and keys

- **ASST-01** The assistant runs on the user's own provider account: the user brings a key for a built-in provider or a custom OpenAI-compatible endpoint, and requests go straight from the browser to that provider, never through a PetitMaker server.
- **ASST-02** Telling which provider a key belongs to happens on the device without any network request; an ambiguous key needs the user's choice, and a key is sent only to the provider or endpoint the user selected.
- **ASST-03** A saved key stays on the device, sealed under a key the browser will not export where the browser supports it and otherwise kept only in obfuscated form, never as plain text.
- **ASST-04** A key never appears in the assistant's record: provider error text is cleared of the live key and of anything shaped like a key before it is shown or stored.
- **ASST-05** Removing the key of the provider a job is running on stops that job first.
- **ASST-06** A custom endpoint must use HTTPS, except a loopback address on the user's own machine, which may use HTTP; a plain-HTTP address elsewhere is upgraded to HTTPS, and credentials written into the address are removed.

## Undo and rollback

- **ASST-07** Each edit the assistant makes is one undo step.
- **ASST-08** The assistant's own undo never reaches below the point where its current job started, so it cannot take back work from before the job; each step it undoes is one map edit, taken back with any selection steps made after it.
- **ASST-09** Rewinding a job asks first and says how many steps it will take back, including how many of them are the user's own later work.
- **ASST-10** When map rules refuse part of an assistant edit, only as much is rolled back as the map needs to be legal again, and the panel says in the user's language what was refused and which changes stayed; an edit that fails partway is rolled back whole.

## Painted region

- **ASST-11** While the user has a region painted, every assistant edit must stay inside it, judged by whole object footprints; an edit that strays is refused, the whole call is rolled back, and the panel shows that the work was kept to the region.

## Running a job

- **ASST-12** The user can pause a job at any moment, mid-reply or between steps, and resume it from where it stopped, and a job interrupted by a reload comes back paused. Stop ends a job at once, after which the assistant makes no further requests or edits for it.
- **ASST-13** A message sent while the assistant works steers the running job instead of starting a second one.
- **ASST-14** A job finishes on the model and endpoint it started with; a change of model or endpoint applies from the next order.

## Approvals and screening

- **ASST-15** The user chooses how often the assistant asks: Strict asks before every change, Checkpoint asks at plan steps and wide changes, and Autopilot builds without asking; a change of level applies from the next edit.
- **ASST-16** Under Checkpoint, undoing, redoing, clearing an area, laying a road network and handing work to a helper ask for approval every time, even after the plan was approved.
- **ASST-17** Every approval describes the action in plain language in the user's language, never as raw data or internal names, and the user can allow or decline it.
- **ASST-18** Before the model first reads an order, the order passes the same on-device text check as exports, and a refused order ends at once with a local reply and is never sent to the provider.
- **ASST-19** Notes and typed answers sent during a job pass the same check, and a refused one is dropped while the job carries on; when the check cannot run, orders, notes and answers go through.

## How the assistant builds

- **ASST-20** The assistant has no tool that runs the generator; it builds through its own editing tools, so every change is a step the user can see, approve and undo. Source: owner ruling 2026-08-27.

## Plans on the map

- **ASST-21** For a layout across several areas, a whole map, or an order that asks for a plan, the assistant lays its plan out as planning annotations before building: tagged and coloured zones for the spaces the order needs, sized in cells on the open buildable ground, entrance zones or routes for the way people move between them, and chips for focal points. It plans by a stated method: a programme with the instances and sizes each function needs, paths drawn first as a connected hierarchy reaching the plaza, the other fixed arrival points and every parcel, and parcels tiling the ground between the paths; its written plan is a short legend of those annotations. Under Strict and Checkpoint the plan's approval is asked with that layout standing on the map. Source: owner request 2026-10-29.
- **ASST-22** Annotations already on the map reach the assistant with each order as requirements, with their number, tag, size and place; a zone the assistant draws by shape leaves the cells other zones hold to those zones unless it is told to overlap them, and the assistant changes or removes annotations it did not lay for the current order only when the user asks. Source: owner request 2026-10-29.
- **ASST-23** The assistant's plan annotations stay on the map after it builds, as the record of the plan, until the user removes them or asks the assistant to; undoing its terrain work or rewinding its job leaves them, and the Annotations undo takes them back one edit at a time. While the Annotations layer is hidden or locked the assistant writes no annotations and gives its plan as text. Source: owner request 2026-10-29.
- **ASST-24** A custom tag the assistant names for a facility is drawn only after it passes the same on-device text check as a tag the user types. Source: owner request 2026-10-29.
- **ASST-25** Asked to build from annotations, its own approved plan or zones, chips and routes the user drew, the assistant builds each zone as its tag or name means with what the catalog offers and inside the zone's cells (its area tools take a zone's number and keep to it), lays roads along path zones and routes, leaves reserved zones empty and the annotations standing, reads an untagged zone or a free custom name from its context and asks only when the choice changes the result materially, and reports what it could not build and why. Its read of the annotations tells what each zone holds and which zones hold nothing. Source: owner request 2026-10-29.
