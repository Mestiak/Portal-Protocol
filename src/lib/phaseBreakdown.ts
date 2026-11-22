import { cleanAccountName } from "./format.ts";

/**
 * Per-phase DPS / cleave / breakbar, aggregated across the logs in a filter.
 *
 * The Analytics tab compares players across a whole filter, so each phase of each
 * log is summarised here and the summaries are then averaged. The Stats modal's
 * per-log view lives in `phaseStats.ts`; this is the cross-log counterpart.
 */

export interface PhasePlayerStat {
  name: string;
  account: string;
  profession: string;
  /** Boss-target damage per second — the sum over the fight's boss targets. */
  dps: number;
  /** Total damage per second, i.e. boss plus everything else. */
  cleave: number;
  /** Breakbar damage dealt in the phase. */
  breakbar: number;
}

export interface PhaseLogPhase {
  name: string;
  isFullFight: boolean;
  isBreakbar: boolean;
  /** Fight-relative start of the phase, in milliseconds. */
  start: number;
  players: PhasePlayerStat[];
}

export interface PhaseLogReport {
  phases: PhaseLogPhase[];
}

export interface PhaseRow extends PhasePlayerStat {
  /** How many logs contributed this phase — a pull that never reached it does not. */
  logs: number;
}

export interface PhaseColumn {
  name: string;
  isFullFight: boolean;
  isBreakbar: boolean;
  players: PhaseRow[];
}

export interface PhaseBreakdown {
  phases: PhaseColumn[];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Summarise one Elite Insights report into per-phase rows.
 *
 * Returns null when the payload is not an EI report or is a WvW log — WvW logs
 * have no boss target per phase, so DPS would be meaningless.
 */
export function summarizePhaseBreakdown(raw: any): PhaseLogReport | null {
  if (!raw || !Array.isArray(raw.phases) || raw.phases.length === 0) return null;
  if (!Array.isArray(raw.players) || raw.players.length === 0) return null;
  if ((raw.phases[0].targets ?? []).some((t: unknown) => String(t).toLowerCase().includes("enemy"))) return null;

  const phases: PhaseLogPhase[] = [];
  for (let pi = 0; pi < raw.phases.length; pi++) {
    const meta = raw.phases[pi] ?? {};
    // The boss target indices come from the phase itself: a split phase targets a
    // different index than the main boss. `dpsTargets` is indexed by those values,
    // so the value is the index — not its position in the list.
    const bossTargets = (Array.isArray(meta.targets) ? meta.targets : [])
      .map((t: unknown) => ({ target: String(t).toLowerCase(), index: Number(t) }))
      .filter((x: { target: string; index: number }) =>
        Number.isFinite(x.index) && x.index >= 0 &&
        x.target !== "all" && x.target !== "boss" && !x.target.includes("enemy"));

    const players: PhasePlayerStat[] = [];

    for (const p of raw.players) {
      const dpsAll = p.dpsAll?.[pi];
      if (!dpsAll) continue;

      let dps = 0;
      const targets = Array.isArray(p.dpsTargets) ? p.dpsTargets : [];
      for (const { index } of bossTargets) {
        dps += num(targets[index]?.[pi]?.dps);
      }

      players.push({
        name: p.name ?? "",
        account: cleanAccountName(p.account ?? ""),
        profession: p.profession ?? "",
        dps,
        cleave: num(dpsAll.dps),
        breakbar: num(dpsAll.breakbarDamage),
      });
    }

    phases.push({
      name: meta.name ?? `Phase ${pi + 1}`,
      isFullFight: pi === 0,
      isBreakbar: meta.breakbarPhase === true,
      start: num(meta.start),
      players,
    });
  }

  return { phases };
}

/**
 * Average the per-log reports into one column per phase.
 *
 * Phases are matched by name, never by index: logs of one boss share a phase
 * order, but a log that never reached a phase simply omits it, so an index-based
 * union would shift every later phase. The canonical order comes from the report
 * with the most phases, with anything it lacks appended in first-seen order.
 *
 * A player's value is averaged only over the reports that contain the phase, so a
 * pull that ended early does not drag the number down.
 */
export function buildPhaseBreakdown(reports: PhaseLogReport[]): PhaseBreakdown | null {
  if (!reports || reports.length === 0) return null;

  // Order comes from the fight itself: each phase's median start time. Logs of one
  // boss share a phase order but can number breakbar phases differently, and a log
  // that never reached a phase omits it — so neither one report's sequence nor the
  // phase name is a reliable ordering key.
  const starts = new Map<string, number[]>();
  const fullFight = new Set<string>();
  const firstSeen: string[] = [];
  for (const report of reports) {
    for (const phase of report.phases) {
      if (!starts.has(phase.name)) {
        starts.set(phase.name, []);
        firstSeen.push(phase.name);
      }
      starts.get(phase.name)!.push(phase.start);
      if (phase.isFullFight) fullFight.add(phase.name);
    }
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const order = [...firstSeen].sort((a, b) => {
    const d = median(starts.get(a)!) - median(starts.get(b)!);
    if (d !== 0) return d;
    const fa = fullFight.has(a) ? 0 : 1;
    const fb = fullFight.has(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.localeCompare(b);
  });

  const phases: PhaseColumn[] = order.map((name) => {
    let isFullFight = false;
    let isBreakbar = false;
    const acc = new Map<string, { name: string; account: string; profession: string; dps: number; cleave: number; breakbar: number; logs: number }>();

    for (const report of reports) {
      const phase = report.phases.find((p) => p.name === name);
      if (!phase) continue;
      isFullFight = phase.isFullFight;
      isBreakbar = phase.isBreakbar;

      for (const player of phase.players) {
        const key = player.account || player.name;
        let row = acc.get(key);
        if (!row) {
          row = { name: player.name, account: player.account, profession: player.profession, dps: 0, cleave: 0, breakbar: 0, logs: 0 };
          acc.set(key, row);
        }
        row.dps += player.dps;
        row.cleave += player.cleave;
        row.breakbar += player.breakbar;
        row.logs += 1;
      }
    }

    const players: PhaseRow[] = [...acc.values()].map((row) => ({
      name: row.name,
      account: row.account,
      profession: row.profession,
      dps: row.logs > 0 ? row.dps / row.logs : 0,
      cleave: row.logs > 0 ? row.cleave / row.logs : 0,
      breakbar: row.logs > 0 ? row.breakbar / row.logs : 0,
      logs: row.logs,
    }));
    players.sort((a, b) => b.dps - a.dps);

    return { name, isFullFight, isBreakbar, players };
  });

  return { phases };
}
