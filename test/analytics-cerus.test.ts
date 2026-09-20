/**
 * TDD tests for the Cerus Analytics Leaderboard feature (Phase 1 / v1).
 *
 * Run with:  node --experimental-strip-types test/analytics-cerus.test.ts
 * (Node 24 strips TS type annotations natively — no tsconfig/build needed.)
 *
 * These tests target the PURE logic only (no Svelte/DOM/invoke):
 *   - isCerusLog(): Cerus boss-name detection
 *   - getFilteredCerusUrls(): scope Cerus logs by active boss/mode/range filter
 *   - mergeCerusReports(): per-player aggregation correctness
 *   - buildCerusLeaderboardRows(): unified per-player leaderboard rows
 *   - MAX_AGGREGATE_LOGS skew threshold
 *
 * NOTE: isCerusLog / getFilteredCerusUrls / buildCerusLeaderboardRows are added
 * by the implementation under test. Running this BEFORE implementation makes the
 * module import fail (RED). After implementation it should be GREEN.
 */

import {
  isCerusLog,
  getFilteredCerusUrls,
  buildCerusLeaderboardRows,
  defaultCerusSort,
  profIcon,
  type CerusLeaderboardRow,
  type AnalyticsLog,
} from '../src/lib/analyticsEngine.ts';
import { mergeCerusReports, MAX_AGGREGATE_LOGS } from '../src/lib/mechanicParser.ts';
import type { MechanicReport, SquadLedgerPlayer } from '../src/lib/mechanicParser.ts';

// ─── tiny assert harness (no deps) ──────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; failures.push(`${msg}\n   expected: ${e}\n   actual:   ${a}`); }
}
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; }
  else { failed++; failures.push(`${msg}\n   expected truthy, got: ${cond}`); }
}
function section(name: string): void {
  console.log(`\n▶ ${name}`);
}

// ─── fixtures ──────────────────────────────────────────────────────────────
function cerusLog(p: Partial<AnalyticsLog> & { boss_name: string }): AnalyticsLog {
  return {
    timestamp: '2026-08-01T20:00:00',
    status: 'Completed',
    url: 'https://dps.report/abc',
    is_cm: false,
    is_lcm: false,
    ...p,
  } as AnalyticsLog;
}

function squadPlayer(name: string, account: string, orbs: number, cryRage: number, envyStrip: number, dps = 0): SquadLedgerPlayer {
  return { name, account, profession: 'Scourge', orbs, cryRage, envyStrip, dps };
}

function mechReport(players: SquadLedgerPlayer[]): MechanicReport {
  // minimal MechanicReport good enough for mergeCerusReports + row builder
  const orbMap = players.map((p) => ({ name: p.name, account: p.account, profession: p.profession, damage: p.orbs, percent: 0 }));
  return {
    boss: 'Cerus',
    isLCM: false,
    summary: { totalDps: 0, durationSec: 0, players: players.length, avgBoonPct: 0 },
    orbEfficiency: 0, totalOrbs: 0, totalOrbsLeaked: 0, totalOrbsSpawned: 0,
    shadowsReached: 0, shadowsLeaked: 0, empoweredGained: 0, rageHits: 0,
    timeline: [], boonStrippedPlayers: 0, totalEnvyStrips: 0,
    totalMaliceDamage: 0, malicePlayers: [], maliceTargetCount: 0,
    shadowPhases: [], orbLeaderboard: orbMap, orbPhaseLeaders: [],
    phases: [], squadLedger: players, revealedBreakers: [],
  } as MechanicReport;
}

// ════════════════════════════════════════════════════════════════════════════
section('isCerusLog — boss-name detection');
{
  ok(isCerusLog(cerusLog({ boss_name: 'Cerus (CM)' })), 'detects "Cerus (CM)"');
  ok(isCerusLog(cerusLog({ boss_name: 'Cerus' })), 'detects bare "Cerus"');
  ok(isCerusLog(cerusLog({ boss_name: 'Cerus LCM' })), 'detects "Cerus LCM"');
  ok(isCerusLog(cerusLog({ boss_name: 'Temple of Febe (CM)' })), 'detects "Temple of Febe"');
  ok(isCerusLog(cerusLog({ boss_name: 'TEMPLE OF FEBE' })), 'case-insensitive Febe');
  ok(!isCerusLog(cerusLog({ boss_name: 'Vale Guardian (CM)' })), 'rejects Vale Guardian');
  ok(!isCerusLog(cerusLog({ boss_name: 'Cerus the Pretender (Story)' })), 'rejects story boss "Cerus the Pretender"');
}

