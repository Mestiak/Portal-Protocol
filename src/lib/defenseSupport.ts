/**
 * Defensive and support statistics extracted from an Elite Insights JSON report.
 *
 * Both arrays are indexed by phase (length == number of phases), so the same
 * phase selector drives the DPS and the defense/support views:
 *   - players[].defenses[phase]  -> JsonDefensesAll  (damage taken, mitigation, deaths)
 *   - players[].support[phase]   -> JsonPlayerSupport (cleanses, strips, revives)
 *   - players[].groupBuffsActive[phase] -> boons this player generated for the group
 *
 * Field names mirror EI's JSON keys verbatim so the mapping stays auditable
 * against the C# models.
 */

export interface DefensePlayerStat {
  name: string;
  account: string;
  profession: string;
  group: number;
  // Damage taken
  damageTaken: number;
  damageTakenCount: number;
  powerDamageTaken: number;
  conditionDamageTaken: number;
  strikeDamageTaken: number;
  lifeLeechDamageTaken: number;
  downedDamageTaken: number;
  damageBarrier: number;
  breakbarDamageTaken: number;
  // Mitigation
  blockedCount: number;
  evadedCount: number;
  dodgeCount: number;
  invulnedCount: number;
  missedCount: number;
  interruptedCount: number;
  // Time in trouble
  downCount: number;
  downDuration: number;
  deadCount: number;
  deadDuration: number;
  dcCount: number;
  dcDuration: number;
  // Crowd control received
  receivedCrowdControl: number;
  receivedCrowdControlDuration: number;
  stunBreak: number;
  removedStunDuration: number;
  // Deaths: time into the phase (ms) plus the biggest damage sources that led to it
  deathRecap: { deathTime: number; toKill: { src: string; id: number; damage: number; indirectDamage: boolean }[] }[];
}

export interface SupportPlayerStat {
  name: string;
  account: string;
  profession: string;
  group: number;
  // Revives
  resurrects: number;
  resurrectTime: number;
  // Cleanses
  condiCleanse: number;
  condiCleanseTime: number;
  condiCleanseSelf: number;
  condiCleanseTimeSelf: number;
  // Strips
  boonStrips: number;
  boonStripsTime: number;
  boonStripDownContribution: number;
  boonStripDownContributionTime: number;
  // Stun breaks
  stunBreak: number;
  removedStunDuration: number;
  stunBreakSelf: number;
  removedStunSelfDuration: number;
  // Crowd control this player applied to enemies, as breakbar damage dealt.
  // EI's appliedCrowdControl event count is NOT a reliable measure of this:
  // it stays 0 for players who clearly dealt breakbar damage.
  breakbarDamage: number;
  // Boons this player generated for the group
  groupBoons: { id: number; name: string; generation: number; presence: number; overstack: number }[];
}

