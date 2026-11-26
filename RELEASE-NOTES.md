# Portal Protocol 0.8.8 — Patch Notes

## 🐞 Bug Fixes

**Boss HP Shows the Boss** — on fights with summoned adds, the remaining-HP
number could come from a minion instead of the boss — an Adina wipe showed 12%
where the boss was at 7%, and some Qadim wipes showed a damaged add instead of an
untouched boss. The app now reads the main boss directly. Logs saved before this
fix keep their old number until they are processed again.
