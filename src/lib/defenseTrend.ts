/**
 * Squad-wide defense/support summary for a single log, used by the Analytics
 * tab's defense trend.
 *
 * `extractDefenseSupport()` returns per-phase, per-player arrays. The trend
 * works on the full fight (phase 0) and collapses the squad into one point per
 * log, using the same mitigation formula as the Stats modal's Defense tab.
 */

import type { DefenseSupportStats } from './defenseSupport';

export interface DefenseTrendPoint {
  date: Date;
  boss: string;
  success: boolean;
  durationSec: number;
  /** Blocked + evaded + dodged + invulned as a share of hits taken, 0-100. */
  mitigationRate: number;
  downs: number;
  downsPerHour: number;
  cleanses: number;
  strips: number;
  revives: number;
}

export interface DefenseTrendMeta {
  date: Date;
  boss: string;
  success: boolean;
  durationSec: number;
}

/** Full-fight squad summary. Returns null when the log has no defense rows. */
export function summarizeDefense(
  ds: DefenseSupportStats,
  meta: DefenseTrendMeta,
): DefenseTrendPoint | null {
  const def = ds.defense[0];
  if (!def || def.length === 0) return null;
  // defense[] and support[] are built in the same player loop, so index i in
  // one is the same player in the other.
  const sup = ds.support[0] ?? [];

  let mitigated = 0;
  let hits = 0;
  let downs = 0;
  let cleanses = 0;
  let strips = 0;
  let revives = 0;
  for (let i = 0; i < def.length; i++) {
    const p = def[i];
    mitigated += p.blockedCount + p.evadedCount + p.dodgeCount + p.invulnedCount;
    hits += p.damageTakenCount;
    downs += p.downCount;
    const s = sup[i];
    if (s) {
      cleanses += s.condiCleanse;
      strips += s.boonStrips;
      revives += s.resurrects;
    }
  }

  return {
    date: meta.date,
    boss: meta.boss,
    success: meta.success,
    durationSec: meta.durationSec,
    mitigationRate: hits + mitigated > 0 ? (mitigated / (hits + mitigated)) * 100 : 0,
    downs,
    downsPerHour: meta.durationSec > 0 ? (downs / meta.durationSec) * 3600 : 0,
    cleanses,
    strips,
    revives,
  };
}

export interface DefenseTrendSummary {
  logs: number;
  avgMitigationRate: number;
  avgDownsPerHour: number;
  cleanses: number;
  strips: number;
  revives: number;
}

/** Averages across a loaded trend, for the section's summary line. */
export function summarizeTrend(points: DefenseTrendPoint[]): DefenseTrendSummary | null {
  if (points.length === 0) return null;
  const total = (f: (p: DefenseTrendPoint) => number) =>
    points.reduce((s, p) => s + f(p), 0);
  return {
    logs: points.length,
    avgMitigationRate: total(p => p.mitigationRate) / points.length,
    avgDownsPerHour: total(p => p.downsPerHour) / points.length,
    cleanses: total(p => p.cleanses),
    strips: total(p => p.strips),
    revives: total(p => p.revives),
  };
}
