# Portal Protocol 0.8.3 — Patch Notes

This update turns the Stats window into a full post-fight review: pick any phase of the fight, and two new tabs — **Defense** and **Support** — show who kept the squad alive and who kept it standing, with a ranked MVP, per-metric panels, and a blow-by-blow of every down and death.

---

## 📊 Stats — Phase Breakdown

### Pick a Phase
The Stats window now has a phase selector — Full Fight plus every phase Elite Insights found (100%–70%, burn windows, add phases). Damage and boon numbers follow the phase you pick.

### Per 10 min
A toggle that rescales damage numbers to a per-10-minute rate, so a short pull and a long one can be compared fairly.

---

## 🛡️ Defense (new tab)

### Defensive MVP
The top three players, ranked by a defensive score — how much damage they avoided, and how few times they went down or died. Gold, silver and bronze cards with matching crowns and outlines.

### Metric Panels
Damage Taken, Hits Mitigated, Downed and Barrier, each showing the squad total and a ranked list of who did what.

### Mitigation Matrix
Blocked, evaded, dodged, invuln, interrupted, downed and dead for every player, colour-shaded so the outliers stand out. Click a row for that player's damage split.

### Down Recap
The boss icon beside the top three skills that took the most players down, with how many were downed and how many died to each.

### Downs & Deaths
Every down and every death in order — the time, the profession, the player, and what caused it.

---

## 💚 Support (new tab)

### Support MVP
The top three players, ranked by cleanses, breakbar damage, revives and boon strips.

### Revives With Time
Shows how many players each person resurrected and how long they spent doing it.

### Breakbar Damage
The real crowd-control contribution — the same "Breakbar" number Elite Insights shows in its Damage Stats.

### Boons Generated
Who gave the squad its boons, with a chip for each boon.

---

## 🐛 Fixes

### Defense Tab Crash
Opening Defense on some logs showed "500 Internal Error". Older cached stats were missing a newly added field; the cache is now versioned so those entries are refreshed instead of crashing the tab.

### Invisible Bars
The damage-taken bars were rendering transparent.

### Real Damage Sources
A death caused by Burning or Poison now says so, instead of only naming the boss. Condition damage is highlighted so you can tell a damage-over-time death from a single big hit.

### Cleaner Names
Damage sources read "Deimos" instead of "Deimos 12" — the number was an internal counter, not a phase or a mechanic.

### Crowd Control Numbers
The CC stat used an event count that stayed at 0 for players who clearly dealt breakbar damage. It now uses breakbar damage.

### Duplicate Update Toast
Removed a redundant update notification.
