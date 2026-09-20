// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

/**
 * analyticsEngine.ts
 * Pure TypeScript aggregation helpers for the Analytics Dashboard.
 * Zero Svelte/DOM dependencies — safe to unit-test in isolation.
 *
 * Memoization: results are cached by a string key derived from the filter
 * combo. The cache is bounded to MAX_CACHE_SIZE entries so it cannot grow
 * unbounded even if the user rapidly toggles filters.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
/** Minimal projection of UploadRecord fields used by analytics. */

import { buildProfessionGroups, SPEC_CORE, PROFESSIONS } from './professionData.ts';
const SPEC_NAMES: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  for (const g of buildProfessionGroups()) for (const s of g.specs) out[s.id] = s.name;
  return out;
})();
export interface AnalyticsLog {
  timestamp: string;
  status: string;
  url?: string | null;
  boss_name?: string | null;
  success?: boolean | null;
  duration?: number | null;
  is_cm?: boolean | null;
  is_lcm?: boolean | null;
  is_convergence?: boolean | null;
  is_wvw?: boolean | null;
  is_story?: boolean | null;
  num_players?: number | null;
  boss_hp_left?: number | null;
  players?: { display_name?: string; account?: string; profession?: number; elite_spec?: number | null; role?: string; dps?: number | null; cleave_dps?: number | null }[] | null;
}

export interface AnalyticsFilters {
  boss: string;
  mode: string;
  range: string;
  profession?: string | number; // "all" or a PROFESSIONS key / elite_spec id
  professionKind?: "all" | "core" | "spec"; // base-id vs elite-spec-id
  customStart?: string;
  customEnd?: string;
  customStartTime?: string; // HH:MM, for sub-day filtering within a custom date
  customEndTime?: string;   // HH:MM
}

export interface BossStats {
  boss: string;
  kills: number;
  wipes: number;
  total: number;
  successRate: number;
  avgDuration: number | null;
  shortestKill: number | null;
  avgWipeHp: number | null;
}

export interface ActivityPoint {
  label: string;
  date: Date;
  kills: number;
  wipes: number;
  total: number;
}

export interface ProfessionCount {
  profId: number;
  name: string;
  color: string;
  count: number;
  pct: number;
}