export interface DefenseSupportStats {
  /** `[phase][player]` */
  defense: DefensePlayerStat[][];
  /** `[phase][player]` */
  support: SupportPlayerStat[][];
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

function playerIdentity(p: any) {
  return {
    name: str(p?.name),
    account: str(p?.account),
    profession: str(p?.profession),
    group: num(p?.group),
  };
}

/**
 * Build per-phase defense/support stats from an EI report.
 * Returns null when the payload is not an EI report (no `defenses`/`support`
 * arrays) — dps.report-only logs have neither.
 */
export function extractDefenseSupport(raw: any): DefenseSupportStats | null {
  const phases = raw?.phases;
  const players = raw?.players;
  if (!Array.isArray(phases) || phases.length === 0) return null;
  if (!Array.isArray(players) || players.length === 0) return null;
  if (!players.some((p: any) => (Array.isArray(p?.defenses) && p.defenses.length > 0) || (Array.isArray(p?.support) && p.support.length > 0))) {
    return null;
  }

  const phaseCount = phases.length;

  const defense: DefensePlayerStat[][] = [];
  const support: SupportPlayerStat[][] = [];

  for (let phase = 0; phase < phaseCount; phase++) {
    const defensePhase: DefensePlayerStat[] = [];
    const supportPhase: SupportPlayerStat[] = [];

    for (const p of players) {
      const d = Array.isArray(p?.defenses) ? (p.defenses[phase] ?? {}) : {};
      defensePhase.push({
        ...playerIdentity(p),
        damageTaken: num(d.damageTaken),
        damageTakenCount: num(d.damageTakenCount),
        powerDamageTaken: num(d.powerDamageTaken),
        conditionDamageTaken: num(d.conditionDamageTaken),
        strikeDamageTaken: num(d.strikeDamageTaken),
        lifeLeechDamageTaken: num(d.lifeLeechDamageTaken),
        downedDamageTaken: num(d.downedDamageTaken),
        damageBarrier: num(d.damageBarrier),
        breakbarDamageTaken: num(d.breakbarDamageTaken),
        blockedCount: num(d.blockedCount),
        evadedCount: num(d.evadedCount),
        dodgeCount: num(d.dodgeCount),
        invulnedCount: num(d.invulnedCount),
        missedCount: num(d.missedCount),
        interruptedCount: num(d.interruptedCount),
        downCount: num(d.downCount),
        downDuration: num(d.downDuration),
        deadCount: num(d.deadCount),
        deadDuration: num(d.deadDuration),
        dcCount: num(d.dcCount),
        dcDuration: num(d.dcDuration),
        receivedCrowdControl: num(d.receivedCrowdControl),
        receivedCrowdControlDuration: num(d.receivedCrowdControlDuration),
        stunBreak: num(d.stunBreak),
        removedStunDuration: num(d.removedStunDuration),
        deathRecap: (Array.isArray(p?.deathRecap) ? p.deathRecap : []).map((x: any) => ({
          deathTime: num(x?.deathTime),
          toKill: (Array.isArray(x?.toKill) ? x.toKill : [])
            .slice()
            .sort((a: any, b: any) => num(b?.damage) - num(a?.damage))
            .slice(0, 3)
            .map((k: any) => ({
              src: str(k?.src),
              id: num(k?.id),
              damage: num(k?.damage),
              indirectDamage: k?.indirectDamage === true,
            })),
        })),
      });

      const s = Array.isArray(p?.support) ? (p.support[phase] ?? {}) : {};
      const da = Array.isArray(p?.dpsAll) ? (p.dpsAll[phase] ?? {}) : {};
      // `groupBuffsActive` is one entry per buff; `id` sits on the buff and
      // `buffData` holds one cell per phase.
      const groupBuffsList: any[] = Array.isArray(p?.groupBuffsActive) ? p.groupBuffsActive : [];
      const groupBoons = groupBuffsList.map((buff) => {
        const buffData: any[] = Array.isArray(buff?.buffData) ? buff.buffData : [];
        const cell = buffData[phase] ?? {};
        const id = num(buff?.id);
        return {
          id,
          // EI keys its buff map as "b<id>"; the app's own ALL_BOONS list covers
          // only the classic boons, so this is what names everything else.
          name: str(raw?.buffMap?.[`b${id}`]?.name),
          generation: num(cell.generation),
          presence: num(cell.generationPresence),
          overstack: num(cell.overstack),
        };
      });

      supportPhase.push({
        ...playerIdentity(p),
        resurrects: num(s.resurrects),
        resurrectTime: num(s.resurrectTime),
        condiCleanse: num(s.condiCleanse),
        condiCleanseTime: num(s.condiCleanseTime),
        condiCleanseSelf: num(s.condiCleanseSelf),
        condiCleanseTimeSelf: num(s.condiCleanseTimeSelf),
        boonStrips: num(s.boonStrips),
        boonStripsTime: num(s.boonStripsTime),
        boonStripDownContribution: num(s.boonStripDownContribution),
        boonStripDownContributionTime: num(s.boonStripDownContributionTime),
        stunBreak: num(s.stunBreak),
        removedStunDuration: num(s.removedStunDuration),
        stunBreakSelf: num(s.stunBreakSelf),
        removedStunSelfDuration: num(s.removedStunSelfDuration),
        breakbarDamage: num(da.breakbarDamage),
        groupBoons,
      });
    }

    defense.push(defensePhase);
    support.push(supportPhase);
  }

  return { defense, support };
}
