// Portal Protocol - Log Uploader & Log Manager Suite
// Copyright (C) 2026 Mestiak
// Licensed under MIT License

// Mechanic parsers — faithful TS port of the Mechanic Analyzer's Cerus extractor.
//
// SOURCE: Mechanic Analyzer `src/utils/cerusParser.js` (extractCerusMechanics).
// That tool fetches dps.report getJson and re-derives encounter mechanics from
// Elite Insights' processed JSON. We reuse the EXACT same dps.report JSON
// (returned by the Rust `get_log_full` command, already fetched once for the
// combat tab) and run the same math in-browser — no second download, no local
// EVTC parser, no GW2 skill-API calls (we only need ids, not names).
//
// SCOPE: what the Stats-modal tabs render:
//   • Statistics  — 4 cards + fight timeline (orb-block eff, shadows reached,
//                   empowered gained, rage hits) straight from the MA overview.
//   • Shadows    — damage to Malicious Shadows (id 25645) per player.
//   • Orbs       — Gluttony buff (70253) collected/leaked per player.
//   • Empowered  — Emp.A consumed per phase (orbs/malice/rage/slam).
//
// The full per-shadow CC breakdown (the bulk of cerusParser.js:79–348) is NOT
// used by any tab, so it is intentionally omitted to keep parse cost + bundle lean.
//
// Boss detection is driven by `bossName` from the upload record (the app already
// knows the boss), so we never force a picker like the MA does.

// ─── Types ────────────────────────────────────────────────────────────────────
// A single skill's contribution to a player's damage on one Malicious Shadow.
export interface SkillHit {
  id: number;          // GW2 skill id
  name: string;        // resolved from skillMap ("s"+id); "Unknown" if absent
  icon: string;        // skill/passive/minion icon URL from skillMap ("" if absent)
  damage: number;      // damage this skill dealt to this shadow (this phase)
  percent: number;     // share of the player's total to this shadow
}

// Per-player entry inside a single Malicious Shadow (L3 drill-down).
// CC data is deferred — `ccTypes` stays [] until the buff-attribution phase.
export interface ShadowPlayer {
  name: string;        // toon name
  account: string;     // account tag
  profession: string;  // elite-spec string → /professions/{profession}.png
  damage: number;      // damage dealt to this shadow
  percent: number;     // share of this shadow's total
  topSkill: string;    // highest-damage skill name (derived from `skills[0]`)
  skills: SkillHit[];  // per-skill breakdown (player + minions), desc by damage
  ccTypes: string[];   // CC categories applied (deferred — empty until buff-attribution)
  hasAnyCC: boolean;   // deferred — always false for now
}

// A single Malicious Shadow spawned in a phase (L2).
export interface MaliciousShadow {
  name: string;        // "Malicious Shadow 1"
  index: number;       // target index (stable id)
  totalDamage: number; // sum of squad damage to this shadow
  players: ShadowPlayer[];
}

// A fight phase in the Shadows drill-down (L1).
export interface ShadowPhase {
  phaseName: string;   // "Phase 1" / "50%-10%" / "Enraged Smash"
  maliceCount: number; // number of shadows spawned in this phase
  totalDamage: number; // total cleave dmg to shadows this phase
  shadows: MaliciousShadow[];
}

export interface MechanicTabPlayer {
  name: string;
  account: string;
  profession: string;
  damage: number;
  percent: number;
}

export interface MechanicPhase {
  phaseName: string;
  start: number;
  end: number;
  maliceDamage: number;
  orbsEaten: number;
  maliceHits: number;   // stacked Emp.A consumed by shadows (capped 5 / shadow)
  shadowCount: number;  // number of distinct shadows that reached Cerus
  rageHits: number;
  empGained: number;
  empEnd: number;
  smashStacks: number;
  smashCount: number;
  rageHitsList: string[];
  timeline: { rawTime: number; type: string; detail: string; stacks: number }[];
}

export interface TimelinePoint {
  t: number; // ms
  orbBlocked: number; // orbs intercepted this tick
  orbLeaked: number; // orbs expired this tick
  shadowReached: number; // shadows that reached Cerus this tick
  rageHit: number; // true dome failures this tick
  type?: 'orb_blocked' | 'orb_leaked' | 'shadow_close' | 'shadow_reached' | 'rage_hit'; // event kind (chart dots)
  actor?: string; // who blocked / leaked / raged
  detail?: string; // Close Spawn text for shadow_reached events (player + distance)
}

// Per-player squad ledger (Cerus Statistics view — Squad Mechanics table).
export interface SquadLedgerPlayer {
  name: string;        // toon name
  account: string;     // account (e.g. ":Dejh.5971")
  profession: string;  // elite-spec string (e.g. "Scourge") → /professions/{profession}.png
  orbs: number;        // Gluttony buff (70253) stack gains collected
  cryRage: number;     // Cry of Rage hits taken (big AoE, player totalDamageTaken)
  envyStrip: number;   // Envy Wall touches (EnvGaze.Strip, time-clustered per player)
  dps: number;         // player DPS (from EI players[].dpsAll / dpsTargets)
}

// Harvest Temple stealth-break tracker (Mass Invisibility → Revealed proc).
export interface RevealedEvent {
  time: number;         // ms from fight start
  phaseName: string;    // matched phase from dps.report.phases[]
  player: string;       // account or toon name
  toonName?: string;    // character name when available
  profession: string;   // elite-spec string → /professions/{profession}.png
  source: string;       // Revealed / player-name / add-name
  sourceId?: number;
}

export interface MechanicReport {
  boss: string;
  isLCM: boolean;
  // Generic combat summary (non-Cerus bosses land here; never empty).
  summary: { totalDps: number; durationSec: number; players: number; avgBoonPct: number };
  // Statistics cards (Cerus only — 0/empty otherwise).
  orbEfficiency: number; // 0..100 collected / (collected + leaked)
  totalOrbs: number;
  totalOrbsLeaked: number;
  totalOrbsSpawned: number;   // Collected + Leaked (conservation; no deleted tracking)
  shadowsReached: number;
  shadowsLeaked: number;
  empoweredGained: number;
  rageHits: number;
  bestPull: number;           // best single-log boss % HP burned (0..100), 0 if no HP data
  timeline: TimelinePoint[];
  // Boon-strip summary (Envy Wall)
  boonStrippedPlayers: number; // distinct players stripped
  totalEnvyStrips: number;     // summed touches across squad
  // Shadows tab
  totalMaliceDamage: number;
  malicePlayers: MechanicTabPlayer[];
  maliceTargetCount: number; // number of Malicious Shadow targets (e.g. 23)
  shadowPhases: ShadowPhase[]; // L1→L2→L3 drill-down (phases → shadows → players)
  // Orbs tab
  orbLeaderboard: MechanicTabPlayer[];
  orbPhaseLeaders: { phaseName: string; collected: number; leaked: number; players: { name: string; account: string; profession: string; orbs: number }[] }[]; // per-phase collected leaderboard + leaked
  // Empowered tab
  phases: MechanicPhase[];
  // Squad Mechanics table (Cerus only — empty otherwise)
  squadLedger: SquadLedgerPlayer[];
  // Harvest Temple stealth breaks (empty unless boss === "Harvest Temple").
  revealedBreakers: RevealedEvent[];
  rawMechanicsCount?: number;
  debugMechanicNames?: { mechanics: string[]; buffs: string[] };
}

type Json = any;

// Per-player ALL-targets DPS from EI. `dpsAll` is an ARRAY [{dps}] in the live
// schema (NOT an object) — the prior `.dpsAll.dps` read returned undefined and
// zeroed every player. Index robustly: array→arr[0].dps, else object .get("0").dps.
function playerAllDps(p: Json): number {
  if (!p) return 0;
  const da = p.dpsAll;
  if (da == null) return 0;
  let node: Json | undefined;
  if (Array.isArray(da)) node = da[0];
  else node = da["0"];
  const d = node && node.dps;
  return typeof d === "number" ? Math.round(d) : 0;
}

const MALICE_ID = 25645;
const GLUTTONY_ID = 70253;

