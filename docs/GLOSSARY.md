# Glossary — Real Trade Terms & Shorthand

Pulled directly from a real WhatsApp export of an active crew. This is seed data for the agent's parsing/alias table — the point is that the agent should understand how this specific crew actually talks, not generic industry terms.

## Time & dispatch shorthand

| Term | Meaning |
|---|---|
| `hh` | Military-style time — "830hh" = 8:30am |
| `OMW` | On my way |
| `ETA` | Estimated time of arrival |
| `NVM` | Nevermind |
| `@all` | Broadcast to whole crew |

## Materials

| Term | Meaning |
|---|---|
| `Poly` / poly sand | Polymeric jointing sand for interlock |
| `Stone dust` | Bedding material under interlock/pavers |
| `Geo tech` | Geotextile fabric, laid under base |
| `Base` | Aggregate foundation layer |
| `Ready mix` | Bagged ready-mix concrete/mortar |
| `Flag stone` | Flagstone paving material |
| `Root ball` | Soil mass around a tree/shrub's roots |
| `Snap edging` | Snap-together landscape edging |
| `Riverstone` | Decorative stone, sold/measured by sqft |
| Brand/spec orders | Some material orders come as full specs (brand, color, dimension, linear ft) — e.g. "Mellville tandem scandania grey, 7", 185 linear ft." Order forms need a free-text spec field, not just item + qty. |
| Sod, topsoil/dirt, riverstone | Bulk materials — tracked by sqft, cubic yard, or truckload, not unit count. Almost always ordered fresh per job and delivered/picked up directly (`per_job_delivery` in the schema), not stocked at a depot like bagged goods. |
| Dirt/soil "dumps" | Two different flows — waste spoil hauled *out* to a dump (a disposal event, tied to a tipping ticket) vs. new topsoil brought *in* for backfill (a purchased consumable). Don't conflate them. |

## Equipment

| Term | Meaning |
|---|---|
| `Bobcat` | Skid steer loader |
| `Mini` / `mini ex` / `2 ton mini` | Mini excavator, 2-ton class |
| `Sod cutter` | Cuts/lifts sod for removal |
| `Roller` (+ cap) | Compacts sod; cap fills with water for weight |
| `Wheelie` | Wheelbarrow |
| `Dump bin` | Waste/debris bin — distinct asset from a trailer |
| `Hand tamper` / `gas tamper` | Manual vs. gas-powered compaction |

## Job types

| Term | Meaning |
|---|---|
| `Interlock rep job` / `interlock prep` | Interlock repair vs. prep for new install |
| `Service call` / `SC` | Smaller repair/callback, distinct from full install |
| `Full scope project` | Larger job, own category |
| `Grading & leveling` | Site prep before sod/interlock |
| `Compaction` (numbered passes) | Tracked by sequence — "compaction number one" |
| `Ripping` | Tearing out existing sod/material |
| `Breakaway team` | Crew subset split to a second site mid-day |
| `Seed and feed` | Lawn seeding + fertilizer service |
| `Excavation` | Standalone job type, distinct from prep |

## Real vendors/locations formalized in the schema

- **Access Storage** — depot where tools/equipment live; `sites.type = 'depot'` with address + access hours captured, since even regular crew hadn't consistently known it
- **Thunderbolt** (Bank St / Greely) — sod supplier pickup point
- **Richie Seed and Feed** — has an existing company account — real account number/terms to capture in `vendors`
- **Dupont Ford** — vehicle dealership (pickup/service)
- A rental vendor on Vanguard (name to confirm) — equipment rental, e.g. sod cutters

## A note on parsing vs. real place names

"Magic Morning" looked like slang the first time it came up in the source chat — it's actually a literal street name ("1600 Magic Morning Way"). The alias table needs to distinguish real place names from trade shorthand, or the agent will try to "translate" an address and get it wrong.
