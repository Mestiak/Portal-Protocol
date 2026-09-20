<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { aggregateStats, getAvailableBosses, clearAnalyticsCache, buildPersonalDpsSeries, buildMultiPlayerDpsSeries, cleanAccountName, aggregatePlayers, isCerusLog, getFilteredCerusUrls, buildCerusLeaderboardRows, defaultCerusSort, type CerusLeaderboardRow } from '../lib/analyticsEngine';
  import type { AnalyticsLog, ActivityPoint, WipeBucket, ProfessionCount, PersonalDpsPoint, MultiPlayerDpsPoint, PlayerDpsMatch } from '../lib/analyticsEngine';
  import { extractMechanics, mergeCerusReports, MAX_AGGREGATE_LOGS, type MechanicReport } from '../lib/mechanicParser';
  import { fmtTime } from '../lib/format';
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
  let tooltipData = $state<{
    visible: boolean;
    x: number;
    y: number;
    flip: boolean; // true → render below the dot (avoids clipping the top edge)
    point: MultiPlayerDpsPoint | null;
  }>({ visible: false, x: 0, y: 0, flip: false, point: null });
  let tooltipEl = $state<HTMLDivElement | null>(null);

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
  type CerusPerLog = {
    orbs: number[]; empowered: number[]; rageHits: number[];
    shadows: number[]; stripped: number[]; orbEff: number[]; bestPull: number[];
  };
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
      cards.push({ icon: '🔥', text: `${top.account} leads at ${top.avgDps.toLocaleString()} avg DPS`, tone: 'neutral' });
    }
    if (cardTrends) {
      const r = cardTrends.rate;
      if (!r.same) {
        cards.push({
          icon: r.good ? '📈' : '📉',
          text: `Kill rate ${r.up ? 'up' : 'down'} ${fmtKpiDelta(r, 'pct')} vs prev`,
          tone: r.good ? 'good' : 'bad'
        });
      }
    }
    const mostWiped = [...stats.bossBreakdown].sort((a, b) => b.wipes - a.wipes)[0];
    if (mostWiped && mostWiped.wipes > 0) {
      cards.push({ icon: '⚠️', text: `Most wipes on ${mostWiped.boss} (${mostWiped.wipes})`, tone: 'bad' });
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

  // Store point hitboxes for multi-player performance chart tooltips
  let dpsPointHitboxes: { x: number; y: number; point: MultiPlayerDpsPoint }[] = [];

  // ─── Canvas refs ───────────────────────────────────────────────────────────
  let activityCanvas = $state<HTMLCanvasElement | null>(null);
  let wipeCanvas = $state<HTMLCanvasElement | null>(null);
  let dpsCanvas = $state<HTMLCanvasElement | null>(null);

  let activityRO: ResizeObserver | null = null;
  let wipeRO: ResizeObserver | null = null;
  let dpsRO: ResizeObserver | null = null;

  // ─── Chart drawing helpers ─────────────────────────────────────────────────
  const KILL_COLOR = '#10b981';
  const WIPE_COLOR = '#ef4444';
  const GRID_COLOR = 'rgba(255,255,255,0.06)';
  const TEXT_COLOR = '#94a3b8';
  const AXIS_COLOR = 'rgba(255,255,255,0.12)';

  function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; W: number; H: number } | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (W === 0 || H === 0) return null;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    return { ctx, W, H };
  }

  function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
    const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
  }

  function drawActivity(canvas: HTMLCanvasElement, series: ActivityPoint[]) {
    const s = setupCanvas(canvas);
    if (!s) return;
    const { ctx, W, H } = s;
    ctx.clearRect(0, 0, W, H);
    if (series.length === 0) return;
    const PL = 36, PR = 12, PT = 12, PB = 40;
    const cW = W - PL - PR, cH = H - PT - PB;
    const maxV = Math.max(...series.map(p => p.total), 1);
    const gap = 4;
    const bW = Math.max(4, (cW - gap * (series.length - 1)) / series.length);
    ctx.font = '10px system-ui';
    for (let i = 0; i <= 4; i++) {
      const y = PT + cH * (1 - i / 4);
      ctx.strokeStyle = GRID_COLOR; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
      if (i > 0) {
        ctx.fillStyle = TEXT_COLOR; ctx.textAlign = 'right';
        ctx.fillText(String(Math.round(maxV * i / 4)), PL - 4, y + 4);
      }
    }
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      const x = PL + i * (bW + gap);
      if (p.wipes > 0) {
        const h = (p.wipes / maxV) * cH;
        ctx.fillStyle = WIPE_COLOR;
        rr(ctx, x, PT + cH - h, bW, h, [3, 3, 0, 0]); ctx.fill();
      }
      if (p.kills > 0) {
        const hW = (p.wipes / maxV) * cH;
        const hK = (p.kills / maxV) * cH;
        ctx.fillStyle = KILL_COLOR;
        rr(ctx, x, PT + cH - hW - hK, bW, hK, [3, 3, 0, 0]); ctx.fill();
      }
      const step = series.length <= 14 ? 1 : series.length <= 30 ? 3 : 7;
      if (i % step === 0) {
        ctx.fillStyle = TEXT_COLOR; ctx.textAlign = 'center';
        ctx.fillText(p.label, x + bW / 2, H - PB + 14);
      }
    }
    ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PL, PT + cH); ctx.lineTo(W - PR, PT + cH); ctx.stroke();
  }

  function drawWipeProf(canvas: HTMLCanvasElement, buckets: WipeBucket[], professions: ProfessionCount[]) {
    const s = setupCanvas(canvas);
    if (!s) return;
    const { ctx, W, H } = s;
    ctx.clearRect(0, 0, W, H);
    const half = W / 2;
    const PL = 52, PR = 12, PT = 12, PB = 16;
    const cH = H - PT - PB;
    const maxC = Math.max(...buckets.map(b => b.count), 1);
    const gap = 6;
    const bH = (cH - gap * (buckets.length - 1)) / buckets.length;
    const cW = half - PL - PR;
    ctx.font = '10px system-ui';
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const y = PT + i * (bH + gap);
      const bL = b.count > 0 ? (b.count / maxC) * cW : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; rr(ctx, PL, y, cW, bH, 4); ctx.fill();
      if (bL > 0) {
        const g = ctx.createLinearGradient(PL, 0, PL + bL, 0);
        g.addColorStop(0, '#6366f1'); g.addColorStop(1, '#a78bfa');
        ctx.fillStyle = g; rr(ctx, PL, y, bL, bH, 4); ctx.fill();
      }
      ctx.fillStyle = TEXT_COLOR; ctx.textAlign = 'right';
      ctx.fillText(b.label, PL - 6, y + bH / 2 + 4);
      if (b.count > 0) {
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        ctx.fillText(String(b.count), PL + bL + 4, y + bH / 2 + 4);
      }
    }
    ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(half, PT); ctx.lineTo(half, H - PB); ctx.stroke();
    ctx.setLineDash([]);
    
    // Squad Composition Chart Layout (Fixed overflow)
    const PL2 = half + 80;
    const PR2 = 45;
    const maxBarW = Math.max(20, W - PL2 - PR2);
    const top = professions.slice(0, 6);
    if (top.length === 0) {
      ctx.fillStyle = TEXT_COLOR; ctx.textAlign = 'center';
      ctx.fillText('No profession data', half + (W - half) / 2, H / 2);
      return;
    }
    const maxP = Math.max(...top.map(p => p.count), 1);
    const pbH = Math.min(24, (cH - gap * (top.length - 1)) / top.length);
    const pGap = Math.max(gap, (cH - pbH * top.length) / (top.length + 1));
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      const y = PT + pGap + i * (pbH + pGap);
      const bL = (p.count / maxP) * maxBarW;
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; rr(ctx, PL2, y, maxBarW, pbH, 4); ctx.fill();
      ctx.fillStyle = p.color; ctx.globalAlpha = 0.85;
      rr(ctx, PL2, y, bL, pbH, 4); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = TEXT_COLOR; ctx.textAlign = 'right';
      let displayName = p.name;
      if (ctx.measureText(displayName).width > 70) { displayName = displayName.slice(0, 8) + '…'; }
      ctx.fillText(displayName, PL2 - 8, y + pbH / 2 + 4);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      const labelX = Math.min(PL2 + bL + 6, W - 38);
      ctx.fillText(p.pct.toFixed(1) + '%', labelX, y + pbH / 2 + 4);
    }
  }

  function drawPersonalDpsChart(canvas: HTMLCanvasElement, series: MultiPlayerDpsPoint[]) {
    const s = setupCanvas(canvas);
    if (!s) return;
    const { ctx, W, H } = s;
    ctx.clearRect(0, 0, W, H);
    // Empty state: require a comparison scope (specific boss, specific mode, or a
    // custom date window) before comparing DPS. The default All+All+30d shows a
    // prompt to pick something.
    const hasScope = (activeFilters.boss && activeFilters.boss !== 'all') ||
                     (activeFilters.mode && activeFilters.mode !== 'all') ||
                     (activeFilters.range === 'custom' &&
                       (activeFilters.customStart || activeFilters.customEnd ||
                        activeFilters.customStartTime || activeFilters.customEndTime));
    if (!hasScope) {
      dpsPointHitboxes = [];
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Select encounters to compare DPS', W / 2, H / 2);
      return;
    }

    if (series.length === 0 || selectedAccounts.length === 0) {
      dpsPointHitboxes = [];
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No player performance logs found for selected filters', W / 2, H / 2);
      return;
    }

    // Allocate right padding (PR = 45) for the secondary Wipe HP% Y-axis
    const PL = 50, PR = 45, PT = 15, PB = 35;
    const cW = W - PL - PR, cH = H - PT - PB;

    // Collect all player values to derive global Y-axis scale
    const allValues: number[] = [];
    for (const pt of series) {
      for (const m of Object.values(pt.players)) {
        allValues.push(m.value);
      }
    }
    const minVal = allValues.length ? Math.min(...allValues) * 0.9 : 0;
    const maxVal = allValues.length ? Math.max(...allValues) * 1.1 : 10000;
    const valRange = maxVal - minVal || 1;

    // Draw horizontal grid lines & Y-axes
    ctx.font = '10px system-ui';
    for (let i = 0; i <= 4; i++) {
      const val = minVal + (valRange * i) / 4;
      const y = PT + cH * (1 - i / 4);

      // Grid line
      ctx.strokeStyle = GRID_COLOR; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();

      // Left Y-axis (DPS)
      ctx.fillStyle = TEXT_COLOR;
      ctx.textAlign = 'right';
      ctx.fillText((val / 1000).toFixed(1) + 'k', PL - 8, y + 3);

      // Right Y-axis (Wipe HP% scale: 0% at top, 100% at baseline)
      const hpVal = Math.round(100 * (1 - i / 4));
      ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.textAlign = 'left';
      ctx.fillText(hpVal + '%', W - PR + 8, y + 3);
    }

    // Map log X coordinates
    const logCoords = series.map((pt, idx) => {
      const x = PL + (series.length > 1 ? (idx / (series.length - 1)) * cW : cW / 2);
      let yHp: number | null = null;
      if (!pt.success && pt.bossHpLeft != null) {
        yHp = PT + cH * (pt.bossHpLeft / 100);
      }
      return { x, yHp, point: pt };
    });

    // Wipe depth dotted line
    const wipeCoords = logCoords.filter(c => c.yHp !== null) as { x: number; yHp: number; point: MultiPlayerDpsPoint }[];
    if (wipeCoords.length > 1) {
      ctx.beginPath();
      ctx.moveTo(wipeCoords[0].x, wipeCoords[0].yHp);
      for (let i = 1; i < wipeCoords.length; i++) {
        ctx.lineTo(wipeCoords[i].x, wipeCoords[i].yHp);
      }
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const hitboxes: { x: number; y: number; point: MultiPlayerDpsPoint }[] = [];

    // Draw per-player trend lines and dots
    selectedAccounts.forEach((acc) => {
      const color = getPlayerColor(acc);
      const playerPoints: { x: number; y: number; val: number }[] = [];

      logCoords.forEach((lc) => {
        const match = lc.point.players[acc];
        if (match) {
          const y = PT + cH * (1 - (match.value - minVal) / valRange);
          playerPoints.push({ x: lc.x, y, val: match.value });
          hitboxes.push({ x: lc.x, y, point: lc.point });
        }
      });

      if (playerPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(playerPoints[0].x, playerPoints[0].y);
        for (let i = 1; i < playerPoints.length; i++) {
          ctx.lineTo(playerPoints[i].x, playerPoints[i].y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      // Draw per-point dots only when the series is small (focused filter).
      // With no/loose filter there can be dozens of points per player — drawing
      // a dot on each just clutters the line, so we skip them and rely on hover.
      if (series.length <= 30) {
        for (const p of playerPoints) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#1e1e24';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    });

    dpsPointHitboxes = hitboxes;

    // Highlight hovered point if active
    if (tooltipData.visible && tooltipData.point) {
      const hLog = logCoords.find(c => c.point === tooltipData.point);
      if (hLog) {
        // Highlight wipe HP dot if present
        if (hLog.yHp !== null) {
          ctx.beginPath();
          ctx.arc(hLog.x, hLog.yHp, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#ef4444';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        selectedAccounts.forEach((acc) => {
          const match = hLog.point.players[acc];
          if (match) {
            const y = PT + cH * (1 - (match.value - minVal) / valRange);
            ctx.beginPath();
            ctx.arc(hLog.x, y, 6.5, 0, Math.PI * 2);
            ctx.fillStyle = getPlayerColor(acc);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        });
      }
    }

    // X-axis date labels
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(series.length / 8));
    for (let i = 0; i < logCoords.length; i += labelStep) {
      ctx.fillText(logCoords[i].point.label, logCoords[i].x, H - PB + 16);
    }

    // X-axis baseline
    ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PL, PT + cH); ctx.lineTo(W - PR, PT + cH); ctx.stroke();
  }

  let mouseMoveRaf: number | null = null;
  function handleDpsCanvasMouseMove(e: MouseEvent) {
    if (!dpsCanvas || dpsPointHitboxes.length === 0) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (mouseMoveRaf) return;
    mouseMoveRaf = requestAnimationFrame(() => {
      mouseMoveRaf = null;
      if (!dpsCanvas) return;
      const rect = dpsCanvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      let closest: { x: number; y: number; point: MultiPlayerDpsPoint } | null = null;
      let minDist = 24;

      for (const item of dpsPointHitboxes) {
        const dist = Math.hypot(mouseX - item.x, mouseY - item.y);
        if (dist < minDist) {
          minDist = dist;
          closest = item;
        }
      }

      if (closest) {
        const chartW = rect.width || dpsCanvas.clientWidth || 600;
        const tipW = tooltipEl ? tooltipEl.offsetWidth : 0;
        const tipH = tooltipEl ? tooltipEl.offsetHeight : 0;
        const halfW = tipW > 0 ? tipW / 2 : 120;
        const estH = tipH > 0 ? tipH : 140;
        let tx = closest.x;
        if (tx < halfW) tx = halfW;
        if (tx > chartW - halfW) tx = chartW - halfW;
        const flip = closest.y - estH - 12 < 0;
        const ty = flip ? closest.y + 12 : closest.y - 12;
        tooltipData = {
          visible: true,
          x: tx,
          y: ty,
          flip,
          point: closest.point
        };
        if (dpsCanvas) drawPersonalDpsChart(dpsCanvas, multiPlayerSeries);
      } else if (tooltipData.visible) {
        tooltipData = { visible: false, x: 0, y: 0, flip: false, point: null };
        if (dpsCanvas) drawPersonalDpsChart(dpsCanvas, multiPlayerSeries);
      }
    });
  }

  function handleDpsCanvasMouseLeave() {
    if (mouseMoveRaf) {
      cancelAnimationFrame(mouseMoveRaf);
      mouseMoveRaf = null;
    }
    if (tooltipData.visible) {
      tooltipData = { visible: false, x: 0, y: 0, flip: false, point: null };
      if (dpsCanvas) drawPersonalDpsChart(dpsCanvas, multiPlayerSeries);
    }
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

  // ─── Canvas reactive effects ───────────────────────────────────────────────
  $effect(() => {
    const canvas = activityCanvas;
    const series = stats.activitySeries;
    if (!canvas) return;
    const draw = () => drawActivity(canvas, series);
    draw();
    activityRO?.disconnect();
    activityRO = new ResizeObserver(draw);
    activityRO.observe(canvas);
    return () => { activityRO?.disconnect(); activityRO = null; };
  });

  $effect(() => {
    const canvas = wipeCanvas;
    const buckets = stats.wipeDepthBuckets;
    const profs = stats.professionFrequency;
    if (!canvas) return;
    const draw = () => drawWipeProf(canvas, buckets, profs);
    draw();
    wipeRO?.disconnect();
    wipeRO = new ResizeObserver(draw);
    wipeRO.observe(canvas);
    return () => { wipeRO?.disconnect(); wipeRO = null; };
  });

  $effect(() => {
    const canvas = dpsCanvas;
    const series = multiPlayerSeries;
    if (!canvas) return;
    const draw = () => drawPersonalDpsChart(canvas, series);
    draw();
    dpsRO?.disconnect();
    dpsRO = new ResizeObserver(draw);
    dpsRO.observe(canvas);
    return () => { dpsRO?.disconnect(); dpsRO = null; };
  });

  onDestroy(() => {
    isDestroyed = true;
    if (mouseMoveRaf) {
      cancelAnimationFrame(mouseMoveRaf);
      mouseMoveRaf = null;
    }
    activityRO?.disconnect();
    wipeRO?.disconnect();
    dpsRO?.disconnect();
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
        <option value="convergence">Convergence</option>
        <option value="wvw">WvW</option>
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
          <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-left:3px solid {c.tone === 'good' ? '#10b981' : c.tone === 'bad' ? '#ef4444' : 'var(--accent)'}; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; color:var(--text);">
            <span>{c.icon}</span><span>{c.text}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Summary cards -->
    <div class="an-cards">
      <div class="an-card">
        <div class="an-card-val an-cyan">{stats.totalLogs}</div>
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
        <div class="an-card-val an-green">{stats.totalKills}</div>
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
        <div class="an-card-val an-red">{stats.totalWipes}</div>
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
        <div class="an-card-val {stats.overallSuccessRate >= 50 ? 'an-green' : 'an-red'}">{fmtPct(stats.overallSuccessRate)}<span class="an-unit">%</span></div>
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
        <div class="an-card-val an-purple">{fmtDur(stats.avgDuration)}</div>
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
      
      <div style="position:relative; width:100%;">
        <canvas
          class="an-canvas"
          bind:this={dpsCanvas}
          style="height:210px;"
          onmousemove={handleDpsCanvasMouseMove}
          onmouseleave={handleDpsCanvasMouseLeave}
        ></canvas>

        {#if tooltipData.visible && tooltipData.point}
          <div
            class="dps-tooltip"
            bind:this={tooltipEl}
            style="left:{tooltipData.x}px; top:{tooltipData.y}px; transform: translate(-50%, {tooltipData.flip ? '0' : '-100%'});"
          >
            <div class="dps-tooltip-title" style="margin-bottom:6px;">
              <span class="dps-tooltip-status {tooltipData.point.success ? 'kill' : 'wipe'}">
                {tooltipData.point.success ? 'KILL' : 'WIPE'}
              </span>
              <span>{tooltipData.point.bossName} ({tooltipData.point.label})</span>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:4px;">
              {#each selectedAccounts as acc}
                {#if tooltipData.point.players[acc]}
                  {@const pMatch = tooltipData.point.players[acc]}
                  <div style="display:flex; align-items:center; justify-space-between; gap:12px; font-size:11px;">
                    <span style="display:flex; align-items:center; gap:5px; color:{getPlayerColor(acc)}; font-weight:600;">
                      <span style="width:6px; height:6px; border-radius:50%; background:{getPlayerColor(acc)};"></span>
                      {#if profIconFor(pMatch.profession, pMatch.elite_spec)}
                        <img src={profIconFor(pMatch.profession, pMatch.elite_spec)} alt="" style="width:17px; height:17px; object-fit:contain;" />
                      {/if}
                      <span style="font-weight:400; color:var(--text-muted);">{pMatch.charName}</span>
                      <span>{acc}</span>
                    </span>
                    <span style="color:var(--text); font-weight:700;">
                      {pMatch.value.toLocaleString()}
                    </span>
                  </div>
                {/if}
              {/each}
            </div>

            {#if !tooltipData.point.success && tooltipData.point.bossHpLeft != null}
              <div class="dps-tooltip-val" style="color: #fca5a5; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); padding-top:4px;">
                Wipe HP: <strong>{tooltipData.point.bossHpLeft.toFixed(1)}%</strong>
              </div>
            {/if}
          </div>
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
              <span class="an-warn">⚠ {cerusScopeUrls.length} logs — averages may be skewed</span>
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

    <!-- Grid container for secondary charts -->
    <div class="an-charts-grid">
      <!-- Activity chart -->
      <div class="an-section">
        <div class="an-section-head">
          <span class="an-section-title"><i class="fa-solid fa-chart-column"></i> Encounter Activity</span>
          <div class="an-legend">
            <span class="an-leg-dot" style="background:#10b981;"></span><span class="an-leg-label">Kills</span>
            <span class="an-leg-dot" style="background:#ef4444;"></span><span class="an-leg-label">Wipes</span>
          </div>
        </div>
        <canvas class="an-canvas" bind:this={activityCanvas} style="height:200px;"></canvas>
      </div>

      <!-- Wipe depth + profession distribution -->
      <div class="an-section">
        <div class="an-section-head" style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding-bottom: 8px;">
          <span class="an-section-title"><i class="fa-solid fa-heart-crack"></i> Wipe Depth</span>
          <span class="an-section-title" style="border-left: 1px solid var(--border); padding-left: 16px;"><i class="fa-solid fa-user-group"></i> Squad Composition</span>
        </div>
        <canvas class="an-canvas" bind:this={wipeCanvas} style="height:200px;"></canvas>
      </div>
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
                  <span class="an-rate-pill {b.successRate >= 50 ? 'an-rate-green' : b.successRate >= 25 ? 'an-rate-yellow' : 'an-rate-red'}">
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

  {/if}
</div>

<style>
  .analytics-wrap{display:flex;flex-direction:column;gap:20px;width:100%;min-width:0;}
  .an-charts-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
    width: 100%;
  }
  @media (min-width: 1024px) {
    .an-charts-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
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
    padding:80px 24px;background:var(--bg-card);border:1px dashed var(--border);
    border-radius:14px;color:var(--text);text-align:center;
  }
  .an-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;}
  .an-card{
    background:var(--bg-card);border:1px solid var(--border);border-radius:12px;
    padding:14px 16px;display:flex;flex-direction:column;gap:4px;
    transition:border-color .2s,box-shadow .2s;
  }
  .an-card:hover{
    border-color:color-mix(in srgb,var(--accent) 50%,transparent);
    box-shadow:0 4px 20px color-mix(in srgb,var(--accent) 12%,transparent);
  }
  .an-card-val{font-size:28px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:.01em;}
  .an-unit{font-size:14px;font-weight:700;color:var(--text-muted);margin-left:1px;}
  .an-card-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);}
  .an-card-delta{font-size:10px;font-weight:700;margin-top:5px;display:flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums;}
  .an-card-delta.good{color:var(--success);}
  .an-card-delta.bad{color:var(--fail);}
  .an-card-delta.same{color:var(--text-muted);font-weight:600;}
  .an-card-delta-cap{font-size:9px;font-weight:500;opacity:.65;text-transform:uppercase;letter-spacing:.04em;}
  .an-cyan{color:#22d3ee;}
  .an-green{color:#10b981;}
  .an-red{color:#ef4444;}
  .an-purple{color:#a78bfa;}
  .an-gold{color:#fbbf24;}
  .an-section{
    background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
    padding:14px 16px;display:flex;flex-direction:column;gap:12px;
  }
  .an-section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .an-section-title{
    font-size:11px;font-weight:700;text-transform:uppercase;
    letter-spacing:.08em;color:var(--text);display:flex;align-items:center;gap:7px;
  }
  .an-section-title i{color:var(--accent);font-size:12px;}
  .an-warn{font-size:11px;font-weight:600;color:var(--fail);background:color-mix(in srgb,var(--fail) 12%,transparent);border:1px solid color-mix(in srgb,var(--fail) 35%,transparent);padding:3px 8px;border-radius:6px;}
  .an-loading{display:flex;align-items:center;gap:8px;padding:18px 4px;color:var(--text-muted);font-size:13px;}
  .an-error{padding:18px 4px;color:var(--fail);font-size:13px;}
  .an-muted-sm{font-size:11px;color:var(--text-muted);}
  .an-btn{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,#fff 4%,transparent);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s;}
  .an-btn:hover{background:color-mix(in srgb,#fff 8%,transparent);}
  .an-btn-primary{border-color:color-mix(in srgb,var(--accent) 55%,var(--border));background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--text);}
  .an-btn-primary:hover{background:color-mix(in srgb,var(--accent) 26%,transparent);}
  .cl-empty{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:22px 4px 8px;}
  .cl-empty p{margin:0;color:var(--text-muted);font-size:13px;max-width:560px;}

  .an-leg-dot{width:10px;height:10px;border-radius:50%;display:inline-block;}
  .an-leg-label{font-size:10px;color:var(--text-muted);}
  .an-canvas{width:100%;display:block;border-radius:8px;}
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
  .an-row.interactive.focused td {
    color: #fff;
  }
  .an-td-boss{padding:8px 12px;font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;}
  .an-td-num{padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted);white-space:nowrap;}
  .an-kill{color:#10b981;font-weight:600;}
  .an-wipe{color:#ef4444;font-weight:600;}
  .an-rate-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;}
  .an-rate-green{background:color-mix(in srgb,#10b981 18%,transparent);color:#6ee7b7;}
  .an-rate-yellow{background:color-mix(in srgb,#fbbf24 18%,transparent);color:#fcd34d;}
  .an-rate-red{background:color-mix(in srgb,#ef4444 18%,transparent);color:#fca5a5;}

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
    border-color: color-mix(in srgb, var(--red) 50%, var(--border));
    color: var(--red);
  }
  .an-btn-danger:hover {
    background: color-mix(in srgb, var(--red) 12%, transparent);
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

  /* Personal DPS Tooltip */
  .dps-tooltip {
    position: absolute;
    transform: translate(-50%, -100%);
    pointer-events: none;
    background: rgba(20, 20, 26, 0.94);
    backdrop-filter: blur(8px);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    z-index: 10;
    white-space: nowrap;
  }
  .dps-tooltip-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 2px;
  }
  .dps-tooltip-status {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .dps-tooltip-status.kill {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }
  .dps-tooltip-status.wipe {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }
  .dps-tooltip-val {
    font-size: 11px;
    color: var(--text-muted);
  }
  .dps-tooltip-val strong {
    color: #a78bfa;
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
    background: #18181f;
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
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
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
    background: #16171f;
    border: 1px solid var(--border);
    border-radius: 12px;
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
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.4);
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
    color: #c084fc;
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
    background: #1e1e24;
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
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .skeleton-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
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
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
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
</style>