// Mesmer-family professions — scope for skill overrides below. Includes the new
// Janthir Wilds elite spec "Troubadour" (dps.report emits the canonical spelling).
const MESMER_PROFS = new Set(["Mesmer", "Chronomancer", "Mirage", "Virtuoso", "Troubadour"]);
// dps.report reuses some Ranger skill ids for Mesmer phantasms (e.g. the Virtuoso /
// Troubadour Focus-5 "Phantasmal Warden" comes back labeled "Whirling Defense" with
// the Ranger axe icon). Map the mislabeled source *name* → { correct name, correct
// GW2 icon }. Applied ONLY for Mesmer-family casters, so genuine Ranger skills keep
// their own name+icon.
interface SkillOverride { name: string; icon: string; }
const SKILL_OVERRIDES: Record<string, SkillOverride> = {
  "Whirling Defense": {
    name: "Phantasmal Warden",
    icon: "https://render.guildwars2.com/file/4E08BB09C3E6BE013AE255D763A3EB7C99AE2644/103768.png", // Mesmer Focus 5 phantasm
  },
};

// Aggregate a player's per-skill damage to one Malicious Shadow in one phase.
// Pulls `targetDamageDist[target][phase]` from the player AND each minion so the
// sum reconciles exactly to the slot total in `dpsTargets` (verified: diff 0).
// Skill names resolve via `skillMap["s"+id]`; damage-over-time effects that
// dps.report files as buffs (e.g. Bleeding/Poison) live in `buffMap["b"+id]`,
// which we use as a fallback so they show a real name + icon instead of "id<n>".
function skillBreakdownForTarget(
  logData: Json, p: Json, targetIdx: number, phaseIdx: number,
  skillMap: Record<string, Json>, buffMap: Record<string, Json>,
): SkillHit[] {
  const agg: Record<number, number> = {};
  const add = (tdd: Json) => {
    if (!tdd || !tdd[targetIdx] || !tdd[targetIdx][phaseIdx] || !Array.isArray(tdd[targetIdx][phaseIdx])) return;
    for (const sk of tdd[targetIdx][phaseIdx]) {
      const d = sk.totalDamage || 0;
      if (d > 0) agg[sk.id] = (agg[sk.id] || 0) + d;
    }
  };
  add(p.targetDamageDist);
  if (p.minions && Array.isArray(p.minions)) for (const m of p.minions) add(m.targetDamageDist);
  const total = Object.keys(agg).reduce((s: number, k: string) => s + agg[Number(k)], 0);
  const hits: SkillHit[] = Object.keys(agg).map((k: string) => {
    const id = Number(k);
    const dmg = agg[id];
    const sk = skillMap["s" + k];
    // Force `k` to a real string before adding the "b" prefix. This keeps the
    // lookup stable even if `k` ever arrives as a non-string type in the future.
    const buf = buffMap["b" + String(k)];
    const entry = sk || buf;
    const baseName = (entry && entry.name) || ("id" + k);
    const baseIcon = (entry && entry.icon) || "";
    // dps.report reuses Ranger ids for Mesmer phantasms → wrong name+icon. Apply the
    // override only for Mesmer-family casters so genuine Ranger skills are untouched.
    const ov = (p.profession && MESMER_PROFS.has(p.profession) && SKILL_OVERRIDES[baseName]) || null;
    const name = ov ? ov.name : baseName;
    const icon = ov ? ov.icon : baseIcon;
    return {
      id,
      name,
      icon,
      damage: dmg,
      percent: total > 0 ? Math.round((dmg / total) * 1000) / 10 : 0,
    };
  });
  hits.sort((a, b) => b.damage - a.damage);
  return hits;
}

// ─── Boss routing ──────────────────────────────────────────────────────────────
// Maps the uploader's `boss_name` (or dps.report fightName) to a parser.
// Temple of Febe IS the Cerus fight but dps.report names it "Temple of Febe"
// (no "cerus" substring), so we also route on that name and — most robustly —
// on the presence of a Malicious Shadow target (id 25645), which only spawns
// in Cerus. Ura/Dhuum keep their own (currently empty/graceful) routes.
export function extractMechanics(logData: Json, bossName: string, localRevealedSources?: { time: number; src_character?: string; src_account?: string; src_profession?: string; skill_id?: number }[]): MechanicReport | null {
  const key = (bossName || "").toLowerCase();
  const hasMaliceShadow =
    Array.isArray(logData.targets) &&
    logData.targets.some((t: Json) => t && t.id === MALICE_ID);
  const isCerus = key.includes("cerus") || key.includes("febe") || hasMaliceShadow;
  if (isCerus) return extractCerus(logData);
  if (key.includes("ura")) return extractUra(logData);
  if (key.includes("dhuum")) return extractDhuum(logData);
  if (key.includes("harvest") || key.includes("temple")) return extractHarvestTemple(logData, localRevealedSources);
  // Unknown / non-mechanic boss → only the Combat + generic summary apply.
  return null;
}

// ─── Generic combat summary (every boss) ───────────────────────────────────────
function combatSummary(logData: Json): { totalDps: number; durationSec: number; players: number; avgBoonPct: number; bestPull: number } {
  let totalDps = 0;
  let players = 0;
  let boonSum = 0;
  let boonN = 0;
  let bestPull = 0;
  if (logData.players) {
    logData.players.forEach((p: Json) => {
      players++;
      totalDps += playerAllDps(p);
      // best single-log boss % HP burned: from dps.report per-player percentBurned (boss target)
      const pb = p.percentBurned;
      const pct = typeof pb === "number" ? pb : (Array.isArray(p.dpsTargets) && p.dpsTargets[0] && p.dpsTargets[0][0] && typeof p.dpsTargets[0][0].percentBurned === "number" ? p.dpsTargets[0][0].percentBurned : 0);
      if (typeof pct === "number" && pct > bestPull) bestPull = pct;
      if (Array.isArray(p.buffUptimes)) {
        p.buffUptimes.forEach((b: Json) => {
          if (b && Array.isArray(b.buffData) && b.buffData[0] && typeof b.buffData[0].uptime === "number") {
            boonSum += b.buffData[0].uptime;
            boonN++;
          }
        });
      }
    });
  }
  const dur = (logData.phases && logData.phases[0] && logData.phases[0].end) || (logData.duration || 0) * 1000;
  return {
    totalDps: Math.round(totalDps),
    durationSec: Math.round(dur / 1000),
    players,
    avgBoonPct: boonN ? Math.round((boonSum / boonN) * 10) / 10 : 0,
    bestPull: Math.round(bestPull * 10) / 10,
  };
}

// ─── Ura / Dhuum (placeholder, graceful) ─────────────────────────────────────
function extractUra(logData: Json): MechanicReport {
  return { boss: "Ura", isLCM: /(legendary|lcm)/i.test(logData.fightName || ""), summary: combatSummary(logData),
    orbEfficiency: 0, totalOrbs: 0, totalOrbsLeaked: 0, totalOrbsSpawned: 0, shadowsReached: 0, shadowsLeaked: 0,
    empoweredGained: 0, rageHits: 0, bestPull: 0, timeline: [], boonStrippedPlayers: 0, totalEnvyStrips: 0,
    totalMaliceDamage: 0, malicePlayers: [], maliceTargetCount: 0, shadowPhases: [], orbLeaderboard: [], orbPhaseLeaders: [], phases: [], squadLedger: [], revealedBreakers: [] };
}
function extractDhuum(logData: Json): MechanicReport {
  return { boss: "Dhuum", isLCM: /(legendary|lcm)/i.test(logData.fightName || ""), summary: combatSummary(logData),
    orbEfficiency: 0, totalOrbs: 0, totalOrbsLeaked: 0, totalOrbsSpawned: 0, shadowsReached: 0, shadowsLeaked: 0,
    empoweredGained: 0, rageHits: 0, bestPull: 0, timeline: [], boonStrippedPlayers: 0, totalEnvyStrips: 0,
    totalMaliceDamage: 0, malicePlayers: [], maliceTargetCount: 0, shadowPhases: [], orbLeaderboard: [], orbPhaseLeaders: [], phases: [], squadLedger: [], revealedBreakers: [] };
}

