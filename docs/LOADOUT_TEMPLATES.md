# Loadout Templates

Drafted directly from itemized dispatch messages a crew lead was already writing by hand — proof the template feature matches real usage, and a seed set rather than a blank slate.

**These are v1 drafts.** Confirm quantities with the actual crew lead before they go live as defaults — the source data shows quantities are often improvised per job size rather than fixed, which is why the schema supports per-crew-member scaling (`loadout_items.scales_with_crew`) rather than hard-coded counts.

## Interlock Full-Scope / Excavation Kit

- Wheelie (per 2 crew)
- Pick, rake, round-point shovel, square shovel (per person)
- Grade rake
- Compactor (gas)
- Hand tampers
- Level
- Chip stone (half yard, adjust by job size)
- Screening pipes (metal)
- Two-by-four (grade guide)
- Rubber mallet
- Excavator or mini excavator (site-dependent)
- Dump bin

## Interlock Repair / Standard Kit

- Poly sand (grey, adjust bags by sqft)
- Stone dust
- Geotextile fabric (by linear ft needed)
- Clamps (¾")

## Sod Install / Replacement Kit

- Sod cutter
- Roller + cap
- Wheelie (per 2 crew)
- Shovels, rakes (per person)

## Path / Garden Install Kit

- Snap edging
- Flag stone (as needed)
- Mulch
- Hand tools for planting

## Capturing new templates

First time a job type appears with no template, the agent should capture the live item list as the crew lead sends it — mirroring how "what components do I need to get?" plays out in a real dispatch thread today — and turn it into a reusable template automatically rather than relying on memory next time.