// ════════════════════════════════════════════════════════════════════════════
section('getFilteredCerusUrls — scope by boss/mode/range');
{
  const logs: AnalyticsLog[] = [
    cerusLog({ boss_name: 'Cerus (CM)', url: 'https://dps.report/a', is_cm: true, is_lcm: false }),
    cerusLog({ boss_name: 'Cerus LCM', url: 'https://dps.report/b', is_cm: false, is_lcm: true }),
    cerusLog({ boss_name: 'Vale Guardian (CM)', url: 'https://dps.report/c', is_cm: true }),
    cerusLog({ boss_name: 'Temple of Febe', url: 'https://dps.report/d', is_cm: false, is_lcm: false }),
    // excluded: not "Completed"
    cerusLog({ boss_name: 'Cerus (CM)', url: 'https://dps.report/e', status: 'Failed' }),
  ];

  // boss=all, mode=all → all 4 Cerus/Febe that are Completed
  const all = getFilteredCerusUrls(logs, { boss: 'all', mode: 'all', range: 'all' });
  eq(all.sort(), ['https://dps.report/a', 'https://dps.report/b', 'https://dps.report/d'].sort(), 'all mode returns only Cerus/Febe completed');

  // boss filter to a specific non-Cerus boss → empty
  eq(getFilteredCerusUrls(logs, { boss: 'Vale Guardian (CM)', mode: 'all', range: 'all' }), [], 'non-Cerus boss filter → empty');

  // mode=cm only → just the CM Cerus
  eq(getFilteredCerusUrls(logs, { boss: 'all', mode: 'cm', range: 'all' }), ['https://dps.report/a'], 'mode=cm isolates CM Cerus');

  // mode=lcm only → just the LCM Cerus
  eq(getFilteredCerusUrls(logs, { boss: 'all', mode: 'lcm', range: 'all' }), ['https://dps.report/b'], 'mode=lcm isolates LCM Cerus');

  // missing url → skipped
  const noUrl = [cerusLog({ boss_name: 'Cerus (CM)', url: undefined })];
  eq(getFilteredCerusUrls(noUrl, { boss: 'all', mode: 'all', range: 'all' }), [], 'logs without url are skipped');
}

// ════════════════════════════════════════════════════════════════════════════
section('mergeCerusReports — per-player aggregation');
{
  const r1 = mechReport([
    squadPlayer('Alice', ':Alice.123', 10, 2, 1),
    squadPlayer('Bob', ':Bob.456', 5, 3, 0),
  ]);
  const r2 = mechReport([
    squadPlayer('Alice', ':Alice.123', 4, 1, 2),
    squadPlayer('Cara', ':Cara.789', 8, 0, 1),
  ]);
  const merged = mergeCerusReports([r1, r2]);
  ok(merged !== null, 'merge returns a report for 2 Cerus reports');

  // Alice should be summed across both logs
  const alice = merged!.squadLedger.find((p) => p.account === ':Alice.123')!;
  eq([alice.orbs, alice.cryRage, alice.envyStrip], [14, 3, 3], 'Alice orbs/rage/strip summed across logs');

  // Bob only in r1, Cara only in r2
  ok(merged!.squadLedger.some((p) => p.account === ':Bob.456' && p.orbs === 5), 'Bob present with r1 values');
  ok(merged!.squadLedger.some((p) => p.account === ':Cara.789' && p.orbs === 8), 'Cara present with r2 values');

  // distinct player count = 3
  eq(merged!.squadLedger.length, 3, '3 distinct players in merged ledger');

  // per-player orb % recomputed against squad total (10+5 + 4+8 = 27)
  const aliceOrb = merged!.orbLeaderboard.find((p) => p.account === ':Alice.123')!;
  eq(aliceOrb.percent, Math.round((14 / 27) * 1000) / 10, 'Alice orb % = 14/27 of squad orbs');

  // single report returns itself (not re-summed)
  const single = mergeCerusReports([r1]);
  eq(single!.squadLedger.find((p) => p.account === ':Alice.123')!.orbs, 10, 'single report unchanged');

  // no Cerus reports → null
  ok(mergeCerusReports([]) === null, 'empty → null');
  ok(mergeCerusReports([{ ...mechReport([]), boss: 'Vale Guardian' }]) === null, 'non-Cerus report → null');
}

