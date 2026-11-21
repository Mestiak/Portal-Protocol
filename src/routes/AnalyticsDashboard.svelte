<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { aggregateStats, getAvailableBosses, clearAnalyticsCache, buildMultiPlayerDpsSeries, cleanAccountName, aggregatePlayers, getFilteredCerusUrls, buildCerusLeaderboardRows, filterLogs, parseLogDate, type CerusLeaderboardRow, type CerusPerLog } from '../lib/analyticsEngine';
  import type { AnalyticsLog, MultiPlayerDpsPoint } from '../lib/analyticsEngine';
  import { extractMechanics, mergeCerusReports, MAX_AGGREGATE_LOGS, type MechanicReport } from '../lib/mechanicParser';
  import { extractDefenseSupport } from '../lib/defenseSupport';
  import { summarizeDefense, summarizeTrend, type DefenseTrendPoint } from '../lib/defenseTrend';
  import { fmtTime } from '../lib/format';
  import { wipeLayout, professionRows, dpsLayout } from '../lib/chartScale';
  import { buildProfessionGroups, ELITE_SPEC_ICONS, PROFESSIONS, type ProfessionGroup } from '../lib/professionData';
  import CerusLeaderboard from './CerusLeaderboard.svelte';

  // ─── Props ─────────────────────────────────────────────────────────────────
  let { logs, onRefreshHistory, isLoading = false }: { logs: AnalyticsLog[], onRefreshHistory: () => Promise<void>, isLoading?: boolean } = $props();

  // ─── Filter state ──────────────────────────────────────────────────────────
  let bossFilter = $state('all');
  let modeFilter = $state('all');
  let rangeFilter = $state('30d');
  // Profession filter (core or specific elite spec), two-step modal like Feed/History.
  let professionFilter = $state<string | number>('all');
  let professionKind = $state<'all' | 'core' | 'spec'>('all');
  const professionGroups: ProfessionGroup[] = buildProfessionGroups();
  // Resolve a player's profession icon: elite-spec icon when they run one,
  // otherwise the core profession icon. Used in the comparison tooltip.
  function profIconFor(profession?: number, eliteSpec?: number | null): string {
    if (eliteSpec && ELITE_SPEC_ICONS[eliteSpec]) return ELITE_SPEC_ICONS[eliteSpec];
    if (profession && PROFESSIONS[profession]) return PROFESSIONS[profession].icon;
    return '';
  }
  // Two-step modal navigation: null = closed, "core" = core list, number = that core's specs.
  let profStep = $state<null | "core" | number>(null);
  let selectedProf = $derived(professionGroups.find((g) => g.id === Number(professionFilter) && professionKind === "core") ?? null);
  let selectedSpec = $derived(
    professionKind === "spec"
      ? professionGroups.flatMap((g) => g.specs).find((s) => s.id === Number(professionFilter)) ?? null
      : null,
  );
  let customStartDate = $state('');
  let customEndDate = $state('');
  let customStartTime = $state(''); // HH:MM — narrow a custom day to a run window
  let customEndTime = $state('');
  let bossSort = $state<{ col: string; dir: 1 | -1 }>({ col: 'total', dir: -1 });

  // Player comparison filters
  const PLAYER_COLORS = ['#a78bfa', '#10b981', '#38bdf8', '#f59e0b', '#ec4899'];
  let selectedAccounts = $state<string[]>([]);
  let metricFilter = $state<'dps' | 'cleave'>('dps');
  let accountSearchQuery = $state('');
  let accountDropdownOpen = $state(false);
  // Viewport-aware alignment for the account dropdown: 'right' anchors the menu
  // to the button's right edge; 'left' anchors to the left edge. Flipped to 'left'
  // when right-anchoring would push the menu off the left side of a narrow window.
  let accountMenuAlign = $state<'right' | 'left'>('right');
  let accountBtnEl = $state<HTMLButtonElement | null>(null);
  const MENU_W = 240;
  function updateAccountMenuAlign() {
    if (accountDropdownOpen && accountBtnEl) {
      const r = accountBtnEl.getBoundingClientRect();
      // Right-anchored menu would start at (r.right - MENU_W) and extend to r.right.
      // If that start is off the left edge (or within 4px), grow rightward instead.
      if (r.right - MENU_W < 4) accountMenuAlign = 'left';
      else accountMenuAlign = 'right';
    }
  }
  function toggleAccountDropdown() {
    accountDropdownOpen = !accountDropdownOpen;
    accountSearchQuery = '';
    if (accountDropdownOpen) requestAnimationFrame(updateAccountMenuAlign);
  }
  // Keep the menu aligned to the viewport while it's open (e.g. on window resize).
  function onWindowResize() { updateAccountMenuAlign(); }
  // Signature of the filter scope (boss|mode|date-window) for which the comparison
  // was last auto-seeded. Reseed only when the scope changes — never on a manual
  // add/remove — so a deselected player stays deselected and a new date window
  // re-seeds the top players for that window.
  let lastReseedScope = $state<string | null>(null);
  // Tooltip state for performance chart
  let tooltipData = $state<{ visible: boolean; point: MultiPlayerDpsPoint | null }>({
    visible: false, point: null
  });

  // Backfill Control State
  let isBackfilling = $state(false);
  let isPaused = $state(false);
  let backfillProgress = $state<{ processed: number; total: number; success: number } | null>(null);
  let backfillMessage = $state('');

  let unlistenProgress: (() => void) | null = null;
  let unlistenComplete: (() => void) | null = null;

  // ─── Derived data ──────────────────────────────────────────────────────────
  let availableBosses = $derived(getAvailableBosses(logs));
  let activeFilters = $derived({
    boss: bossFilter,
    mode: modeFilter,
    range: rangeFilter,
    profession: professionFilter,
    professionKind,
    customStart: customStartDate,
    customEnd: customEndDate,
    customStartTime: customStartTime,
    customEndTime: customEndTime
  });
  let stats = $derived(aggregateStats(logs, activeFilters));

  // ─── Cerus multi-log leaderboard (manual "Load" button) ─────────────────────
  // Scope = the Cerus/Febe logs in the CURRENT boss/mode/range filter. Reuses
  // getFilteredCerusUrls (same filters as the rest of the tab). Builds ONLY on
  // explicit click — the active watcher mutates `logs` every few minutes, so an
  // auto-effect would rebuild/refetch constantly (lag + wobbling numbers).
  let cerusCohort = $state<MechanicReport | null>(null);
  let cerusPerLog = $state<CerusPerLog | null>(null);
  // AVG DPS comes from the SAME record-level source as the "Top Players" chart
  // (aggregatePlayers → log.players[].dps), so the leaderboard column always
  // matches the chart. Keyed by cleaned account.
  let cerusDpsByAccount = $state<Record<string, number>>({});
  let cerusRows = $derived.by<CerusLeaderboardRow[]>(() => {
    const base = cerusCohort ? buildCerusLeaderboardRows(cerusCohort) : [];
    return base.map(r => ({ ...r, avgDps: cerusDpsByAccount[cleanAccountName(r.account)] ?? r.avgDps }));
  });
  let cerusLoading = $state(false);
  let cerusError = $state<string | null>(null);
  let cerusLogCount = $state(0);
  let cerusLoaded = $state(false);   // board shown only after a successful Load
  let cerusScopeUrls = $derived(getFilteredCerusUrls(logs, activeFilters));
  let isCerusScope = $derived(cerusScopeUrls.length > 0);

  // Cheap reactive nudge: when the filter scope (the set of Cerus URLs) changes
  // after a load, mark the current board stale (hide it; user clicks Load again).
  // IMPORTANT: this effect must NOT read cerusLoaded — reading a $state makes the
  // effect subscribe to it, so setting cerusLoaded=true below would instantly
  // re-fire this effect and reset it to false (board vanishes, no error).
  // getFilteredCerusUrls returns a fresh array each call, so compare by CONTENT
  // (joined string), not reference — otherwise a watcher mutation of `logs` would
  // re-hide the board even when the Cerus scope is unchanged.
  let _prevScopeKey: string | null = null;
  $effect(() => {
    const curKey = cerusScopeUrls.join('|');
    if (_prevScopeKey === null) { _prevScopeKey = curKey; return; }
    if (_prevScopeKey !== curKey) { _prevScopeKey = curKey; cerusLoaded = false; }
  });

  async function loadCerusLeaderboard() {
    const urls = getFilteredCerusUrls(logs, activeFilters); // snapshot once
    if (urls.length === 0) { cerusError = 'No Cerus logs in the current filter scope.'; return; }
    cerusError = null;
    cerusLoading = true;
    cerusLogCount = urls.length;
    try {
      const reports: MechanicReport[] = [];
      let failed = 0;
      const capped = urls.slice(0, Math.max(MAX_AGGREGATE_LOGS * 2, urls.length));
      await Promise.all(capped.map(async (u) => {
        try {
          const res = await invoke('get_log_full', { permalink: u }) as any;
          const mech = extractMechanics(res.raw, res.stats?.boss_name || '');
          if (mech && mech.boss === 'Cerus') reports.push(mech);
        } catch { failed++; /* skip unreachable/old log */ }
      }));
      cerusCohort = mergeCerusReports(reports);
      if (!cerusCohort) {
        cerusError = `No Cerus mechanic data found. ${reports.length}/${capped.length} logs parsed; ${failed} unreachable.`;
        cerusLoaded = false;
        return;
      }
      // AVG DPS per account — from aggregatePlayers (record-level players[].dps),
      // the exact source the "Top Players" chart uses, so the column matches it.
      const dpsByAccount: Record<string, number> = {};
      for (const p of aggregatePlayers(logs, activeFilters)) {
        if (p.avgDps > 0) dpsByAccount[cleanAccountName(p.account)] = p.avgDps;
      }
      cerusDpsByAccount = dpsByAccount;
      // Best Pull per log = the LOWEST boss HP% left across the selected logs
      // (record-level boss_hp_left, already computed by enrich_record_from_ei).
      // That is the closest-to-kill attempt. A kill has hp_left ~0. For a log
      // with no stored hp (e.g. a kill that nulled it) treat a success as 0,
      // otherwise 100 (unknown → won't become the minimum).
      const bestPullLog: number[] = [];
      for (const u of capped) {
        const rec = logs.find(l => l.url === u);
        const hp = rec && typeof rec.boss_hp_left === 'number'
          ? rec.boss_hp_left
          : (rec && rec.success === true ? 0 : 100);
        const left = Math.max(0, Math.min(100, hp));
        // truncate to 2 decimals (NO rounding up): 12.98000000000004 → 12.98, 12.88 → 12.88
        bestPullLog.push(Math.floor(left * 100) / 100);
      }
      cerusPerLog = {
        orbs: reports.map(r => r.totalOrbs),
        empowered: reports.map(r => r.empoweredGained),
        rageHits: reports.map(r => r.rageHits),
        shadows: reports.map(r => r.shadowsReached),
        stripped: reports.map(r => r.boonStrippedPlayers),
        orbEff: reports.map(r => r.orbEfficiency),
        bestPull: bestPullLog,
      };
      cerusCohort = { ...cerusCohort, bestPull: bestPullLog.length ? Math.min(...bestPullLog) : 0 };
      cerusLoaded = true;
    } catch (e) {
      cerusError = `Failed to build leaderboard: ${e instanceof Error ? e.message : String(e)}`;
      cerusLoaded = false;
    } finally {
      cerusLoading = false;
    }
  }

  // Prior equal-length window (for trend deltas on the KPI cards).
  // 7d -> previous 7 days, 30d -> previous 30, 90d -> previous 90.
  // "all" / "custom" have no clean prior boundary, so we skip the delta.
  let prevStats = $derived.by(() => {
    const days = rangeFilter === '7d' ? 7 : rangeFilter === '30d' ? 30 : rangeFilter === '90d' ? 90 : 0;
    if (days === 0) return null;
    const now = new Date();
    const curStart = new Date(now); curStart.setDate(curStart.getDate() - days); curStart.setHours(0, 0, 0, 0);
    const priorEnd = new Date(curStart); priorEnd.setDate(priorEnd.getDate() - 1); priorEnd.setHours(23, 59, 59, 999);
    const priorStart = new Date(priorEnd); priorStart.setDate(priorStart.getDate() - days); priorStart.setHours(0, 0, 0, 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return aggregateStats(logs, { ...activeFilters, range: 'custom', customStart: iso(priorStart), customEnd: iso(priorEnd) });
  });

  // Per-card trend objects (null when there's no prior window).
  let cardTrends = $derived.by(() => {
    if (!prevStats) return null;
    return {
      total: kpiTrend(stats.totalLogs, prevStats.totalLogs, false),
      kills: kpiTrend(stats.totalKills, prevStats.totalKills, false),
      wipes: kpiTrend(stats.totalWipes, prevStats.totalWipes, true),
      rate: kpiTrend(stats.overallSuccessRate, prevStats.overallSuccessRate, false),
      avgDur: kpiTrend(stats.avgDuration ?? 0, prevStats.avgDuration ?? 0, true),
      fastest: kpiTrend(stats.shortestKill ?? 0, prevStats.shortestKill ?? 0, true)
    };
  });

  // Plain-language insight cards derived from data already in scope.
  let insightCards = $derived.by(() => {
    const cards: { icon: string; text: string; tone: 'good' | 'bad' | 'neutral' }[] = [];
    const top = aggregatePlayers(logs, activeFilters)[0];
    if (top && top.avgDps > 0) {
      cards.push({ icon: 'fa-solid fa-fire', text: `${top.account} leads at ${top.avgDps.toLocaleString()} avg DPS`, tone: 'neutral' });
    }
    if (cardTrends) {
      const r = cardTrends.rate;
      if (!r.same) {
        cards.push({
          icon: r.good ? 'fa-solid fa-arrow-trend-up' : 'fa-solid fa-arrow-trend-down',
          text: `Kill rate ${r.up ? 'up' : 'down'} ${fmtKpiDelta(r, 'pct')} vs prev`,
          tone: r.good ? 'good' : 'bad'
        });
      }
    }
    const mostWiped = [...stats.bossBreakdown].sort((a, b) => b.wipes - a.wipes)[0];
    if (mostWiped && mostWiped.wipes > 0) {
      cards.push({ icon: 'fa-solid fa-triangle-exclamation', text: `Most wipes on ${mostWiped.boss} (${mostWiped.wipes})`, tone: 'bad' });
    }
    return cards;
  });

  // Trend for one metric. lowerIsBetter=true means a decrease is "good"
  // (wipes, avg duration, fastest kill). When there is no prior window,
  // cardTrends itself is null (handled by the {#if} in markup).
  function kpiTrend(cur: number, prev: number, lowerIsBetter: boolean): { d: number; up: boolean; good: boolean; same: boolean } {
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return { d: 0, up: false, good: true, same: true };
    const up = d > 0;
    return { d, up, good: lowerIsBetter ? !up : up, same: false };
  }

  function fmtKpiDelta(t: { d: number; up: boolean; same: boolean }, kind: 'int' | 'pct' | 'dur'): string {
    if (t.same) return '0';
    const abs = Math.abs(t.d);
    if (kind === 'int') return String(Math.round(abs));
    if (kind === 'pct') return `${abs.toFixed(1)}%`;
    return `${Math.round(abs)}s`;
  }

  // Find all unique account names present across the logs with encounter counts, sorted by frequency descending
  let accountFrequencyMap = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const log of logs) {
      if (log.players) {
        for (const p of log.players) {
          const cleaned = cleanAccountName(p.account);
          if (cleaned) {
            counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
          }
        }
      }
    }
    return counts;
  });

  let availableAccounts = $derived.by(() => {
    return Array.from(accountFrequencyMap.keys()).sort((a, b) => {
      const countDiff = (accountFrequencyMap.get(b) || 0) - (accountFrequencyMap.get(a) || 0);
      if (countDiff !== 0) return countDiff;
      return a.localeCompare(b);
    });
  });

  let filteredAccounts = $derived.by(() => {
    const q = accountSearchQuery.trim().toLowerCase();
    if (!q) return presentAccountList;
    return presentAccountList.filter(acc => acc.toLowerCase().includes(q));
  });

  // Players actually present in the current filtered logs. Used both to seed the
  // comparison and to sanitize any stale/restored selection so a player from a
  // different filter (e.g. persisted in localStorage) can never linger.
  let presentAccounts = $derived.by(() => {
    const set = new Set<string>();
    for (const log of aggregatePlayers(logs, activeFilters)) set.add(log.account);
    return set;
  });

  // Players in the selected filter, sorted by frequency across ALL logs (most
  // seen first) so the dropdown reads naturally. Empty when no boss is selected.
  let presentAccountList = $derived.by(() => {
    return Array.from(presentAccounts).sort((a, b) => {
      const countDiff = (accountFrequencyMap.get(b) || 0) - (accountFrequencyMap.get(a) || 0);
      if (countDiff !== 0) return countDiff;
      return a.localeCompare(b);
    });
  });

  // Keep the player comparison auto-populated with the top-DPS players for the
  // active filter scope. Re-seeds when boss/mode/date-range changes, but never
  // clobbers a manual add/remove — so a deselected player stays out and a new
  // date window re-seeds the top players for that window.
  $effect(() => {
    // Touch the reactive deps that should trigger a re-seed: the filter pool and
    // the available account list. Reading them here registers them as dependencies.
    void activeFilters.boss; void activeFilters.mode; void activeFilters.range;
    void activeFilters.customStart; void activeFilters.customEnd;
    void activeFilters.customStartTime; void activeFilters.customEndTime;
    void presentAccounts.size;

    const boss = activeFilters.boss;
    const mode = activeFilters.mode;
    const range = activeFilters.range;
    const isCustomWindow = range === 'custom' &&
      (activeFilters.customStart || activeFilters.customEnd ||
       activeFilters.customStartTime || activeFilters.customEndTime);

    // A meaningful comparison scope exists when the user narrows by boss, mode,
    // or a custom date window. The default (All bosses + All modes + 30d) is the
    // "pick something to compare" state, so keep the selection cleared there.
    const hasScope = (boss && boss !== 'all') ||
                     (mode && mode !== 'all') ||
                     isCustomWindow;
    if (!hasScope) {
      if (selectedAccounts.length) selectedAccounts = [];
      lastReseedScope = null;
      return;
    }
    if (presentAccounts.size === 0) return;

    // Re-seed only when the scope signature actually changed. On every other
    // reactive tick (including a manual add/remove) leave the selection alone,
    // so a deselected player stays out and editing a player never re-seeds.
    const scopeSig = `${boss}|${mode}|${range}|${activeFilters.customStart}|${activeFilters.customEnd}|${activeFilters.customStartTime}|${activeFilters.customEndTime}`;
    if (lastReseedScope === scopeSig) return;
    lastReseedScope = scopeSig;

    const top = aggregatePlayers(logs, activeFilters)
      .filter(p => p.avgDps > 0) // only players who actually have DPS in this filter
      .map(p => p.account)
      .filter(a => presentAccounts.has(a))
      .slice(0, 4);
    // Never fall back to an all-history account — if nobody has DPS, show nothing
    // rather than a player who isn't in the filtered logs.
    selectedAccounts = top;
  });

  // Sanitize any selection (restored from localStorage or set manually on a
  // different filter) so it only contains accounts present in the current logs.
  $effect(() => {
    void presentAccounts.size;
    if (selectedAccounts.length === 0) return;
    const cleaned = selectedAccounts.filter(a => presentAccounts.has(a));
    if (cleaned.length !== selectedAccounts.length) selectedAccounts = cleaned;
  });

  // Persist selected accounts choices
  $effect(() => {
    if (selectedAccounts.length > 0) {
      localStorage.setItem('gw2_log_uploader_analytics_accounts', JSON.stringify(selectedAccounts));
    }
  });

  function toggleAccountSelect(acc: string) {
    if (selectedAccounts.includes(acc)) {
      selectedAccounts = selectedAccounts.filter(a => a !== acc);
    } else {
      if (selectedAccounts.length < 4) {
        selectedAccounts = [...selectedAccounts, acc];
      }
    }
  }

  function getPlayerColor(acc: string): string {
    const idx = selectedAccounts.indexOf(acc);
    return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length] : '#a78bfa';
  }

  // Missing data stats
  function isDpsEligible(l: AnalyticsLog) {
    return !!l.url && !l.is_story && !l.is_wvw && !l.is_convergence;
  }

  function logNeedsBackfill(l: AnalyticsLog) {
    if (!isDpsEligible(l)) return false;
    if (!l.players || l.players.length === 0) return true;
    return l.players.every(p => p.dps == null);
  }

  let missingDpsCount = $derived.by(() => {
    return logs.filter(l => logNeedsBackfill(l)).length;
  });

  let multiPlayerSeries = $derived(buildMultiPlayerDpsSeries(
    logs,
    activeFilters,
    selectedAccounts,
    metricFilter
  ));

  let multiPlayerStats = $derived.by(() => {
    return selectedAccounts.map(acc => {
      let sum = 0;
      let count = 0;
      let max = 0;
      for (const pt of multiPlayerSeries) {
        const m = pt.players[acc];
        if (m) {
          sum += m.value;
          count++;
          if (m.value > max) max = m.value;
        }
      }
      const avg = count > 0 ? Math.round(sum / count) : 0;
      return {
        account: acc,
        color: getPlayerColor(acc),
        count,
        avg,
        max
      };
    });
  });

  let sortedBossBreakdown = $derived.by(() => {
    const col = bossSort.col;
    const dir = bossSort.dir;
    return [...stats.bossBreakdown].sort((a, b) => {
      const av = (a as any)[col] ?? -Infinity;
      const bv = (b as any)[col] ?? -Infinity;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  });

  // ─── Chart geometry ────────────────────────────────────────────────────────
  // SVG charts draw in their own coordinate space, so each chart measures its
  // container; the layout itself lives in lib/chartScale.ts.

  let activityBox = $state<HTMLDivElement | null>(null);
  let wipeBox = $state<HTMLDivElement | null>(null);
  let wipeW = $state(0);
  let dpsBox = $state<HTMLDivElement | null>(null);
  let dpsW = $state(0);

  $effect(() => {
    const el = wipeBox;
    if (!el) return;
    const ro = new ResizeObserver(() => { wipeW = el.clientWidth; });
    ro.observe(el);
    wipeW = el.clientWidth;
    return () => ro.disconnect();
  });

  $effect(() => {
    const el = dpsBox;
    if (!el) return;
    const ro = new ResizeObserver(() => { dpsW = el.clientWidth; });
    ro.observe(el);
    dpsW = el.clientWidth;
    return () => ro.disconnect();
  });

  let wipeGeom = $derived(wipeLayout(stats.wipeDepthBuckets, wipeW));
  let wipeTotal = $derived(stats.wipeDepthBuckets.reduce((s, b) => s + b.count, 0));
  let profRows = $derived(professionRows(stats.professionFrequency));

  // ─── Squad defense trend ───────────────────────────────────────────────────
  // Loaded on demand: it costs one get_log_full per log in the filter, so it
  // must not run on every filter change. Same contract as the Cerus board.
  let defPoints = $state<DefenseTrendPoint[] | null>(null);
  let defLoading = $state(false);
  let defLoaded = $state(false);
  let defError = $state<string | null>(null);
  let defBox = $state<HTMLDivElement | null>(null);
  let defW = $state(0);

  $effect(() => {
    const el = defBox;
    if (!el) return;
    const ro = new ResizeObserver(() => { defW = el.clientWidth; });
    ro.observe(el);
    defW = el.clientWidth;
    return () => ro.disconnect();
  });

  let defSeries = $derived((defPoints ?? []).map(p => ({
    label: fmtDateShort(p.date),
    players: { rate: { value: p.mitigationRate } },
    raw: p,
  })));
  let defGeom = $derived(dpsLayout(defSeries, defW, {
    keys: ['rate'],
    color: () => 'var(--accent)',
    hovered: null,
  }));
  let defHitW = $derived(
    defSeries.length > 1 && defGeom
      ? (defGeom.W - defGeom.PL - defGeom.PR) / (defSeries.length - 1)
      : 20,
  );
  let defSummary = $derived(summarizeTrend(defPoints ?? []));
  let defHover = $state<DefenseTrendPoint | null>(null);

  function handleDefMouseMove(e: MouseEvent) {
    const g = defGeom;
    if (!g || g.hitboxes.length === 0) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    // The geometry is in viewBox units and max-width:100% can scale the rendered
    // SVG, so convert the cursor into viewBox space before comparing.
    const scale = rect.width / g.W || 1;
    const mx = (e.clientX - rect.left) / scale;
    let closest: (typeof g.hitboxes)[number] | null = null;
    let minDist = defHitW / 2;
    for (const h of g.hitboxes) {
      const d = Math.abs(mx - h.x);
      if (d < minDist) { minDist = d; closest = h; }
    }
    defHover = closest ? closest.point.raw : null;
  }

  async function loadDefenseTrend() {
    const recs = filterLogs(logs, activeFilters).filter(l => l.url);
    if (recs.length === 0) { defError = 'No logs in the current filter scope.'; defLoaded = false; return; }
    defError = null;
    defLoading = true;
    try {
      const pts: DefenseTrendPoint[] = [];
      let failed = 0;
      await Promise.all(recs.map(async (rec) => {
        try {
          const res = await invoke('get_log_full', { permalink: rec.url }) as any;
          const ds = extractDefenseSupport(res.raw);
          if (!ds) return;
          const durationSec = typeof res.raw?.durationMS === 'number'
            ? res.raw.durationMS / 1000
            : (rec.duration ?? 0);
          const pt = summarizeDefense(ds, {
            date: parseLogDate(rec.timestamp),
            boss: rec.boss_name ?? 'Unknown',
            success: rec.success === true,
            durationSec,
          });
          if (pt) pts.push(pt);
        } catch { failed++; }
      }));
      pts.sort((a, b) => a.date.getTime() - b.date.getTime());
      defPoints = pts;
      defLoaded = pts.length > 0;
      if (pts.length === 0) {
        defError = `No defense data found. ${pts.length}/${recs.length} logs parsed; ${failed} unreachable.`;
      }
    } catch (e) {
      defError = String(e);
      defLoaded = false;
    } finally {
      defLoading = false;
    }
  }

  // ─── Attempt feed ────────────────────────────────────────────────────────────
  // Every attempt in the current filter, newest first. This is the view that
  // works for any boss — it needs only the upload record, not a per-boss
  // mechanic extractor.
  const ATTEMPT_LIMIT = 100;

  let scopedAttempts = $derived(
    filterLogs(logs, activeFilters).filter(l => l.success === true || l.success === false),
  );

  let attempts = $derived.by(() => [...scopedAttempts]
    .sort((a, b) => parseLogDate(b.timestamp).getTime() - parseLogDate(a.timestamp).getTime())
    .slice(0, ATTEMPT_LIMIT));

  // ─── Attempt timeline ──────────────────────────────────────────────────────
  // One lane per boss, a dot per attempt along the filter's time span. Anchor-
  // based clustering (not gap-chained) so a dense session stays readable.
  const LANE_LABEL_W = 96;
  const LANE_GAP = 8;
  const CLUSTER_PX = 8;

  let laneBox = $state<HTMLDivElement | null>(null);
  let laneW = $state(0);
  let laneHover = $state<{ x: number; items: AnalyticsLog[] } | null>(null);

  $effect(() => {
    const el = laneBox;
    if (!el) return;
    const ro = new ResizeObserver(() => { laneW = el.clientWidth; });
    ro.observe(el);
    laneW = el.clientWidth;
    return () => ro.disconnect();
  });

  let attemptLanes = $derived.by(() => {
    const list = scopedAttempts;
    if (list.length === 0 || laneW === 0) return null;

    const times = list.map(l => parseLogDate(l.timestamp).getTime());
    let min = Math.min(...times), max = Math.max(...times);
    if (min === max) { min -= 3600_000; max += 3600_000; }
    const pad = (max - min) * 0.02;
    min -= pad; max += pad;

    const counts = new Map<string, number>();
    for (const l of list) {
      const b = l.boss_name ?? 'Unknown';
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const laneNames = ranked.slice(0, 6);
    const hasOther = ranked.length > laneNames.length;
    const lanes = hasOther ? [...laneNames, 'Other'] : laneNames;
    const laneOf = (name: string) => {
      const i = laneNames.indexOf(name);
      return i >= 0 ? i : lanes.length - 1;
    };

    const trackW = Math.max(0, laneW - LANE_LABEL_W - LANE_GAP);
    const radiusPct = trackW > 0 ? (CLUSTER_PX / trackW) * 100 : 0;

    const buckets: { x: number; items: AnalyticsLog[] }[][] = lanes.map(() => []);
    const sorted = [...list].sort((a, b) => parseLogDate(a.timestamp).getTime() - parseLogDate(b.timestamp).getTime());
    for (const l of sorted) {
      const t = parseLogDate(l.timestamp).getTime();
      const x = ((t - min) / (max - min)) * 100;
      const lane = buckets[laneOf(l.boss_name ?? 'Unknown')];
      const anchor = lane[lane.length - 1];
      if (anchor && radiusPct > 0 && Math.abs(x - anchor.x) <= radiusPct) lane[lane.length - 1].items.push(l);
      else lane.push({ x, items: [l] });
    }

    const tickAt = (i: number) => min + ((max - min) * i) / 4;
    return {
      lanes, buckets,
      ticks: [0, 1, 2, 3, 4].map(i => ({ x: (i / 4) * 100, label: fmtDateShort(new Date(tickAt(i))) })),
    };
  });

  function fmtDateShort(d: Date): string {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ─── Activity heatmap ──────────────────────────────────────────────────────
  // One cell per day across the filter window. Unlike the bar chart it shows
  // the days with no logs at all — that is the point of an activity view.
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const HM_GAP = 4;
  const HM_DAY_W = 20;
  const HM_LABEL_GAP = 8;

  type ActivityCell = {
    key: string; date: Date;
    count: number; kills: number; wipes: number;
    inRange: boolean;
  };

  function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dayKey(d: Date): string { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

  let heatBox = $state<HTMLDivElement | null>(null);
  let heatW = $state(0);
  let hmHover = $state<ActivityCell | null>(null);

  $effect(() => {
    const el = heatBox;
    if (!el) return;
    const ro = new ResizeObserver(() => { heatW = el.clientWidth; });
    ro.observe(el);
    heatW = el.clientWidth;
    return () => ro.disconnect();
  });

  let activityCells = $derived.by(() => {
    const inScope = filterLogs(logs, activeFilters);
    if (inScope.length === 0 || heatW === 0) return null;

    const now = new Date();
    let start: Date;
    let end: Date;
    if (activeFilters.range === 'custom') {
      if (!activeFilters.customStart) return null;
      start = startOfDay(new Date(`${activeFilters.customStart}T00:00:00`));
      end = startOfDay(new Date(`${activeFilters.customEnd || activeFilters.customStart}T23:59:59`));
    } else if (activeFilters.range === 'all') {
      const ts = inScope.map(l => parseLogDate(l.timestamp).getTime());
      start = startOfDay(new Date(Math.min(...ts)));
      end = startOfDay(new Date(Math.max(...ts)));
    } else {
      const days = activeFilters.range === '7d' ? 7 : activeFilters.range === '30d' ? 30 : 90;
      end = startOfDay(now);
      start = addDays(end, -(days - 1));
    }

    const byDay = new Map<string, { count: number; kills: number; wipes: number }>();
    for (const l of inScope) {
      const key = dayKey(parseLogDate(l.timestamp));
      const rec = byDay.get(key) ?? { count: 0, kills: 0, wipes: 0 };
      rec.count++;
      if (l.success === true) rec.kills++;
      else if (l.success === false) rec.wipes++;
      byDay.set(key, rec);
    }

    const first = startOfDay(start);
    const last = startOfDay(end);
    const weeks: { days: ActivityCell[] }[] = [];
    for (let w = addDays(first, -((first.getDay() + 6) % 7)); w <= last; w = addDays(w, 7)) {
      const days: ActivityCell[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(w, i);
        const rec = byDay.get(dayKey(d));
        days.push({
          key: dayKey(d), date: d,
          count: rec?.count ?? 0, kills: rec?.kills ?? 0, wipes: rec?.wipes ?? 0,
          inRange: d >= first && d <= last,
        });
      }
      weeks.push({ days });
    }

    const max = Math.max(1, ...weeks.flatMap(w => w.days.map(d => d.count)));
    const cell = Math.max(
      8,
      Math.min(22, Math.floor((heatW - HM_DAY_W - 6 - HM_GAP * (weeks.length + 1)) / weeks.length)),
    );
    const gridW = weeks.length * cell + (weeks.length - 1) * HM_GAP;

    // Month labels are positioned in the grid's own pixel space and dropped
    // when they would collide with the previous one. A percentage track that
    // is wider than the grid puts every label in the wrong place, and clamping
    // the last ones to a fixed offset stacks them exactly on top of each other.
    const monthLabels: { left: number; label: string }[] = [];
    let prevMonth = -1, prevYear = -1, lastRight = -Infinity;
    weeks.forEach((w, i) => {
      const mond = w.days[0].date;
      const m = mond.getMonth(), y = mond.getFullYear();
      if (m === prevMonth) return;
      const text = y !== prevYear ? `${SHORT_MONTHS[m]} ${y}` : SHORT_MONTHS[m];
      prevMonth = m; prevYear = y;
      const textW = labelWidth(text);
      let left = i * (cell + HM_GAP);
      if (left + textW > gridW) left = Math.max(0, gridW - textW);
      if (left < lastRight + HM_LABEL_GAP) return;
      monthLabels.push({ left, label: text });
      lastRight = left + textW;
    });

    return { weeks, cell, max, gridW, monthLabels };
  });

  function labelWidth(text: string): number {
    return text.length * 5 + 6;
  }

  function heatColor(d: ActivityCell): string {
    if (d.count === 0) return 'color-mix(in srgb, #fff 5%, transparent)';
    const rate = d.kills / d.count;
    return `color-mix(in srgb, var(--fail) ${((1 - rate) * 100).toFixed(1)}%, var(--success))`;
  }

  function heatAlpha(count: number, max: number): number {
    if (count === 0) return 1;
    return 0.25 + 0.75 * Math.min(1, count / max);
  }

  function modeLabel(l: AnalyticsLog): string {
    if (l.is_lcm) return 'LCM';
    if (l.is_cm) return 'CM';
    if (l.is_convergence) return 'Conv';
    if (l.is_wvw) return 'WvW';
    return 'NM';
  }

  function fmtWhen(ts: string): string {
    const d = parseLogDate(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // The comparison needs a scope: a boss, a mode, or a custom window. Without
  // one the chart would plot every log in history against every other.
  let dpsHasScope = $derived(
    (activeFilters.boss !== 'all') ||
    (activeFilters.mode !== 'all') ||
    (activeFilters.range === 'custom' &&
      (activeFilters.customStart || activeFilters.customEnd ||
       activeFilters.customStartTime || activeFilters.customEndTime)),
  );

  let dpsGeom = $derived.by(() => {
    const W = dpsW;
    if (!W) return null;
    if (!dpsHasScope) return { empty: 'no-scope' as const, W };
    if (multiPlayerSeries.length === 0 || selectedAccounts.length === 0) {
      return { empty: 'no-data' as const, W };
    }
    return dpsLayout(multiPlayerSeries, W, {
      keys: selectedAccounts,
      color: getPlayerColor,
      hovered: tooltipData.visible ? tooltipData.point : null,
    });
  });

  function handleDpsMouseMove(e: MouseEvent) {
    const g = dpsGeom;
    if (!g || g.empty || g.hitboxes.length === 0) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    // The geometry is in viewBox units; max-width:100% can scale the rendered
    // SVG, so convert the cursor into viewBox space before comparing.
    const scale = rect.width / g.W || 1;
    const mx = (e.clientX - rect.left) / scale;
    let closest: { x: number; point: MultiPlayerDpsPoint } | null = null;
    let minDist = 24;
    for (const h of g.hitboxes) {
      const d = Math.abs(mx - h.x);
      if (d < minDist) { minDist = d; closest = h; }
    }
    if (closest) {
      tooltipData = { visible: true, point: closest.point };
    } else if (tooltipData.visible) {
      tooltipData = { visible: false, point: null };
    }
  }

  function handleDpsMouseLeave() {
    if (tooltipData.visible) tooltipData = { visible: false, point: null };
  }

  let isDestroyed = false;
  onMount(() => {
    isDestroyed = false;
    // Listen for backfill progress events continuously
    listen<{ processed: number; total: number; success: number }>('backfill_progress', (event) => {
      if (isDestroyed) return;
      backfillProgress = event.payload;
      isBackfilling = true;
      backfillMessage = `Backfilling: ${event.payload.processed} / ${event.payload.total} (${event.payload.success} updated)`;
    }).then(fn => {
      if (isDestroyed) fn();
      else unlistenProgress = fn;
    });

    // Listen for backfill completion event
    listen<number>('backfill_complete', async (event) => {
      if (isDestroyed) return;
      isBackfilling = false;
      isPaused = false;
      backfillMessage = `Successfully backfilled ${event.payload} logs!`;
      await onRefreshHistory();
      setTimeout(() => {
        if (isDestroyed) return;
        backfillMessage = '';
        backfillProgress = null;
      }, 5000);
    }).then(fn => {
      if (isDestroyed) fn();
      else unlistenComplete = fn;
    });

    // Query backend to restore state if backfill is running/paused across tab switches
    try {
      invoke<{ is_running: boolean; is_paused: boolean; processed: number; total: number; success: number }>('get_backfill_status').then(status => {
        if (isDestroyed) return;
        if (status && status.is_running) {
          isBackfilling = true;
          isPaused = status.is_paused;
          if (status.total > 0) {
            backfillProgress = { processed: status.processed, total: status.total, success: status.success };
            backfillMessage = `Backfilling: ${status.processed} / ${status.total} (${status.success} updated)`;
          }
        }
      });
    } catch (e) {
      console.error('Failed to fetch backfill status:', e);
    }
  });

  // ─── Trigger local history backfilling ─────────────────────────────────────
  async function triggerBackfill() {
    if (isBackfilling) return;
    isBackfilling = true;
    isPaused = false;
    backfillProgress = null;
    backfillMessage = 'Preparing backfill...';

    try {
      const count = await invoke<number>('backfill_dps_history');
      backfillMessage = `Successfully backfilled ${count} logs!`;
      await onRefreshHistory();
      setTimeout(() => {
        backfillMessage = '';
        backfillProgress = null;
      }, 5000);
    } catch (e: any) {
      console.error(e);
      backfillMessage = `Backfill failed: ${e.toString()}`;
    } finally {
      isBackfilling = false;
    }
  }

  async function pauseBackfill() {
    await invoke('pause_backfill');
    isPaused = true;
  }

  async function resumeBackfill() {
    await invoke('resume_backfill');
    isPaused = false;
  }

  async function cancelBackfill() {
    await invoke('cancel_backfill');
    isBackfilling = false;
    isPaused = false;
  }

  onDestroy(() => {
    isDestroyed = true;
    if (unlistenProgress) unlistenProgress();
    if (unlistenComplete) unlistenComplete();
    clearAnalyticsCache();
  });

  function fmtPct(n: number) { return n.toFixed(1); }
  function fmtDur(sec: number | null) { return sec != null ? fmtTime(sec) : '\u2014'; }
  function sortBoss(col: string) {
    bossSort = bossSort.col === col
      ? { col, dir: (bossSort.dir * -1) as 1 | -1 }
      : { col, dir: -1 };
  }
  function chevron(col: string) {
    return bossSort.col !== col ? '' : bossSort.dir === -1 ? ' \u25bc' : ' \u25b2';
  }

  // Export Stats Function
  async function exportStats() {
    try {
      let report = `# Portal Protocol - Analytics Report\n`;
      report += `Generated: ${new Date().toLocaleString()}\n`;
      report += `Filters: Boss: ${bossFilter} | Mode: ${modeFilter} | Range: ${rangeFilter}\n`;
      if (rangeFilter === 'custom') {
        report += `Custom Range: ${customStartDate || 'Start'} to ${customEndDate || 'End'}\n`;
      }

      report += `\n## Summary\n`;
      report += `- Total Encounters: ${stats.totalLogs}\n`;
      report += `- Kills: ${stats.totalKills}\n`;
      report += `- Wipes: ${stats.totalWipes}\n`;
      report += `- Kill Rate: ${fmtPct(stats.overallSuccessRate)}%\n`;
      report += `- Avg Duration: ${fmtDur(stats.avgDuration)}\n`;
      report += `- Fastest Kill: ${fmtDur(stats.shortestKill)}\n`;

      // Boss Breakdown only when more than one boss is in scope, so a single
      // boss filter doesn't print the same numbers twice (once in Summary).
      if (sortedBossBreakdown.length > 1) {
        report += `\n## Boss Breakdown\n`;
        report += `| Boss | Total | Kills | Wipes | Kill Rate | Avg Duration | Fastest Kill |\n`;
        report += `| --- | --- | --- | --- | --- | --- | --- |\n`;
        for (const b of sortedBossBreakdown) {
          report += `| ${b.boss} | ${b.total} | ${b.kills} | ${b.wipes} | ${fmtPct(b.successRate)}% | ${fmtDur(b.avgDuration)} | ${fmtDur(b.shortestKill)} |\n`;
        }
      }

      // Player Performance — every player present in the filtered logs,
      // sorted by Avg DPS (best first). No cap.
      const players = aggregatePlayers(logs, activeFilters);
      if (players.length) {
        report += `\n## Player Performance\n`;
        report += `| Player | Profession | Encounters | Avg DPS | Max DPS |\n`;
        report += `| --- | --- | --- | --- | --- |\n`;
        for (const p of players) {
          const name = p.displayName && p.displayName !== p.account ? `${p.displayName} (${p.account})` : p.account;
          report += `| ${name} | ${p.profession} | ${p.encounters} | ${p.avgDps.toLocaleString()} | ${p.maxDps.toLocaleString()} |\n`;
        }
      }

      if (stats.professionFrequency.length) {
        const profLine = stats.professionFrequency.map((pr) => `${pr.name} ${pr.count}`).join(' · ');
        report += `\nProfessions: ${profLine}\n`;
      }

      await navigator.clipboard.writeText(report);
      backfillMessage = 'Analytics report copied to clipboard!';
      setTimeout(() => {
        backfillMessage = '';
      }, 3000);
    } catch (e: any) {
      console.error(e);
      backfillMessage = 'Failed to copy report: ' + e.toString();
    }
  }
</script>

<svelte:window onresize={onWindowResize} />

<div class="analytics-wrap">

  <!-- Header + filters -->
  <div class="page-header" style="margin-bottom:0;">
    <div>
      <h2 class="feed-title" style="margin:0 0 2px;">Analytics</h2>
      <p style="font-size:12px;color:var(--text-muted);margin:0;">Historical trends from your encounter logs</p>
    </div>
    <div class="an-filter-bar" style="flex-wrap:wrap; gap:8px;">
      <select class="an-select" bind:value={bossFilter}>
        <option value="all">All Bosses</option>
        {#each availableBosses as b}
          <option value={b}>{b}</option>
        {/each}
      </select>
      <select class="an-select" bind:value={modeFilter}>
        <option value="all">All Modes</option>
        <option value="nm">Normal Mode</option>
        <option value="cm">Challenge Mode</option>
        <option value="lcm">Legendary CM</option>
      </select>
      <div class="an-pills">
        {#each [['7d','7 Days'],['30d','30 Days'],['90d','90 Days'],['all','All Time'],['custom','Custom']] as [v,l]}
          <button class="an-pill {rangeFilter === v ? 'active' : ''}" onclick={() => rangeFilter = v} role="tab" aria-selected={rangeFilter === v} aria-label={l}>{l}</button>
        {/each}
      </div>
      {#if rangeFilter === 'custom'}
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.03); padding:4px 8px; border-radius:6px; border:1px solid var(--border);">
            <i class="fa-regular fa-calendar" style="font-size:11px; color:var(--text-muted);"></i>
            <input type="date" class="an-date-input" bind:value={customStartDate} title="Start Date" />
            <input type="time" class="an-date-input" bind:value={customStartTime} title="Start Time" />
            <span style="font-size:11px; color:var(--text-muted);">-</span>
            <input type="date" class="an-date-input" bind:value={customEndDate} title="End Date" />
            <input type="time" class="an-date-input" bind:value={customEndTime} title="End Time" />
          </div>
          {#if !customStartDate && !customEndDate}
            <span style="font-size:11px; color:var(--text-muted); padding-left:2px;">Pick a start date (or start + end). Leaving both empty shows no logs instead of all of them.</span>
          {/if}
        </div>
      {/if}
      <button
        class="an-pill an-prof-btn"
        class:active={professionFilter !== "all"}
        style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px;"
        onclick={() => { profStep = "core"; }}
        title="Filter by profession"
      >
        {#if selectedSpec}
          <img src={selectedSpec.icon} alt="" style="width:16px;height:16px;object-fit:contain;" />
          {selectedSpec.name}
        {:else if selectedProf}
          <img src={selectedProf.icon} alt="" style="width:16px;height:16px;object-fit:contain;" />
          {selectedProf.name}
        {:else}
          All Professions
        {/if}
        <i class="fa-solid fa-chevron-down" style="font-size:10px; opacity:0.6;"></i>
      </button>
      <button 
        class="an-pill" 
        style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; margin-left: auto;" 
        onclick={exportStats}
        title="Copy Markdown Report to clipboard"
      >
        <i class="fa-solid fa-copy"></i> Export Report
      </button>
    </div>
  </div>

  {#if profStep !== null}
    <div
      class="prof-modal-overlay"
      role="button"
      tabindex="0"
      aria-label="Close profession picker"
      onclick={(e) => { if (e.target === e.currentTarget) { profStep = null; } }}
      onkeydown={(e) => { if (e.key === "Escape") { profStep = null; } }}
    >
      <div class="prof-modal" role="dialog" aria-modal="true">
        {#if profStep === "core"}
          <div class="prof-modal-head">
            <span class="prof-modal-title">Filter by Profession</span>
            <button class="prof-modal-close" onclick={() => profStep = null} aria-label="Close">✕</button>
          </div>
          <div class="prof-grid prof-grid-core">
            {#each professionGroups as g}
              <button class="prof-cell" onclick={() => { profStep = g.id; }}>
                <img src={g.icon} alt="" class="prof-cell-icon" />
                <span class="prof-cell-name">{g.name}</span>
                <i class="fa-solid fa-chevron-right prof-cell-arrow"></i>
              </button>
            {/each}
          </div>
        {:else}
          {@const grp = professionGroups.find((g) => g.id === profStep)}
          <div class="prof-modal-head">
            <button class="prof-modal-back" onclick={() => profStep = "core"} aria-label="Back to professions">
              <i class="fa-solid fa-chevron-left"></i> Professions
            </button>
            <button class="prof-modal-close" onclick={() => profStep = null} aria-label="Close">✕</button>
          </div>
          {#if grp}
            <div class="prof-modal-title sub">{grp.name} — Elite Specializations</div>
            <div class="prof-grid">
              <button class="prof-cell prof-cell-core" onclick={() => { professionFilter = grp.id; professionKind = "core"; profStep = null; }}>
                <img src={grp.icon} alt="" class="prof-cell-icon" />
                <span class="prof-cell-name">{grp.name} (Core)</span>
                {#if grp.id === Number(professionFilter) && professionKind === "core"}<i class="fa-solid fa-check prof-cell-check"></i>{/if}
              </button>
              {#each grp.specs as s}
                <button class="prof-cell" onclick={() => { professionFilter = s.id; professionKind = "spec"; profStep = null; }}>
                  <img src={s.icon} alt="" class="prof-cell-icon" />
                  <span class="prof-cell-name">{s.name}</span>
                  {#if s.id === Number(professionFilter) && professionKind === "spec"}<i class="fa-solid fa-check prof-cell-check"></i>{/if}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if missingDpsCount > 0 || isBackfilling}
    <div class="an-backfill-banner" role="status" aria-live="polite">
      <div style="display:flex; flex-direction:column; gap:4px; flex-grow:1;">
        <div style="display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-bolt" style="color:var(--accent);"></i>
          {#if isBackfilling && backfillProgress}
            <span style="font-size:12px; font-weight:600;">
              Extracting player DPS data: {backfillProgress.processed} / {backfillProgress.total} logs ({backfillProgress.success} found)
            </span>
          {:else}
            <span style="font-size:12px; font-weight:600;">{missingDpsCount} logs are missing local player DPS records.</span>
          {/if}
        </div>
        {#if isBackfilling && backfillProgress}
          <div class="an-progress-bg">
            <div class="an-progress-bar" style="width: {(backfillProgress.processed / backfillProgress.total) * 100}%"></div>
          </div>
        {/if}
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        {#if isBackfilling}
          {#if isPaused}
            <button class="an-control-btn" onclick={resumeBackfill}>
              <i class="fa-solid fa-play"></i> Resume
            </button>
          {:else}
            <button class="an-control-btn" onclick={pauseBackfill}>
              <i class="fa-solid fa-pause"></i> Pause
            </button>
          {/if}
          <button class="an-control-btn an-btn-danger" onclick={cancelBackfill}>
            <i class="fa-solid fa-stop"></i> Cancel
          </button>
        {:else}
          <button class="an-backfill-btn" onclick={triggerBackfill}>
            <i class="fa-solid fa-bolt"></i> Extract Local DPS
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if backfillMessage}
    <div class="an-toast">{backfillMessage}</div>
  {/if}

  {#if isLoading}
    <!-- Summary cards skeleton -->
    <div class="an-cards">
      {#each Array(6) as _}
        <div class="skeleton-card">
          <div class="skeleton-val"></div>
          <div class="skeleton-label"></div>
        </div>
      {/each}
    </div>
    <!-- Section skeleton (simulate charts/breakdowns layout) -->
    <div class="skeleton-section" style="height: 300px; margin-top: 10px;">
      <div class="skeleton-chart-header"></div>
      <div class="skeleton-chart-body"></div>
    </div>
  {:else if stats.empty}
    <div class="an-empty">
      <i class="fa-solid fa-chart-line" style="font-size:40px;color:var(--text-muted);margin-bottom:14px;"></i>
      <p style="font-size:15px;font-weight:700;margin:0 0 6px;">No encounter data</p>
      <p style="font-size:12px;color:var(--text-muted);margin:0;">Upload logs or adjust your filters to see analytics.</p>
    </div>
  {:else}

    <!-- Insight cards: plain-language takeaways from the current filter -->
    {#if insightCards.length > 0}
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        {#each insightCards as c}
          <div class="an-insight {c.tone}">
            <i class={c.icon}></i><span>{c.text}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Summary cards -->
    <div class="an-cards">
      <div class="an-card">
        <div class="an-card-val an-accent">{stats.totalLogs}</div>
        <div class="an-card-label">Total Encounters</div>
        {#if cardTrends}
          {@const t = cardTrends.total}
          <div class="an-card-delta {t.same ? 'same' : (t.good ? 'good' : 'bad')}">
            {t.same ? 'no change' : `${t.up ? '▲' : '▼'} ${fmtKpiDelta(t, 'int')}`}<span class="an-card-delta-cap">vs prev</span>
          </div>
        {:else}
          <div class="an-card-delta same">—</div>
        {/if}
      </div>
      <div class="an-card">
        <div class="an-card-val an-success">{stats.totalKills}</div>
        <div class="an-card-label">Kills</div>
        {#if cardTrends}
          {@const t = cardTrends.kills}
          <div class="an-card-delta {t.same ? 'same' : (t.good ? 'good' : 'bad')}">
            {t.same ? 'no change' : `${t.up ? '▲' : '▼'} ${fmtKpiDelta(t, 'int')}`}<span class="an-card-delta-cap">vs prev</span>
          </div>
        {:else}
          <div class="an-card-delta same">—</div>
        {/if}
      </div>
      <div class="an-card">
        <div class="an-card-val an-fail">{stats.totalWipes}</div>
        <div class="an-card-label">Wipes</div>
        {#if cardTrends}
          {@const t = cardTrends.wipes}
          <div class="an-card-delta {t.same ? 'same' : (t.good ? 'good' : 'bad')}">
            {t.same ? 'no change' : `${t.up ? '▲' : '▼'} ${fmtKpiDelta(t, 'int')}`}<span class="an-card-delta-cap">vs prev</span>
          </div>
        {:else}
          <div class="an-card-delta same">—</div>
        {/if}
      </div>
      <div class="an-card">
        <div class="an-card-val {stats.overallSuccessRate >= 50 ? 'an-success' : 'an-fail'}">{fmtPct(stats.overallSuccessRate)}<span class="an-unit">%</span></div>
        <div class="an-card-label">Kill Rate</div>
        {#if cardTrends}
          {@const t = cardTrends.rate}
          <div class="an-card-delta {t.same ? 'same' : (t.good ? 'good' : 'bad')}">
            {t.same ? 'no change' : `${t.up ? '▲' : '▼'} ${fmtKpiDelta(t, 'pct')}`}<span class="an-card-delta-cap">vs prev</span>
          </div>
        {:else}
          <div class="an-card-delta same">—</div>
        {/if}
      </div>
      <div class="an-card">
        <div class="an-card-val an-warn">{fmtDur(stats.avgDuration)}</div>
        <div class="an-card-label">Avg Kill Duration</div>
        {#if cardTrends}
          {@const t = cardTrends.avgDur}
          <div class="an-card-delta {t.same ? 'same' : (t.good ? 'good' : 'bad')}">
            {t.same ? 'no change' : `${t.up ? '▲' : '▼'} ${fmtKpiDelta(t, 'dur')}`}<span class="an-card-delta-cap">vs prev</span>
          </div>
        {:else}
          <div class="an-card-delta same">—</div>
        {/if}
      </div>
      <div class="an-card">
        <div class="an-card-val an-gold">{fmtDur(stats.shortestKill)}</div>
        <div class="an-card-label">Fastest Kill</div>
        {#if cardTrends}
          {@const t = cardTrends.fastest}
          <div class="an-card-delta {t.same ? 'same' : (t.good ? 'good' : 'bad')}">
            {t.same ? 'no change' : `${t.up ? '▲' : '▼'} ${fmtKpiDelta(t, 'dur')}`}<span class="an-card-delta-cap">vs prev</span>
          </div>
        {:else}
          <div class="an-card-delta same">—</div>
        {/if}
      </div>
    </div>

    <!-- Player Performance Line Chart & Comparison -->
    {#if bossFilter !== 'all'}
    <div class="an-section" style="position:relative;">
      <div class="an-section-head" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span class="an-section-title"><i class="fa-solid fa-users"></i> Player Performance Comparison</span>
          <!-- Active Player Color Chips -->
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            {#each selectedAccounts as acc}
              <span
                class="an-pill"
                style="display:inline-flex; align-items:center; gap:6px; padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.03); border:1px solid {getPlayerColor(acc)}; color:var(--text);"
              >
                <span style="width:8px; height:8px; border-radius:50%; background:{getPlayerColor(acc)};"></span>
                <span>{acc}</span>
                {#if selectedAccounts.length >= 1}
                  <button
                    onclick={() => toggleAccountSelect(acc)}
                    style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:0; font-size:10px;"
                    title="Remove player"
                  >
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                {/if}
              </span>
            {/each}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
          <!-- Searchable Multi-Player Account Selector Dropdown -->
          <div class="an-acc-dropdown-wrap">
            <button
              class="an-acc-btn"
              bind:this={accountBtnEl}
              onclick={toggleAccountDropdown}
              title="Select Player Accounts to Compare (Up to 4)"
            >
              <i class="fa-solid fa-user-plus" style="color:var(--accent);"></i>
              <span class="an-acc-btn-text">
                {selectedAccounts.length === 1 ? selectedAccounts[0] : `Compare Players (${selectedAccounts.length})`}
              </span>
              <i class="fa-solid fa-chevron-down" style="font-size:9px; margin-left:4px; opacity:0.6;"></i>
            </button>

            {#if accountDropdownOpen}
              <!-- Backdrop to close on click outside -->
              <div
                class="an-acc-backdrop"
                onclick={() => accountDropdownOpen = false}
                role="presentation"
              ></div>

              <div
                class="an-acc-menu"
                style={accountMenuAlign === 'right'
                  ? 'right:0; left:auto;'
                  : 'left:0; right:auto;'}
              >
                <div class="an-acc-search-box">
                  <i class="fa-solid fa-magnifying-glass" style="font-size:11px; color:var(--text-muted);"></i>
                  <input
                    type="text"
                    class="an-acc-search-input"
                    placeholder="Search player or account..."
                    bind:value={accountSearchQuery}
                    onclick={(e) => e.stopPropagation()}
                  />
                  {#if accountSearchQuery}
                    <button
                      class="an-acc-search-clear"
                      onclick={() => accountSearchQuery = ''}
                      title="Clear search"
                      aria-label="Clear search"
                    >
                      <i class="fa-solid fa-xmark"></i>
                    </button>
                  {/if}
                </div>

                <div class="an-acc-list">
                  {#if filteredAccounts.length === 0}
                    <div class="an-acc-empty">No matching accounts</div>
                  {:else}
                    {#each filteredAccounts as acc}
                      {@const isSelected = selectedAccounts.includes(acc)}
                      <button
                        class="an-acc-item {isSelected ? 'selected' : ''}"
                        onclick={() => toggleAccountSelect(acc)}
                      >
                        <i class="fa-regular {isSelected ? 'fa-square-check' : 'fa-square'}" style="font-size:12px; color:{isSelected ? getPlayerColor(acc) : 'var(--text-muted)'};"></i>
                        <span class="an-acc-item-name" style="margin-left:6px;">{acc}</span>
                        <span class="an-acc-item-count">{accountFrequencyMap.get(acc)} logs</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Metric toggle -->
          <div class="an-pills" role="group" aria-label="Metric">
            <button class="an-pill {metricFilter === 'dps' ? 'active' : ''}" onclick={() => metricFilter = 'dps'} style="padding:4px 10px; font-size:10px;" aria-pressed={metricFilter === 'dps'}>Target DPS</button>
            <button class="an-pill {metricFilter === 'cleave' ? 'active' : ''}" onclick={() => metricFilter = 'cleave'} style="padding:4px 10px; font-size:10px;" aria-pressed={metricFilter === 'cleave'}>Cleave DPS</button>
          </div>
        </div>
      </div>
      
      <div class="an-chart-box" bind:this={dpsBox}>
        {#if dpsGeom && !dpsGeom.empty}
          <svg class="an-svg" width={dpsGeom.W} height={dpsGeom.H} viewBox="0 0 {dpsGeom.W} {dpsGeom.H}"
               role="img" aria-label="Player DPS comparison"
               onmousemove={handleDpsMouseMove} onmouseleave={handleDpsMouseLeave}>
            {#each dpsGeom.grid as g}
              <line x1={dpsGeom.PL} y1={g.y} x2={dpsGeom.W - dpsGeom.PR} y2={g.y} class="an-grid" />
              <text x={dpsGeom.PL - 8} y={g.y + 3} class="an-axis-text" text-anchor="end">{(g.val / 1000).toFixed(1)}k</text>
            {/each}
            {#each dpsGeom.lines as l}
              <polyline points={l.points} fill="none" stroke={l.color} stroke-width="2.2"
                        stroke-linejoin="round" stroke-linecap="round" />
              {#if dpsGeom.showDots}
                {#each l.dots as d}
                  <circle cx={d.x} cy={d.y} r={d.hot ? 6.5 : 4}
                          fill={l.color} stroke="var(--bg-panel)" stroke-width={d.hot ? 2 : 1.5} />
                {/each}
              {/if}
            {/each}
            {#each dpsGeom.xLabels as xl}
              <text x={xl.x} y={dpsGeom.H - dpsGeom.PB + 16} class="an-axis-text" text-anchor="middle">{xl.label}</text>
            {/each}
            <line x1={dpsGeom.PL} y1={dpsGeom.baseY} x2={dpsGeom.W - dpsGeom.PR} y2={dpsGeom.baseY} class="an-axis" />
          </svg>
        {:else}
          <p class="an-chart-empty">{dpsGeom?.empty === 'no-data' ? 'No player performance logs found for selected filters' : 'Select encounters to compare DPS'}</p>
        {/if}
      </div>
      <div class="an-detail" aria-live="polite">
        {#if tooltipData.visible && tooltipData.point}
          <span class="an-detail-status {tooltipData.point.success ? 'kill' : 'wipe'}">
            {tooltipData.point.success ? 'KILL' : 'WIPE'}
          </span>
          <span class="an-detail-title">{tooltipData.point.bossName} ({tooltipData.point.label})</span>
          <div class="an-detail-rows">
            {#each selectedAccounts as acc}
              {#if tooltipData.point.players[acc]}
                {@const pMatch = tooltipData.point.players[acc]}
                <div class="an-detail-row">
                  <span class="an-detail-player">
                    <span class="an-dot" style="background:{getPlayerColor(acc)};"></span>
                    {#if profIconFor(pMatch.profession, pMatch.elite_spec)}
                      <img src={profIconFor(pMatch.profession, pMatch.elite_spec)} alt="" class="an-detail-prof" />
                    {/if}
                    <span class="an-detail-char">{pMatch.charName}</span>
                    <span class="an-detail-acct">{acc}</span>
                  </span>
                  <span class="an-detail-val">{pMatch.value.toLocaleString()}</span>
                </div>
              {/if}
            {/each}
          </div>
          {#if !tooltipData.point.success && tooltipData.point.bossHpLeft != null}
            <div class="an-detail-hp">Wipe HP: <strong>{tooltipData.point.bossHpLeft.toFixed(1)}%</strong></div>
          {/if}
        {:else}
          <span class="an-detail-hint">Hover a point for details</span>
        {/if}
      </div>

      <!-- Comparative Summary Bar -->
      {#if multiPlayerStats.length > 0}
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
          {#each multiPlayerStats as st}
            <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-left:3px solid {st.color}; border-radius:8px; padding:8px 12px; display:flex; flex-direction:column; gap:2px;">
              <span style="font-size:11px; font-weight:700; color:{st.color};">{st.account}</span>
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:2px;">
                <span>Avg {metricFilter.toUpperCase()}: <strong style="color:var(--text);">{st.avg ? (st.avg / 1000).toFixed(1) + 'k' : '—'}</strong></span>
                <span>Peak: <strong style="color:var(--text);">{st.max ? (st.max / 1000).toFixed(1) + 'k' : '—'}</strong></span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {:else}
    <div class="an-section" style="position:relative;">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-users"></i> Player Performance Comparison</span>
      </div>
      <div style="padding:18px 4px; color:var(--text-muted); font-size:13px;">
        Select a boss (and optionally a mode or date) to compare player DPS from the filtered logs.
      </div>
    </div>
    {/if}

    <!-- Cerus multi-log Leaderboard (manual Load button) -->
    {#if isCerusScope && bossFilter !== 'all'}
      <div class="an-section">
        <div class="an-section-head" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <span class="an-section-title"><i class="fa-solid fa-trophy"></i> Cerus Leaderboard</span>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            {#if cerusScopeUrls.length > MAX_AGGREGATE_LOGS}
              <span class="an-warn-pill">⚠ {cerusScopeUrls.length} logs — averages may be skewed</span>
            {/if}
            {#if cerusLoaded && cerusLogCount > 0}
              <span class="an-muted-sm">Aggregated from {cerusLogCount} log{cerusLogCount === 1 ? '' : 's'}</span>
            {/if}
          </div>
        </div>

        {#if cerusLoading}
          <div class="an-loading"><i class="fa-solid fa-spinner fa-spin"></i> Building leaderboard from {cerusLogCount} log{cerusLogCount === 1 ? '' : 's'}…</div>
        {:else if cerusError}
          <div class="an-error">{cerusError}</div>
          <button class="an-btn" onclick={loadCerusLeaderboard}><i class="fa-solid fa-rotate"></i> Retry</button>
        {:else if cerusLoaded && cerusCohort && cerusPerLog}
          <CerusLeaderboard report={cerusCohort} rows={cerusRows} perLog={cerusPerLog} />
        {:else}
          <div class="cl-empty">
            <p>Aggregates per-player Cerus mechanics across the {cerusScopeUrls.length} log{cerusScopeUrls.length === 1 ? '' : 's'} in this filter.</p>
            <button class="an-btn an-btn-primary" onclick={loadCerusLeaderboard}>
              <i class="fa-solid fa-trophy"></i> Load Cerus Leaderboard
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Activity heatmap: one cell per day in the filter window, gaps included -->
    <div class="an-section">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-calendar-days"></i> Encounter Activity</span>
        <span class="an-muted-sm">{scopedAttempts.length} attempt{scopedAttempts.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="hm" bind:this={heatBox}>
        {#if activityCells}
          <div class="hm-body">
            <span class="hm-days">
              <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
            </span>
            <div class="hm-main" style="width:{activityCells.gridW}px">
              <div class="hm-month-track">
                {#each activityCells.monthLabels as m}
                  <span class="hm-month" style="left:{m.left}px">{m.label}</span>
                {/each}
              </div>
              <div class="hm-grid" style="--cell:{activityCells.cell}px;grid-template-columns:repeat({activityCells.weeks.length}, var(--cell))">
                {#each activityCells.weeks as w}
                  {#each w.days as d}
                    <button
                      class="hm-cell"
                      class:pad={!d.inRange}
                      class:empty={d.inRange && d.count === 0}
                      style="background:{heatColor(d)};opacity:{heatAlpha(d.count, activityCells.max)}"
                      onmouseover={() => { hmHover = d; }}
                      onfocus={() => { hmHover = d; }}
                      onmouseleave={() => { hmHover = null; }}
                      onblur={() => { hmHover = null; }}
                      aria-label="{d.date.getMonth() + 1}/{d.date.getDate()}: {d.count} attempt{d.count !== 1 ? 's' : ''}"
                    ></button>
                  {/each}
                {/each}
              </div>
            </div>
          </div>
          <div class="hm-legend">
            <span class="hm-leg"><span class="hm-leg-dot" style="background:var(--success)"></span>Kills</span>
            <span class="hm-leg"><span class="hm-leg-dot" style="background:var(--fail)"></span>Wipes</span>
            <span class="hm-leg hm-leg-gap">Fewer</span>
            {#each [0.25, 0.45, 0.65, 0.85, 1] as a}
              <span class="hm-leg-swatch" style="background:var(--text-muted);opacity:{a}"></span>
            {/each}
            <span class="hm-leg">More</span>
          </div>
        {:else}
          <p class="an-chart-empty">No activity in this range</p>
        {/if}
      </div>
      <div class="an-detail" aria-live="polite">
        {#if hmHover}
          {@const h = hmHover}
          <span class="an-detail-title">{h.date.getMonth() + 1}/{h.date.getDate()}/{h.date.getFullYear()}</span>
          <span class="an-muted-sm">{h.count} attempt{h.count !== 1 ? 's' : ''}</span>
          <span class="an-detail-val">{h.kills} kill{h.kills !== 1 ? 's' : ''} · {h.wipes} wipe{h.wipes !== 1 ? 's' : ''}</span>
        {:else}
          <span class="an-detail-hint">Hover a day for details</span>
        {/if}
      </div>
    </div>

    <!-- Grid container for the remaining charts -->
    <div class="an-charts-grid">
      <!-- Wipe depth -->
      <div class="an-section">
        <div class="an-section-head">
          <span class="an-section-title"><i class="fa-solid fa-heart-crack"></i> Wipe Depth</span>
          <span class="an-muted-sm">{wipeTotal} wipe{wipeTotal !== 1 ? 's' : ''} in this range</span>
        </div>
        <div class="an-chart-box" bind:this={wipeBox}>
          {#if wipeGeom}
            <svg class="an-svg" width={wipeGeom.W} height={wipeGeom.H} viewBox="0 0 {wipeGeom.W} {wipeGeom.H}"
                 role="img" aria-label="Wipe depth">
              {#each wipeGeom.rows as r}
                <text x={wipeGeom.PL - 6} y={r.y + r.h / 2 + 4} class="an-axis-text" text-anchor="end">{r.label}</text>
                <rect x={wipeGeom.PL} y={r.y} width={wipeGeom.trackW} height={r.h} class="an-track" rx="4" />
                {#if r.w > 0}<rect x={wipeGeom.PL} y={r.y} width={r.w} height={r.h} class="an-bar-accent" rx="4" />{/if}
                {#if r.count > 0}<text x={wipeGeom.PL + r.w + 4} y={r.y + r.h / 2 + 4} class="an-bar-val">{r.count}</text>{/if}
              {/each}
            </svg>
          {:else}
            <p class="an-chart-empty">No wipes in this range</p>
          {/if}
        </div>
      </div>

      <!-- Squad composition -->
      <div class="an-section">
        <div class="an-section-head">
          <span class="an-section-title"><i class="fa-solid fa-user-group"></i> Squad Composition</span>
        </div>
        <div class="an-prof-rows">
          {#each profRows as p}
            <div class="an-prof-row">
              <span class="an-prof-name" title={p.name}>{p.name}</span>
              <span class="an-prof-track"><span class="an-prof-bar" style="width:{p.barPct}%;background:{p.color}"></span></span>
              <span class="an-prof-pct">{p.pct.toFixed(1)}%</span>
            </div>
          {:else}
            <p class="an-chart-empty">No profession data</p>
          {/each}
        </div>
      </div>
    </div>

    <!-- Squad defense trend: one point per log, loaded on demand -->
    <div class="an-section">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-shield-halved"></i> Squad Defense</span>
        {#if defSummary}
          <span class="an-muted-sm">
            {defSummary.logs} log{defSummary.logs !== 1 ? 's' : ''} · avg {defSummary.avgMitigationRate.toFixed(1)}% mitigated
          </span>
        {/if}
      </div>

      <!-- The chart box is always rendered so its width can be measured: the
           geometry depends on that width, and binding it inside the branch that
           needs the geometry would deadlock (no box → no width → no geometry →
           no box). -->
      <div class="an-chart-box" bind:this={defBox}>
        {#if defLoading}
          <div class="an-loading"><i class="fa-solid fa-spinner fa-spin"></i> Reading defense stats from {scopedAttempts.length} log{scopedAttempts.length !== 1 ? 's' : ''}…</div>
        {:else if defError}
          <div class="an-error">{defError}</div>
          <button class="an-btn" onclick={loadDefenseTrend}><i class="fa-solid fa-rotate"></i> Retry</button>
        {:else if defLoaded && defGeom}
          <svg class="an-svg" width={defGeom.W} height={defGeom.H} viewBox="0 0 {defGeom.W} {defGeom.H}"
               role="img" aria-label="Squad mitigation rate over time"
               onmousemove={handleDefMouseMove}
               onmouseleave={() => { defHover = null; }}>
            {#each defGeom.grid as g}
              <line x1={defGeom.PL} y1={g.y} x2={defGeom.W - defGeom.PR} y2={g.y} class="an-grid" />
              <text x={defGeom.PL - 6} y={g.y + 4} class="an-axis-text" text-anchor="end">{Math.round(g.val)}%</text>
            {/each}
            {#each defGeom.lines as l}
              <polyline points={l.points} fill="none" stroke={l.color} stroke-width="2" stroke-linejoin="round" />
              {#each l.dots as d}
                <circle cx={d.x} cy={d.y} r="3.5" fill={l.color} />
              {/each}
            {/each}
            {#each defGeom.xLabels as xl}
              <text x={xl.x} y={defGeom.H - 12} class="an-axis-text" text-anchor="middle">{xl.label}</text>
            {/each}
          </svg>
        {:else if defLoaded}
          <p class="an-chart-empty">No defense data in this range</p>
        {:else}
          <div class="cl-empty">
            <p>Squad-wide mitigation rate per log, across the {scopedAttempts.length} log{scopedAttempts.length !== 1 ? 's' : ''} in this filter. Reads each log's Elite Insights report, so it takes a moment on a large history.</p>
            <button class="an-btn an-btn-primary" onclick={loadDefenseTrend}>
              <i class="fa-solid fa-shield-halved"></i> Load Squad Defense
            </button>
          </div>
        {/if}
      </div>

      {#if defLoaded}
        <div class="an-detail" aria-live="polite">
          {#if defHover}
            {@const dh = defHover}
            <span class="an-detail-title">{dh.boss}</span>
            <span class="an-muted-sm">{fmtDateShort(dh.date)}{dh.success ? ' · kill' : ' · wipe'}</span>
            <span class="an-detail-val">{dh.mitigationRate.toFixed(1)}% mitigated · {dh.downs} downs ({dh.downsPerHour.toFixed(1)}/h)</span>
            <span class="an-detail-val">{dh.cleanses} cleanses · {dh.strips} strips · {dh.revives} revives</span>
          {:else if defSummary}
            <span class="an-detail-title">{defSummary.avgMitigationRate.toFixed(1)}% mitigated</span>
            <span class="an-muted-sm">{defSummary.avgDownsPerHour.toFixed(1)} downs/h</span>
            <span class="an-detail-val">{defSummary.cleanses} cleanses · {defSummary.strips} strips · {defSummary.revives} revives</span>
          {:else}
            <span class="an-detail-hint">Hover a point for details</span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Boss breakdown table -->
    <div class="an-section">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-table"></i> Boss Breakdown</span>
        <span style="font-size:10px;color:var(--text-muted);">{sortedBossBreakdown.length} encounter type{sortedBossBreakdown.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="an-table-wrap">
        <table class="an-table">
          <thead>
            <tr>
              <th class="an-th-left">Boss</th>
              <th class="an-th-sort {bossSort.col === 'total' ? 'active' : ''}" onclick={() => sortBoss('total')}>Total{chevron('total')}</th>
              <th class="an-th-sort {bossSort.col === 'kills' ? 'active' : ''}" onclick={() => sortBoss('kills')}>Kills{chevron('kills')}</th>
              <th class="an-th-sort {bossSort.col === 'wipes' ? 'active' : ''}" onclick={() => sortBoss('wipes')}>Wipes{chevron('wipes')}</th>
              <th class="an-th-sort {bossSort.col === 'successRate' ? 'active' : ''}" onclick={() => sortBoss('successRate')}>Kill Rate{chevron('successRate')}</th>
              <th class="an-th-sort {bossSort.col === 'avgDuration' ? 'active' : ''}" onclick={() => sortBoss('avgDuration')}>Avg Duration{chevron('avgDuration')}</th>
              <th class="an-th-sort {bossSort.col === 'shortestKill' ? 'active' : ''}" onclick={() => sortBoss('shortestKill')}>Fastest Kill{chevron('shortestKill')}</th>
              <th class="an-th-sort {bossSort.col === 'avgWipeHp' ? 'active' : ''}" onclick={() => sortBoss('avgWipeHp')}>Avg Wipe HP%{chevron('avgWipeHp')}</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedBossBreakdown as b}
              <tr 
                class="an-row interactive {bossFilter === b.boss ? 'focused' : ''}" 
                onclick={() => { bossFilter = bossFilter === b.boss ? 'all' : b.boss; }}
                title="Click to filter analytics on {b.boss}"
                style="cursor: pointer;"
              >
                <td class="an-td-boss">
                  <span style="display: inline-flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-chevron-right" style="font-size: 8px; opacity: 0.4; transition: transform 0.12s; {bossFilter === b.boss ? 'transform: rotate(90deg); color: var(--accent); opacity: 1;' : ''}"></i>
                    {b.boss}
                  </span>
                </td>
                <td class="an-td-num">{b.total}</td>
                <td class="an-td-num an-kill">{b.kills}</td>
                <td class="an-td-num an-wipe">{b.wipes}</td>
                <td class="an-td-num">
                  <span class="an-rate-pill {b.successRate >= 50 ? 'an-rate-success' : b.successRate >= 25 ? 'an-rate-warn' : 'an-rate-fail'}">
                    {fmtPct(b.successRate)}%
                  </span>
                </td>
                <td class="an-td-num">{fmtDur(b.avgDuration)}</td>
                <td class="an-td-num an-gold">{fmtDur(b.shortestKill)}</td>
                <td class="an-td-num {b.avgWipeHp != null ? 'an-wipe' : ''}">{b.avgWipeHp != null ? fmtPct(b.avgWipeHp) + '%' : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Attempt timeline: one lane per boss, one dot per attempt -->
    <div class="an-section">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-timeline"></i> Attempt Timeline</span>
        <span class="an-muted-sm">{scopedAttempts.length} attempt{scopedAttempts.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="ln-wrap" bind:this={laneBox}>
        {#if attemptLanes}
          <div class="ln-lanes">
            {#each attemptLanes.lanes as name, i}
              <div class="ln-lane">
                <span class="ln-label" title={name}>{name}</span>
                <span class="ln-track">
                  {#each attemptLanes.buckets[i] as c}
                    <button
                      class="ln-dot {c.items[0].success === true ? 'kill' : 'wipe'}"
                      style="left:{c.x}%"
                      onmouseover={() => { laneHover = c; }}
                      onfocus={() => { laneHover = c; }}
                      onmouseleave={() => { laneHover = null; }}
                      onblur={() => { laneHover = null; }}
                      aria-label="{c.items.length} attempt{c.items.length !== 1 ? 's' : ''} on {name}"
                    >
                      {#if c.items.length > 1}<span class="ln-count">×{c.items.length}</span>{/if}
                    </button>
                  {/each}
                </span>
              </div>
            {/each}
          </div>
          <div class="ln-axis">
            <span></span>
            <span class="ln-axis-track">
              {#each attemptLanes.ticks as t}
                <span class="ln-axis-label" style="left:{t.x}%">{t.label}</span>
              {/each}
            </span>
          </div>
        {:else}
          <p class="an-chart-empty">No attempts in this filter</p>
        {/if}
      </div>
      <div class="an-detail" aria-live="polite">
        {#if laneHover}
          {@const lh = laneHover}
          <span class="an-detail-title">{lh.items[0].boss_name ?? 'Unknown'}</span>
          <span class="an-muted-sm">{lh.items.length} attempt{lh.items.length !== 1 ? 's' : ''}</span>
          <div class="an-detail-rows">
            {#each [...lh.items].sort((a, b) => parseLogDate(b.timestamp).getTime() - parseLogDate(a.timestamp).getTime()) as a}
              <div class="an-detail-row">
                <span class="an-detail-player">
                  <span class="an-dot {a.success === true ? 'kill' : 'wipe'}"></span>
                  <span class="an-detail-acct">{fmtWhen(a.timestamp)}</span>
                </span>
                <span class="an-detail-val">
                  {a.success === true
                    ? (a.duration != null ? fmtDur(a.duration) : '—')
                    : (a.boss_hp_left != null ? fmtPct(a.boss_hp_left) + '%' : '—')}
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <span class="an-detail-hint">Hover a dot for details</span>
        {/if}
      </div>
    </div>

    <!-- Attempt feed: every attempt in the current filter, newest first -->
    <div class="an-section">
      <div class="an-section-head">
        <span class="an-section-title"><i class="fa-solid fa-list"></i> Attempts</span>
        <span class="an-muted-sm">
          {attempts.length}{stats.totalLogs > attempts.length ? ` of ${stats.totalLogs}` : ''} attempt{stats.totalLogs !== 1 ? 's' : ''} in this filter
        </span>
      </div>
      <div class="at-feed">
        <div class="at-row at-head">
          <span></span><span>Boss</span><span>Mode</span><span>When</span><span>Duration</span><span>Party</span>
        </div>
        {#each attempts as a}
          <div class="at-row">
            <span class="at-dot {a.success === true ? 'kill' : 'wipe'}" title={a.success === true ? 'Kill' : 'Wipe'}></span>
            <span class="at-boss" title={a.boss_name ?? ''}>{a.boss_name ?? 'Unknown'}</span>
            <span class="at-mode">{modeLabel(a)}</span>
            <span class="at-time">{fmtWhen(a.timestamp)}</span>
            <span class="at-dur">
              {a.success === true
                ? (a.duration != null ? fmtDur(a.duration) : '—')
                : (a.boss_hp_left != null ? fmtPct(a.boss_hp_left) + '% left' : '—')}
            </span>
            <span class="at-party">{a.num_players ?? '—'}</span>
          </div>
        {:else}
          <p class="an-chart-empty">No attempts in this filter</p>
        {/each}
      </div>
    </div>

  {/if}
</div>

<style>
  .analytics-wrap{display:flex;flex-direction:column;gap:20px;width:100%;min-width:0;}
  .an-charts-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    width: 100%;
    min-width: 0;
  }
  @media (min-width: 1024px) {
    .an-charts-grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  /* Flex items default to min-width:auto, so a card holding a wide SVG would
     refuse to shrink and the chart would clip instead of rescaling. */
  .an-chart-box{min-width:0;}
  .an-filter-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .an-select{
    background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
    color:var(--text);font-size:12px;font-family:var(--font);padding:6px 10px;
    cursor:pointer;outline:none;transition:border-color .15s;
  }
  .an-select:hover,.an-select:focus{border-color:var(--accent);}
  .an-pills{display:flex;gap:4px;}
  .an-pill{
    background:var(--bg-card);border:1px solid var(--border);border-radius:20px;
    color:var(--text-muted);font-size:11px;font-family:var(--font);
    font-weight:600;padding:5px 12px;cursor:pointer;transition: background-color .15s ease, color .15s ease;
  }
  .an-pill:hover{color:var(--text);border-color:var(--accent);}
  .an-pill.active{
    background:color-mix(in srgb,var(--accent) 20%,transparent);
    border-color:var(--accent);color:#fff;
  }
  .an-empty{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:80px 24px;background:var(--bg-panel);border:1px dashed var(--border);
    border-radius:var(--radius);color:var(--text);text-align:center;
  }
  .an-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;}
  .an-card{
    background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--radius);
    padding:14px 16px;display:flex;flex-direction:column;gap:4px;
    transition:border-color .2s,box-shadow .2s;
  }
  .an-card:hover{
    border-color:color-mix(in srgb,var(--accent) 50%,transparent);
    box-shadow:0 4px 20px color-mix(in srgb,var(--accent) 12%,transparent);
  }
  .an-card-val{font-size:22px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:.01em;}
  .an-unit{font-size:14px;font-weight:700;color:var(--text-muted);margin-left:1px;}
  .an-card-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);}
  .an-card-delta{font-size:10px;font-weight:700;margin-top:5px;display:flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;}
  .an-card-delta.good{color:var(--success);}
  .an-card-delta.bad{color:var(--fail);}
  .an-card-delta.same{color:var(--text-muted);font-weight:600;}
  .an-card-delta-cap{font-size:9px;font-weight:500;opacity:.65;text-transform:uppercase;letter-spacing:.04em;}
  .an-accent{color:var(--accent);}
  .an-success{color:var(--success);}
  .an-fail{color:var(--fail);}
  .an-warn{color:var(--warn);}
  .an-gold{color:var(--gold);}
  .an-insight{
    display:inline-flex; align-items:center; gap:6px;
    background:color-mix(in srgb,#fff 3%,transparent);
    border:1px solid var(--border); border-left:3px solid var(--accent);
    border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; color:var(--text);
  }
  .an-insight i{color:var(--accent);}
  .an-insight.good{border-left-color:var(--success);}
  .an-insight.good i{color:var(--success);}
  .an-insight.bad{border-left-color:var(--fail);}
  .an-insight.bad i{color:var(--fail);}
  .an-section{
    background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--radius);
    padding:14px 16px;display:flex;flex-direction:column;gap:12px;min-width:0;
  }
  .an-section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .an-section-title{
    font-size:11px;font-weight:700;text-transform:uppercase;
    letter-spacing:.03em;color:var(--text);display:flex;align-items:center;gap:7px;
  }
  .an-section-title i{color:var(--accent);font-size:12px;}
  .an-warn-pill{font-size:11px;font-weight:600;color:var(--fail);background:color-mix(in srgb,var(--fail) 12%,transparent);border:1px solid color-mix(in srgb,var(--fail) 35%,transparent);padding:3px 8px;border-radius:6px;}
  .an-loading{display:flex;align-items:center;gap:8px;padding:18px 4px;color:var(--text-muted);font-size:13px;}
  .an-error{padding:18px 4px;color:var(--fail);font-size:13px;}
  .an-muted-sm{font-size:11px;color:var(--text-muted);}
  .an-btn{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,#fff 4%,transparent);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s;}
  .an-btn:hover{background:color-mix(in srgb,#fff 8%,transparent);}
  .an-btn-primary{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--text);}
  .an-btn-primary:hover{background:color-mix(in srgb,var(--accent) 26%,transparent);}
  .cl-empty{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:22px 4px 8px;}
  .cl-empty p{margin:0;color:var(--text-muted);font-size:13px;max-width:560px;}

  .an-svg{display:block;max-width:100%;}
  /* Activity heatmap */
  .hm{min-width:0;overflow-x:auto;}
  .hm-month-track{position:relative;display:block;height:13px;margin-bottom:2px;min-width:0;}
  .hm-month{position:absolute;top:0;font-size:9px;color:var(--text-muted);white-space:nowrap;}
  .hm-body{display:flex;gap:6px;min-width:0;align-items:flex-start;}
  .hm-main{min-width:0;}
  .hm-days{display:grid;grid-template-rows:repeat(7, var(--cell, 14px));gap:4px;flex:none;margin-top:15px;}
  .hm-days span{font-size:8px;color:var(--text-muted);display:flex;align-items:center;}
  .hm-grid{
    display:grid;grid-auto-flow:column;grid-template-rows:repeat(7, var(--cell, 14px));
    gap:4px;min-width:0;
  }
  .hm-cell{
    width:var(--cell, 14px);height:var(--cell, 14px);
    border:none;border-radius:3px;padding:0;cursor:pointer;
    background:color-mix(in srgb, #fff 5%, transparent);
    transition:transform .18s var(--ease-spring);
  }
  .hm-cell.pad{visibility:hidden;}
  .hm-cell.empty{cursor:default;}
  .hm-cell:not(.pad):not(.empty):hover,
  .hm-cell:not(.pad):not(.empty):focus-visible{transform:scale(1.25);z-index:2;outline:none;}
  .hm-legend{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:9px;color:var(--text-muted);margin-top:8px;}
  .hm-leg{display:inline-flex;align-items:center;gap:4px;}
  .hm-leg-gap{margin-left:10px;}
  .hm-leg-dot{width:8px;height:8px;border-radius:2px;display:inline-block;}
  .hm-leg-swatch{width:10px;height:10px;border-radius:2px;display:inline-block;}
  .an-grid{stroke:var(--border);stroke-width:1;}
  .an-axis{stroke:var(--border);stroke-width:1;}
  .an-axis-text{fill:var(--text-muted);font-size:10px;font-family:var(--font);}
  .an-track{fill:color-mix(in srgb,#fff 4%,transparent);}
  .an-bar-accent{fill:var(--accent);}
  .an-bar-val{fill:var(--text);font-size:10px;font-weight:700;font-family:var(--font);}
  .an-chart-empty{margin:0;padding:28px 4px;color:var(--text-muted);font-size:12px;text-align:center;}
  .an-prof-rows{display:flex;flex-direction:column;gap:8px;}
  .an-prof-row{display:grid;grid-template-columns:88px 1fr 46px;align-items:center;gap:8px;}
  .an-prof-name{font-size:10px;font-weight:600;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .an-prof-track{height:8px;border-radius:4px;background:color-mix(in srgb,#fff 4%,transparent);overflow:hidden;}
  .an-prof-bar{display:block;height:100%;border-radius:4px;}
  .an-prof-pct{font-size:10px;font-weight:700;color:var(--text);text-align:right;font-variant-numeric:tabular-nums;}
  .at-feed{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;}
  .at-row{
    display:grid;grid-template-columns:14px minmax(0,1fr) 46px 74px 74px 44px;
    align-items:center;gap:8px;padding:6px 10px;min-width:0;
    border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent);
    transition:background-color .14s;
  }
  .at-row:last-child{border-bottom:none;}
  .at-row:not(.at-head):hover{background:color-mix(in srgb,#fff 4%,transparent);}
  .at-head{
    background:color-mix(in srgb,#fff 3%,transparent);
    font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
    color:var(--text-muted);padding:5px 10px;
  }
  .at-dot{width:8px;height:8px;border-radius:50%;justify-self:center;}
  .at-dot.kill{background:var(--success);}
  .at-dot.wipe{background:var(--fail);}
  .at-boss{font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .at-mode{font-size:9px;font-weight:700;color:var(--text-muted);text-align:right;}
  .at-time,.at-dur,.at-party{font-size:10px;color:var(--text-muted);text-align:right;font-variant-numeric:tabular-nums;}
  /* Attempt timeline */
  .ln-wrap{min-width:0;}
  .ln-lanes{display:flex;flex-direction:column;gap:2px;min-width:0;}
  .ln-lane{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;align-items:center;height:26px;min-width:0;}
  .ln-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ln-track{position:relative;display:block;height:100%;min-width:0;background:color-mix(in srgb,#fff 2%,transparent);border-radius:4px;}
  .ln-dot{
    position:absolute;top:50%;transform:translate(-50%,-50%);
    width:10px;height:10px;border-radius:50%;padding:0;border:none;cursor:pointer;
    background:var(--success);
    transition:transform .18s var(--ease-spring);
  }
  .ln-dot.wipe{background:var(--fail);}
  .ln-dot:hover,.ln-dot:focus-visible{transform:translate(-50%,-50%) scale(1.5);z-index:2;outline:none;}
  .ln-count{
    position:absolute;top:-8px;right:-10px;
    font-size:8px;font-weight:800;line-height:1;
    background:var(--bg-card);border:1px solid var(--border);border-radius:6px;
    padding:1px 3px;color:var(--text);
  }
  .ln-axis{display:grid;grid-template-columns:96px minmax(0,1fr);gap:8px;margin-top:4px;}
  .ln-axis-track{position:relative;height:14px;min-width:0;}
  .ln-axis-label{position:absolute;transform:translateX(-50%);font-size:9px;color:var(--text-muted);white-space:nowrap;}
  .an-detail-player .an-dot.kill{background:var(--success);}
  .an-detail-player .an-dot.wipe{background:var(--fail);}
  .an-table-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--border);}
  .an-table{width:100%;border-collapse:collapse;font-size:12px;}
  .an-table thead tr{
    background:color-mix(in srgb,#fff 3%,transparent);
    border-bottom:1px solid var(--border);
  }
  .an-table th{padding:8px 12px;white-space:nowrap;}
  .an-th-left{text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);}
  .an-th-sort{
    text-align:right;font-size:10px;font-weight:600;text-transform:uppercase;
    letter-spacing:.06em;color:var(--text-muted);cursor:pointer;
    user-select:none;transition:color .12s;white-space:nowrap;
  }
  .an-th-sort:hover{color:var(--text);}
  .an-th-sort.active{color:var(--accent);}
  .an-row{border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent);transition:background .12s;}
  .an-row:last-child{border-bottom:none;}
  .an-row:hover{background:color-mix(in srgb,#fff 3%,transparent);}
  .an-row.interactive:hover {
    background: color-mix(in srgb, var(--accent) 5%, rgba(255, 255, 255, 0.04));
  }
  .an-row.interactive.focused {
    background: color-mix(in srgb, var(--accent) 12%, rgba(255, 255, 255, 0.02));
    border-left: 3px solid var(--accent);
  }
  .an-td-boss{padding:8px 12px;font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;}
  .an-td-num{padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted);white-space:nowrap;}
  .an-kill{color:var(--success);font-weight:600;}
  .an-wipe{color:var(--fail);font-weight:600;}
  .an-rate-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;}
  .an-rate-success{background:color-mix(in srgb,var(--success) 18%,transparent);color:var(--success);}
  .an-rate-warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn);}
  .an-rate-fail{background:color-mix(in srgb,var(--fail) 18%,transparent);color:var(--fail);}

  /* Backfill Banner styling */
  .an-backfill-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 10px;
    padding: 10px 14px;
    gap: 16px;
  }
  .an-backfill-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: opacity 0.15s;
  }
  .an-backfill-btn:hover {
    opacity: 0.9;
  }
  .an-backfill-btn:disabled {
    background: var(--border);
    color: var(--text-muted);
    cursor: not-allowed;
  }

  .an-progress-bg {
    background: rgba(255,255,255,0.06);
    border-radius: 4px;
    height: 6px;
    width: 100%;
    margin-top: 4px;
    overflow: hidden;
  }
  .an-progress-bar {
    background: var(--accent);
    height: 100%;
    border-radius: 4px;
    transition: width 0.15s ease-out;
  }
  .an-control-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s;
  }
  .an-control-btn:hover {
    background: rgba(255,255,255,0.12);
  }
  .an-btn-danger {
    border-color: color-mix(in srgb, var(--fail) 50%, var(--border));
    color: var(--fail);
  }
  .an-btn-danger:hover {
    background: color-mix(in srgb, var(--fail) 12%, transparent);
  }

  /* Date Range Input */
  .an-date-input {
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 11px;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    color-scheme: dark;
  }
  .an-date-input::-webkit-calendar-picker-indicator {
    cursor: pointer;
    opacity: 0.9;
    filter: invert(1) brightness(100);
  }
  .an-date-input::-webkit-clear-button,
  .an-date-input::-webkit-inner-spin-button {
    filter: invert(1) brightness(100);
  }

  /* DPS chart detail strip — reserved space, so the card does not jump */
  .an-detail{
    display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px;
    min-height:34px; padding:6px 10px;
    background:var(--bg-panel); border:1px solid var(--border); border-radius:var(--radius);
    font-size:11px;
  }
  .an-detail-title{font-weight:700;color:var(--text);}
  .an-detail-rows{display:flex; flex-wrap:wrap; gap:2px 16px; flex:1; min-width:0;}
  .an-detail-row{display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:190px;}
  .an-detail-player{display:flex; align-items:center; gap:5px; min-width:0;}
  .an-detail-player .an-dot{width:6px; height:6px; border-radius:50%; flex:none;}
  .an-detail-prof{width:17px; height:17px; object-fit:contain;}
  .an-detail-char{color:var(--text-muted);}
  .an-detail-acct{color:var(--text);font-weight:600;}
  .an-detail-val{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums;}
  .an-detail-hp{color:var(--fail);width:100%;margin-top:2px;border-top:1px solid var(--border);padding-top:4px;}
  .an-detail-hint{color:var(--text-muted);opacity:.8;}
  .an-detail-status {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .an-detail-status.kill {
    background: color-mix(in srgb, var(--success) 20%, transparent);
    color: var(--success);
  }
  .an-detail-status.wipe {
    background: color-mix(in srgb, var(--fail) 20%, transparent);
    color: var(--fail);
  }

  /* Searchable Account Dropdown */
  .an-acc-dropdown-wrap {
    position: relative;
    display: inline-block;
  }
  .an-acc-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s, border-color 0.15s;
  }
  .an-acc-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }
  .an-acc-btn-text {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .an-acc-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
  }
  .an-acc-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 240px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    z-index: 50;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: fadeInDown 0.15s ease-out;
  }
  @keyframes fadeInDown {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .an-acc-search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: rgba(0, 0, 0, 0.2);
  }
  .an-acc-search-input {
    flex-grow: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 11px;
    font-family: inherit;
  }
  .an-acc-search-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
  }
  .an-acc-search-clear:hover {
    color: var(--text);
  }
  .an-acc-list {
    max-height: 220px;
    overflow-y: auto;
    padding: 4px;
  }
  .an-acc-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .an-acc-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .an-acc-item.selected {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-weight: 600;
  }
  .an-acc-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-right: 6px;
  }
  .an-acc-item-count {
    font-size: 10px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  /* Profession filter — modal drill-down (core → elite specs), reused from FilterBar */
  .prof-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  .prof-modal {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: min(440px, 100%);
    max-height: 80vh;
    overflow-y: auto;
    padding: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  .prof-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  .prof-modal-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }
  .prof-modal-title.sub {
    margin-bottom: 12px;
    color: var(--text-muted);
    font-weight: 600;
    font-size: 12px;
  }
  .prof-modal-close,
  .prof-modal-back {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-family: var(--font);
    padding: 5px 9px;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .prof-modal-close:hover,
  .prof-modal-back:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }
  .prof-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .prof-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font);
    text-align: left;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .prof-cell:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  }
  .prof-cell-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
    flex: none;
  }
  .prof-grid-core .prof-cell-icon {
    width: 52px;
    height: 52px;
  }
  .prof-cell-core .prof-cell-icon {
    width: 52px;
    height: 52px;
  }
  .prof-cell-name {
    flex: 1;
  }
  .prof-cell-arrow {
    color: var(--text-muted);
    font-size: 11px;
  }
  .prof-cell-check {
    color: var(--accent);
    font-size: 12px;
  }

  .an-acc-empty {
    padding: 12px;
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
  }

  /* Toast Notification */
  .an-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 12px 18px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    z-index: 100;
    animation: slideUp 0.25s ease-out;
  }
  /* Shimmer Skeleton Loaders */
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .skeleton-card {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
  }
  .skeleton-val {
    height: 28px;
    width: 60px;
    border-radius: 6px;
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite linear;
  }
  .skeleton-label {
    height: 10px;
    width: 90px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite linear;
  }
  .skeleton-section {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    pointer-events: none;
  }
  .skeleton-chart-header {
    height: 16px;
    width: 140px;
    border-radius: 4px;
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite linear;
  }
  .skeleton-chart-body {
    flex: 1;
    border-radius: 8px;
    background: linear-gradient(90deg, rgba(255,255,255,0.02) 25%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.02) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite linear;
  }

  /* Reduced motion: the skeleton shimmer loops forever, so it needs an
     explicit opt-out. */
  @media (prefers-reduced-motion: reduce) {
    .skeleton-val,
    .skeleton-label,
    .skeleton-chart-header,
    .skeleton-chart-body,
    .an-acc-menu,
    .an-toast,
    .an-progress-bar,
    .ln-dot,
    .hm-cell {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
