/**
 * Per-phase combat statistics extracted from an Elite Insights JSON report.
 *
 * EI stores every per-phase metric as a positional array indexed by phase, so one
 * generic pass covers every encounter:
 *   - players[].dpsTargets[target][phase]        boss-target DPS
 *   - players[].dpsAll[phase]                    total (cleave) DPS
 *   - players[].buffUptimesActive[b].buffData[phase].uptime
 *
 * The emitted players reuse the Stats modal's PlayerStat shape so the existing
 * tables, sorting and subgroup totals work unchanged.
 */

export interface PhaseBoonStat {
  id: number;
  uptime_pct: number;
  stacks: number;
}

export interface PhasePlayerStat {
  name: string;
  account: string;
  profession: string;
  group: number;
  dps: number;
  cleave_dps: number;
  quickness_pct: number;
  alacrity_pct: number;
  boons: PhaseBoonStat[];
}

export interface PhaseStat {
  index: number;
  name: string;
  phaseType: string;
  isBreakbar: boolean;
  isFullFight: boolean;
  start: number;
  end: number;
  durationSec: number;
  players: PhasePlayerStat[];
}

/** Boon metadata the caller already holds (id + whether the boon stacks). */
export interface PhaseBoonMeta {
  id: number;
  stacks?: boolean;
}

const QUICKNESS_ID = 1187;
const ALACRITY_ID = 30328;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Target indices that count as the boss (mirrors the dps.report/EI target rule). */
function bossTargetIndices(raw: any): Set<number> {
  const targets = Array.isArray(raw?.phases) ? raw.phases[0]?.targets : null;
  if (!Array.isArray(targets)) return new Set([0]);
  const indices = targets.filter((t: unknown) => typeof t === "number");
  return new Set(indices.length > 0 ? indices : [0]);
}

/**
 * Build per-phase stats from an EI report.
 * Returns null when the payload is not an EI report (no phases / no per-phase arrays).
 */
export function extractPhaseStats(raw: any, boonMeta: PhaseBoonMeta[] = []): PhaseStat[] | null {
  const phases = raw?.phases;
  const players = raw?.players;
  if (!Array.isArray(phases) || phases.length === 0) return null;
  if (!Array.isArray(players) || players.length === 0) return null;
  if (!players.some((p: any) => Array.isArray(p?.dpsAll))) return null;

  // WvW logs report damage rather than DPS in the stats modal; the phase
  // breakdown targets PvE encounters, so leave WvW on the whole-fight view.
  const targetNames: string[] = (Array.isArray(raw?.targets) ? raw.targets : []).map((t: any) =>
    String(t?.name ?? "").toLowerCase(),
  );
  if (targetNames.some((n) => n.includes("enemy"))) return null;

  const bossTargets = bossTargetIndices(raw);
  const metaById = new Map(boonMeta.map((b) => [b.id, b]));
  const wantedIds = boonMeta.length > 0 ? new Set(boonMeta.map((b) => b.id)) : null;

  return phases.map((phase: any, index: number): PhaseStat => {
    const phasePlayers: PhasePlayerStat[] = players.map((p: any): PhasePlayerStat => {
      const perTarget: any[] = Array.isArray(p?.dpsTargets) ? p.dpsTargets : [];
      const targetIndices = bossTargets.size > 0 ? [...bossTargets] : perTarget.map((_, i) => i);

      let dps = 0;
      for (const t of targetIndices) {
        const entry = perTarget[t];
        const cell = Array.isArray(entry) ? entry[index] : null;
        dps += num(cell?.dps);
      }

      const dpsAll: any[] = Array.isArray(p?.dpsAll) ? p.dpsAll : [];
      const cleave = num(dpsAll[index]?.dps);

      const boons: PhaseBoonStat[] = [];
      let quickness = 0;
      let alacrity = 0;
      const uptimes: any[] = Array.isArray(p?.buffUptimesActive) ? p.buffUptimesActive : [];
      for (const buff of uptimes) {
        const id = num(buff?.id);
        if (wantedIds && !wantedIds.has(id)) continue;
        const buffData: any[] = Array.isArray(buff?.buffData) ? buff.buffData : [];
        const uptime = num(buffData[index]?.uptime);
        boons.push({ id, uptime_pct: uptime, stacks: metaById.get(id)?.stacks ? uptime : 0 });
        if (id === QUICKNESS_ID) quickness = uptime;
        if (id === ALACRITY_ID) alacrity = uptime;
      }

      return {
        name: str(p?.name),
        account: str(p?.account),
        profession: str(p?.profession),
        group: num(p?.group),
        dps,
        cleave_dps: cleave,
        quickness_pct: quickness,
        alacrity_pct: alacrity,
        boons,
      };
    });

    const start = num(phase?.start);
    const end = num(phase?.end);
    return {
      index,
      name: str(phase?.name, `Phase ${index + 1}`),
      phaseType: str(phase?.phaseType),
      isBreakbar: phase?.breakbarPhase === true,
      isFullFight: index === 0,
      start,
      end,
      durationSec: Math.round(((end - start) / 1000) * 10) / 10,
      players: phasePlayers,
    };
  });
}
