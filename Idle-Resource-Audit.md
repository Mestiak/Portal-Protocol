# Idle Resource Consumption Audit (iddle-follow)

Branch: `iddle-follow`. Audit of code that keeps running while the app is open and the user is doing nothing, with findings, proposed fixes, and priority.

## Summary
Portal Protocol has several always-on timers and polling loops that run regardless of user activity or tab visibility. The biggest offenders: a 20s status/queue tick in `+page.svelte`, a 5s notify polling watcher, and no Page Visibility handling, so nothing pauses when the window is minimized/hidden.

## Findings

### 1. Frontend 20s status tick (`src/routes/+page.svelte` ~L4211)
- `setInterval(..., 20000)` runs forever.
- Each tick: `checkDpsReportStatus`, `checkBackupDpsStatus`, `checkWingmanStatus`, filters allHistory for On Hold logs, enqueues dps retries, processes dps queue, verifies orphaned wingman logs (with 2-min cooldown), enqueues wingman retries.
- Cost: network requests + DB scans every 20s even when idle and offline.
- Fix: gate tick to only do work when there are pending items (On Hold logs, dpsQueue, wingmanQueue, in_progress wingman). If none, skip (or back off to 60s). Pause entirely when `document.hidden`.

### 2. Frontend hourly update poll (~L4295)
- `setInterval(..., 60*60*1000)` calls `checkForUpdate`. Already guarded by `!updateModalOpen && !updateChecking`. Low impact; keep but pause when hidden.

### 3. Rust file watcher poll interval (default 5000ms, `config.rs` L374)
- `notify` RecommendedWatcher uses poll_interval. On Windows, notify may use polling backend depending on version; 5s polling of the logs directory.
- Fix: increase default to 10000ms or rely on native ReadDirectoryChangesW; expose setting. Only poll when auto-upload enabled (already gated by watcher start).

### 4. ApiTracker 1s countdown interval (`src/routes/ApiTracker.svelte` L890)
- `setInterval(updateCountdowns, 1000)` while tab is mounted. Fine if tab unmounts; verify unmount. If ApiTracker is always mounted (conditional render), pauses when hidden.

### 5. AnalyticsDashboard rAF loops (`src/routes/AnalyticsDashboard.svelte`)
- `requestAnimationFrame` only on mouse move (event-driven) — low impact. OK.

### 6. Config autosave `$effect` (`+page.svelte` L5571)
- Tracks `JSON.stringify(sessions)`, `gw2_accounts`, `discord_webhooks` and all settings. Re-runs on any state change; debounced 400ms. When idle no changes → no runs. OK, but `sessions` reassignment in favorite/note flows triggers it (now guarded by suppressDirty). Keep.

### 7. No Page Visibility handling
- Nothing pauses intervals/timers when the window is minimized or tab hidden. Single biggest easy win.

### 8. Rust status poll HTTP client (`lib.rs` ~L284)
- "lightweight 20s status polls" — shared client. Ensure no per-tick client creation; reuse. Already shared. OK.

### 9. Startup self-heals / repair passes
- Some repair passes scan all history on startup. Gate to affected subset or disable (per user preference: minimal-scope). Already noted in memory.

### 10. Wingman verify cooldown (2 min) — fine.

## Proposed Fixes (priority)

### P1 — Pause all intervals when document hidden
Add a `visibilitychange` listener in onMount; when hidden, clear `statusInterval`/`updatePollInterval` and set a flag; on visible, restart. Applies to ApiTracker too.

### P2 — Make 20s tick lazy
Skip work when no pending items:
```
const hasPending = dpsQueue.length || wingmanQueue.length ||
  allHistory.some(h => h.status === 'On Hold' || h.wingman_status === 'in_progress');
if (!hasPending) return;
```
Back off to 60s when idle.

### P3 — Bump watcher poll default to 10s
Change `default_watch_poll_interval_ms` 5000 → 10000.

### P4 — ApiTracker countdown pause on hidden
Clear interval on hidden, restart on visible.

### P5 — Reduce notify polling where native events available
Investigate `notify` backend on Windows; prefer `ReadDirectoryChangesW`. (Low priority, OS-level.)

## Enhancements
- Expose "Pause background activity when minimized" toggle in Settings.
- Add a debug panel showing active timers/intervals.
- Log resource usage (CPU) in dev mode.

## Files touched by this audit
- `src/routes/+page.svelte` (intervals)
- `src/routes/ApiTracker.svelte` (countdown)
- `src-tauri/src/config.rs` (watch poll default)
- `src-tauri/src/watcher.rs` (polling backend)

*Audit date: November 2026 (v0.7.9)*