// ─── Harvest Temple ────────────────────────────────────────────────────────────
function extractHarvestTemple(logData: Json, localRevealedSources?: { time: number; src_character?: string; src_account?: string; src_profession?: string; skill_id?: number }[]): MechanicReport {
  const isLCM = /(legendary|lcm)/i.test((logData.fightName || "").toLowerCase());
  const phases: { phaseName: string; start: number; end: number }[] = [];
  if (logData.phases) {
    logData.phases.forEach((p: Json) => {
      if (p && typeof p.name === "string") phases.push({ phaseName: p.name, start: p.start || 0, end: p.end || 0 });
    });
  }

  // Harvest Temple can come back from dps.report as coarse names like "Full Fight".
  // Map them to the canonical Dragonvoid phase list so the Phase column is useful.
  const normalizePhase = (name: string): string => {
    const n = name.toLowerCase();
    if (n.includes("jormag")) return "Jormag";
    if (n.includes("primordus")) return "Primordus";
    if (n.includes("kralk")) return "Kralkatorrik";
    if (n.includes("zhaitan")) return "Zhaitan";
    if (n.includes("mordremoth")) return "Mordremoth";
    if (n.includes("soowon") || n.includes("soo-won")) return "Soo-Won";
    if (n.includes("heart") || n.includes("purification")) return "Purification";
    if (n.includes("void time caster")) return "Void Time Caster";
    if (n.includes("giant")) return "Giants";
    if (n.includes("saltspray")) return "Void Saltspray Dragon";
    if (n.includes("obliterator")) return "Void Obliterator";
    if (n.includes("goliath")) return "Void Goliath";
    if (n === "full fight" || n === "fullfight" || n.includes("full")) return "Full Fight";
    return name;
  };

  const mappedPhases = phases.map((p) => ({ ...p, phaseName: normalizePhase(p.phaseName) }));

  const skillMap: Record<string, Json> = (logData.skillMap as Record<string, Json>) || {};
  const skillName = (id: number | undefined | null) => {
    if (id == null) return "Unknown";
    const a = skillMap["s" + id];
    return (a && a.name) ? a.name : ("id" + id);
  };

  const matchPhase = (t: number) => {
    for (const p of mappedPhases) {
      if (t >= p.start && t <= p.end) return p.phaseName;
    }
    return "Global";
  };

  let out: RevealedEvent[] = [];
  const mechNames: string[] = [];
  const buffNames: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(logData.mechanics)) {
    for (const m of logData.mechanics) {
      const name = (m && m.name || "").toString();
      if (!seen.has(name)) { seen.add(name); mechNames.push(name); }
    }
  }
  seen.clear();
  if (Array.isArray(logData.buffData)) {
    for (const b of logData.buffData) {
      const name = (b && b.name || "").toString();
      if (!seen.has(name)) { seen.add(name); buffNames.push(name); }
    }
  }
  // dps.report exposes Revealed as a buffUptime under the squad buff map, not
  // as a top-level mechanics[] event. Build player→profession from players[],
  // locate Revealed by name or id 890 in buffMap/buffUptimes, then read the
  // per-player time-series in `statesPerSource` and emit one row per apply.
  const playerProfession: Record<string, string> = {};
  if (Array.isArray(logData.players)) {
    for (const p of logData.players) {
      const acct = String(p.account || "").trim();
      const name = String((p as any).name || "").trim();
      const prof = String(p.profession || "").trim();
      if (acct) playerProfession[acct] = prof;
      if (name) playerProfession[name] = prof;
    }
  }
  const buffById: Record<string, Json> = (logData.buffMap as Record<string, Json>) || {};
  let revealedBuffId: string | null = null;
  for (const [key, b] of Object.entries(buffById)) {
    const name = String(b && b.name || "").trim();
    if (/^b\d+$/.test(key) && name.toLowerCase() === "revealed") { revealedBuffId = key; break; }
  }
  const scanUptimesForRevealed = (players: Json[]) => {
    if (!revealedBuffId) return;
    for (const p of players) {
      const acct = String(p.account || "").trim();
      const name = String((p as any).name || "").trim();
      if (!acct && !name) continue;
      const uptimes: Json[] = Array.isArray(p.buffUptimes) ? p.buffUptimes : [];
      const match = uptimes.find((u) => String(u.id || "") === revealedBuffId.replace("b", ""));
      if (!match || !match.statesPerSource) continue;
      // Prefer the account-keyed series when present; fall back to the
      // character-name-keyed series. dps.report keys `statesPerSource` by
      // account for most logs, but some older logs key by character name
      // instead. This fallback preserves both paths without dropping data.
      const series: Json[] = match.statesPerSource[acct] || match.statesPerSource[name];
      if (!Array.isArray(series)) continue;
      const playerKey = acct || name;
      const toonName = name || playerKey;
      const sourceKey = acct ? (match.statesPerSource[acct] ? acct : (name ? (match.statesPerSource[name] ? name : "Unknown") : "Unknown")) : (name ? (match.statesPerSource[name] ? name : "Unknown") : "Unknown");
      for (let i = 0; i < series.length; i++) {
        const entry = series[i];
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const tRaw = typeof entry[0] === "number" ? entry[0] : Number(entry[0]);
        const state = typeof entry[1] === "number" ? entry[1] : Number(entry[1]);
        if (!Number.isFinite(tRaw) || !Number.isFinite(state)) continue;
        if (state < 1) continue;
        const t = Math.max(0, tRaw);
        out.push({
          time: t,
          phaseName: matchPhase(t),
          player: playerKey,
          toonName,
          profession: playerProfession[playerKey] || "",
          source: resolveRevealedSource(t, localRevealedSources) || "Unknown",
          sourceId: 719,
        });
        break;
      }
    }
  };
  scanUptimesForRevealed(Array.isArray(logData.players) ? logData.players : []);
  if (out.length === 0 && Array.isArray(logData.buffData)) {
    for (const b of logData.buffData) {
      if (!b || !Array.isArray(b.events)) continue;
      const id = typeof b.id === "number" ? b.id : Number(b.id);
      if (id !== 719 && !/reveal/i.test(String(b.name || ""))) continue;
      for (const ev of b.events) {
        const t = typeof ev.time === "number" ? ev.time : Number(ev.time) || 0;
        out.push({
          time: t,
          phaseName: matchPhase(t),
          player: String(ev.target || ev.actor || "Unknown"),
          profession: "",
          source: "Revealed",
          sourceId: id || undefined,
        });
      }
    }
  }

  out.sort((a, b) => a.time - b.time);
  seen.clear();
  const deduped: typeof out = [];
  for (const ev of out) {
    // Use composite player+time key so a single account that breaks Revealed
    // multiple times across different phases/times keeps every row (the UI
    // requirement says "all revealed events for the log").
    const key = `${ev.player}|${ev.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }
  out = deduped;
  return {
    boss: "Harvest Temple",
    isLCM,
    summary: combatSummary(logData),
    orbEfficiency: 0, totalOrbs: 0, totalOrbsLeaked: 0, totalOrbsSpawned: 0,
    shadowsReached: 0, shadowsLeaked: 0, empoweredGained: 0, rageHits: 0, bestPull: 0, timeline: [],
    boonStrippedPlayers: 0, totalEnvyStrips: 0,
    totalMaliceDamage: 0, malicePlayers: [], maliceTargetCount: 0, shadowPhases: [],
    orbLeaderboard: [], orbPhaseLeaders: [], phases: [], squadLedger: [],
    revealedBreakers: out,
  };
}


function resolveRevealedSource(time: number, local?: { time: number; src_character?: string; src_account?: string; src_profession?: string; skill_id?: number }[]): string {
  if (!Array.isArray(local) || !local.length) return "";
  let best = "";
  let bestDist = Infinity;
  for (const row of local) {
    const t = typeof row.time === "number" ? row.time : Number(row.time);
    if (!Number.isFinite(t)) continue;
    const dist = Math.abs(t - time);
    if (dist < bestDist) {
      bestDist = dist;
      const parts = [row.src_character, row.src_account, row.src_profession].filter((v) => typeof v === "string" && v.trim() !== "");
      best = parts.join(" | ") || "";
    }
  }
  return best;
}

// ─── Cerus ──────────────────────────────────────────────────────────────────────
function extractCerus(logData: Json): MechanicReport {
  const isLCM = /(legendary|lcm)/i.test((logData.fightName || "").toLowerCase());
  const smashStacksPerSlam = isLCM ? 3 : 2;

  // Malicious Shadow targets (index into logData.targets = dpsTargets key).
  const maliceTargets: { index: number; name: string }[] = [];
  if (logData.targets) {
    logData.targets.forEach((t: Json, index: number) => {
      if (t && t.id === MALICE_ID) maliceTargets.push({ index, name: t.name || "Malicious Shadow" });
    });
  }

  // ── Main (non-breakbar/non-split) phases ──
  //   • phaseStats — lightweight list (Empowered tab needs start/end/phaseIdx).
  //   • shadowPhases — full L1→L2→L3 drill-down (Shadows tab).
  const phaseStats: { phaseName: string; start: number; end: number; phaseIdx: number; totalDamage: number }[] = [];
  const shadowPhases: ShadowPhase[] = [];
  const skillMap: Record<string, Json> = (logData.skillMap as Record<string, Json>) || {};
  const buffMap: Record<string, Json> = (logData.buffMap as Record<string, Json>) || {};
  // Friendly phase names (dps.report feeds "50%-10%" for the third phase).
  const normPhase = (n: string) => (/50%\s*-\s*10%/i.test(n) ? "Phase 3" : n);
  if (logData.phases && logData.players) {
    for (let phaseIdx = 1; phaseIdx < logData.phases.length; phaseIdx++) {
      const phase = logData.phases[phaseIdx];
      const pName = (phase.name || "").toLowerCase();
      if (pName.includes("breakbar") || pName.includes("split")) continue;

      let phaseTotalDamage = 0;
      const shadowsInPhase: MaliciousShadow[] = [];

      maliceTargets.forEach((malice) => {
        const shadowPlayersMap: Record<string, ShadowPlayer> = {};
        logData.players.forEach((p: Json) => {
          const slot = p.dpsTargets && p.dpsTargets[malice.index] && p.dpsTargets[malice.index][phaseIdx];
          const dmg = slot ? (slot.damage || 0) : 0;
          if (dmg > 0) {
            const skills = skillBreakdownForTarget(logData, p, malice.index, phaseIdx, skillMap, buffMap);
            shadowPlayersMap[p.account || "Unknown"] = {
              name: p.name, account: p.account || "Unknown", profession: p.profession,
              damage: dmg, percent: 0,
              topSkill: skills.length ? skills[0].name : "",
              skills,
              ccTypes: [], hasAnyCC: false,
            };
          }
        });
        const shadowPlayers = Object.values(shadowPlayersMap);
        const shadowTotalDamage = shadowPlayers.reduce((s, pl) => s + pl.damage, 0);
        if (shadowTotalDamage > 0) {
          shadowPlayers.forEach((pl) => (pl.percent = Math.round((pl.damage / shadowTotalDamage) * 1000) / 10));
          shadowPlayers.sort((a, b) => b.damage - a.damage);
          shadowsInPhase.push({ name: malice.name, index: malice.index, totalDamage: shadowTotalDamage, players: shadowPlayers });
          phaseTotalDamage += shadowTotalDamage;
        }
      });

      if (phaseTotalDamage > 0) {
        shadowsInPhase.sort((a, b) => b.totalDamage - a.totalDamage);
        shadowPhases.push({
        phaseName: normPhase(phase.name), maliceCount: shadowsInPhase.length,
        totalDamage: phaseTotalDamage, shadows: shadowsInPhase,
        });
        phaseStats.push({ phaseName: normPhase(phase.name), start: phase.start, end: phase.end, phaseIdx, totalDamage: phaseTotalDamage });
      }
    }
  }

  // Orb/empowered phases — drop strict supersets (e.g. broad "Phase 3" that
  // contains "50%-10%" + "Enraged Smash") so orbs/leaks attribute to leaf phases.
  const mainPhases: { phaseName: string; start: number; end: number; phaseIdx: number; totalDamage: number }[] =
    phaseStats.filter((p) =>
    !phaseStats.some((q) => q !== p && q.start >= p.start && q.end <= p.end && (q.start > p.start || q.end < p.end)));

  // ── Overall damage to Shadows + per-player share ──
  let overallTotalDamage = 0;
  const overallPlayersMap: Record<string, { account: string; toonName: string; profession: string; damage: number }> = {};
  logData.players && logData.players.forEach((p: Json) => {
    let playerOverallDamage = 0;
    maliceTargets.forEach((malice) => {
      const slot = p.dpsTargets && p.dpsTargets[malice.index] && p.dpsTargets[malice.index][0];
      if (slot) playerOverallDamage += slot.damage || 0;
    });
    if (playerOverallDamage > 0) {
      overallTotalDamage += playerOverallDamage;
      overallPlayersMap[p.account || "Unknown"] = {
        account: p.account || "Unknown", toonName: p.name, profession: p.profession, damage: playerOverallDamage,
      };
    }
  });
  const malicePlayers: MechanicTabPlayer[] = Object.values(overallPlayersMap)
    .map((p) => ({ name: p.toonName, account: p.account, profession: p.profession, damage: p.damage,
      percent: overallTotalDamage > 0 ? Math.round((p.damage / overallTotalDamage) * 1000) / 10 : 0 }))
    .sort((a, b) => b.damage - a.damage);

  // ── Mechanic event times ──
  const empAByTime: number[] = [];
  const malIntAEvents: number[] = [];
  const rageEvents: number[] = [];
  const cryRageCasts: number[] = [];
  const enrSmashCasts: number[] = [];
  const cerusPos = [373.396, 363.581];
  if (logData.targets && logData.targets[0] && logData.targets[0].combatReplayData &&
      logData.targets[0].combatReplayData.positions && logData.targets[0].combatReplayData.positions[0]) {
    cerusPos[0] = logData.targets[0].combatReplayData.positions[0][0];
    cerusPos[1] = logData.targets[0].combatReplayData.positions[0][1];
  }

  if (logData.mechanics) {
    logData.mechanics.forEach((mech: Json) => {
      const name = mech.name || "";
      const events: { time: number }[] = mech.mechanicsData || [];
      if (name === "Emp.A") events.forEach((ev) => empAByTime.push(ev.time));
      else if (name === "MalInt.A") events.forEach((ev) => malIntAEvents.push(ev.time));
      else if (name === "Emp.CryRage.H" || name === "CryRage.H") events.forEach((ev) => rageEvents.push(ev.time));
      else if (name === "CryRage.C") events.forEach((ev) => cryRageCasts.push(ev.time));
      else if (name === "EnrSmash.C") events.forEach((ev) => enrSmashCasts.push(ev.time));
    });
  }
  empAByTime.sort((a, b) => a - b);
  malIntAEvents.sort((a, b) => a - b);
  rageEvents.sort((a, b) => a - b);
  cryRageCasts.sort((a, b) => a - b);
  enrSmashCasts.sort((a, b) => a - b);

  // Shadow spawn times (dedup within 500ms, like the MA).
  const shadowSpawnTimes: number[] = [];
  let lastShadowT = -99999;
  malIntAEvents.forEach((t) => { if (t - lastShadowT > 500) { shadowSpawnTimes.push(t); lastShadowT = t; } });

  // Rage hits (true dome failures) for each phase.
  const skillName = (logData: Json, id: number): string => {
    const s = logData.skillMap && (logData.skillMap["s" + id] || logData.skillMap[id]);
    return (s && s.name) || "";
  };
  const phaseRageHits = (phaseIdx: number): string[] => {
    const list: string[] = [];
    if (!logData.players) return list;
    logData.players.forEach((p: Json) => {
      const pList = p.totalDamageTaken ? p.totalDamageTaken[phaseIdx] : null;
      let hits = 0;
      if (pList) pList.forEach((item: Json) => {
        const sn = skillName(logData, item.id).toLowerCase();
        if (sn.includes("cry of rage")) {
          const dmg = item.totalDamage || item.damage || 0;
          if (dmg >= 20000 || item.blocked > 0 || item.evaded > 0 || dmg === 0) hits += (item.hits || 0);
        }
      });
      if (hits > 0) list.push(p.name + (hits > 1 ? " x" + hits : ""));
    });
    return list;
  };

  // ── Build per-phase empowered breakdowns (faithful MA math) ──
  // Emp.A events are deduped by time (one phase wins) because this dps.report
  // version omits the per-event `phase` field the MA keys on — overlapping
  // windows (Phase 3 / 50%-10% / Enraged Smash share time) would double-count.
  const empPhases: any[] = [];
  const usedEmpA = new Set<number>();
  const usedRage = new Set<number>();
  // Global across phases: spawn→entity map, reached set, the burst→spawn owner
  // map, and the set of already-emitted shadows (so a shadow is never double-
  // counted when its orb-burst lands in a different phase than its spawn).
  const spawnClusters: Record<number, number[]> = {};
  const emittedShadows = new Set<number>();
  let globalReachedBuilt = false;
  let globalReached: { idx: number; spawnT: number; sh: Json | null; reachT: number; minDist: number }[] = [];
  mainPhases.forEach((phase) => {
    const start = phase.start, end = phase.end, phaseIdx = phase.phaseIdx;
    const pEmpA: number[] = [];
    empAByTime.forEach((t, idx) => { if (t >= start && t <= end && !usedEmpA.has(idx)) { pEmpA.push(t); usedEmpA.add(idx); } });
    const pShadowSpawns = shadowSpawnTimes.filter((t) => t >= start && t <= end);
    const pSmashCasts = enrSmashCasts.filter((t) => t >= start && t <= end);
    const pRageEvents: number[] = [];
    rageEvents.forEach((t, idx) => { if (t >= start && t <= end && !usedRage.has(idx)) { pRageEvents.push(t); usedRage.add(idx); } });

    // matchedRage = rage hits that coincide with an Emp.A within 100ms.
    const rageIndices = new Set<number>();
    const matchedRageMap: Record<number, string> = {};
    pRageEvents.forEach((rt) => {
      let closestT = -1, closestDiff = Infinity;
      pEmpA.forEach((t, idx) => {
        if (rageIndices.has(idx)) return;
        const diff = Math.abs(t - rt);
        if (diff < closestDiff) { closestDiff = diff; closestT = idx; }
      });
      if (closestT !== -1) {
        rageIndices.add(closestT);
        let actor = "Unknown Player";
        if (logData.mechanics) {
          for (const mech of logData.mechanics) {
            if (mech.name === "Emp.CryRage.H" || mech.name === "CryRage.H") {
              for (const ev of (mech.mechanicsData || [])) {
                if (Math.abs(ev.time - rt) <= 100) { actor = ev.actor; break; }
              }
            }
          }
        }
        matchedRageMap[closestT] = actor;
      }
    });

    let remainingEmpA: number[] = [];
    const timeline: { rawTime: number; type: string; detail: string; stacks: number }[] = [];
    pEmpA.forEach((t, idx) => {
      // Cry of Rage is an autonomous empowered-gain source (+1) — it does NOT consume
      // a stack from remainingEmpA (orbs/shadows/slams stay attributed correctly).
      if (rageIndices.has(idx)) timeline.push({ rawTime: t, type: "Rage Hit", detail: matchedRageMap[idx] || "", stacks: 1 });
      else remainingEmpA.push(t);
    });

    // Slams (Enraged Smash casts consume smashStacksPerSlam Emp.A within 2s).
    let smashCount = 0, smashStacks = 0;
    // Shadow (Malicious Shadow) orb-consumption events. Accumulated across the
    // whole fight: shadowStacks = Emp.A consumed by shadows (malice that reached
    // Cerus via a shadow); shadowCount = reached shadows that gained stacks.
    let shadowStacks = 0, shadowCount = 0;
    pSmashCasts.forEach((castT) => {
      let matched = 0;
      for (let i = 0; i < remainingEmpA.length; i++) {
        const t = remainingEmpA[i];
        if (t >= castT && t <= castT + 2000) {
          timeline.push({ rawTime: t, type: "Slam", detail: "Cast at " + Math.round(castT / 1000) + "s", stacks: 1 });
          remainingEmpA.splice(i, 1); i--; matched++; if (matched >= smashStacksPerSlam) break;
        }
      }
      if (matched > 0) { smashCount++; smashStacks += matched; }
    });

    // Shadows reached (Emp.A cluster of >=4 within 200ms, 2-20s after a shadow spawn,
    // that ended up within 250u of Cerus — needs combatReplayData positions).
    // Two semantically different cases, which the user wants shown distinctly:
    //   • CLOSE SPAWN — the malice was DROPPED near Cerus (spawn position within
    //     250u of the boss). The dropper (MalInt.A actor) is named; this is a
    //     placement mistake by that player. Badge: "Close Spawn: **Player** (Xu)".
    //   • WALK-IN — the malice spawned FAR from Cerus (e.g. 336-365u, by the
    //     door) and the squad FAILED to immobilize/slow/kill it, so it walked
    //     into Cerus and gained stacks. No close-spawn player; the dot simply
    //     marks "Shadow Reached Boss". (Verified against replay: the 5:55 Sheetz
    //     case is a walk-in, NOT a close spawn.)
    // The "Close Spawn" dropper is the squad member paired 1:1 to this shadow by
    // spawn-instant index in the globalReached build (e.closeName) — NOT by
    // position (a shadow spawns at its dropper and walks to Cerus, so "closest
    // to Cerus" matches a different nearby player) and NOT by time-nearest (which
    // would hand all siblings sharing a spawn instant the same single actor).
    const CLOSE_SPAWN_DIST = 250; // u: spawn position within this of Cerus = close spawn
    const closeSpawnPlayer = (e: any): { name: string; dist: number } | null => {
      if (!e || !e.sh || !e.sh.combatReplayData) return null;
      if (e.spawnDist == null || e.spawnDist >= CLOSE_SPAWN_DIST) return null; // walk-in, not a close spawn
      const dist = Math.round(e.spawnDist); // how close to Cerus it was DROPPED
      if (e.closeName) return { name: e.closeName, dist };
      return null;
    };

    // to within 250u of Cerus (its combatReplayData trajectory) AND (b) consumes
    // its orb stack there (an Emp.A burst near that reach moment). If it reached
    // but no orb was consumed near it, it was intercepted/blocked (not a "reached"
    // shadow). The Emp.A burst that a shadow consumes must be assigned to the
    // NEAREST shadow spawn — never to whichever spawn's fixed window happens to
    // overlap it — otherwise an early spawn (e.g. 146s) can "steal" a later
    // spawn's burst (e.g. 161s/Past Gone) and get mis-named. So we first match
    // each spawn to its own replay entity (by start time), compute that entity's
    // reach moment, then greedily assign each Emp.A burst to the nearest reached
    // shadow. This is theft-proof by construction and catches genuinely-reached
    // late shadows (whose orb consumption can land 30-60s after spawn) without
    // letting an early spawn swallow them.
    // 1) Build the GLOBAL "reached Cerus" set ONCE, from EI's own Malicious
    //    Shadow (id 25645) targets — the authoritative source. A shadow "reached"
    //    when its combatReplayData trajectory passes within 250u of Cerus. Each
    //    reached entry carries the matched MalInt.A spawn time (the player who
    //    summoned it) and its closest-approach moment (reachT). This is the
    //    ground-truth candidate pool — every later phase can attach an Emp.A
    //    burst to any of these, regardless of which phase the spawn lived in.
    if (!globalReachedBuilt) {
      globalReachedBuilt = true;
      const malIntA = (logData.mechanics || []).find((m: Json) => m.name === "MalInt.A");
      const malIntTimes = malIntA ? (malIntA.mechanicsData || []).map((e: Json) => e.time) : [];
      // Multiple Malicious Shadows spawn at the SAME MalInt.A instant (e.g. three
      // at 308.7s, each owned by a different player: Keira / Vaalye / Sheetz). We
      // must pair them 1:1 by spawn-instant INDEX — not time-nearest (which would
      // hand every sibling the same single actor) and not position (which picks
      // whoever stood near Cerus). Build: spawnInstant -> [actors in EI order];
      // the i-th shadow spawned at that instant owns the i-th actor.
      const actorsBySpawn: Record<string, string[]> = {};
      (malIntA?.mechanicsData || []).forEach((ev: Json) => {
        const k = String(ev.time);
        if (!actorsBySpawn[k]) actorsBySpawn[k] = [];
        actorsBySpawn[k].push(ev.actor);
      });
      let seenAt: Record<string, number> = {};
      globalReached = (logData.targets || [])
        .filter((t: Json) => t.id === MALICE_ID && t.combatReplayData && t.combatReplayData.positions && t.combatReplayData.positions[0])
        .map((t: Json, idx: number) => {
          const crd = t.combatReplayData;
          const start = crd.start || 0;
          const pos = crd.positions;
          let minDist = Infinity, minIdx = 0;
          pos.forEach((pt: number[], i: number) => {
            const d = Math.hypot(pt[0] - cerusPos[0], pt[1] - cerusPos[1]);
            if (d < minDist) { minDist = d; minIdx = i; }
          });
          // matched MalInt.A instant = the spawn event nearest (start - 5000ms).
          // NOTE: this instant is NOT unique per shadow (3 shadows can share it)
          // — so we pair by spawn-instant INDEX below, not by the time alone.
          let spawnT = -1, best = Infinity;
          for (const mt of malIntTimes) { const diff = Math.abs(mt - (start - 5000)); if (diff < best) { best = diff; spawnT = mt; } }
          // reachT = the shadow's OWN closest-approach moment (authoritative; the
          // instant it actually reached Cerus), not the spawn time.
          const reachT = start + minIdx * 300;
          // spawnDist = where the malice was DROPPED (positions[0]), distance
          // from Cerus. <250u => a "Close Spawn" (dropper placement mistake);
          // far (336-365u) => a "Walk-in" the squad failed to stop.
          const spawnDist = Math.hypot(pos[0][0] - cerusPos[0], pos[0][1] - cerusPos[1]);
          // Pair this shadow (the i-th spawned at `spawnT`) with the i-th MalInt.A
          // actor at that instant. This is the authoritative dropper.
          const k = String(spawnT);
          const n = seenAt[k] || 0; seenAt[k] = n + 1;
          const actor = (actorsBySpawn[k] && actorsBySpawn[k][n]) ? actorsBySpawn[k][n] : null;
          return { idx, spawnT, start, sh: t, reachT, minDist, spawnDist, closeName: actor };
        })
        .filter((e: any) => e.minDist < 250);
    }
    const reached = globalReached;
    // 2) Each reached shadow carries exactly ONE orb, so each (keyed by its own
    //    target idx) may own at most ONE Emp.A burst. Assign each burst to the
    //    globally-nearest reached shadow by reachT; if that one is taken, the
    //    next-nearest. The burst→shadow attribution defines the *stacks gained*
    //    (malice that actually reached Cerus via a shadow); reached-without-burst
    //    = blocked. Keying by idx keeps the 3 shadows that share one spawn instant
    //    distinct, so all of them can be counted.
    const burstUsed = new Set<number>();
    const bursts: { t: number; times: number[] }[] = [];
    remainingEmpA.forEach((t, idx) => {
      if (burstUsed.has(idx)) return;
      const burst: number[] = [];
      for (let j = 0; j < remainingEmpA.length; j++) {
        if (Math.abs(remainingEmpA[j] - t) <= 200) burst.push(j);
      }
      burst.forEach((j) => burstUsed.add(j));
      if (burst.length >= 4) bursts.push({ t, times: burst.map((j) => remainingEmpA[j]) });
    });
    const burstCount: Record<number, number> = {}; // idx -> #bursts
    const CAP = 1;
    bursts.forEach((b) => {
      let bestIdx = -1, bestDiff = Infinity;
      const tryAssign = (allowCapped: boolean) => {
        bestIdx = -1; bestDiff = Infinity;
        reached.forEach((e: any) => {
          const over = (burstCount[e.idx] || 0) >= CAP;
          if (over && !allowCapped) return;
          const diff = Math.abs(e.reachT - b.t);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = e.idx; }
        });
      };
      tryAssign(false);
      if (bestIdx === -1) tryAssign(true); // only if every near shadow is full
      if (bestIdx === -1) return; // no reached shadow near → stays an orb
      (spawnClusters[bestIdx] ||= []).push(...b.times);
      burstCount[bestIdx] = (burstCount[bestIdx] || 0) + 1;
      shadowStacks += b.times.length; // malice that reached Cerus via this shadow
      // Immediately remove these Emp.A from remainingEmpA so they can't later
      // leak as an orb (critical when the burst sits in a phase with no spawns).
      remainingEmpA = remainingEmpA.filter((t) => !b.times.includes(t));
    });
    // 3) Emit ONE Shadow event per reached shadow (keyed by idx) that owns a
    //    burst. This is the "Shadows Reached Cerus" stat (shadows that reached
    //    AND gained stacks = malice that actually reached Cerus via a shadow).
    //    Blocked shadows (reached but no Emp.A) are intentionally NOT counted here.
    reached.forEach((e: any) => {
      const cluster = spawnClusters[e.idx];
      if (!cluster || !cluster.length) return;
      if (emittedShadows.has(e.idx)) return; // already emitted
      emittedShadows.add(e.idx);
      shadowCount++;
      const close = closeSpawnPlayer(e);
      const sMin = Math.floor(e.start / 60000), sSec = Math.floor((e.start % 60000) / 1000);
      // ONE event per shadow, placed at its actual reach moment (reachT), not one
      // per burst-time (the cluster repeats -> inflated dots/counts). stacks =
      // orbs gained via this shadow (cluster length).
      if (close) {
        // CLOSE SPAWN — dropped near Cerus; name the dropper (MalInt.A actor).
        const detail = `${sMin}:${sSec.toString().padStart(2, "0")} ⚠️ Close Spawn: **${close.name}** (${close.dist}u)`;
        timeline.push({ rawTime: e.reachT, type: "ShadowClose", detail, stacks: cluster.length });
      } else {
        // WALK-IN — spawned far, squad failed to stop it; no close-spawn player.
        timeline.push({ rawTime: e.reachT, type: "ShadowWalk", detail: "", stacks: cluster.length });
      }
    });

    // Leaked orbs (remaining Emp.A) → Orb events, then group like MA
    // (Slam/Shadow grouped by detail, Orb grouped by second, Rage kept as-is).
    remainingEmpA.forEach((t) => timeline.push({ rawTime: t, type: "Orb", detail: "", stacks: 1 }));
    timeline.sort((a, b) => a.rawTime - b.rawTime);
    const groupedTimeline: { rawTime: number; type: string; detail: string; stacks: number }[] = [];
    const sg: Record<string, any> = {}, og: Record<string, any> = {};
    timeline.forEach((ev) => {
      if ((ev.type === "Shadow" || ev.type === "Slam") && ev.detail) {
        if (!sg[ev.detail]) { sg[ev.detail] = { rawTime: ev.rawTime, type: ev.type, detail: ev.detail, stacks: 1 }; groupedTimeline.push(sg[ev.detail]); }
        else sg[ev.detail].stacks++;
      } else if (ev.type === "Orb") {
        const key = Math.floor(ev.rawTime / 1000).toString();
        if (!og[key]) { og[key] = { rawTime: ev.rawTime, type: "Orb", detail: "", stacks: 1 }; groupedTimeline.push(og[key]); }
        else og[key].stacks++;
      } else {
        groupedTimeline.push({ ...ev });
      }
    });
    groupedTimeline.sort((a, b) => a.rawTime - b.rawTime);

    const orbStacks = remainingEmpA.length; // remaining Emp.A after slam/shadow = orbs eaten
    const empGained = pEmpA.length; // every Emp.A gain is empowered: orbs + shadows + slam + cry of rage
    const rageHitsList = phaseRageHits(phaseIdx);
    const rageHits = pRageEvents.length;

    empPhases.push({
      phaseName: phase.phaseName, start, end,
      empGained: Math.max(0, empGained),
      orbsEaten: orbStacks,
      maliceHits: shadowStacks,
      shadowCount,
      smashStacks, smashCount,
      rageHits,
      rageHitsList,
      timeline: groupedTimeline,
    });
  });

  // ── Orb collection/leak per player (Gluttony buff 70253 stack gains) ──
  // mainPhases (deduped leaf phases) is defined earlier.
  const orbWindows = mainPhases.map((cp, i) => ({
    name: cp.phaseName, start: cp.start,
    end: i < mainPhases.length - 1 ? mainPhases[i + 1].start : (logData.phases[0] ? logData.phases[0].end : (logData.duration || 0) * 1000),
  }));

  const playerOrbs: Record<string, { account: string; toonName: string; profession: string; phases: Record<string, number>; total: number }> = {};
  let totalOrbs = 0;
  if (logData.players) {
    logData.players.forEach((p: Json) => {
      playerOrbs[p.name] = { account: p.account || "Unknown", toonName: p.name, profession: p.profession, phases: {}, total: 0 };
      orbWindows.forEach((pw) => (playerOrbs[p.name].phases[pw.name] = 0));
      if (p.buffUptimes) {
        const b = p.buffUptimes.find((x: Json) => x.id === GLUTTONY_ID);
        if (b && b.states) {
          for (let s = 1; s < b.states.length; s++) {
            const t = b.states[s][0];
            const stack = b.states[s][1];
            const prev = b.states[s - 1][1];
            if (stack > prev) {
              const diff = stack - prev;
              playerOrbs[p.name].total += diff;
              totalOrbs += diff;
              orbWindows.forEach((pw) => { if (t >= pw.start && t <= pw.end) playerOrbs[p.name].phases[pw.name] += diff; });
            }
          }
        }
      }
    });
  }
  const orbLeaderboard: MechanicTabPlayer[] = Object.values(playerOrbs)
    .filter((p) => p.total > 0)
    .map((p) => ({ name: p.toonName, account: p.account, profession: p.profession, damage: p.total, percent: 0 }))
    .sort((a, b) => b.damage - a.damage);

  // Per-phase leaderboard (players who collected orbs in that phase) + leaked count.
  // Collected per player already lives in playerOrbs[p].phases[phaseName];
  // leaked per phase lives in empPhases[].orbsEaten (remaining Emp.A after rage/slam/shadow).
  const leakedByPhase: Record<string, number> = {};
  empPhases.forEach((ep) => { leakedByPhase[ep.phaseName] = ep.orbsEaten; });
  const orbPhaseLeaders = mainPhases.map((cp) => {
    const leaked = leakedByPhase[cp.phaseName] || 0;
    const collected = Object.values(playerOrbs).reduce((s, p) => s + (p.phases[cp.phaseName] || 0), 0);
    return {
      phaseName: cp.phaseName,
      collected,
      leaked,
      players: Object.values(playerOrbs)
        .filter((p) => (p.phases[cp.phaseName] || 0) > 0)
        .map((p) => ({ name: p.toonName, account: p.account, profession: p.profession, orbs: p.phases[cp.phaseName] }))
        .sort((a, b) => b.orbs - a.orbs),
    };
  });

  // ── Timeline events (faithful MA ordering) ──
  const timelineEvents: TimelinePoint[] = [];
  // orb_blocked from Gluttony gains; orb_leaked from remaining Emp.A (per phase).
  if (logData.players) {
    logData.players.forEach((p: Json) => {
      if (p.buffUptimes) {
        const b = p.buffUptimes.find((x: Json) => x.id === GLUTTONY_ID);
        if (b && b.states) {
          for (let s = 1; s < b.states.length; s++) {
            const t = b.states[s][0];
            const stack = b.states[s][1];
            const prev = b.states[s - 1][1];
            if (stack > prev) timelineEvents.push({ t, orbBlocked: stack - prev, orbLeaked: 0, shadowReached: 0, rageHit: 0, type: 'orb_blocked', actor: p.name });
          }
        }
      }
    });
  }
  empPhases.forEach((ph) => {
    ph.timeline.forEach((ev: any) => {
      if (ev.type === "Orb") timelineEvents.push({ t: ev.rawTime, orbBlocked: 0, orbLeaked: ev.stacks || 1, shadowReached: 0, rageHit: 0, type: 'orb_leaked' });
      else if (ev.type === "ShadowClose") timelineEvents.push({ t: ev.rawTime, orbBlocked: 0, orbLeaked: 0, shadowReached: ev.stacks || 1, rageHit: 0, type: 'shadow_close', detail: ev.detail });
      else if (ev.type === "ShadowWalk") timelineEvents.push({ t: ev.rawTime, orbBlocked: 0, orbLeaked: 0, shadowReached: ev.stacks || 1, rageHit: 0, type: 'shadow_reached' });
      else if (ev.type === "Rage Hit") timelineEvents.push({ t: ev.rawTime, orbBlocked: 0, orbLeaked: 0, shadowReached: 0, rageHit: 1, type: 'rage_hit', actor: ev.detail });
    });
  });
  timelineEvents.sort((a, b) => a.t - b.t);

  // ── Totals for the Statistics cards ──
  const totalOrbsLeaked = timelineEvents.reduce((s, e) => s + e.orbLeaked, 0);
  // Spawned is derived by conservation (Emp.A undercounts collected orbs), so it
  // always reconciles: Spawned = Collected + Leaked. No deleted-orb tracking.
  const totalOrbsSpawned = totalOrbs + totalOrbsLeaked;
  // shadowsReached = distinct Malicious Shadows that reached Cerus AND gained a
  // stack. shadowCount is incremented once per shadow (keyed by its target idx
  // across the whole fight), so summing per-phase shadowCount is the authoritative
  // distinct-shadow count — it is NOT affected by the MA-style grouping that
  // collapses same-detail shadows into one chart line.
  const shadowsReached = empPhases.reduce((s, p) => s + (p.shadowCount || 0), 0);
  const shadowsLeaked = 0; // MA counts reached; leaked = shadows that despawned (omitted for KISS)
  const empoweredGained = empPhases.reduce((s, p) => s + (p.empGained || 0), 0);
  const rageHits = empPhases.reduce((s, p) => s + (p.rageHits || 0), 0);
  const orbEfficiency = totalOrbs + totalOrbsLeaked > 0
    ? Math.round((totalOrbs / (totalOrbs + totalOrbsLeaked)) * 1000) / 10 : 0;

  // ── Phases (Empowered tab) with running total ──
  const phases: MechanicPhase[] = [];
  let running = 0;
  empPhases.forEach((p) => {
    running += p.empGained || 0;
    phases.push({
      phaseName: p.phaseName, start: p.start, end: p.end,
      maliceDamage: 0, orbsEaten: p.orbsEaten, maliceHits: p.maliceHits, shadowCount: p.shadowCount || 0,
      rageHits: p.rageHits, empGained: p.empGained, empEnd: running,
      smashStacks: p.smashStacks || 0, smashCount: p.smashCount || 0,
      rageHitsList: p.rageHitsList || [], timeline: p.timeline || [],
    });
  });
  // attach per-phase malice damage
  phases.forEach((ph) => {
    const ps = phaseStats.find((s) => s.phaseName === ph.phaseName);
    ph.maliceDamage = ps ? ps.totalDamage : 0;
  });

  // ── Squad Mechanics ledger (per-player: orbs, Cry of Rage, Envy Wall) ──
  // Cry of Rage hits (big AoE) — player totalDamageTaken skill "Cry of Rage".
  // Envy Wall boon strips — mechanic EnvGaze.Strip, one event per boon removed.
  // A single wall-touch strips several boons within the same ~1ms window, so we
  // CLUSTER by time (gap < 2000ms = same touch) and count TOUCHES, not boons.
  const stripByPlayer: Record<string, number[]> = {};
  if (logData.mechanics) {
    logData.mechanics.forEach((m: Json) => {
      if (m.name === "EnvGaze.Strip") {
        (m.mechanicsData || []).forEach((e: Json) => {
          (stripByPlayer[e.actor] ||= []).push(e.time);
        });
      }
    });
  }
  // Cry of Rage hits per player — authoritative source is the Emp.CryRage.H /
  // CryRage.H "true dome failure" mechanic, which already carries the actor.
  // This is the SAME source the cohort "Squad Rage Hits" card uses, so the table
  // agrees with the card. The old per-player totalDamageTaken gate (dmg >= 20000)
  // silently drops real hits (e.g. CM Cry of Rage ticks of 11139 dmg) and made the
  // table disagree with the card — so we key off the mechanic event instead and
  // only fall back to damage-taken when that mechanic data is absent.
  const cryRageByActor: Record<string, number> = {};
  if (logData.mechanics) {
    logData.mechanics.forEach((m: Json) => {
      if (m.name === "Emp.CryRage.H" || m.name === "CryRage.H") {
        (m.mechanicsData || []).forEach((e: Json) => {
          if (e.actor) cryRageByActor[e.actor] = (cryRageByActor[e.actor] || 0) + 1;
        });
      }
    });
  }
  const stripTouches = (actor: string): number => {
    const times = (stripByPlayer[actor] || []).slice().sort((a: number, b: number) => a - b);
    let touches = 0, last = -Infinity;
    for (const t of times) { if (t - last > 2000) { touches++; } last = t; }
    return touches;
  };
  const playerNames: string[] = [];
  if (logData.players) logData.players.forEach((p: Json) => { if (p && p.name) playerNames.push(p.name); });
  const squadLedger: SquadLedgerPlayer[] = playerNames.map((nm) => {
    const orbs = playerOrbs[nm] ? playerOrbs[nm].total : 0;
    // Cry of Rage (true dome failure) per player — use the authoritative
    // Emp.CryRage.H mechanic (matches the cohort "Squad Rage Hits" card). Fall
    // back to the per-player damage-taken gate only when that mechanic is absent.
    let cry = cryRageByActor[nm] || 0;
    if (cry === 0 && Object.keys(cryRageByActor).length === 0 && logData.players) {
      const pp = logData.players.find((x: Json) => x.name === nm);
      if (pp && pp.totalDamageTaken) {
        pp.totalDamageTaken.forEach((list: Json[]) => {
          (list || []).forEach((item: Json) => {
            const sn = skillName(logData, item.id).toLowerCase();
            if (sn.includes("cry of rage")) {
              const dmg = item.totalDamage || item.damage || 0;
              if (dmg >= 20000 || item.blocked > 0 || item.evaded > 0 || dmg === 0) cry += (item.hits || 0);
            }
          });
        });
      }
    }
    let dps = 0;
    if (logData.players) {
      const pp = logData.players.find((x: Json) => x.name === nm);
      if (pp) dps = playerAllDps(pp);
    }
    return { name: nm, account: (playerOrbs[nm] && playerOrbs[nm].account) || "", profession: (playerOrbs[nm] && playerOrbs[nm].profession) || "", orbs, cryRage: cry, envyStrip: stripTouches(nm), dps };
  });
  const boonStrippedPlayers = squadLedger.filter((p) => p.envyStrip > 0).length;
  const totalEnvyStrips = squadLedger.reduce((s, p) => s + p.envyStrip, 0);

  return {
    boss: "Cerus",
    isLCM,
    summary: combatSummary(logData),
    orbEfficiency,
    totalOrbs,
    totalOrbsLeaked,
    totalOrbsSpawned,
    shadowsReached,
    shadowsLeaked,
    empoweredGained,
    rageHits,
    bestPull: combatSummary(logData).bestPull,
    timeline: timelineEvents,
    boonStrippedPlayers,
    totalEnvyStrips,
    totalMaliceDamage: overallTotalDamage,
    malicePlayers,
    maliceTargetCount: maliceTargets.length,
    shadowPhases,
    orbLeaderboard,
    orbPhaseLeaders,
    phases,
    squadLedger,
    revealedBreakers: [],
  };
}

// ─── Multi-log aggregation ───────────────────────────────────────────────────
// Cap on how many Cerus logs a single aggregate "Analyze" can sum. Above this we
// still run, but the UI warns that the cohort may be skewed (e.g. 80 logs vs 3).
export const MAX_AGGREGATE_LOGS = 25;

// Merge two already-extracted Cerus reports into one summed cohort report.
// Used by the Mechanics tab: select N logs → render ONE dashboard with numbers
// summed across all of them. Identity/drill-down fields (shadowPhases, phases,
// orbPhaseLeaders) are taken from the first log (they're per-fight shape, not
// summable); the aggregate cards/leaderboards are summed per-player so the
// "Squad Mechanics" and "Orb Leaderboard" tables reflect the cohort.
export function mergeCerusReports(reports: MechanicReport[]): MechanicReport | null {
  const valid = reports.filter((r) => r && r.boss === "Cerus");
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const base = valid[0];
  const isLCM = valid.some((r) => r.isLCM);

  // Sum scalar cards.
  let totalOrbs = 0, totalOrbsLeaked = 0, totalOrbsSpawned = 0;
  let shadowsReached = 0, shadowsLeaked = 0, empoweredGained = 0, rageHits = 0, bestPull = 0;
  let totalMaliceDamage = 0, maliceTargetCount = 0, totalEnvyStrips = 0;
  let boonStrippedPlayers = 0;
  for (const r of valid) {
    totalOrbs += r.totalOrbs;
    totalOrbsLeaked += r.totalOrbsLeaked;
    totalOrbsSpawned += r.totalOrbsSpawned;
    shadowsReached += r.shadowsReached;
    shadowsLeaked += r.shadowsLeaked;
    empoweredGained += r.empoweredGained;
    rageHits += r.rageHits;
    if (r.bestPull > bestPull) bestPull = r.bestPull;
    totalMaliceDamage += r.totalMaliceDamage;
    maliceTargetCount += r.maliceTargetCount;
    totalEnvyStrips += r.totalEnvyStrips;
    boonStrippedPlayers += r.boonStrippedPlayers;
  }
  const orbEfficiency = totalOrbs + totalOrbsLeaked > 0
    ? Math.round((totalOrbs / (totalOrbs + totalOrbsLeaked)) * 1000) / 10
    : 0;

  // Sum per-player squad ledger + orb leaderboard + malice contribution.
  const byKey = (name: string, account: string) => `${account}::${name}`.toLowerCase();
  const squadMap = new Map<string, SquadLedgerPlayer>();
  const orbMap = new Map<string, MechanicTabPlayer>();
  const maliceMap = new Map<string, { name: string; account: string; profession: string; damage: number; percent: number }>();
  for (const r of valid) {
    for (const p of r.squadLedger) {
      const k = byKey(p.name, p.account);
      const cur = squadMap.get(k) || { name: p.name, account: p.account, profession: p.profession, orbs: 0, cryRage: 0, envyStrip: 0, dps: 0 };
      cur.orbs += p.orbs; cur.cryRage += p.cryRage; cur.envyStrip += p.envyStrip; cur.dps += p.dps;
      squadMap.set(k, cur);
    }
    for (const p of r.orbLeaderboard) {
      const k = byKey(p.name, p.account);
      const cur = orbMap.get(k) || { name: p.name, account: p.account, profession: p.profession, damage: 0, percent: 0 };
      cur.damage += p.damage; // field reused for "orbs taken" count in UI
      orbMap.set(k, cur);
    }
    for (const p of r.malicePlayers) {
      const k = byKey(p.name, p.account);
      const cur = maliceMap.get(k) || { name: p.name, account: p.account, profession: p.profession, damage: 0, percent: 0 };
      cur.damage += p.damage;
      maliceMap.set(k, cur);
    }
  }
  const squadLedger = [...squadMap.values()];
  const orbLeaderboard = [...orbMap.values()];
  const malicePlayers = [...maliceMap.values()];
  // Recompute per-player percent shares against the summed totals.
  const squadTotalOrbs = squadLedger.reduce((s, p) => s + p.orbs, 0) || 1;
  for (const p of squadLedger) p.orbs = p.orbs; // already summed
  const orbTotal = orbLeaderboard.reduce((s, p) => s + p.damage, 0) || 1;
  for (const p of orbLeaderboard) p.percent = Math.round((p.damage / orbTotal) * 1000) / 10;
  const maliceTotal = malicePlayers.reduce((s, p) => s + p.damage, 0) || 1;
  for (const p of malicePlayers) p.percent = Math.round((p.damage / maliceTotal) * 1000) / 10;

  // Timeline: aggregate only when all logs are single-log (handled in UI — we
  // leave timeline empty on multi-log so the chart is omitted, not misleading).
  return {
    boss: "Cerus",
    isLCM,
    summary: base.summary,
    orbEfficiency,
    totalOrbs,
    totalOrbsLeaked,
    totalOrbsSpawned,
    shadowsReached,
    shadowsLeaked,
    empoweredGained,
    rageHits,
    bestPull,
    timeline: [], // multi-log: chart omitted (per-fight offsets not summable)
    boonStrippedPlayers,
    totalEnvyStrips,
    totalMaliceDamage,
    malicePlayers,
    maliceTargetCount,
    shadowPhases: base.shadowPhases,   // shape from first log (drill-down)
    orbPhaseLeaders: base.orbPhaseLeaders, // shape from first log
    phases: base.phases,               // shape from first log
    squadLedger,
    orbLeaderboard,                    // summed per-player orb collection
    revealedBreakers: [],
  };
}

// Count Cerus (Cerus CM/LCM) logs in a set of UploadRecords, for the Mechanics
// tab boss-rail badge. Reads the cached dps.report boss_name when present.
export function countCerusLogs(records: { boss_name?: string | null; url?: string | null }[]): number {
  let n = 0;
  for (const r of records) {
    const bn = (r.boss_name || "").toLowerCase();
    if (bn.includes("cerus")) n++;
  }
  return n;
}
