# Features

## Log Management

### Auto-Upload
Portal Protocol watches your ArcDPS logs folder and automatically uploads new logs to dps.report. No manual intervention needed — just raid as usual.

### Log Feed
Browse all your uploads in a unified feed with:
- Boss portraits and encounter names
- CM/QP/Normal mode badges
- Kill/wipe status with color coding
- Duration and squad composition
- Date and time of upload

### Folders & Sessions
Organize your logs into:
- **Sessions** — A collection of logs from one play session
- **Subfolders** — Custom categories within sessions (e.g., "W1 Reclears", "Prog")

Drag and drop logs between folders to reorganize.

### Local Fallback
When dps.report is unavailable, Portal Protocol enriches logs with data from local EVTC files:
- Boss HP remaining
- Phase timings
- Squad composition
- CM/LCM detection

## Discord Integration

### Rich Embeds
Send formatted Discord notifications with:
- Boss name and mode
- Kill/wipe status
- Duration and HP left
- Link to full report
- Squad composition

### Role Pings
Configure named role pings per webhook:
- `<@&ROLE_ID>` for role mentions
- `<@USER_ID>` for user mentions
- `@everyone` and `@here` support

### Thread Targeting
Post to Discord threads instead of channel root. Great for organizing notifications by boss or wing.

### Routing Filters
Control which logs trigger notifications:
- **Type**: raid, strike, fractal, convergence, golem
- **Outcome**: kill, wipe
- **Mode**: CM only, non-CM, LCM only
- **Boss**: substring match (e.g., "ura" matches all Ura logs)

### Quick Filters
Preset buttons for common filter combinations:
- **All** — Every encounter type, kill + wipe
- **Raids** — Raids only
- **Strikes** — Strikes only
- **CM** — All encounter types, CM mode only

## Analytics

### Encounter Statistics
View your clear counts across:
- Total clears by encounter
- Breakdown by mode (CM/QP/Normal)
- Kill vs wipe ratio
- Per-boss success rate

### Personal Records
Track your best performances:
- Fastest kill per encounter
- Lowest HP left (best pull)
- CM clear times
- Compare across modes

### Trends
See your progression over time:
- Weekly/monthly clear counts
- Success rate trends
- Duration improvements

## Squad Planner

Plan your raid composition:
- Assign players to subgroups
- Track roles (Tank, Healer, DPS)
- Save squad templates for quick access
- View historical squad compositions from logs

## Notes

Attach notes to individual logs:
- Inline editing (click to edit)
- Persistent across app restarts
- Useful for tracking strategy changes or prog points
- Visual indicator on logs with notes

## Search & Filter

Find logs quickly:
- Filter by boss name
- Filter by mode (CM/QP/LCM)
- Filter by outcome (kill/wipe)
- Filter by date range
- Search within notes

## Export

Copy formatted log summaries:
- Discord-formatted messages
- Raw URLs
- Log metadata for spreadsheets
