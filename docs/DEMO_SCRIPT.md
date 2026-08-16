# Demo Script — Sod Boys Ltd FieldOps

~10 minutes, timed. Link: **https://dashboard.sodboysltd.org** — stable now (named tunnel, not the old rotating trycloudflare.com link).

## Before you start (5 min prep, do this the morning of)

- [ ] Confirm the Pi is up: dashboard loads, no login errors.
- [ ] Confirm WhatsApp is connected (`openclaw channels status` if you have terminal access, or just send yourself a test message).
- [ ] Log in once yourself first as `nick@sodboys.ca` to dismiss the welcome banner on that account before the audience sees it (or leave it — it's a nice touch showing onboarding thought, your call).
- [ ] Have a phone in hand that can send a WhatsApp message live, for the WhatsApp segment.
- [ ] **Fallback if WiFi drops mid-demo**: the tunnel occasionally needs a beat to reconnect. If the dashboard hangs, wait 10 seconds and refresh once before doing anything else — don't panic-narrate it. If it's still down after 30 seconds, pivot to narrating the architecture/screenshots instead of live-clicking, and mention the IT monitoring (item below) catches this automatically in production.

## The script

**1. Open with the WhatsApp side (2 min)** — this is the differentiator, lead with it.
- Show your phone, WhatsApp open to the crew group or a DM.
- Send: *"give me a status check"* — the agent replies with crew status + alert summary.
- Send: *"send me my dashboard link"* — the agent replies with a link (point out: expires in 15 min, tied to your identity, no password).
- Tap the link live — it should drop straight into the dashboard, no login screen.

**2. Overview page (1.5 min)**
- KPI row: today's shifts, unresolved alerts, order pipeline, critical unacknowledged.
- Fleet map card — real vehicle if one's registered, otherwise narrate what it does.
- Point out the welcome banner if it's still showing on a fresh account — mention every new user gets oriented automatically.

**3. Crew page (1.5 min)**
- Show the real imported roster — 13 real names, real phone numbers, real roles (crew/foreman/management/owner/IT).
- Point out: this wasn't hand-typed — it was reconstructed from the actual WhatsApp group history.
- Filter by role to show the tier system.

**4. Sites + Timesheets (1.5 min)**
- Sites page — real job addresses pulled from real dispatch messages.
- Timesheets — show a real (if "incomplete") clock-in session, explain the "incomplete" flag is honest, not a bug: no fabricated clock-outs.

**5. Reports / Payroll export (1 min)**
- Pull up the payroll export CSV. Be upfront if rates aren't set yet: *"pay rates get set per person, then this populates automatically — here's the mechanism."*

**6. Role-based access, live (1.5 min)**
- Log out, log back in as a `foreman` or `management` account (or just narrate this if time's short).
- Show the crew-portal magic-link view for a **management** account — site roster is org-wide.
- Contrast with a **foreman** account — scoped to their own site only. This is a real, deliberate access-control decision, not a placeholder.

**7. Close: reliability story (1 min)**
- Automated nightly backups (mention the dashboard's own backup-status visibility).
- IT monitoring — if the backend, database, or network degrades, it pages IT automatically, before anyone has to notice and ask.
- Named domain, stable link — no more "the link changed again."

## If something breaks live

- **Dashboard won't load**: refresh once, wait 10s. Still broken → narrate from memory/screenshots, mention the IT monitoring would have already paged you if this were a real incident.
- **WhatsApp doesn't reply**: don't wait in silence — say "let's come back to this" and move to the dashboard segment, circle back at the end if it recovers.
- **Someone asks a question you don't know the answer to**: "good question, let me check and follow up" beats guessing — this is still pre-launch software, no shame in that framing.
