# Portal Protocol 0.8.8 — Patch Notes

## 🌐 External Logs — New Tab

A new **External** tab lets you analyze log links shared by other people without
adding them to your own upload history or analytics.

- **Add Log** — paste a GW2 Wingman link. The card uses the same mode badges,
  result badge, timer, player count and remaining-HP styling as the regular feed.
  **Check Stats** opens the familiar Stats modal with all its boon, phase,
  defense and encounter-specific tabs.
- **Find on Wingman** — paste a dps.report link to see whether Wingman already
  has the fight. If it does, the log is added so you can open it with Check
  Stats. If it does not, the tab says so and offers an explicit **Import to
  Wingman** button. Nothing is queued automatically and nothing is polled.

Direct dps.report fetching is disabled for now because the site returned HTTP
403 to app requests; the code stays behind a feature flag. Wingman links work
normally.

Saved external logs survive restarts with their notes, source link and
last-checked time. The raw Elite Insights JSON is cached on disk, and parsed
stats now use the same compact cache as local logs, so reopening Check Stats is
fast. The tab shows an outage banner when Wingman is down, and buttons have
clear hover, press and loading states. Failed-log HP uses the red heart icon in
the same metadata row as fight time and player count. "Not on Wingman yet" is
orange, "Already queued on Wingman" is bold white, and the Opening stats toast
is green. Deleting a saved log now collapses its card smoothly before it
disappears.

## 🐉 Multi-Boss Encounters

Multi-target fights now show their parts instead of one misleading HP number.
Harvest Temple / The Dragonvoid shows the same Dragon Council strip as the
regular cards, with one chip per dragon and interphase. Twin Largos, Statue of
Darkness, Voice & Claw, Conjured Amalgamate, Aetherblade Hideout and Old Lion's
Court show per-target HP rows; Old Lion's Court also shows its phase and
CC-wipe flag. The single boss HP line is hidden for these fights.

The boss-name lookup was audited against both Wingman's boss list and Elite
Insights' species table. Wingman trigger IDs and Elite Insights species IDs are
separate namespaces that overlap; mixing them could label Twin Largos as
Conjured Amalgamate. External cards now use Wingman's own ID list. All 63
Wingman boss IDs are covered, including two IDs above 65,535 that used to be
truncated. Regular uploads were unaffected because they take names from the
EVTC file and dps.report's API.

## 🐞 Bug Fixes

- **Boss HP Shows the Boss** — on fights with summoned adds, the remaining-HP
  number could come from a minion instead of the boss — an Adina wipe showed 12%
  where the boss was at 7%, and some Qadim wipes showed a damaged add instead of
  an untouched boss. The app now reads the main boss directly. Logs saved before
  this fix keep their old number until they are processed again.
- **Large Wingman JSON downloads** — full reports of 35 MB or more used to fail
  because a 30-second timeout cut the stream off. Downloads now have a longer
  timeout.
- **Boss names from IDs** — several species-to-name entries were wrong (Voice &
  Claw, Boneskinner, Eparch, the eyes and others). They now match Elite Insights'
  species table, with icon aliases for the canonical names.

## 💬 Feedback & Requests

Something look wrong, or is there a mechanic you'd like added? DM me on Discord —
**Mestiak**. Bug reports and requests are both welcome.