// ════════════════════════════════════════════════════════════════════════════
section('buildCerusLeaderboardRows — unified per-player rows');
{
  const merged = mergeCerusReports([
    mechReport([
      squadPlayer('Alice', ':Alice.123', 10, 2, 1),
      squadPlayer('Bob', ':Bob.456', 5, 3, 0),
    ]),
  ])!;
  const rows = buildCerusLeaderboardRows(merged);
  eq(rows.length, 2, 'one row per player');
  const alice = rows.find((r) => r.account === ':Alice.123')!;
  eq([alice.orbs, alice.cryRage, alice.envyStrip, alice.maliceDmg], [10, 2, 1, 0], 'row carries squadLedger fields + maliceDmg (0 when no malicePlayers)');
  eq(alice.orbPercent, 0, 'orbPercent defaulted when orbLeaderboard empty');

  // avgDps flows from squadLedger.dps (per-player EI DPS, summed across logs)
  const mergedDps = mergeCerusReports([
    mechReport([ squadPlayer('Alice', ':Alice.123', 10, 2, 1, 12000), squadPlayer('Bob', ':Bob.456', 5, 3, 0, 9000) ]),
    mechReport([ squadPlayer('Alice', ':Alice.123', 3, 1, 0, 13000) ]),
  ])!;
  const dpsRows = buildCerusLeaderboardRows(mergedDps);
  eq(dpsRows.find((r) => r.account === ':Alice.123')!.avgDps, 25000, 'Alice avgDps summed across logs (12000 + 13000)');
  eq(dpsRows.find((r) => r.account === ':Bob.456')!.avgDps, 9000, 'Bob avgDps from single log');

  // with orbLeaderboard present, percent flows through
  merged.orbLeaderboard = [
    { name: 'Alice', account: ':Alice.123', profession: 'Scourge', damage: 10, percent: 66.7 },
    { name: 'Bob', account: ':Bob.456', profession: 'Scourge', damage: 5, percent: 33.3 },
  ];
  const rows2 = buildCerusLeaderboardRows(merged);
  eq(rows2.find((r) => r.account === ':Alice.123')!.orbPercent, 66.7, 'orbPercent from orbLeaderboard');
}

// ════════════════════════════════════════════════════════════════════════════
section('defaultCerusSort — default ordering');
{
  const rows: CerusLeaderboardRow[] = [
    { name: 'Bob', account: ':Bob.456', profession: 'Scourge', orbs: 5, orbPercent: 33.3, cryRage: 3, envyStrip: 0, maliceDmg: 0, avgDps: 0 },
    { name: 'Alice', account: ':Alice.123', profession: 'Scourge', orbs: 10, orbPercent: 66.7, cryRage: 2, envyStrip: 1, maliceDmg: 0, avgDps: 0 },
  ];
  const sorted = defaultCerusSort(rows);
  eq(sorted[0].account, ':Alice.123', 'default sort = Orbs desc → Alice first');
  eq(sorted[1].account, ':Bob.456', 'Bob second');
}

// ════════════════════════════════════════════════════════════════════════════
section('MAX_AGGREGATE_LOGS threshold');
{
  ok(MAX_AGGREGATE_LOGS === 25, 'cohort skew threshold is 25');
  const urls = Array.from({ length: 30 }, (_, i) => `https://dps.report/${i}`);
  // getFilteredCerusUrls should still return all (cap happens at fetch time, not scope time)
  const logs = urls.map((u) => cerusLog({ boss_name: 'Cerus (CM)', url: u, is_cm: true }));
  eq(getFilteredCerusUrls(logs, { boss: 'all', mode: 'all', range: 'all' }).length, 30, 'scope returns all 30 (cap is a render/fetch warning, not a hard filter)');
}

// ─── profIcon (lowercase static filenames) ────────────────────────────────────
section('profIcon');
eq(profIcon('Scourge'), '/professions/scourge.png', 'capitalised profession → lowercase path');
eq(profIcon('Virtuoso'), '/professions/virtuoso.png', 'capitalised multi → lowercase path');
eq(profIcon(''), '/professions/guardian.png', 'empty → guardian fallback');
eq(profIcon('Soul Beast'), '/professions/soulbeast.png', 'spaces stripped');

// ─── perLog shape (drives sparklines) ────────────────────────────────────────
section('perLog sparkline data');
{
  const reports: MechanicReport[] = [
    mechReport([squadPlayer('A', ':A', 10, 1, 2)]),
    mechReport([squadPlayer('B', ':B', 4, 0, 1)]),
  ];
  // mimic the perLog capture done in AnalyticsDashboard.loadCerusLeaderboard
  const perLog = {
    orbs: reports.map(r => r.totalOrbs),
    empowered: reports.map(r => r.empoweredGained),
    rageHits: reports.map(r => r.rageHits),
    shadows: reports.map(r => r.shadowsReached),
    stripped: reports.map(r => r.boonStrippedPlayers),
    orbEff: reports.map(r => r.orbEfficiency),
  };
  eq(perLog.orbs.length, 2, 'perLog.orbs length == log count');
  eq(perLog.empowered.length, 2, 'perLog.empowered length == log count');
  // perLog arrays feed the cohort cards, so they must sum to the merged cohort totals
  const merged = mergeCerusReports(reports)!;
  eq(perLog.orbs.reduce((s, v) => s + v, 0), merged.totalOrbs, 'perLog.orbs sum == cohort Total Orbs card');
  eq(perLog.empowered.reduce((s, v) => s + v, 0), merged.empoweredGained, 'perLog.empowered sum == cohort Empowered card');
}

// ─── summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(48)}`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}

console.log('ALL GREEN ✅');
process.exit(0);
