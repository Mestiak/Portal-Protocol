/**
 * Squad healing summary for a single log, used by the Analytics tab's healing
 * trend.
 *
 * Healing comes from the arcdps healing extension, which EI exposes as
 * `players[].extHealingStats`. Logs recorded without it (or before it ran) have
 * no such key at all, so every helper here returns null and the caller skips
 * the log rather than showing a zero.
 */

export interface HealingHealer {
  name: string;
  account: string;
  profession: string;
  healing: number;
  downedHealing: number;
  hps: number;
}

export interface HealingTrendPoint {
  date: Date;
  boss: string;
  success: boolean;
  durationSec: number;
  /** Squad outgoing healing over the full fight. */
  healing: number;
  healingPerHour: number;
  /** Healing done while the target was downed — nothing else in the app shows it. */
  downedHealing: number;
  healers: HealingHealer[];
}

export interface HealingTrendMeta {
  date: Date;
  boss: string;
  success: boolean;
  durationSec: number;
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** Full-fight squad healing. Returns null when the log has no healing extension data. */
export function summarizeHealing(
  raw: any,
  meta: HealingTrendMeta,
): HealingTrendPoint | null {
  const players = Array.isArray(raw?.players) ? raw.players : [];
  let sawExtension = false;
  let healing = 0;
  let downedHealing = 0;
  const healers: HealingHealer[] = [];

  for (const p of players) {
    const ext = p?.extHealingStats;
    if (!ext) continue;
    sawExtension = true;
    const out = Array.isArray(ext.outgoingHealing) ? ext.outgoingHealing[0] : null;
    if (!out) continue;
    const h = num(out.healing);
    const downed = num(out.downedHealing);
    healing += h;
    downedHealing += downed;
    if (h > 0 || downed > 0) {
      healers.push({
        name: str(p?.name),
        account: str(p?.account),
        profession: str(p?.profession),
        healing: h,
        downedHealing: downed,
        hps: num(out.hps),
      });
    }
  }

  if (!sawExtension) return null;
  healers.sort((a, b) => b.healing - a.healing);

  return {
    date: meta.date,
    boss: meta.boss,
    success: meta.success,
    durationSec: meta.durationSec,
    healing,
    healingPerHour: meta.durationSec > 0 ? healing / (meta.durationSec / 3600) : 0,
    downedHealing,
    healers,
  };
}

export interface HealingSummaryHealer extends HealingHealer {
  logs: number;
}

export interface HealingSummary {
  logs: number;
  totalHealing: number;
  totalDownedHealing: number;
  avgHealingPerHour: number;
  healers: HealingSummaryHealer[];
}

/** Cohort totals across a loaded trend, for the healer table. */
export function summarizeHealingTrend(points: HealingTrendPoint[]): HealingSummary | null {
  if (points.length === 0) return null;

  const byAccount = new Map<string, HealingSummaryHealer>();
  for (const pt of points) {
    for (const h of pt.healers) {
      const key = h.account || h.name;
      const prev = byAccount.get(key);
      if (prev) {
        prev.healing += h.healing;
        prev.downedHealing += h.downedHealing;
        prev.logs += 1;
      } else {
        byAccount.set(key, {
          name: h.name, account: h.account, profession: h.profession,
          healing: h.healing, downedHealing: h.downedHealing, hps: 0, logs: 1,
        });
      }
    }
  }

  const healers = [...byAccount.values()].sort((a, b) => b.healing - a.healing);
  const totalHealing = points.reduce((s, p) => s + p.healing, 0);
  return {
    logs: points.length,
    totalHealing,
    totalDownedHealing: points.reduce((s, p) => s + p.downedHealing, 0),
    avgHealingPerHour: points.reduce((s, p) => s + p.healingPerHour, 0) / points.length,
    healers,
  };
}