export interface WipeBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface AggregatedStats {
  totalLogs: number;
  totalKills: number;
  totalWipes: number;
  overallSuccessRate: number;
  avgDuration: number | null;
  shortestKill: number | null;
  mostPlayedBoss: string | null;
  bossBreakdown: BossStats[];
  activitySeries: ActivityPoint[];
  professionFrequency: ProfessionCount[];
  wipeDepthBuckets: WipeBucket[];
  empty: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CACHE_SIZE = 64;

const WIPE_BUCKETS: Omit<WipeBucket, "count">[] = [
  { label: "0-10%",  min: 0,  max: 10  },
  { label: "10-20%", min: 10, max: 20  },
  { label: "20-30%", min: 20, max: 30  },
  { label: "30-40%", min: 30, max: 40  },
  { label: "40-50%", min: 40, max: 50  },
  { label: "50%+",   min: 50, max: 101 },
];

// ─── Memoization ──────────────────────────────────────────────────────────────

const memo = new Map<string, AggregatedStats>();

function memoKey(logsLen: number, filters: AnalyticsFilters): string {
  return `${logsLen}|${filters.boss}|${filters.mode}|${filters.range}|${filters.profession ?? 'all'}|${filters.professionKind ?? 'all'}|${filters.customStart ?? ''}|${filters.customEnd ?? ''}|${filters.customStartTime ?? ''}|${filters.customEndTime ?? ''}`;
}

function memoSet(key: string, value: AggregatedStats): void {
  if (memo.size >= MAX_CACHE_SIZE) {
    const first = memo.keys().next().value;
    if (first !== undefined) memo.delete(first);
  }
  memo.set(key, value);
}

export function clearAnalyticsCache(): void {
  memo.clear();
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function parseLogDate(ts: string): Date {
  return new Date(ts.replace(" ", "T"));
}

function rangeStart(range: string): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Filter helpers ───────────────────────────────────────────────────────────

function isRelevant(log: AnalyticsLog): boolean {
  if (log.status !== "Completed" && log.status !== "Duplicate" && log.status !== "On Hold") {
    return false;
  }
  // Exclude WvW, Convergences, and Story logs from Analytics Dashboard (only Raids, Strikes, Fractals)
  if (log.is_wvw || log.is_convergence || log.is_story) {
    return false;
  }
  return true;
}

function passesMode(log: AnalyticsLog, mode: string): boolean {
  if (mode === "all") return true;
  if (mode === "wvw") return !!log.is_wvw;
  if (mode === "convergence") return !!log.is_convergence;
  if (mode === "lcm") return !!log.is_lcm;
  if (mode === "cm") return !!log.is_cm && !log.is_lcm;
  if (mode === "nm") return !log.is_cm && !log.is_lcm && !log.is_convergence && !log.is_wvw;
  return true;
}

function applyFilters(logs: AnalyticsLog[], filters: AnalyticsFilters): AnalyticsLog[] {
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  // If the user has picked any custom date, ALWAYS honor that window — even
  // when range isn't literally "custom" — so a selected day can never silently
  // fall back to all-time (the 131-logs bug). A lone start date means
  // "that one day", so default the end to the same day.
  if (filters.customStart || filters.customEnd) {
    const end = filters.customEnd || filters.customStart;
    if (filters.customStart) {
      // Use || (not ??) so an empty-string time from the UI falls back to
      // 00:00. ?? only catches null/undefined, so "" would produce "T:00"
      // -> Invalid Date -> start boundary never excludes anything -> 131 bug.
      const startT = (filters.customStartTime || "00:00") + ":00";
      startDate = new Date(`${filters.customStart}T${startT}`);
    }
    const endT = filters.customEndTime ? `${filters.customEndTime}:59.999` : "23:59:59.999";
    endDate = new Date(`${end}T${endT}`);
  } else if (filters.range === "custom") {
    // Custom selected but no dates at all → don't silently fall back to
    // all-time (the user would see every log). Show nothing until a date is set.
    return [];
  } else {
    startDate = rangeStart(filters.range);
  }

  return logs.filter((log) => {
    if (!isRelevant(log)) return false;
    const d = parseLogDate(log.timestamp);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    if (filters.boss !== "all" && log.boss_name !== filters.boss) return false;
    if (!passesMode(log, filters.mode)) return false;
    if ((filters.profession ?? "all") !== "all") {
      const want = Number(filters.profession);
      const hit = (log.players ?? []).some((p) =>
        filters.professionKind === "spec" ? p.elite_spec === want : p.profession === want,
      );
      if (!hit) return false;
    }
    return true;
  });
}

// ─── Boss breakdown ───────────────────────────────────────────────────────────

function buildBossBreakdown(logs: AnalyticsLog[]): BossStats[] {
  const map = new Map<string, { kills: number; wipes: number; durations: number[]; wipesHp: number[] }>();
  for (const log of logs) {
    const boss = log.boss_name ?? "Unknown";
    if (!map.has(boss)) map.set(boss, { kills: 0, wipes: 0, durations: [], wipesHp: [] });
    const entry = map.get(boss)!;
    if (log.success === true) {
      entry.kills++;
      if (log.duration != null && log.duration > 0) entry.durations.push(log.duration);
    } else if (log.success === false) {
      entry.wipes++;
      if (log.boss_hp_left != null) entry.wipesHp.push(log.boss_hp_left);
    }
  }
  const result: BossStats[] = [];
  for (const [boss, data] of map.entries()) {
    const total = data.kills + data.wipes;
    const avgDuration = data.durations.length ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length : null;
    const shortestKill = data.durations.length ? Math.min(...data.durations) : null;
    const avgWipeHp = data.wipesHp.length ? data.wipesHp.reduce((a, b) => a + b, 0) / data.wipesHp.length : null;
    result.push({ boss, kills: data.kills, wipes: data.wipes, total, successRate: total > 0 ? (data.kills / total) * 100 : 0, avgDuration, shortestKill, avgWipeHp });
  }
  return result.sort((a, b) => b.total - a.total);
}

// ─── Activity series ──────────────────────────────────────────────────────────

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildActivitySeries(logs: AnalyticsLog[], range: string): ActivityPoint[] {
  const byWeek = range === "90d" || range === "all";
  const map = new Map<string, { kills: number; wipes: number; date: Date }>();
  for (const log of logs) {
    const d = parseLogDate(log.timestamp);
    const key = byWeek
      ? `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")}`
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, { kills: 0, wipes: 0, date: d });
    const entry = map.get(key)!;
    if (log.success === true) entry.kills++;
    else if (log.success === false) entry.wipes++;
  }
  return Array.from(map.entries())
    .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
    .map(([, data]) => ({
      label: byWeek
        ? `W${getISOWeek(data.date)} ${SHORT_MONTHS[data.date.getMonth()]}`
        : `${SHORT_MONTHS[data.date.getMonth()]} ${data.date.getDate()}`,
      date: data.date,
      kills: data.kills,
      wipes: data.wipes,
      total: data.kills + data.wipes,
    }));
}

// ─── Profession frequency ─────────────────────────────────────────────────────

function buildProfessionFrequency(logs: AnalyticsLog[]): ProfessionCount[] {
  // Group by elite specialization when present, else by core profession.
  // This lets the Squad Composition chart show elite specs (e.g. Scourge,
  // Dragonhunter) as their own bars while core players still appear by core name.
  const counts = new Map<number, number>();
  let total = 0;
  for (const log of logs) {
    for (const player of log.players ?? []) {
      const spec = player.elite_spec ?? 0;
      const id = spec > 0 ? spec : (player.profession ?? 0);
      if (id < 1 || id > 999) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .map(([id, count]) => {
      const isSpec = id > 9; // core profession ids are 1–9
      const coreId = isSpec ? (SPEC_CORE[id] ?? 0) : id;
      const core = PROFESSIONS[coreId];
      const name = isSpec ? (SPEC_NAMES[id] ?? core?.name ?? `Spec ${id}`) : (core?.name ?? `Prof ${id}`);
      return {
        profId: id,
        name,
        color: core?.color ?? "#888",
        count,
        pct: (count / total) * 100,
      };
    })
    .sort((a, b) => b.count - a.count);
}

// ─── Wipe depth buckets ───────────────────────────────────────────────────────

function buildWipeDepthBuckets(logs: AnalyticsLog[]): WipeBucket[] {
  const buckets: WipeBucket[] = WIPE_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const log of logs) {
    if (log.success !== false || log.boss_hp_left == null) continue;
    const hp = log.boss_hp_left;
    for (const bucket of buckets) {
      if (hp >= bucket.min && hp < bucket.max) { bucket.count++; break; }
    }
  }
  return buckets;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAvailableBosses(logs: AnalyticsLog[]): string[] {
  const set = new Set<string>();
  for (const log of logs) {
    if (isRelevant(log) && log.boss_name) set.add(log.boss_name);
  }
  return Array.from(set).sort();
}

// ─── Cerus multi-log leaderboard helpers ──────────────────────────────────────
// These power the Analytics-tab "Cerus Leaderboard" section. The per-player
// Cerus mechanics are NOT stored on the UploadRecord — they are re-derived at
// view time from dps.report JSON via extractMechanics() in mechanicParser.ts,
// then summed across logs by mergeCerusReports(). These helpers only decide
// WHICH logs belong to the current Cerus cohort (scope) and shape the merged
// MechanicReport into the flat per-player rows the table renders.

import type { MechanicReport, MechanicTabPlayer } from './mechanicParser';

/** True when a boss name denotes the Cerus fight (Cerus / Temple of Febe).
 *  Excludes the story boss "Cerus the Pretender" (a different fight, not the
 *  raid CM/LCM/Normal encounter this feature targets). */
export function isCerusLog(log: AnalyticsLog): boolean {
  const bn = (log.boss_name || '').toLowerCase();
  if (bn.includes('pretender')) return false;
  return bn.includes('cerus') || bn.includes('febe');
}

/** Resolve a profession icon path. Static files are lowercase (e.g. scourge.png);
 *  EI returns capitalised profession names (e.g. 'Scourge'), so lowercase + strip
 *  spaces. Falls back to guardian. Shared so every Cerus view renders the same way. */
export function profIcon(profession: string): string {
  const p = (profession || '').toLowerCase().replace(/\s+/g, '');
  return `/professions/${p || 'guardian'}.png`;
}

/**
 * URLs of the Cerus logs currently in scope, respecting the SAME boss/mode/range
 * filters the rest of the Analytics tab uses (applyFilters is the single source
 * of truth). Empty when the active boss filter resolves to a non-Cerus boss.
 */
export function getFilteredCerusUrls(
  logs: AnalyticsLog[],
  filters: AnalyticsFilters,
): string[] {
  const filtered = applyFilters(logs, filters);
  return filtered
    .filter((l) => isCerusLog(l) && l.url)
    .map((l) => l.url as string);
}

/** Unified per-player row for the leaderboard table. */
export interface CerusLeaderboardRow {
  name: string;
  account: string;
  profession: string;
  orbs: number;        // summed squadLedger.orbs
  orbPercent: number;  // share of squad orbs (from orbLeaderboard)
  cryRage: number;     // rage hits taken
  envyStrip: number;   // boon strip touches
  maliceDmg: number;   // malice damage to shadows
  avgDps: number;      // summed per-player DPS across logs (player DPS, not squad)
}

/** Per-log distribution of each cohort stat — drives the mini sparklines. */
export interface CerusPerLog {
  orbs: number[];
  empowered: number[];
  rageHits: number[];
  shadows: number[];
  stripped: number[];
  orbEff: number[];
  bestPull: number[];
}

/**
 * Flatten a merged MechanicReport into one row per distinct player
 * (deduped by account::name). Joins squadLedger (orbs/cryRage/envyStrip) with
 * orbLeaderboard (orb %) and malicePlayers (malice damage). Reused by both the
 * Analytics leaderboard and any downstream export.
 */
export function buildCerusLeaderboardRows(report: MechanicReport): CerusLeaderboardRow[] {
  const byKey = (name: string, account: string) => `${account}::${name}`.toLowerCase();
  const orbMap = new Map<string, MechanicTabPlayer>();
  for (const p of report.orbLeaderboard) orbMap.set(byKey(p.name, p.account), p);
  const maliceMap = new Map<string, MechanicTabPlayer>();
  for (const p of report.malicePlayers) maliceMap.set(byKey(p.name, p.account), p);

  const rows: CerusLeaderboardRow[] = report.squadLedger.map((p) => {
    const key = byKey(p.name, p.account);
    const orb = orbMap.get(key);
    const mal = maliceMap.get(key);
    return {
      name: p.name,
      account: p.account,
      profession: p.profession,
      orbs: p.orbs,
      orbPercent: orb ? orb.percent : 0,
      cryRage: p.cryRage,
      envyStrip: p.envyStrip,
      maliceDmg: mal ? mal.damage : 0,
      avgDps: p.dps,
    };
  });
  return rows;
}

/** Default leaderboard ordering: Orbs desc. */
export function defaultCerusSort(rows: CerusLeaderboardRow[]): CerusLeaderboardRow[] {
  return [...rows].sort((a, b) => b.orbs - a.orbs);
}

export function aggregateStats(logs: AnalyticsLog[], filters: AnalyticsFilters): AggregatedStats {
  const key = memoKey(logs.length, filters);
  const cached = memo.get(key);
  if (cached) return cached;

  const filtered = applyFilters(logs, filters);
  if (filtered.length === 0) {
    const empty: AggregatedStats = {
      totalLogs: 0, totalKills: 0, totalWipes: 0, overallSuccessRate: 0,
      avgDuration: null, shortestKill: null, mostPlayedBoss: null,
      bossBreakdown: [], activitySeries: [], professionFrequency: [],
      wipeDepthBuckets: [], empty: true,
    };
    memoSet(key, empty);
    return empty;
  }

  const kills = filtered.filter((l) => l.success === true);
  const wipes = filtered.filter((l) => l.success === false);
  const killDurations = kills.map((l) => l.duration).filter((d): d is number => d != null && d > 0);
  const avgDuration = killDurations.length ? killDurations.reduce((a, b) => a + b, 0) / killDurations.length : null;
  const shortestKill = killDurations.length ? Math.min(...killDurations) : null;
  const bossBreakdown = buildBossBreakdown(filtered);

  const result: AggregatedStats = {
    totalLogs: filtered.length,
    totalKills: kills.length,
    totalWipes: wipes.length,
    overallSuccessRate: filtered.length > 0 ? (kills.length / filtered.length) * 100 : 0,
    avgDuration,
    shortestKill,
    mostPlayedBoss: bossBreakdown[0]?.boss ?? null,
    bossBreakdown,
    activitySeries: buildActivitySeries(filtered, filters.range),
    professionFrequency: buildProfessionFrequency(filtered),
    wipeDepthBuckets: buildWipeDepthBuckets(wipes),
    empty: false,
  };

  memoSet(key, result);
  return result;
}

export interface PersonalDpsPoint {
  label: string;
  date: Date;
  value: number;
  charName: string;
  success: boolean;
  bossName: string;
  bossHpLeft?: number | null;
}

import { cleanAccountName } from './format';
export { cleanAccountName };

export interface PlayerAggStat {
  account: string;
  displayName: string;
  profession: string;
  encounters: number;
  avgDps: number;
  maxDps: number;
  avgCleave: number;
}

// Aggregate every player present in the filtered logs (used by the Analytics
// export). Reuses the same private applyFilters() as aggregateStats() so the
// exported roster always matches what the dashboard is showing. DPS is taken
// from each log's per-player record (dps.report getJson), summed across logs.
export function aggregatePlayers(logs: AnalyticsLog[], filters: AnalyticsFilters): PlayerAggStat[] {
  const filtered = applyFilters(logs, filters);
  const map = new Map<string, PlayerAggStat>();
  for (const log of filtered) {
    for (const p of log.players ?? []) {
      const acc = cleanAccountName(p.account);
      if (!acc) continue;
      const dps = p.dps ?? null;
      const cleave = p.cleave_dps ?? null;
      let entry = map.get(acc);
      if (!entry) {
        entry = {
          account: acc,
          displayName: p.display_name ?? acc,
          profession: p.profession != null ? (PROFESSIONS[p.profession]?.name ?? `Prof ${p.profession}`) : 'Unknown',
          encounters: 0,
          avgDps: 0,
          maxDps: 0,
          avgCleave: 0,
        };
        map.set(acc, entry);
      }
      entry.encounters++;
      if (dps != null) {
        entry.avgDps += dps;
        if (dps > entry.maxDps) entry.maxDps = dps;
      }
      if (cleave != null) entry.avgCleave += cleave;
    }
  }
  const out = Array.from(map.values());
  for (const e of out) {
    if (e.encounters > 0) {
      e.avgDps = Math.round(e.avgDps / e.encounters);
      e.avgCleave = Math.round(e.avgCleave / e.encounters);
    }
  }
  // Sort by Avg DPS descending (best performers first), all players included.
  out.sort((a, b) => b.avgDps - a.avgDps);
  return out;
}

export function buildPersonalDpsSeries(
  logs: AnalyticsLog[],
  filters: AnalyticsFilters,
  accountName: string,
  metric: 'dps' | 'cleave'
): PersonalDpsPoint[] {
  const filtered = applyFilters(logs, filters);
  const series: PersonalDpsPoint[] = [];
  const targetAcc = cleanAccountName(accountName);

  for (const log of filtered) {
    if (!log.players) continue;
    const pMatch = log.players.find(p => cleanAccountName(p.account) === targetAcc);
    if (!pMatch) continue;

    const val = metric === 'dps' ? pMatch.dps : pMatch.cleave_dps;
    if (val == null || val <= 0) continue;

    const d = parseLogDate(log.timestamp);
    const label = `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;

    series.push({
      label,
      date: d,
      value: val,
      charName: pMatch.display_name ?? 'Unknown',
      success: log.success === true,
      bossName: log.boss_name ?? 'Encounter',
      bossHpLeft: log.boss_hp_left,
    });
  }

  return series.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export interface PlayerDpsMatch {
  account: string;
  charName: string;
  profession?: number;
  elite_spec?: number | null;
  value: number;
}

export interface MultiPlayerDpsPoint {
  logId: string;
  label: string;
  date: Date;
  bossName: string;
  success: boolean;
  bossHpLeft?: number | null;
  players: Record<string, PlayerDpsMatch>;
}

export function buildMultiPlayerDpsSeries(
  logs: AnalyticsLog[],
  filters: AnalyticsFilters,
  accountNames: string[],
  metric: 'dps' | 'cleave'
): MultiPlayerDpsPoint[] {
  const filtered = applyFilters(logs, filters);
  const points: MultiPlayerDpsPoint[] = [];
  const targetAccs = accountNames.map(cleanAccountName).filter(Boolean);
  if (targetAccs.length === 0) return [];

  for (const log of filtered) {
    if (!log.players || log.players.length === 0) continue;
    
    const matchedPlayers: Record<string, PlayerDpsMatch> = {};
    let hasAnyMatch = false;

    for (const p of log.players) {
      const cleanAcc = cleanAccountName(p.account);
      if (targetAccs.includes(cleanAcc)) {
        const val = metric === 'dps' ? p.dps : p.cleave_dps;
        if (val != null && val > 0) {
          matchedPlayers[cleanAcc] = {
            account: cleanAcc,
            charName: p.display_name ?? 'Unknown',
            profession: p.profession,
            elite_spec: p.elite_spec ?? null,
            value: val,
          };
          hasAnyMatch = true;
        }
      }
    }

    if (!hasAnyMatch) continue;

    const d = parseLogDate(log.timestamp);
    const label = `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;

    points.push({
      logId: log.url || log.timestamp || Math.random().toString(),
      label,
      date: d,
      bossName: log.boss_name ?? 'Encounter',
      success: log.success === true,
      bossHpLeft: log.boss_hp_left,
      players: matchedPlayers,
    });
  }

  return points.sort((a, b) => a.date.getTime() - b.date.getTime());
}

