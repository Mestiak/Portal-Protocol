<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { extractMechanics, type MechanicReport } from "#lib/mechanicParser";
  import { extractPhaseStats, type PhaseStat } from "#lib/phaseStats";
  import { extractDefenseSupport, type DefenseSupportStats, type DefensePlayerStat, type SupportPlayerStat, type RecapSource } from "#lib/defenseSupport";
  import { fmt, fmtPct, fmtTime } from "#lib/format";
  import { slide } from "svelte/transition";
  import { cubicInOut } from "svelte/easing";
  import CerusDashboard from "./CerusDashboard.svelte";
  // Stats modal: per-player damage + boon breakdown + encounter mechanics for a
  // dps.report log. Data comes from the Rust `get_log_full` command, which streams
  // dps.report getJson ONCE and returns both the Rust-shaped combat stats AND the
  // raw JSON (parsed in-browser here for the mechanic tabs). No browser CORS, one
  // network fetch per log. Mirrors the app's .vl-modal style.

  interface BoonStat { id: number; name: string; uptime_pct: number; stacks: number; }
  interface TargetStat { id: number; name: string; dps: number; }
  interface PlayerStat {
    name: string; account: string; profession: string; group: number;
    dps: number; cleave_dps: number; quickness_pct: number; alacrity_pct: number;
    boons: BoonStat[];
  }
  interface LogStats {
    boss_name: string; duration_sec: number;
    players: PlayerStat[]; targets: TargetStat[]; total_dps: number;
  }
  interface LogFull { stats: LogStats; raw: any; }

  // Compact stats caches are keyed by file and persisted across launches.
  // Bumping this discards entries written before a field existed. Any addition
  // to the cached payload MUST bump it: a warm open otherwise loads entries
  // missing the new field, and the tab that dereferences it throws.
  // 2: deathRecap gained toDown/downTime. 3: defenseSupport gained `downs`.
  // 4: the name maps (skillMap/buffMap) ride along, so a cached open can still
  //    resolve skill names instead of falling back to the boss name.
  // 5: mechanics timeline entries gained `closeName`/`closeDist` — caches from
  //    before that carry the close-spawn name inside `detail` and no fields.
  // 6: rage-hit rows carry their own actor. Caches from version 5 were parsed
  //    before that and credit one player with a whole simultaneous dome.
  // 7: Deimos oil downs carry their own timestamp. Version 6 entries have the
  //    down but no time, which rendered as "NaN:NaN".
  // 8: Dhuum CM reports gained the Ender's Echo fields (echoPickups/Players/
  //    Summary). Version 7 entries have no echo data at all, so the Pick Ups tab
  //    never appeared and Dhuum CM fell back to Boon Uptime.
  // 9: Deimos oils are now derived from damage bursts rather than `Oil T.` alone,
  //    which changes the slick list itself — version 8 entries carry the old rows.
  // 10: Statues of Darkness reports gained the eye override fields
  //     (eyeOverrides/Players/Summary); version 9 entries have none.
  // 11: overrides carry `unmatched`, saying why no skill could be attributed.
  // 12: attribution also matches the CC skill-id table (src/lib/ccSkillIds.ts).
  // 13: stun (872) is tracked too, with the encounter-granted Flare ids.
  // 14: eye teleports are read from the replay position track.
  // 15: skills the tooltip scan cannot classify (minion / mech commands).
  // 16: more of those (Artillery Slash).
  // 17: Ura reports gained the shard/bubble fields.
  // 18: each freed player carries their own float time.
  // 19: rescues free the closest players, capped by the removal-event count.
  // 20: a shard use matches its own removal events, never somebody else's.
  // 21: downed carriers drop their shard.
  // 22: early drops, and late bubble rescues flagged on the row.
  // 23: wasted drops explain when another player's shard got there first.
  // 24: that explanation is limited to a one-second window.
  // 25: a double drop requires the same player to pick up again.
  // 26: early drops need a geyser activation, or a very close bubble lift.
  // 27: another player's clear beats an early-drop inference.
  // 28: tighter geyser early window; bubbles can be scooped up to 2 s later.
  // 29: early drops name what they were early for.
  // 30: a qualifying bubble lift outranks an ambient geyser eruption.
  // 31: Aetherblade Hideout CM Exposed applications and downs.
  // 32: Exposed rows carry the stack count before and after each application.
  const STATS_CACHE_VERSION = 32;

  let { permalink, bossName = "", bossIcon = "/bosses/unknown.png", localPath, onClose }: {
    permalink: string;
    bossName?: string;
    bossIcon?: string;
    localPath?: string;
    onClose: () => void;
  } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let stats = $state<LogStats | null>(null);
  // Mechanic report parsed from the raw dps.report JSON (Cerus → full; others →
  // null or a graceful empty-shaped report with at least `summary`).
  let mechanics = $state<MechanicReport | null>(null);
  // Scoping: only Cerus gets the full Statistics tab (stat cards, timeline,
  // squad mechanics). Every other fight is reduced to the Boon Uptime table
  // only — fights like Ura spawn dozens of adds, and listing them inflates the
  // payload / stats count for no useful gain.
  const isCerus = $derived(!!mechanics && mechanics.boss === "Cerus");
  const isValeGuardian = $derived(!!mechanics && mechanics.boss === "Vale Guardian");
  const isDeimos = $derived(!!mechanics && mechanics.boss === "Deimos");
  // The echo fields exist only in CM, so their presence is the mode gate.
  const isDhuumCM = $derived(!!mechanics && mechanics.echoPickups !== undefined);
  const isEyes = $derived(!!mechanics && mechanics.eyeOverrides !== undefined);
  const isUra = $derived(!!mechanics && mechanics.uraShards !== undefined);
  const isAhCm = $derived(!!mechanics && mechanics.ahExposed !== undefined);

  // ── Dhuum CM echo holds ──
  // One lane per held player; each segment is one hold, laid out against the fight
  // clock. HTML rather than SVG so the lane labels can carry a profession icon.
  let echoHover = $state<{ name: string; time: number; end: number; died: boolean } | null>(null);
  const echoChart = $derived.by(() => {
    if (!isDhuumCM || !mechanics) return null;
    const evs = mechanics.echoPickups ?? [];
    if (evs.length === 0) return null;
    const dur = Math.max(stats?.duration_sec ?? 0, ...evs.map((e) => e.end), 1);

    const byPlayer = new Map<string, typeof evs>();
    for (const e of evs) {
      const list = byPlayer.get(e.name) ?? [];
      list.push(e);
      byPlayer.set(e.name, list);
    }
    const lanes = [...byPlayer.entries()]
      .map(([name, list]) => ({
        name,
        first: Math.min(...list.map((e) => e.time)),
        segs: list.map((e) => ({
          time: e.time,
          end: e.end,
          died: e.diedAt !== null,
          leftPct: (e.time / dur) * 100,
          // Sub-second holds would be under a pixel wide; CSS enforces a visible
          // minimum, anchored at the true start so position stays honest.
          widthPct: ((e.end - e.time) / dur) * 100,
        })),
      }))
      .sort((a, b) => a.first - b.first);

    // Six-ish ticks on a round step (30s / 60s / 120s ...) so the axis stays readable.
    const raw = dur / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = ([1, 2, 5, 10].map((m) => m * mag).find((s) => dur / s <= 9) ?? 10 * mag);
    const ticks: { t: number; pct: number; label: string }[] = [];
    for (let t = 0; t <= dur + 0.001; t += step) {
      ticks.push({ t, pct: (t / dur) * 100, label: `${Math.floor(Math.round(t) / 60)}:${String(Math.round(t) % 60).padStart(2, "0")}` });
    }
    return { lanes, ticks, dur };
  });
  const isHT = $derived(!!mechanics && /harvest temple/i.test(mechanics.boss));
  let targetsOpen = $state(false); // collapsed by default — fights like Cerus spawn 25+ adds
  // Shadows tab accordion state
  let shadowAllOpen = $state(false);
  let shadowOpen = $state<Map<string, boolean>>(new Map());
  let shadowMaliceOpen = $state<Map<number, boolean>>(new Map());
  let badgeOpen = $state<string | null>(null);
  function toggleShadow(name: string) {
    const m = new Map(shadowOpen);
    m.set(name, !(m.get(name) ?? shadowAllOpen));
    shadowOpen = m;
  }
  function toggleMalice(idx: number) {
    const m = new Map(shadowMaliceOpen);
    m.set(idx, !m.get(idx));
    shadowMaliceOpen = m;
  }
  function toggleBadge(id: string) {
    badgeOpen = badgeOpen === id ? null : id;
  }
  let empOpen = $state<Map<string, boolean>>(new Map());
  function toggleEmp(name: string) {
    const m = new Map(empOpen);
    m.set(name, !m.get(name));
    empOpen = m;
  }

  // ── Sidebar nav state ──
  // Single source of truth for the active sub-view. STATS section: Statistics
  // (cards+chart, default) | Boon Uptime (table). MECHANICS section (Cerus
  // only): Shadows | Orbs | Empowered.
  type Tab = "statistics" | "boon" | "defense" | "support" | "revealed" | "shadows" | "orbs" | "empowered" | "teleports" | "oils" | "pickups" | "overrides" | "shards" | "exposed";
  let activeTab = $state<Tab>("statistics");
  // ── Phase breakdown ──
  // EI stores every per-phase metric as a positional array indexed by phase, so one
  // extractor covers every encounter; no per-boss wiring.
  let phaseStats = $state<PhaseStat[] | null>(null);
  let selectedPhase = $state(0);          // EI phase index; 0 = Full Fight
  let showBreakbars = $state(true);
  // ── Defense / Support tabs ──
  let defenseSupport = $state<DefenseSupportStats | null>(null);
  // EI's skillMap ("s<id>" -> name) so death recaps can name the killing skill.
  let skillNames = $state<Record<string, { name?: string; icon?: string }>>({});
  // EI keys condition damage in a death recap by the BUFF id, not the skill id,
  // so a Burning/Poison tick has no skillMap entry. Resolved as a fallback.
  let buffNames = $state<Record<string, { name?: string }>>({});
  let showPer10Min = $state(false);       // scale damage numbers to a per-10-minute rate
  let defenseOpen = $state<string | null>(null); // player row expanded in the matrix
  let openOrbPhase = $state<string | null>(null); // Orbs tab: expanded per-phase leaderboard

  // Revealed feature flag: hide the tab + table until the feature is complete.
  let revealFeatureReady = $state(true);

  const PHASE_ICON: Record<string, string> = {
    "Jormag": "/bosses/thejormagvoid.png",
    "Primordus": "/bosses/theprimordusvoid.png",
    "Kralkatorrik": "/bosses/thekralkatorrikvoid.png",
    "Zhaitan": "/bosses/thezhaitanvoid.png",
    "Mordremoth": "/bosses/themordremothvoid.png",
    "Soo-Won": "/bosses/thesoowonvoid.png",
    "Void Saltspray Dragon": "/bosses/voidsaltspraydragon.png",
    "Void Time Caster": "/bosses/timecaster.png",
    "Void Goliath": "/bosses/voidgoliath.png",
    "Void Obliterator": "/bosses/voidobliterator.png",
    "Giants": "/bosses/giants.png",
    "Purification 1": "/bosses/purification.png",
    "Purification 2": "/bosses/purification.png",
    "Purification 3": "/bosses/purification.png",
    "Purification 4": "/bosses/purification.png",
  };

  let revealedByPhase = $derived.by(() => {
    const map = new Map<string, { phase: string; time: number; player: string; toonName: string; profession: string; source: string; sourceIcon: string }>();
    for (const r of mechanics?.revealedBreakers ?? []) {
      const phase = r.phaseName || "Global";
      const existing = map.get(phase);
      if (!existing || r.time < existing.time) {
        map.set(phase, {
          phase,
          time: r.time,
          player: r.player || r.toonName || "Unknown",
          toonName: r.toonName || r.player || "Unknown",
          profession: r.profession || "",
          source: r.source || "Unknown",
          sourceIcon: r.sourceIcon || "",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  });

  // Sort: default DPS desc.
  type SortKey = "dps" | "cleave" | "name" | "group";
  let sortKey = $state<SortKey>("dps");
  let sortDir = $state<"asc" | "desc">("desc");

  // Which boon columns are visible. Defaults per user spec.
  const ALL_BOONS: { id: number; key: string; label: string; icon: string; default: boolean; stacks?: boolean }[] = [
    { id: 1187,  key: "quickness",   label: "Quickness",   icon: "/boons/quickness.png",   default: true },
    { id: 30328, key: "alacrity",    label: "Alacrity",    icon: "/boons/alacrity.png",    default: true },
    { id: 717,   key: "protection",  label: "Protection",  icon: "/boons/protection.png",  default: true },
    { id: 740,   key: "might",       label: "Might",       icon: "/boons/might.png",       default: true, stacks: true },
    { id: 718,   key: "regeneration",label: "Regen",       icon: "/boons/regeneration.png",default: true },
    { id: 725,   key: "fury",        label: "Fury",        icon: "/boons/fury.png",        default: true },
    { id: 726,   key: "vigor",       label: "Vigor",       icon: "/boons/vigor.png",       default: true },
    { id: 719,   key: "swiftness",   label: "Swiftness",   icon: "/boons/swiftness.png",   default: false },
    { id: 743,   key: "aegis",       label: "Aegis",       icon: "/boons/aegis.png",       default: false },
    { id: 1122,  key: "stability",   label: "Stability",   icon: "/boons/stability.png",   default: false },
    { id: 26980, key: "resistance",  label: "Resistance",  icon: "/boons/resistance.png",  default: false },
    { id: 873,   key: "resolution",  label: "Resolution",  icon: "/boons/resolution.png",  default: false },
  ];
  let visibleBoons = $state<Set<string>>(new Set(ALL_BOONS.filter(b => b.default).map(b => b.key)));
  let showBoonPicker = $state(false);

  // Column sizes (px) — user-adjustable via drag handles.
  let colWidths = $state<Record<string, number>>({
    player: 190, dps: 78, cleave: 78,
  });

  const BOON_BY_ID = new Map(ALL_BOONS.map(b => [b.id, b]));
  // Boon metadata for the per-phase extractor (EI buff ids + stacking flags).
  const PHASE_BOON_META = ALL_BOONS.map((b) => ({ id: b.id, name: b.label, stacks: b.stacks }));

  function profIcon(profession: string): string {
    const p = (profession || "").toLowerCase().replace(/\s+/g, "");
    return `/professions/${p || "guardian"}.png`;
  }

  function boonFor(player: PlayerStat, id: number): BoonStat | undefined {
    return player.boons.find(b => b.id === id);
  }

  function toggleBoon(key: string) {
    const next = new Set(visibleBoons);
    if (next.has(key)) next.delete(key); else next.add(key);
    visibleBoons = next;
  }

  function setSort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = key === "name" || key === "group" ? "asc" : "desc";
    }
  }

  // Phases offered in the selector (breakbar phases can be toggled off).
  let visiblePhases = $derived((phaseStats ?? []).filter((p) => showBreakbars || !p.isBreakbar));

  // Players for the selected phase. `Full Fight` keeps the Rust-shaped whole-fight
  // players; any other phase swaps in per-phase players of the same shape, so the
  // table, sorting, subgroup totals and boon lookup all work unchanged.
  let phasePlayers = $derived.by<PlayerStat[]>(() => {
    if (!stats) return [];
    if (selectedPhase === 0 || !phaseStats) return stats.players;
    return phaseStats[selectedPhase]?.players ?? [];
  });

  // "Godscream Ura Breakbar 3" → "Brk 3" so a 10-phase fight still fits the chip row.
  function shortPhaseName(name: string): string {
    const m = name.match(/^(.*?)\s*Breakbar\s*(\d+)\s*$/i);
    return m ? `Brk ${m[2]}` : name;
  }

  // Summary for the selected phase, used by the Statistics tab cards and the
  // Cerus dashboard. `Full Fight` keeps the mechanic-reported values so the
  // default view is unchanged.
  let phaseSummary = $derived.by(() => {
    const phase = phaseStats?.[selectedPhase];
    const players = phasePlayers;
    const dps =
      selectedPhase === 0
        ? (mechanics ? mechanics.summary.totalDps : (stats?.total_dps ?? 0))
        : players.reduce((a, p) => a + p.dps, 0);
    const cleave = players.reduce((a, p) => a + p.cleave_dps, 0);
    const durationSec = selectedPhase === 0 ? (stats?.duration_sec ?? 0) : (phase?.durationSec ?? 0);
    let avgBoon = mechanics ? mechanics.summary.avgBoonPct : 0;
    if (selectedPhase !== 0 && players.length) {
      let sum = 0, n = 0;
      for (const b of ALL_BOONS) {
        const vals = players.map((p) => boonFor(p, b.id)).filter((v): v is BoonStat => !!v);
        if (!vals.length) continue;
        sum += vals.reduce((a, x) => a + (b.stacks ? x.stacks : x.uptime_pct), 0) / vals.length;
        n++;
      }
      if (n) avgBoon = sum / n;
    }
    return {
      label: selectedPhase === 0 ? "Full Fight" : (phase?.name ?? `Phase ${selectedPhase + 1}`),
      isFullFight: selectedPhase === 0,
      dps,
      cleave,
      durationSec,
      players: players.length,
      avgBoon,
    };
  });

  // Heatmap cell background: accent ramp scaled to the column max.
  function heatBg(pct: number): string {
    return `color-mix(in srgb, var(--accent) ${Math.round(pct * 0.45)}%, transparent)`;
  }

  // A phase with no boss-target damage reads as "—" rather than a misleading 0.
  function fmtPhase(v: number): string {
    return v > 0 ? fmt(v) : "—";
  }

  // Boon uptime card value: "93.4%" or "—" when the phase has no data.
  function fmtBoonPct(v: number): string {
    return v > 0 ? `${fmtPct(v)}%` : "—";
  }

  // ── Defense tab derivations ──
  let defensePlayers = $derived<DefensePlayerStat[]>(
    defenseSupport ? (defenseSupport.defense[selectedPhase] ?? []) : [],
  );

  // Damage numbers scaled to a per-10-minute rate when the toggle is on.
  let dsRate = $derived.by(() => {
    if (!showPer10Min) return 1;
    const dur = selectedPhase === 0 ? (stats?.duration_sec ?? 0) : (phaseStats?.[selectedPhase]?.durationSec ?? 0);
    return dur > 0 ? 600 / dur : 1;
  });

  let defenseSummary = $derived.by(() => {
    const sum = (f: (p: DefensePlayerStat) => number) => defensePlayers.reduce((a, p) => a + f(p), 0);
    return {
      taken: sum((p) => p.damageTaken) * dsRate,
      mitigated: sum((p) => p.blockedCount + p.evadedCount + p.dodgeCount + p.invulnedCount),
      downed: sum((p) => p.downCount),
      downedTime: sum((p) => p.downDuration),
      ccReceived: sum((p) => p.receivedCrowdControl),
      ccReceivedTime: sum((p) => p.receivedCrowdControlDuration),
      barrier: sum((p) => p.damageBarrier) * dsRate,
    };
  });

  // Damage-taken bars were replaced by the metric panels; ranking now lives in
  // `defensePanels` / `axRows`.

  const DEFENSE_HEAT_COLS: { key: keyof DefensePlayerStat; label: string; tip: string }[] = [
    { key: "blockedCount", label: "Blocked", tip: "Hits negated by the Block modifier" },
    { key: "evadedCount", label: "Evaded", tip: "Hits avoided with Evade (your shadowsteps)" },
    { key: "dodgeCount", label: "Dodged", tip: "Hits avoided with a dodge roll" },
    { key: "invulnedCount", label: "Invuln", tip: "Hits negated by invulnerability frames" },
    { key: "interruptedCount", label: "Interrupted", tip: "Enemy casts or actions you interrupted" },
    { key: "downCount", label: "Downed", tip: "Times you were downed (but not dead)" },
    { key: "deadCount", label: "Dead", tip: "Times you died" },
  ];

  // Heatmap intensity per column (scaled to that column's squad max) + squad rank.
  let defenseHeat = $derived.by(() => {
    const cols = DEFENSE_HEAT_COLS.map((c) => ({
      ...c,
      max: Math.max(1, ...defensePlayers.map((p) => Number(p[c.key]) || 0)),
    }));
    return [...defensePlayers]
      .sort((a, b) => b.damageTaken - a.damageTaken)
      .map((player) => ({
        player,
        cells: cols.map((c) => {
          const value = Number(player[c.key]) || 0;
          const rank = 1 + defensePlayers.filter((p) => (Number(p[c.key]) || 0) > value).length;
          return { label: c.label, tip: c.tip, value, pct: (value / c.max) * 100, rank };
        }),
      }));
  });


  // ── Axibridge-style ranking helpers ──
  // Competition ranking: equal values share a rank (1, 2, 2, 4).
  function competitionRank(values: number[], value: number): number {
    return 1 + values.filter((v) => v > value).length;
  }

  interface AxStatRow { label: string; value: string; }
  interface AxRow {
    rank: number;
    name: string;
    account: string;
    profession: string;
    value: number;
    shown: string;
    pct: number;          // 0..100 of the column max — drives the mini-bar height
  }
  interface AxHeroCfg {
    player: { name: string; account: string; profession: string };
    tier: string;
    label: string;
    icon: string;
    quote: string;
    score: string;
    scoreLabel: string;
    scoreTip?: string;
    rows: AxStatRow[];
  }
  interface AxRunnerCfg {
    player: { name: string; account: string; profession: string };
    tier: string;
    score: string;
    scoreTip?: string;
    rows: AxStatRow[];
  }
  /** The player fields the feeds need; DefensePlayerStat satisfies this. */
  interface AxFeedPlayer {
    name: string;
    account: string;
    profession: string;
  }

  /** One entry in the downs/deaths feed. */
  interface AxFeedRow {
    time: number;
    player: AxFeedPlayer;
    sources: RecapSource[];
  }

  /** One skill in the down recap, ranked by how many players it took down. */
  interface DownRecapRow {
    id: number;
    name: string;
    players: number;
    deaths: number;
    damage: number;
  }

  interface AxPanel {
    key: string;
    title: string;
    icon: string;
    total: string;
    hint: string;
    top: string;
    hasData: boolean;
    rows: AxRow[];
  }

  function axRows<T extends { name: string; account: string; profession: string }>(
    players: T[],
    valueOf: (p: T) => number,
    format: (v: number, p: T) => string,
    ascending = false,
  ): AxRow[] {
    const values = players.map(valueOf);
    const max = Math.max(1, ...values);
    return [...players]
      .sort((a, b) => (ascending ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)))
      .map((p) => {
        const value = valueOf(p);
        return {
          rank: competitionRank(values, value),
          name: p.name,
          account: p.account,
          profession: p.profession,
          value,
          shown: format(value, p),
          // The bar tracks standing, not the raw value, so rank 1 is always the
          // tallest bar even when the best result is the smallest number.
          pct: ascending ? (1 - value / max) * 100 : (value / max) * 100,
        };
      });
  }

  // Top N by a metric — drives the MVP / silver / bronze hero cards.
  function axTop<T extends { name: string; account: string; profession: string }>(
    players: T[],
    valueOf: (p: T) => number,
  ): T[] {
    return [...players].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 3);
  }

  /** Downed time: seconds while short, m:ss once it passes a minute. */
  function fmtDownTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : fmtTime(s);
  }

  function axPanel(
    key: string, title: string, icon: string, hint: string, total: string, rows: AxRow[],
  ): AxPanel {
    return {
      key, title, icon, hint, total,
      top: rows[0]?.name ?? "",
      // A metric nobody produced (stun breaks in PvE, interrupts) is hidden
      // rather than shown as an all-zero panel.
      hasData: rows.some((r) => r.value > 0),
      rows,
    };
  }

  function axMitigated(p: DefensePlayerStat): number {
    return p.blockedCount + p.evadedCount + p.dodgeCount + p.invulnedCount;
  }

  function axMitigationPct(p: DefensePlayerStat): number {
    const hits = p.damageTakenCount;
    const mit = axMitigated(p);
    return hits + mit > 0 ? (mit / (hits + mit)) * 100 : 0;
  }

  // ── Defense score ──
  // Mitigation rate is the skill component; downs and deaths are measured against
  // the squad worst, so a clean run for everyone doesn't distort the ranking.
  // Players who were barely targeted don't qualify for the hero cards.
  const DEFENSE_PARTICIPATION_FLOOR = 10; // damage-taken events

  const DEFENSE_SCORE_TIP =
    "Defensive score = 60% mitigation rate (blocked + evaded + dodged + invulned, as a share of hits " +
    "taken, measured against the squad's best mitigator) + 25% for fewer downs + 15% for fewer " +
    "deaths (measured against the squad worst). Categories nobody reached are left out and the " +
    "rest rescaled to 100. Needs 10+ hits taken to qualify.";

  let defenseScore = $derived.by(() => {
    const maxRate = Math.max(0, ...defensePlayers.map((p) => axMitigationPct(p) / 100));
    const maxDowns = Math.max(0, ...defensePlayers.map((p) => p.downCount));
    const maxDeaths = Math.max(0, ...defensePlayers.map((p) => p.deadCount));
    // Every component is normalised to a 0..1 scale, so the weights mean what
    // they say: PvE mitigation rates sit at 5-20%, and an unnormalised 60% of
    // that would be worth ~10 points while a clean run was worth 40.
    //
    // A component nobody reached (no deaths on a clean run, no mitigation on a
    // log where nobody blocked) is dropped and the rest rescaled. Keeping it
    // would contribute its whole weight as zeros and quietly shrink the scale.
    const parts = [
      { w: 0.6, max: maxRate, v: (p: DefensePlayerStat) => axMitigationPct(p) / 100 / maxRate },
      { w: 0.25, max: maxDowns, v: (p: DefensePlayerStat) => 1 - p.downCount / maxDowns },
      { w: 0.15, max: maxDeaths, v: (p: DefensePlayerStat) => 1 - p.deadCount / maxDeaths },
    ].filter((x) => x.max > 0);
    const total = parts.reduce((a, x) => a + x.w, 0);
    return new Map(defensePlayers.map((p) => {
      const hits = p.damageTakenCount;
      const score = total > 0
        ? Math.round((100 / total) * parts.reduce((a, x) => a + x.w * x.v(p), 0))
        : 0;
      return [p.name, { score, eligible: hits >= DEFENSE_PARTICIPATION_FLOOR }] as const;
    }));
  });

  // ── Defense: hero ranking + metric panels ──
  let defenseTop = $derived.by(() => {
    const rank = (p: DefensePlayerStat) => defenseScore.get(p.name)?.score ?? 0;
    const byScore = [...defensePlayers].sort((a, b) => rank(b) - rank(a));
    const eligible = byScore.filter((p) => defenseScore.get(p.name)?.eligible);
    const pool = eligible.length >= Math.min(3, defensePlayers.length) ? eligible : byScore;
    return pool.slice(0, 3);
  });

  let defenseHero = $derived.by<AxHeroCfg | null>(() => {
    const p = defenseTop[0];
    if (!p) return null;
    return {
      player: p,
      tier: "gold",
      label: "Defensive MVP",
      icon: "fa-shield-halved",
      quote: "Defensive Play",
      score: String(defenseScore.get(p.name)?.score ?? 0),
      scoreLabel: "defensive score",
      scoreTip: DEFENSE_SCORE_TIP,
      rows: [
        { label: "Damage taken", value: fmt(p.damageTaken * dsRate) },
        { label: "Hits mitigated", value: String(axMitigated(p)) },
        { label: "Downed / deaths", value: `${p.downCount} / ${p.deadCount}` },
      ],
    };
  });

  let defenseRunners = $derived.by<AxRunnerCfg[]>(() =>
    ["silver", "bronze"].flatMap((tier, i): AxRunnerCfg[] => {
      const p = defenseTop[i + 1];
      if (!p) return [];
      return [{
        player: p,
        tier,
        score: String(defenseScore.get(p.name)?.score ?? 0),
        scoreTip: DEFENSE_SCORE_TIP,
        rows: [
          { label: "Damage taken", value: fmt(p.damageTaken * dsRate) },
          { label: "Mitigated", value: `${fmtPct(axMitigationPct(p))}%` },
          { label: "Downed / deaths", value: `${p.downCount} / ${p.deadCount}` },
        ],
      }];
    }),
  );

  let defensePanels = $derived<AxPanel[]>([
    axPanel("taken", "Damage Taken", "fa-solid fa-heart-crack", "least taken first",
      fmt(defenseSummary.taken),
      axRows(defensePlayers, (p) => p.damageTaken, (v) => fmt(v * dsRate), true)),
    axPanel("mitigated", "Hits Mitigated", "fa-solid fa-shield-halved", "hits that never landed",
      String(defenseSummary.mitigated), axRows(defensePlayers, axMitigated, (v) => fmt(v))),
    axPanel("downed", "Downed", "fa-solid fa-person-falling", "most first · count | time downed",
      `${defenseSummary.downed} | ${fmtDownTime(defenseSummary.downedTime)}`,
      axRows(defensePlayers, (p) => p.downCount, (v, p) => `${fmt(v)} | ${fmtDownTime(p.downDuration)}`)),
    axPanel("cc", "CC Received", "fa-solid fa-user-injured", "most controlled first · count | time",
      `${defenseSummary.ccReceived} | ${fmtDownTime(defenseSummary.ccReceivedTime)}`,
      axRows(defensePlayers, (p) => p.receivedCrowdControl, (v, p) => `${fmt(v)} | ${fmtDownTime(p.receivedCrowdControlDuration)}`)),
    axPanel("barrier", "Barrier", "fa-solid fa-shield", "damage absorbed by barrier",
      fmt(defenseSummary.barrier), axRows(defensePlayers, (p) => p.damageBarrier, (v) => fmt(v * dsRate))),
  ].filter((p) => p.hasData));

  // Every death in the log, in order, with the sources that led to it.
  let defenseDeaths = $derived.by<AxFeedRow[]>(() =>
    defensePlayers
      .flatMap((p) => p.deathRecap.map((d) => ({ player: p, time: d.deathTime / 1000, sources: d.toKill ?? [] })))
      .filter((d) => d.time > 0)
      .sort((a, b) => a.time - b.time),
  );

  // Every down in the log, in order — including downs that did not kill.
  // EI's mechanics table lists them all; the death recap supplies causes when a
  // fatal down lines up with the event.
  let defenseDowns = $derived.by<AxFeedRow[]>(() => {
    if (!defenseSupport) return [];
    const fatal = defensePlayers.flatMap((p) =>
      p.deathRecap
        .filter((d) => (d.downTime ?? 0) > 0)
        .map((d) => ({ player: p, time: d.downTime / 1000, sources: d.toDown ?? [] })),
    );
    return (defenseSupport.downs ?? [])
      .map((d) => {
        const player = defensePlayers.find((p) => p.name === d.name);
        const match = fatal.find(
          (f) => f.player.name === d.name && Math.abs(f.time - d.time / 1000) < 1.5,
        );
        return {
          player: player ?? { name: d.name, account: d.account, profession: d.profession },
          time: d.time / 1000,
          sources: match?.sources ?? [],
        };
      })
      .filter((d) => d.time > 0)
      .sort((a, b) => a.time - b.time);
  });

  // Top skills by how many players they took out of the fight, across the log.
  let downRecap = $derived.by<DownRecapRow[]>(() => {
    const downed = new Map<number, { players: Set<string>; damage: number; src: string }>();
    const killed = new Map<number, Set<string>>();
    for (const p of defensePlayers) {
      const who = p.account || p.name;
      for (const d of p.deathRecap) {
        for (const k of d.toDown ?? []) {
          const e = downed.get(k.id) ?? { players: new Set<string>(), damage: 0, src: k.src };
          e.players.add(who);
          e.damage += k.damage;
          downed.set(k.id, e);
        }
        for (const k of d.toKill ?? []) {
          const s = killed.get(k.id) ?? new Set<string>();
          s.add(who);
          killed.set(k.id, s);
        }
      }
    }
    return [...downed.entries()]
      .map(([id, e]) => ({
        id,
        name: axSkillName(id) || e.src,
        players: e.players.size,
        deaths: killed.get(id)?.size ?? 0,
        damage: e.damage,
      }))
      .filter((r) => r.name)
      .sort((a, b) => b.players - a.players || b.damage - a.damage)
      .slice(0, 3);
  });

  function axSkillName(id: number): string {
    if (id <= 0) return "";
    return skillNames["s" + id]?.name || buffNames["b" + id]?.name || "";
  }

  /** Condition (DoT) damage arrives flagged indirect and keyed by buff id. */
  function axIsCondition(k: RecapSource): boolean {
    return k.indirectDamage && !skillNames["s" + k.id];
  }

  // ── Support tab ──
  let supportPlayers = $derived<SupportPlayerStat[]>(
    defenseSupport ? (defenseSupport.support[selectedPhase] ?? []) : [],
  );

  let supportSummary = $derived.by(() => {
    const sum = (f: (p: SupportPlayerStat) => number) => supportPlayers.reduce((a, p) => a + f(p), 0);
    return {
      cleanses: sum((p) => p.condiCleanse),
      selfCleanses: sum((p) => p.condiCleanseSelf),
      strips: sum((p) => p.boonStrips),
      revives: sum((p) => p.resurrects),
      resurrectSeconds: sum((p) => p.resurrectTime),
      stunBreaks: sum((p) => p.stunBreak),
      breakbar: sum((p) => p.breakbarDamage),
    };
  });

  // ── Support score ──
  // Same shape as the defensive score: every component is normalised to the
  // squad's best, so the weights mean what they say. A component nobody
  // produced (CC on a breakbar-free fight) is dropped and the rest rescaled —
  // keeping it would contribute its whole weight as zeros and shrink the scale,
  // so a log with no breakbar phase capped the score at 70 while still
  // presenting it as out of 100.
  const SUPPORT_SCORE_TIP =
    "Support score = 40% cleanses on allies + 30% breakbar damage (CC) + 20% revives + 10% boon " +
    "strips, each measured against the squad's best. Categories nobody produced are left out " +
    "and the rest rescaled to 100.";

  let supportScore = $derived.by(() => {
    const maxOf = (f: (p: SupportPlayerStat) => number) => Math.max(0, ...supportPlayers.map(f));
    const parts = [
      { w: 0.40, max: maxOf((p) => p.condiCleanse), v: (p: SupportPlayerStat) => p.condiCleanse },
      { w: 0.30, max: maxOf((p) => p.breakbarDamage), v: (p: SupportPlayerStat) => p.breakbarDamage },
      { w: 0.20, max: maxOf((p) => p.resurrects), v: (p: SupportPlayerStat) => p.resurrects },
      { w: 0.10, max: maxOf((p) => p.boonStrips), v: (p: SupportPlayerStat) => p.boonStrips },
    ].filter((x) => x.max > 0);
    const total = parts.reduce((a, x) => a + x.w, 0);
    return new Map(supportPlayers.map((p) => [
      p.name,
      total > 0
        ? Math.round((100 / total) * parts.reduce((a, x) => a + x.w * (x.v(p) / x.max), 0))
        : 0,
    ] as const));
  });

  let supportRanked = $derived.by(() =>
    [...supportPlayers]
      .sort((a, b) => (supportScore.get(b.name) ?? 0) - (supportScore.get(a.name) ?? 0)),
  );

  let supportTop = $derived(supportRanked.slice(0, 3));

  let supportHero = $derived.by<AxHeroCfg | null>(() => {
    const p = supportTop[0];
    if (!p) return null;
    return {
      player: p,
      tier: "gold",
      label: "Support MVP",
      icon: "fa-hand-holding-heart",
      quote: "Condition Control",
      score: String(supportScore.get(p.name) ?? 0),
      scoreLabel: "support score",
      scoreTip: SUPPORT_SCORE_TIP,
      rows: [
        { label: "Cleanses", value: String(p.condiCleanse) },
        { label: "Breakbar damage", value: fmt(p.breakbarDamage) },
        { label: "Revives", value: `${p.resurrects} · ${p.resurrectTime.toFixed(1)}s` },
      ],
    };
  });

  let supportRunners = $derived.by<AxRunnerCfg[]>(() =>
    ["silver", "bronze"].flatMap((tier, i): AxRunnerCfg[] => {
      const p = supportTop[i + 1];
      if (!p) return [];
      return [{
        player: p,
        tier,
        score: String(supportScore.get(p.name) ?? 0),
        scoreTip: SUPPORT_SCORE_TIP,
        rows: [
          { label: "Cleanses", value: String(p.condiCleanse) },
          { label: "Revives", value: `${p.resurrects} · ${p.resurrectTime.toFixed(1)}s` },
        ],
      }];
    }),
  );

  let supportPanels = $derived<AxPanel[]>([
    axPanel("cleanses", "Cleanses", "fa-solid fa-droplet", "conditions removed from allies",
      String(supportSummary.cleanses), axRows(supportPlayers, (p) => p.condiCleanse, (v) => fmt(v))),
    axPanel("breakbar", "Breakbar Damage", "fa-solid fa-hand", "CC bar damage dealt",
      fmt(supportSummary.breakbar),
      axRows(supportPlayers, (p) => p.breakbarDamage, (v) => fmt(v))),
    axPanel("strips", "Boon Strips", "fa-solid fa-bolt", "enemy boons removed",
      String(supportSummary.strips), axRows(supportPlayers, (p) => p.boonStrips, (v) => fmt(v))),
    axPanel("revives", "Revives", "fa-solid fa-heart-pulse", "players resurrected · time spent",
      `${fmt(supportSummary.revives)} · ${supportSummary.resurrectSeconds.toFixed(1)}s`,
      axRows(supportPlayers, (p) => p.resurrects,
        (v, p) => `${fmt(v)} · ${p.resurrectTime.toFixed(1)}s`)),
    axPanel("stuns", "Stun Breaks", "fa-solid fa-hand-fist", "stuns removed",
      String(supportSummary.stunBreaks), axRows(supportPlayers, (p) => p.stunBreak, (v) => fmt(v))),
  ].filter((p) => p.hasData));

  // Boons each player generated for the group (EI reports generation as an
  // uptime percentage per boon, so the total is a sum of uptime points).
  let supportBoons = $derived.by(() =>
    [...supportPlayers]
      .map((p) => {
        const boons = [...p.groupBoons]
          .filter((b) => b.generation > 0)
          .sort((a, b) => b.generation - a.generation);
        return {
          player: p,
          total: boons.reduce((a, b) => a + b.generation, 0),
          boons: boons.slice(0, 4).map((b) => ({
            id: b.id,
            name: b.name || BOON_BY_ID.get(b.id)?.label || `Buff ${b.id}`,
            generation: b.generation,
          })),
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total),
  );

  // Non-EI fallback: parse the local file with the bundled Elite Insights, then
  // refetch directly (bypassing the compact stats cache) so phases appear.
  let parsingLocally = $state(false);
  async function parseLocallyForPhases() {
    if (!localPath || parsingLocally) return;
    parsingLocally = true;
    error = null;
    try {
      await invoke("run_local_ei_parse", { filePath: localPath });
      const res = await invoke("get_local_log_full", { filePath: localPath }) as LogFull;
      stats = res.stats;
      phaseStats = extractPhaseStats(res.raw, PHASE_BOON_META);
      defenseSupport = extractDefenseSupport(res.raw);
      skillNames = ((res.raw as any)?.skillMap as Record<string, { name?: string; icon?: string }>) || {};
      buffNames = ((res.raw as any)?.buffMap as Record<string, { name?: string }>) || {};
      const mech = extractMechanics(res.raw, res.stats.boss_name);
      mechanics = mech;
      statsCache.set(localPath, { version: STATS_CACHE_VERSION, stats: res.stats, mechanics: mech, phases: phaseStats, defenseSupport, skillMap: (res.raw as any)?.skillMap, buffMap: (res.raw as any)?.buffMap });
      try { await invoke("store_stats_cache", { filePath: localPath, data: { version: STATS_CACHE_VERSION, stats: res.stats, mechanics: mech, phases: phaseStats, defenseSupport, skillMap: (res.raw as any)?.skillMap, buffMap: (res.raw as any)?.buffMap } }); } catch (e) {}
    } catch (e: any) {
      error = typeof e === "string" ? e : (e?.message || "Failed to parse locally");
    } finally {
      parsingLocally = false;
    }
  }

  // Players sorted by the active sort key (default DPS desc).
  let sortedPlayers = $derived.by(() => {
    const arr = [...phasePlayers];
    arr.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "cleave": av = a.cleave_dps; bv = b.cleave_dps; break;
        case "name": av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case "group": av = a.group; bv = b.group; break;
        default: av = a.dps; bv = b.dps;
      }
      let r = av < bv ? -1 : av > bv ? 1 : 0;
      if (sortDir === "desc") r = -r;
      return r;
    });
    return arr;
  });

  // Group/subgroup totals (one row per subgroup, plus a grand total).
  type Agg = { dps: number; cleave: number; count: number; boonSum: Map<number, number> };
  type GroupTotal = { group: number; dps: number; cleave: number; count: number; boons: Map<number, number> };
  let groupTotals = $derived.by(() => {
    const empty: { groups: GroupTotal[]; total: GroupTotal } = {
      groups: [], total: { group: 0, dps: 0, cleave: 0, count: 0, boons: new Map() },
    };
    if (!stats) return empty;
    const mkAgg = (): Agg => ({ dps: 0, cleave: 0, count: 0, boonSum: new Map() });
    const map = new Map<number, Agg>();
    const tot = mkAgg();
    for (const p of phasePlayers) {
      const g = map.get(p.group) || mkAgg();
      g.dps += p.dps; g.cleave += p.cleave_dps; g.count += 1;
      tot.dps += p.dps; tot.cleave += p.cleave_dps; tot.count += 1;
      for (const b of ALL_BOONS) {
        const bs = boonFor(p, b.id);
        if (!bs) continue;
        const val = b.stacks ? bs.stacks : bs.uptime_pct;
        g.boonSum.set(b.id, (g.boonSum.get(b.id) || 0) + val);
        tot.boonSum.set(b.id, (tot.boonSum.get(b.id) || 0) + val);
      }
      map.set(p.group, g);
    }
    const avg = (a: Agg): Map<number, number> => {
      const m = new Map<number, number>();
      if (a.count) for (const [id, sum] of a.boonSum) m.set(id, sum / a.count);
      return m;
    };
    const groups = [...map.entries()]
      .map(([group, v]) => ({ group, dps: v.dps, cleave: v.cleave, count: v.count, boons: avg(v) }))
      .sort((a, b) => a.group - b.group);
    return { groups, total: { group: 0, dps: tot.dps, cleave: tot.cleave, count: tot.count, boons: avg(tot) } };
  });

  // ── Boon color thresholds (subtle green→red by uptime %) ──
  function boonColor(pct: number): string {
    if (pct >= 90) return "boon-good";
    if (pct >= 80) return "boon-ok";
    if (pct >= 50) return "boon-warn";
    return "boon-bad";
  }

  // ── Subgroup filter + per-group collapse (Boon Uptime tab) ──
  let subgroupFilter = $state<number | null>(null);   // null = show all
  let collapsedSubs = $state<Set<number>>(new Set());  // subgroups whose player rows are hidden
  let subgroupList = $derived(groupTotals.groups.map((g) => g.group));

  // ── Which eye the Stun Overrides tab shows; 'all' keeps both columns ──
  type EyeFilter = "all" | "judgment" | "fate";
  let eyeFilter = $state<EyeFilter>("all");
  function toggleSubCollapse(g: number) {
    const next = new Set(collapsedSubs);
    if (next.has(g)) next.delete(g); else next.add(g);
    collapsedSubs = next;
  }

  // ── Timeline chart (faithful to MA: Y = %, X = time) ──
  // orbEfficiency%: cumulative intercepted / (intercepted + leaked) over time.
  // shadowsReached: cumulative shadows that reached Cerus.
  // rageHits: cumulative true dome failures.
  const TL_BUCKETS = 60;
  let timeline = $derived.by(() => {
    if (!mechanics || !mechanics.timeline || mechanics.timeline.length === 0) return null;
    const dur = (stats ? stats.duration_sec : 0) * 1000 || 1; // ms
    const totalOrbs = mechanics.totalOrbs + mechanics.totalOrbsLeaked || 1;
    // per-bucket raw counts
    const bBlk = new Array(TL_BUCKETS).fill(0);
    const bLk = new Array(TL_BUCKETS).fill(0);
    const bShad = new Array(TL_BUCKETS).fill(0);
    const bRage = new Array(TL_BUCKETS).fill(0);
    for (const e of mechanics.timeline) {
      let bi = Math.floor((e.t / dur) * TL_BUCKETS);
      if (bi < 0) bi = 0; if (bi >= TL_BUCKETS) bi = TL_BUCKETS - 1;
      bBlk[bi] += e.orbBlocked; bLk[bi] += e.orbLeaked;
      bShad[bi] += e.shadowReached; bRage[bi] += e.rageHit;
    }
    let cBlk = 0, cLk = 0, cShad = 0, cRage = 0;
    const effPts: { x: number; y: number; t: number }[] = [];
    const shadPts: { x: number; y: number; t: number }[] = [];
    const ragePts: { x: number; y: number; t: number }[] = [];
    for (let i = 0; i < TL_BUCKETS; i++) {
      cBlk += bBlk[i]; cLk += bLk[i]; cShad += bShad[i]; cRage += bRage[i];
      const t = Math.round(((i + 0.5) / TL_BUCKETS) * dur);
      const eff = (cBlk + cLk) > 0 ? Math.round((cBlk / (cBlk + cLk)) * 1000) / 10 : 100;
      effPts.push({ x: i, y: eff, t });
      shadPts.push({ x: i, y: cShad, t });
      ragePts.push({ x: i, y: cRage, t });
    }
    const shadMax = Math.max(1, cShad);
    const rageMax = Math.max(1, cRage);
    // Per-event markers (faithful MA): running efficiency + cumulative counts,
    // colored by type — blue=blocked, red=leaked, purple=shadow, yellow=rage.
    let rBlk = 0, rLk = 0, rSh = 0, rRage = 0;
    const events: { x: number; y: number; color: string; label: string; t: number; eff: number; shad: number; rage: number; type: string; closeSpawn?: RegExpMatchArray | null }[] = [];
    for (const e of mechanics.timeline) {
      if (e.t > dur) continue;
      if (e.type === 'orb_blocked' || e.type === 'orb_leaked') {
        if (e.orbBlocked) rBlk += e.orbBlocked;
        if (e.orbLeaked) rLk += e.orbLeaked;
      } else if (e.type === 'shadow_close' || e.type === 'shadow_reached') rSh += e.shadowReached;
      else if (e.type === 'rage_hit') rRage += e.rageHit;
      const total = rBlk + rLk;
      const eff = total > 0 ? Math.round((rBlk / total) * 1000) / 10 : 100;
      const x = Math.round((e.t / dur) * (TL_BUCKETS - 1));
      let color = '#22d3ee', label = '', y = tlYpct(eff);
      if (e.type === 'orb_blocked') { label = `Orb Blocked by ${e.actor || 'Unknown'}`; }
      else if (e.type === 'orb_leaked') { color = '#ef4444'; label = `Orb Leaked (+${e.orbLeaked})`; }
      else if (e.type === 'shadow_close') { color = '#ff7a3c'; label = 'Malice Dropped Near Boss'; y = tlYcnt(rSh, shadMax); }
      else if (e.type === 'shadow_reached') { color = '#a78bfa'; label = 'Shadow Reached Boss'; y = tlYcnt(rSh, shadMax); }
      else if (e.type === 'rage_hit') { color = '#fbbf24'; label = `Rage Hit: ${e.actor || 'Unknown'} (+${e.rageHit})`; y = tlYcnt(rRage, rageMax); }
      const closeSpawn = e.detail ? e.detail.match(/\*\*([^*]+)\*\*\s*\((\d+)u\)/) : null;
      events.push({ x, y, color, label, t: e.t, eff, shad: rSh, rage: rRage, type: e.type || '', closeSpawn });
    }
    return { effPts, shadPts, ragePts, shadMax, rageMax, totalOrbs, events };
  });

  // Chart geometry (matches the SVG viewBox below: 60..580 x, 18..202 y).
  const TL_W = 640, TL_H = 220, TL_L = 54, TL_R = 580, TL_T = 18, TL_B = 202;
  const tlX = (i: number) => TL_L + (i / (TL_BUCKETS - 1)) * (TL_R - TL_L);
  const tlYpct = (p: number) => TL_B - (p / 100) * (TL_B - TL_T); // 0..100 %
  const tlYcnt = (v: number, max: number) => TL_B - (v / max) * (TL_B - TL_T); // 0..max count
  function fmtClock(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  }
  // hover state for tooltip — only set when the cursor is near an event dot
  let hover = $state<{ x: number; y: number; eff: number; shad: number; rage: number; t: number; label?: string; color?: string; idx: number; dotY: number; side: 'left' | 'right'; closeSpawn?: RegExpMatchArray | null } | null>(null);
  function onTlMove(ev: MouseEvent) {
    if (!timeline) return;
    const svg = ev.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * TL_W;
    const sy = ((ev.clientY - rect.top) / rect.height) * TL_H;
    // nearest dot within a pixel radius wins; otherwise hide tooltip
    let near = null as any;
    let nearIdx = -1;
    let best = 18; // user-space radius (~1.5 buckets)
    const evs = timeline.events || [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      const d = Math.hypot(tlX(e.x) - sx, e.y - sy);
      if (d <= best) { best = d; near = e; nearIdx = i; }
    }
    if (!near) { hover = null; return; }
    const bi = near.x;
    // place tip to the right of the dot, except near the right edge -> flip left
    const side: 'left' | 'right' = bi > TL_BUCKETS * 0.68 ? 'left' : 'right';
    hover = {
      x: tlX(bi), y: TL_T + 8,
      eff: timeline.effPts[bi]?.y ?? 0,
      shad: timeline.shadPts[bi]?.y ?? 0,
      rage: timeline.ragePts[bi]?.y ?? 0,
      t: timeline.effPts[bi]?.t ?? 0,
      label: near.label, color: near.color,
      idx: nearIdx, dotY: near.y, side, closeSpawn: near.closeSpawn,
    };
  }
  function onTlLeave() { hover = null; }

  // Track active resize listeners so we can tear them down if the modal is
  // closed mid-drag (Escape / backdrop) — otherwise they'd leak until the next
  // mouseup. Cleaned by the $effect below on component teardown.
  let activeResizeCleanup: (() => void) | null = null;

  // Column resize (drag handle on header right edge).
  function startResize(e: MouseEvent, col: string) {
    e.preventDefault();
    cancelActiveResize();
    const startX = e.clientX;
    const startW = colWidths[col] || 100;
    function onMove(ev: MouseEvent) {
      const w = Math.max(50, startW + (ev.clientX - startX));
      colWidths = { ...colWidths, [col]: w };
    }
    function onUp() {
      cancelActiveResize();
    }
    activeResizeCleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      activeResizeCleanup = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function cancelActiveResize() {
    activeResizeCleanup?.();
  }

  $effect(() => {
    return () => cancelActiveResize();
  });

  // Keyboard column resize (arrow keys on a focused resizer handle).
  function nudgeCol(col: string, delta: number) {
    const w = Math.max(50, (colWidths[col] || 100) + delta);
    colWidths = { ...colWidths, [col]: w };
  }

  // Hidden dev-only phase payload inspector for dps.report permalink debugging.
  // Gated by `import.meta.env.DEV`, so it never ships in production builds.
  let phaseDebugPermalink = $state("");
  let phaseDebugRaw = $state<unknown>(null);
  let phaseDebugLoading = $state(false);
  let phaseDebugError = $state<string | null>(null);
  const isDevMode = $derived(!!import.meta?.env?.DEV);
  async function fetchPhaseDebug() {
    phaseDebugRaw = null;
    phaseDebugError = null;
    const target = phaseDebugPermalink.trim();
    if (!target) {
      phaseDebugError = "Paste a dps.report permalink first.";
      return;
    }
    phaseDebugLoading = true;
    try {
      const res = await invoke("get_log_full", { permalink: target }) as LogFull;
      phaseDebugRaw = (res as any)?.raw ?? null;
      if (!phaseDebugRaw) {
        phaseDebugError = "Permalink fetched, but no raw payload was returned.";
      }
    } catch (e: any) {
      phaseDebugError = typeof e === "string" ? e : (e?.message || "Failed to load raw phase payload");
    } finally {
      phaseDebugLoading = false;
    }
  }
  function phaseDebugEntries(): { name: string; failed?: boolean; duration?: number; success?: boolean }[] {
    try {
      const raw = phaseDebugRaw as any;
      const phases = Array.isArray(raw?.phases) ? raw.phases : [];
      return phases.map((p: any) => ({
        name: p?.name ?? p?.fightName ?? "—",
        failed: typeof p?.failed === "boolean" ? p.failed : undefined,
        duration: typeof p?.duration === "number" ? p.duration : typeof p?.durationMS === "number" ? p.durationMS : undefined,
        success: typeof p?.success === "boolean" ? p.success : undefined,
      }));
    } catch {
      return [];
    }
  }

  // Module-level cache so reopening a log is instant. `skillMap`/`buffMap` ride
  // along because the recap feeds resolve skill names through them; without
  // them a cached open falls back to the source agent (the boss name).
  const statsCache = new Map<string, { version?: number; stats: any; mechanics: any; phases?: PhaseStat[] | null; defenseSupport?: DefenseSupportStats | null; skillMap?: Record<string, { name?: string; icon?: string }>; buffMap?: Record<string, { name?: string }> }>();
  // concurrent fetches to dps.report — on a flaky WiFi link a burst of large
  // (30MB+) responses can saturate the link and drop the connection.
  let inflight: Promise<unknown> | null = null;
  $effect(() => {
    if (!permalink && !localPath) return;
    const cacheKey = localPath || permalink;
    // Opening a different log resets the phase selection.
    selectedPhase = 0;
    const cachedMem = statsCache.get(cacheKey);
    if (cachedMem && cachedMem.version === STATS_CACHE_VERSION) {
      stats = cachedMem.stats;
      mechanics = cachedMem.mechanics;
      phaseStats = cachedMem.phases ?? null;
      defenseSupport = cachedMem.defenseSupport ?? null;
      skillNames = cachedMem.skillMap ?? {};
      buffNames = cachedMem.buffMap ?? {};
      loading = false;
      activeTab = "statistics";
      return;
    }
    statsCache.delete(cacheKey);
    if (inflight) return;
    loading = true; error = null; stats = null; mechanics = null; phaseStats = null; defenseSupport = null;
    activeTab = "statistics";
    inflight = (async () => {
      // Try compact cache first (instant)
      if (localPath) {
        try {
          const cached = await invoke("load_stats_cache", { filePath: localPath }) as { stats: any; mechanics: any; phases?: PhaseStat[] | null; defenseSupport?: DefenseSupportStats | null; skillMap?: Record<string, { name?: string; icon?: string }>; buffMap?: Record<string, { name?: string }>; version?: number } | null;
          if (cached && cached.version === STATS_CACHE_VERSION) {
            stats = cached.stats;
            mechanics = cached.mechanics;
            phaseStats = cached.phases ?? null;
            defenseSupport = cached.defenseSupport ?? null;
            skillNames = cached.skillMap ?? {};
            buffNames = cached.buffMap ?? {};
            loading = false;
            activeTab = "statistics";
            inflight = null;
            return;
          }
        } catch (e) {}
      }
      try {
        let res: LogFull;
        if (localPath) {
          try {
            res = await invoke("get_local_log_full", { filePath: localPath }) as LogFull;
          } catch (e) {
            // Try on-demand EI parse first
            try {
              await invoke("run_local_ei_parse", { filePath: localPath });
              res = await invoke("get_local_log_full", { filePath: localPath }) as LogFull;
            } catch (e2) {
              if (permalink) {
                res = await invoke("get_log_full", { permalink }) as LogFull;
              } else {
                throw e2;
              }
            }
          }
        } else if (permalink) {
          res = await invoke("get_log_full", { permalink }) as LogFull;
        } else {
          return;
        }
        stats = res.stats;
        phaseStats = extractPhaseStats(res.raw, PHASE_BOON_META);
        defenseSupport = extractDefenseSupport(res.raw);
        skillNames = ((res.raw as any)?.skillMap as Record<string, { name?: string; icon?: string }>) || {};
        buffNames = ((res.raw as any)?.buffMap as Record<string, { name?: string }>) || {};
        let mech = extractMechanics(res.raw, res.stats.boss_name);
        // If a local EVTC fallback is available, use it to fill in Revealed
        // source attribution that dps.report does not expose (skill/clone/
        // phantasm/enemy-attack source).
        if (mech && localPath) {
          try {
            const local: any[] = await invoke("parse_local_revealed_sources", { filePath: localPath });
            if (Array.isArray(local) && local.length) {
              const localTimes = local
                .map((row) => ({ t: Number(row.time), row }))
                .filter((o) => Number.isFinite(o.t))
                .sort((a, b) => a.t - b.t);
              let localIdx = 0;
              const WINDOW = 2000; // ±2 s tolerance for client/server clock skew
              mech = {
                ...mech,
                revealedBreakers: (mech.revealedBreakers ?? []).map((ev) => {
                  // advance localIdx to the first candidate >= ev.time - WINDOW
                  while (localIdx < localTimes.length && localTimes[localIdx].t < ev.time - WINDOW) {
                    localIdx++;
                  }
                  const cands = [];
                  let j = localIdx;
                  while (j < localTimes.length && localTimes[j].t <= ev.time + WINDOW) {
                    cands.push(localTimes[j]);
                    j++;
                  }
                  if (!cands.length) return ev;
                  const closest = cands.reduce((best, cur) =>
                    Math.abs(cur.t - ev.time) < Math.abs(best.t - ev.time) ? cur : best
                  , cands[0]);
                  const src = closest.row;
                  const skillMap: Record<string, { name?: string; icon?: string }> =
                    ((res as any)?.raw?.skillMap as Record<string, { name?: string; icon?: string }>) || {};
                  const skillIds = Array.isArray(src.trigger_skill_ids) ? src.trigger_skill_ids : [];
                  const srcs = Array.isArray(src.trigger_srcs) ? src.trigger_srcs : [];
                  const skillId =
                    skillIds.find((id: number) => typeof id === "number" && id > 0 && skillMap["s" + id]?.name) ??
                    skillIds.find((id: number) => typeof id === "number" && id > 0) ??
                    (typeof src.skill_id === "number" ? src.skill_id : 0);
                  const skillName =
                    skillId > 0 ? skillMap["s" + skillId]?.name || "" : "";
                  const attacker = srcs[0] && String(srcs[0]).trim() ? String(srcs[0]) : "";
                  const localSource = attacker || [src.src_character, src.src_account, src.src_profession]
                    .filter((v) => typeof v === "string" && v.trim() !== "")
                    .join(" | ");
                  const isSelf = !attacker || attacker === src.src_character;
                  const source = skillName || (isSelf ? "Auto Attack" : attacker) || (skillId > 0 ? `skill:${skillId}` : "") || localSource || ev.source || "Unknown";
                  return {
                    ...ev,
                    source,
                    sourceId: (skillId || src.skill_id) ?? ev.sourceId,
                    sourceIcon: skillName ? (skillMap["s" + skillId]?.icon || "") : "",
                  };
                }),
              };
            }
          } catch (e: any) {
            // Errors are surfaced via the outer catch at line 487.
          }
        } else {
          // Local merge skipped — no error to surface.
        }
        mechanics = mech;
        statsCache.set(cacheKey, { version: STATS_CACHE_VERSION, stats: res.stats, mechanics: mech, phases: phaseStats, defenseSupport, skillMap: (res.raw as any)?.skillMap, buffMap: (res.raw as any)?.buffMap });
        if (localPath) {
          try { await invoke("store_stats_cache", { filePath: localPath, data: { version: STATS_CACHE_VERSION, stats: res.stats, mechanics: mech, phases: phaseStats, defenseSupport, skillMap: (res.raw as any)?.skillMap, buffMap: (res.raw as any)?.buffMap } }); } catch (e) {}
        }
        // Non-Cerus fights only get the Boon Uptime tab — skip Statistics.
        // Harvest Temple defaults to Revealed if break data is present.
        const isHT = mechanics && /harvest temple/i.test(res.stats.boss_name);
        activeTab = (mechanics && mechanics.boss === "Cerus")
          ? "statistics"
          : (isValeGuardian ? "teleports"
          : (isDeimos ? "oils"
          : (isDhuumCM ? "pickups"
          : (isEyes ? "overrides"
          : (isUra ? "shards"
          : (isAhCm ? "exposed"
          : (isHT && revealFeatureReady && (mechanics?.revealedBreakers.length ?? 0) > 0 ? "revealed" : "boon")))))));
      } catch (e: any) {
        error = typeof e === "string" ? e : (e?.message || "Failed to load stats");
      } finally {
        loading = false;
      }
    })();
    return () => { inflight = null; loading = false; };
  });
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  // ── Squad Mechanics table: sortable columns (reuses profIcon from above) ──
  // Clickable column sort: orbs | cryRage | envyStrip (asc/desc toggle)
  let smSort = $state<{ key: "orbs" | "cryRage" | "envyStrip" | null; dir: 1 | -1 }>({ key: null, dir: 1 });
  function smSortBy(key: "orbs" | "cryRage" | "envyStrip") {
    if (smSort.key === key) { smSort = { key, dir: smSort.dir === 1 ? -1 : 1 }; }
    else { smSort = { key, dir: -1 }; }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if isDevMode}
<div class="dev-phase-inspector">
  <div class="dev-phase-panel">
    <div class="dev-phase-heading">DEV — raw dps.report phase inspector</div>
    <input
      class="dev-phase-input"
      placeholder="Paste dps.report permalink…"
      bind:value={phaseDebugPermalink}
      onkeydown={(e) => { if (e.key === "Enter") fetchPhaseDebug(); }}
    />
    <button class="dev-phase-btn" disabled={phaseDebugLoading} onclick={fetchPhaseDebug}>
      {phaseDebugLoading ? "Fetching…" : "Fetch raw payload"}
    </button>
    {#if phaseDebugError}
      <div class="dev-phase-error">{phaseDebugError}</div>
    {/if}
    {#if phaseDebugRaw}
      <div class="dev-phase-meta">Raw payload loaded.</div>
      <table class="dev-phase-table">
        <thead>
          <tr>
            <th>#</th>
            <th>phase.name</th>
            <th>failed</th>
            <th>duration</th>
            <th>success</th>
          </tr>
        </thead>
        <tbody>
          {#each phaseDebugEntries() as entry, idx}
            <tr class:dev-phase-failed={entry.failed}>
              <td>{idx + 1}</td>
              <td>{entry.name}</td>
              <td>{entry.failed === undefined ? "—" : (entry.failed ? "true" : "false")}</td>
              <td>{entry.duration === undefined ? "—" : fmt(entry.duration / 1000) + "s"}</td>
              <td>{entry.success === undefined ? "—" : (entry.success ? "true" : "false")}</td>
            </tr>
          {:else}
            <tr><td colspan="5" class="dev-phase-empty">No phases[] entries found at top level.</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
{/if}

<div class="stats-modal-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} onkeydown={(e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") onClose(); }}>
  <div class="stats-modal" role="dialog" aria-modal="true" tabindex="-1">
    <div class="stats-modal-head">
      <div>
        <div class="stats-modal-title">
          <i class="fa-solid fa-chart-bar"></i> Stats
        </div>
        <div class="stats-modal-sub">
          {stats ? stats.boss_name : (bossName || "Encounter")}
          {#if stats}· {fmt(stats.duration_sec)}s · {stats.players.length} players{/if}
        </div>
      </div>
      <button class="stats-modal-close" onclick={onClose} aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>

    {#if loading}
      <div class="stats-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading combat data…</div>
    {:else if error}
      <div class="stats-error">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          <div class="stats-error-title">Couldn't load stats</div>
          <div class="stats-error-msg">{error}</div>
        </div>
      </div>
    {:else if stats}
      <div class="stats-body">
        <!-- ── Top tab strip (full width) ── -->
        <nav class="stats-tabs" aria-label="Stats sections">
          {#if isCerus}
          <button class="top-tab" class:active={activeTab === "statistics"} onclick={() => (activeTab = "statistics")}>
            <i class="fa-solid fa-chart-line"></i> Statistics
          </button>
          {/if}
          <button class="top-tab" class:active={activeTab === "boon"} onclick={() => (activeTab = "boon")}>
            <i class="fa-solid fa-shield-halved"></i> Boon Uptime
          </button>
          <button class="top-tab" class:active={activeTab === "defense"} onclick={() => (activeTab = "defense")}>
            <i class="fa-solid fa-shield"></i> Defense
          </button>
          <button class="top-tab" class:active={activeTab === "support"} onclick={() => (activeTab = "support")}>
            <i class="fa-solid fa-hand-holding-heart"></i> Support
          </button>
          {#if isHT && revealFeatureReady}
          <button class="top-tab" class:active={activeTab === "revealed"} onclick={() => (activeTab = "revealed")}>
            <i class="fa-solid fa-eye"></i> Revealed
          </button>
          {/if}
          {#if mechanics && mechanics.boss === "Cerus" && (mechanics.totalMaliceDamage > 0 || mechanics.totalOrbs > 0 || mechanics.phases.length > 0)}
            <span class="tabs-divider"></span>
            {#if mechanics.totalMaliceDamage > 0}
              <button class="top-tab" class:active={activeTab === "shadows"} onclick={() => (activeTab = "shadows")}>
                <img class="top-icon" src="/mechanics/cerus_avatar.png" alt="" /> Shadows
              </button>
            {/if}
            {#if mechanics.totalOrbs > 0}
              <button class="top-tab" class:active={activeTab === "orbs"} onclick={() => (activeTab = "orbs")}>
                <img class="top-icon" src="/mechanics/insatiable_fanart.png" alt="" /> Orbs
              </button>
            {/if}
            {#if mechanics.phases.length > 0}
              <button class="top-tab" class:active={activeTab === "empowered"} onclick={() => (activeTab = "empowered")}>
                <img class="top-icon" src="/mechanics/empowered.png" alt="" /> Empowered
              </button>
            {/if}
          {/if}
          {#if isValeGuardian}
            <span class="tabs-divider"></span>
            <button class="top-tab" class:active={activeTab === "teleports"} onclick={() => (activeTab = "teleports")}>
              <i class="fa-solid fa-bolt"></i> Teleports
            </button>
          {/if}
          {#if isDeimos}
            <span class="tabs-divider"></span>
            <button class="top-tab" class:active={activeTab === "oils"} onclick={() => (activeTab = "oils")}>
              <i class="fa-solid fa-oil-can"></i> Oils
            </button>
          {/if}
          {#if isDhuumCM}
            <span class="tabs-divider"></span>
            <button class="top-tab" class:active={activeTab === "pickups"} onclick={() => (activeTab = "pickups")}>
              <i class="fa-solid fa-hand-holding"></i> Pick Ups
            </button>
          {/if}
          {#if isEyes}
            <span class="tabs-divider"></span>
            <button class="top-tab" class:active={activeTab === "overrides"} onclick={() => (activeTab = "overrides")}>
              <i class="fa-solid fa-eye"></i> Stun Overrides
            </button>
          {/if}
          {#if isUra}
            <span class="tabs-divider"></span>
            <button class="top-tab" class:active={activeTab === "shards"} onclick={() => (activeTab = "shards")}>
              <i class="fa-solid fa-gem"></i> Shards
            </button>
          {/if}
          {#if isAhCm}
            <span class="tabs-divider"></span>
            <button class="top-tab" class:active={activeTab === "exposed"} onclick={() => (activeTab = "exposed")}>
              <i class="fa-solid fa-radiation"></i> Exposed
            </button>
          {/if}
        </nav>

        <!-- ── Content ── -->
        {#snippet phaseBar()}
          {#if phaseStats === null}
            <div class="phase-fallback">
              <span>Phase breakdown needs a local Elite Insights parse.</span>
              {#if localPath}
                <button class="phase-parse" onclick={parseLocallyForPhases} disabled={parsingLocally}>
                  {parsingLocally ? "Parsing…" : "Parse locally"}
                </button>
              {:else}
                <span class="phase-fallback-note">This log only has a dps.report link, so no per-phase data is available.</span>
              {/if}
            </div>
          {:else if visiblePhases.length > 1}
            <div class="phase-chips">
              {#each visiblePhases as ph}
                <button class="phase-chip" class:active={selectedPhase === ph.index}
                        title={ph.name} onclick={() => selectedPhase = ph.index}>{shortPhaseName(ph.name)}</button>
              {/each}
              <label class="phase-brk"><input type="checkbox" bind:checked={showBreakbars} /> Breakbars</label>
            </div>
          {/if}
        {/snippet}

        <!-- ── Axibridge-style blocks: MVP hero, runner-up, metric panel ── -->
        {#snippet axHero(cfg: AxHeroCfg)}
          <div class="ax-hero-card {cfg.tier}">
            <div class="ax-hero-pill {cfg.tier}">
              <i class="fa-solid {cfg.icon}"></i> {cfg.label}
            </div>
            <div class="ax-hero-main">
              <span class="ax-hero-crown {cfg.tier}"><i class="fa-solid fa-crown"></i></span>
              <div class="ax-hero-id">
                <span class="ax-hero-name" title={cfg.player.account}>{cfg.player.name}</span>
                <span class="ax-hero-prof">{cfg.player.profession}</span>
              </div>
              <div class="ax-hero-score" title={cfg.scoreTip}>
                <b>{cfg.score}</b>
                <span>{cfg.scoreLabel}</span>
              </div>
            </div>
            <div class="ax-hero-quote">{cfg.quote}</div>
            {#each cfg.rows as row}
              <div class="ax-hero-row"><span>{row.label}</span><b>{row.value}</b></div>
            {/each}
          </div>
        {/snippet}

        {#snippet axRunner(cfg: AxRunnerCfg)}
          <div class="ax-runner-card {cfg.tier}">
            <div class="ax-runner-top">
              <span class="ax-runner-tier {cfg.tier}">{cfg.tier}</span>
              <b title={cfg.scoreTip}>{cfg.score}</b>
            </div>
            <div class="ax-runner-name" title={cfg.player.account}>
              <span class="ax-runner-crown {cfg.tier}"><i class="fa-solid fa-crown"></i></span>{cfg.player.name}
            </div>
            <div class="ax-runner-prof">{cfg.player.profession}</div>
            {#each cfg.rows as row}
              <div class="ax-runner-row"><span>{row.label}</span><b>{row.value}</b></div>
            {/each}
          </div>
        {/snippet}

        {#snippet axFeed(title: string, hint: string, rows: AxFeedRow[], down: boolean)}
          {#if rows.length > 0}
            <div class="ds-block">
              <div class="ds-block-title">{title} <span class="ds-block-hint">{hint}</span></div>
              <div class="ax-death-feed">
                {#each rows as r}
                  <div class="ax-death-row">
                    <span class="ax-death-time" class:ax-death-time-down={down}>{fmtTime(r.time)}</span>
                    <img class="ax-row-icon" src={profIcon(r.player.profession)} alt={r.player.profession}
                         onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="ax-death-name" title={r.player.account}>{r.player.name}</span>
                    <span class="ax-death-cause">
                      {#each r.sources as k}
                        <span title={k.src + (axIsCondition(k) ? " (condition damage)" : "")}
                              class:ax-death-cond={axIsCondition(k)}>
                          {axSkillName(k.id) || k.src}{k.damage > 0 ? ` · ${fmt(k.damage)}` : ""}
                        </span>
                      {/each}
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/snippet}

        {#snippet axPanel(panel: AxPanel)}
          <div class="ax-panel">
            <div class="ax-panel-head">
              <i class="{panel.icon}"></i>
              <span class="ax-panel-title">{panel.title}</span>
            </div>
            <div class="ax-panel-total">{panel.total}</div>
            {#if panel.top}
              <div class="ax-panel-top" title={panel.top}>{panel.top}</div>
            {/if}
            <div class="ax-panel-hint">{panel.hint}</div>
            <div class="ax-panel-rows">
              {#each panel.rows as row}
                <div class="ax-row">
                  <span class="ax-row-rank">{row.rank}</span>
                  <img class="ax-row-icon" src={profIcon(row.profession)} alt={row.profession}
                       onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                  <span class="ax-row-name" title={row.account}>{row.name}</span>
                  <span class="ax-row-val">{row.shown}</span>
                  <span class="ax-row-bar"><i style="height:{row.pct}%"></i></span>
                </div>
              {/each}
            </div>
          </div>
        {/snippet}

        <div class="stats-content">
          {#if activeTab === "statistics"}
            <!-- STATISTICS -->
            {@render phaseBar()}
            {#if mechanics && mechanics.boss === "Cerus"}
              <CerusDashboard report={mechanics} activeTab="statistics" singleLog={true} durationSec={stats?.duration_sec ?? 0} phaseSummary={phaseStats && phaseStats.length > 1 ? phaseSummary : null} />
            {:else}
              <!-- Generic combat summary (non-Cerus) -->
              <div class="stat-cards">
                <div class="stat-card">
                  <span class="stat-val">{fmtPhase(phaseSummary.dps)}</span>
                  <span class="stat-label">Total DPS</span>
                </div>
                <div class="stat-card">
                  <span class="stat-val">{fmtPhase(phaseSummary.durationSec)}<span class="stat-unit">s</span></span>
                  <span class="stat-label">Fight Duration</span>
                </div>
                <div class="stat-card">
                  <span class="stat-val">{phaseSummary.players}</span>
                  <span class="stat-label">Players</span>
                </div>
                <div class="stat-card">
                  <span class="stat-val">{fmtBoonPct(phaseSummary.avgBoon)}</span>
                  <span class="stat-label">Avg Boon Uptime</span>
                </div>
              </div>
              {#if !phaseSummary.isFullFight}
                <div class="stat-phase-note">Showing <b>{phaseSummary.label}</b></div>
              {/if}
              <div class="stat-note">No encounter-specific mechanics for this boss. See <b>Boon Uptime</b> for the per-player table.</div>
            {/if}

          {:else if activeTab === "revealed"}
                <!-- REVEALED (Harvest Temple) -->
                {#if revealFeatureReady}
                  {#if !mechanics || mechanics.revealedBreakers.length === 0}
                    <div class="stat-note">No Revealed breaks detected for this log.</div>
                  {:else}
                    <div class="revealed-disclaimer">Shows the first player revealed per phase. Does not necessarily mean an early break — only the first reveal event recorded.</div>
                    <div class="revealed-wrap">
                      <table class="revealed-table">
                        <thead>
                          <tr>
                            <th class="col-phase-reveal">Phase</th>
                            <th class="col-player-reveal">Player</th>
                            <th class="col-time-reveal">Time</th>
                            <th class="col-source-reveal">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each revealedByPhase as r}
                            <tr>
                              <td class="col-phase-reveal">
                                <div class="phase-cell-reveal">
                                  <img class="phase-icon-reveal" src={PHASE_ICON[r.phase] || "/bosses/dragonvoid.png"} alt={r.phase} onerror={(e) => ((e.currentTarget as HTMLImageElement).src = "/bosses/dragonvoid.png")} />
                                  <span>{r.phase}</span>
                                </div>
                              </td>
                              <td class="col-player-reveal">
                                <div class="player-cell-reveal">
                                  <img class="prof-icon-reveal" src={profIcon(r.profession)} alt={r.profession} onerror={(e) => ((e.currentTarget as HTMLImageElement).src = "/professions/guardian.png")} />
                                  <div class="player-names-reveal">
                                    <span class="toon-reveal">{r.toonName || r.player}</span>
                                    <span class="account-reveal">{r.player}</span>
                                  </div>
                                </div>
                              </td>
                              <td class="col-time-reveal">{fmtClock(r.time)}</td>
                              <td class="col-source-reveal">
                                {#if r.sourceIcon}
                                  <img src={r.sourceIcon} alt="" class="source-icon" />
                                {/if}
                                {r.source}
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                {:else}
                  <div class="revealed-placeholder">
                    <i class="fa-solid fa-eye-slash"></i>
                    <div class="revealed-placeholder-title">Revealed tracking</div>
                    <div class="revealed-placeholder-sub">Coming soon — enhancements in progress.</div>
                  </div>
                {/if}
          {:else if activeTab === "boon"}
            <!-- BOON UPTIME (table) -->
            {@render phaseBar()}
            <div class="stats-toolbar">
              <span class="stats-hint">Drag column edges to resize · click headers to sort</span>
              <div class="subgroup-chips">
                <button class="sg-chip" class:active={subgroupFilter === null} onclick={() => subgroupFilter = null}>All</button>
                {#each subgroupList as sg}
                  <button class="sg-chip" class:active={subgroupFilter === sg} onclick={() => subgroupFilter = sg}>Sub {sg}</button>
                {/each}
              </div>
              <button class="stats-boon-toggle" onclick={() => showBoonPicker = !showBoonPicker}>
                <i class="fa-solid fa-sliders"></i> Boons ({visibleBoons.size})
              </button>
              {#if showBoonPicker}
                <div class="stats-boon-picker">
                  {#each ALL_BOONS as b}
                    <label class="stats-boon-opt">
                      <input type="checkbox" checked={visibleBoons.has(b.key)} onchange={() => toggleBoon(b.key)} />
                      <img src={b.icon} alt={b.label} /> {b.label}
                    </label>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="stats-scroll">
              <table class="stats-table">
                <thead>
                  <tr>
                    <th class="col-player" style="width:{colWidths.player}px">
                      <button class="th-sort" onclick={() => setSort("name")}>Player {sortKey==="name" ? (sortDir==="asc"?"▲":"▼") : ""}</button>
                      <span class="resizer" role="button" tabindex="0" aria-label="Resize Player column" onmousedown={(e) => startResize(e, "player")} onkeydown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); nudgeCol("player", e.key === "ArrowRight" ? 8 : -8); } }}></span>
                    </th>
                    <th class="col-num" style="width:{colWidths.dps}px" title="Damage to boss target(s) — dps.report Target (Power + Condi)">
                      <button class="th-sort" onclick={() => setSort("dps")}>DPS {sortKey==="dps" ? (sortDir==="desc"?"▼":"▲") : ""}</button>
                      <span class="resizer" role="button" tabindex="0" aria-label="Resize DPS column" onmousedown={(e) => startResize(e, "dps")} onkeydown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); nudgeCol("dps", e.key === "ArrowRight" ? 8 : -8); } }}></span>
                    </th>
                    <th class="col-num" style="width:{colWidths.cleave}px" title="Total damage to everything — dps.report All (Power + Condi)">
                      <button class="th-sort" onclick={() => setSort("cleave")}>Cleave {sortKey==="cleave" ? (sortDir==="desc"?"▼":"▲") : ""}</button>
                      <span class="resizer" role="button" tabindex="0" aria-label="Resize Cleave column" onmousedown={(e) => startResize(e, "cleave")} onkeydown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); nudgeCol("cleave", e.key === "ArrowRight" ? 8 : -8); } }}></span>
                    </th>
                    {#each ALL_BOONS.filter(b => visibleBoons.has(b.key)) as b}
                      <th class="col-boon" title={b.label}>
                        <img src={b.icon} alt={b.label} class="boon-hd-icon" />
                        <span class="boon-hd-label">{b.label}</span>
                      </th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each sortedPlayers as p}
                    {#if (subgroupFilter === null || p.group === subgroupFilter) && !collapsedSubs.has(p.group)}
                    <tr>
                      <td class="col-player">
                        <div class="player-cell">
                          <img class="prof-icon" src={profIcon(p.profession)} alt={p.profession}
                               onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                          <div class="player-names">
                            <span class="toon">{p.name}</span>
                            <span class="account">{p.account}</span>
                          </div>
                          <span class="sub-badge" title="Squad / subgroup">Sub {p.group}</span>
                        </div>
                      </td>
                      <td class="col-num">{fmt(p.dps)}</td>
                      <td class="col-num">{fmt(p.cleave_dps)}</td>
                      {#each ALL_BOONS.filter(b => visibleBoons.has(b.key)) as b}
                        {@const bs = boonFor(p, b.id)}
                        <td class="col-boon">
                          {#if bs}
                            {#if b.stacks}
                              <span class="boon-val">{fmtPct(bs.stacks)}</span>
                            {:else}
                              <span class="boon-val {boonColor(bs.uptime_pct)}">{fmtPct(bs.uptime_pct)}<span class="pct">%</span></span>
                            {/if}
                          {:else}
                            <span class="boon-empty">·</span>
                          {/if}
                        </td>
                      {/each}
                    </tr>
                    {/if}
                  {/each}

                  <!-- Subgroup totals -->
                  {#each groupTotals.groups as g}
                    {#if subgroupFilter === null || g.group === subgroupFilter}
                    <tr class="subtotal-row">
                      <td class="col-player">
                        <button class="sg-collapse" class:open={!collapsedSubs.has(g.group)} onclick={() => toggleSubCollapse(g.group)} aria-label="Toggle subgroup {g.group} rows">▶</button>
                        <span class="subtotal-label">Sub {g.group}</span>
                      </td>
                      <td class="col-num">{fmt(g.dps)}</td>
                      <td class="col-num">{fmt(g.cleave)}</td>
                      {#each ALL_BOONS.filter(b => visibleBoons.has(b.key)) as b}
                        {@const av = g.boons.get(b.id)}
                        <td class="col-boon">
                          {#if av !== undefined}
                            {#if b.stacks}
                              <span class="boon-val">{fmtPct(av)}</span>
                            {:else}
                              <span class="boon-val {boonColor(av)}">{fmtPct(av)}<span class="pct">%</span></span>
                            {/if}
                          {:else}
                            <span class="boon-empty">·</span>
                          {/if}
                        </td>
                      {/each}
                    </tr>
                    {/if}
                  {/each}

                  <!-- Grand total -->
                  {#if subgroupFilter === null}
                  <tr class="total-row">
                    <td class="col-player"><span class="total-label">Total ({groupTotals.total.count})</span></td>
                    <td class="col-num">{fmt(groupTotals.total.dps)}</td>
                    <td class="col-num">{fmt(groupTotals.total.cleave)}</td>
                    {#each ALL_BOONS.filter(b => visibleBoons.has(b.key)) as b}
                      {@const av = groupTotals.total.boons.get(b.id)}
                      <td class="col-boon">
                        {#if av !== undefined}
                          {#if b.stacks}
                            <span class="boon-val">{fmtPct(av)}</span>
                          {:else}
                            <span class="boon-val {boonColor(av)}">{fmtPct(av)}<span class="pct">%</span></span>
                          {/if}
                        {:else}
                          <span class="boon-empty">·</span>
                        {/if}
                      </td>
                    {/each}
                  </tr>
                  {/if}
                  </tbody>
              </table>
            </div>

            {#if isCerus && stats.targets.length > 1}
              <div class="stats-targets">
                <button class="targets-toggle" onclick={() => (targetsOpen = !targetsOpen)} aria-expanded={targetsOpen}>
                  <span class="targets-chevron" class:open={targetsOpen}>▶</span>
                  <span class="targets-label">Damage per target (group total) — {stats.targets.length} targets</span>
                </button>
                {#if targetsOpen}
                  <div class="target-chips">
                    {#each stats.targets as t}
                      <span class="target-chip" title={t.name}><b>{t.name}</b> {fmt(t.dps)}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}

          {:else if activeTab === "defense"}
            <!-- DEFENSE -->
            {@render phaseBar()}
            <div class="ds-toolbar">
              <span class="stats-hint">Hits mitigated = blocked + evaded + dodged + invulned</span>
              <label class="ds-rate"><input type="checkbox" bind:checked={showPer10Min} /> Per 10 min</label>
            </div>
            {#if defensePlayers.length === 0}
              <div class="stat-note">No defensive data for this log.</div>
            {:else}
              <div class="ax-heroes">
                {#if defenseHero}
                  {@render axHero(defenseHero)}
                {/if}
                {#each defenseRunners as cfg}
                  {@render axRunner(cfg)}
                {/each}
              </div>

              <div class="ax-panels">
                {#each defensePanels as panel}
                  {@render axPanel(panel)}
                {/each}
              </div>

              {#if downRecap.length > 0}
                <div class="ds-block ax-downrecap">
                  <div class="ax-downrecap-icon">
                    <img src={bossIcon} alt={bossName} />
                    <span>{bossName}</span>
                  </div>
                  <div class="ax-downrecap-body">
                    <div class="ds-block-title">Down recap <span class="ds-block-hint">top skills by players downed</span></div>
                    {#each downRecap as r}
                      <div class="ax-downrecap-row">
                        <span class="ax-downrecap-name">{r.name}</span>
                        <span class="ax-downrecap-val">{r.players} downed{r.deaths > 0 ? ` · ${r.deaths} died` : ""}</span>
                        <span class="ax-downrecap-dmg">{fmt(r.damage)}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {@render axFeed("Downs", `${defenseDowns.length} down events`, defenseDowns, true)}
              {@render axFeed("Deaths", `${defenseDeaths.length} in this log`, defenseDeaths, false)}

              <div class="ds-block">
                <div class="ds-block-title">Mitigation matrix <span class="ds-block-hint">click a row for the damage breakdown</span></div>
                <div class="ds-legend">
                  <span>Hits that never landed: blocked · evaded · dodged · invuln</span>
                  <span>Enemy casts stopped: interrupted</span>
                  <span>Went down / died: downed · dead</span>
                </div>
                <table class="ds-heat">
                  <thead>
                    <tr>
                      <th>Player</th>
                      {#each DEFENSE_HEAT_COLS as c}
                        <th class="ds-heat-col" title={c.tip}>{c.label}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each defenseHeat as row}
                      <tr class="ds-heat-row" class:open={defenseOpen === row.player.name}
                          onclick={() => defenseOpen = defenseOpen === row.player.name ? null : row.player.name}>
                        <td class="ds-heat-name">
                          <img class="prof-icon" src={profIcon(row.player.profession)} alt={row.player.profession}
                               onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                          <span>{row.player.name}</span>
                        </td>
                        {#each row.cells as cell}
                          <td class="ds-heat-cell" title="{cell.tip} — {cell.value} · #{cell.rank} of {defensePlayers.length}"
                              style="background: {heatBg(cell.pct)}">{cell.value}</td>
                        {/each}
                      </tr>
                      {#if defenseOpen === row.player.name}
                        <tr class="ds-detail-row">
                          <td colspan={DEFENSE_HEAT_COLS.length + 1}>
                            <div class="ds-detail">
                              <div class="ds-detail-item"><span class="ds-detail-label">Power</span><b>{fmt(row.player.powerDamageTaken * dsRate)}</b></div>
                              <div class="ds-detail-item"><span class="ds-detail-label">Condition</span><b>{fmt(row.player.conditionDamageTaken * dsRate)}</b></div>
                              <div class="ds-detail-item"><span class="ds-detail-label">Strike</span><b>{fmt(row.player.strikeDamageTaken * dsRate)}</b></div>
                              <div class="ds-detail-item"><span class="ds-detail-label">Barrier</span><b>{fmt(row.player.damageBarrier * dsRate)}</b></div>
                              <div class="ds-detail-item"><span class="ds-detail-label">Hits taken</span><b>{row.player.damageTakenCount}</b></div>
                              <div class="ds-detail-item"><span class="ds-detail-label">Downed</span><b>{row.player.downCount}× {fmtTime(row.player.downDuration / 1000)}</b></div>
                              <div class="ds-detail-item"><span class="ds-detail-label">Deaths</span><b>{row.player.deadCount}</b></div>
                            </div>
                          </td>
                        </tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {:else if activeTab === "support"}
            <!-- SUPPORT -->
            {@render phaseBar()}
            <div class="ds-toolbar">
              <span class="stats-hint">Cleanses, boon strips, revives and stun breaks from Elite Insights</span>
            </div>
            {#if supportPlayers.length === 0}
              <div class="stat-note">No support data for this log.</div>
            {:else}
              <div class="ax-heroes">
                {#if supportHero}
                  {@render axHero(supportHero)}
                {/if}
                {#each supportRunners as cfg}
                  {@render axRunner(cfg)}
                {/each}
              </div>

              <div class="ax-panels">
                {#each supportPanels as panel}
                  {@render axPanel(panel)}
                {/each}
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Boons generated for the group <span class="ds-block-hint">hover a chip for the exact uptime</span></div>
                <div class="ax-boon-rows">
                  {#each supportBoons as row}
                    <div class="ax-boon-row">
                      <span class="ax-row-rank">{competitionRank(supportBoons.map((r) => r.total), row.total)}</span>
                      <img class="ax-row-icon" src={profIcon(row.player.profession)} alt={row.player.profession}
                           onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="ax-boon-name" title={row.player.account}>{row.player.name}</span>
                      <span class="ax-boon-total" title="Sum of generated boon uptime">{row.total.toFixed(1)}</span>
                      <span class="ax-boon-list">
                        {#each row.boons as b}
                          <span class="ax-boon-chip" title="{b.name}: {b.generation.toFixed(1)}% uptime generated">{b.name} {b.generation.toFixed(1)}%</span>
                        {/each}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Support detail</div>
                <table class="ax-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Player</th><th>Score</th><th>Cleanses</th><th>Breakbar</th>
                      <th>Self</th><th>Strips</th><th>Revives</th><th>Stun breaks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each supportRanked as p}
                      <tr>
                        <td class="ax-table-rank">{competitionRank(supportPlayers.map((x) => supportScore.get(x.name) ?? 0), supportScore.get(p.name) ?? 0)}</td>
                        <td class="ax-table-name">
                          <img class="ax-row-icon" src={profIcon(p.profession)} alt={p.profession}
                               onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                          <span>{p.name}</span>
                        </td>
                        <td class="ax-table-score">{supportScore.get(p.name) ?? 0}</td>
                        <td>{fmt(p.condiCleanse)}</td>
                        <td>{fmt(p.breakbarDamage)}</td>
                        <td>{fmt(p.condiCleanseSelf)}</td>
                        <td>{fmt(p.boonStrips)}</td>
                        <td>{fmt(p.resurrects)}</td>
                        <td>{fmt(p.stunBreak)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <div class="stat-note">Healing is not shown — Elite Insights only reports it when its healing-stats module is enabled, and it is off for these logs.</div>
            {/if}

          {:else if activeTab === "teleports" && isValeGuardian}
            <!-- TELEPORTS (Vale Guardian) -->
            {@const tpSummary = mechanics?.teleportSummary}
            {@const tpRows = mechanics?.teleports ?? []}
            {@const tpEvents = tpRows
              .flatMap((p) => p.events.map((e) => ({ ...e, player: p })))
              .sort((a, b) => a.time - b.time)}
            {@const tpDowns = tpRows
              .flatMap((p) => p.downs.map((d) => ({ ...d, player: p })))
              .sort((a, b) => a.time - b.time)}
            <div class="ds-toolbar">
              <span class="stats-hint">Unstable Magic Spike teleports, from the boss and the split guardians</span>
            </div>
            {#if tpSummary}
              <div class="enc-summary">
                <span><strong>{tpSummary.total}</strong> teleport{tpSummary.total !== 1 ? 's' : ''}</span>
                <span><strong>{tpSummary.bossTp}</strong> boss</span>
                <span><strong>{tpSummary.splitTp}</strong> split</span>
                <span><strong>{tpSummary.downsAfterTp}</strong> down{tpSummary.downsAfterTp !== 1 ? 's' : ''} after a teleport</span>
              </div>
            {/if}
            {#if tpRows.length === 0}
              <div class="stat-note">No teleport data for this log.</div>
            {:else}
              <div class="ds-block">
                <div class="ds-block-title">Players <span class="ds-block-hint">{tpRows.length} players</span></div>
                <div class="enc-head">
                  <span class="enc-cap">#</span>
                  <span class="enc-cap"></span>
                  <span class="enc-cap">Player</span>
                  <span class="enc-cap">Teleports</span>
                  <span class="enc-cap">Downs</span>
                </div>
                <div class="enc-rows">
                  {#each tpRows as p, i}
                    <div class="enc-row">
                      <span class="enc-rank">{i + 1}</span>
                      <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                           onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="enc-name" title={p.account}>{p.name}</span>
                      <span class="enc-num">{p.total}<span class="enc-sub"> · {p.bossTp} boss / {p.splitTp} split</span></span>
                      <span class="enc-num">{p.downs.length}</span>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Teleports <span class="ds-block-hint">{tpEvents.length} events</span></div>
                <div class="feed">
                  {#each tpEvents as e}
                    <div class="feed-row">
                      <span class="feed-time">{fmtTime(e.time)}</span>
                      <img class="enc-icon" src={profIcon(e.player.profession)} alt={e.player.profession}
                           onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="feed-name" title={e.player.account}>
                        {e.player.name}{#if e.source === "split"}<span class="enc-tag">- split</span>{/if}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Downs after a teleport <span class="ds-block-hint">{tpDowns.length} downs</span></div>
                <div class="feed">
                  {#each tpDowns as d}
                    <div class="feed-row">
                      <span class="feed-time">{fmtTime(d.time)}</span>
                      <img class="enc-icon" src={profIcon(d.player.profession)} alt={d.player.profession}
                           onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="feed-name" title={d.player.account}>{d.player.name}</span>
                      <span class="feed-cause"><span>{d.cause}: {d.causeDetail}</span></span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

          {:else if activeTab === "oils" && isDeimos}
            <!-- OILS (Deimos) -->
            {@const oilSummary = mechanics?.oilSummary}
            {@const oilRows = mechanics?.oilPlayers ?? []}
            {@const oilEvents = mechanics?.oils ?? []}
            <div class="ds-toolbar">
              <span class="stats-hint">Rapid Decay oils set off by players — the first touch of each slick, not every expansion</span>
            </div>
            {#if oilSummary}
              <div class="enc-summary">
                <span><strong>{oilSummary.total}</strong> oil{oilSummary.total !== 1 ? 's' : ''}</span>
                <span><strong>{oilSummary.players}</strong> player{oilSummary.players !== 1 ? 's' : ''}</span>
                <span><strong>{oilSummary.downsAfterOil}</strong> down{oilSummary.downsAfterOil !== 1 ? 's' : ''} caused by oil</span>
              </div>
            {/if}
            {#if oilRows.length === 0}
              <div class="stat-note">No oil data for this log.</div>
            {:else}
              <div class="ds-block">
                <div class="ds-block-title">Players <span class="ds-block-hint">{oilRows.length} players</span></div>
                <div class="enc-head">
                  <span class="enc-cap">#</span>
                  <span class="enc-cap"></span>
                  <span class="enc-cap">Player</span>
                  <span class="enc-cap">Oils</span>
                  <span class="enc-cap">Downs</span>
                </div>
                <div class="enc-rows">
                  {#each oilRows as p, i}
                    <div class="enc-row">
                      <span class="enc-rank">{i + 1}</span>
                      <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                           onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="enc-name" title={p.account}>{p.name}</span>
                      <span class="enc-num">{p.count}</span>
                      <span class="enc-num">{p.downs}</span>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Oils <span class="ds-block-hint">{oilEvents.length} slicks triggered</span></div>
                <div class="feed">
                  {#each oilEvents as o}
                    <div class="feed-row">
                      <span class="feed-time">{fmtTime(o.time)}</span>
                      <img class="enc-icon" src={profIcon(o.profession)} alt={o.profession}
                           onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="feed-name" title={o.account}>{o.name}</span>
                      {#if o.downs.length > 0}
                        <span class="feed-downs">
                          {#each o.downs as d}
                            <span class="feed-down">
                              <span>-</span>
                              <img class="feed-down-icon" src={profIcon(d.profession)} alt={d.profession}
                                   onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                              <span class="feed-down-txt"><b>{d.name}</b> went down by this oil at <b>{fmtTime(d.time)}</b></span>
                            </span>
                          {/each}
                        </span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          {:else if activeTab === "pickups" && isDhuumCM}
            <!-- PICK UPS (Dhuum CM) -->
            {@const puSummary = mechanics?.echoSummary}
            {@const puRows = mechanics?.echoPlayers ?? []}
            {@const puEvents = mechanics?.echoPickups ?? []}
            {@const heldRows = puRows.filter((p) => p.count > 0)}
            {@const maxCount = Math.max(...heldRows.map((p) => p.count), 1)}
            <div class="ds-toolbar">
              <span class="stats-hint">Ender's Echo holds in Dhuum CM — when each player was grabbed, for how long, and whether it took them</span>
            </div>
            {#if puSummary}
              <div class="enc-summary">
                <span><strong>{puSummary.total}</strong> pick up{puSummary.total !== 1 ? 's' : ''}</span>
                <span><strong>{puSummary.players}</strong> player{puSummary.players !== 1 ? 's' : ''} held</span>
                <span><strong>{puSummary.deaths}</strong> taken by the echo</span>
              </div>
            {/if}
            {#if !puSummary || puSummary.total === 0}
              <div class="stat-note">No Ender's Echo pick ups recorded for this log.</div>
            {:else}
              <div class="ds-block">
                <div class="ds-block-title">Total pick ups <span class="ds-block-hint">{heldRows.length} of {puRows.length} players</span></div>
                <div class="pu-grid">
                  <span class="enc-cap">#</span>
                  <span class="enc-cap"></span>
                  <span class="enc-cap">Player</span>
                  <span class="enc-cap"></span>
                  <span class="enc-cap">Pick ups</span>
                  <span class="enc-cap">Taken</span>
                  {#each heldRows as p, i}
                    <span class="enc-rank">{i + 1}</span>
                    <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                         onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="enc-name" title={p.account}>{p.name}</span>
                    <span class="pu-track"><span class="pu-fill" style={`width:${(p.count / maxCount) * 100}%`}></span></span>
                    <span class="enc-num">{p.count}</span>
                    <span class="enc-num pu-taken">{p.deaths || '–'}</span>
                  {/each}
                </div>
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Hold timeline <span class="ds-block-hint">length = time held · red = taken</span></div>
                {#if echoChart}
                  <div class="pu-chart">
                    <div class="pu-lanes">
                      {#each echoChart.lanes as lane}
                        <div class="pu-lane">
                          <span class="pu-lane-name" title={lane.name}>{lane.name}</span>
                          <span class="pu-lane-track">
                            {#each lane.segs as s}
                              <span class="pu-seg" class:pu-seg-dead={s.died} role="img"
                                    aria-label={`${lane.name} held ${fmtTime(s.time)} to ${fmtTime(s.end)}, ${s.died ? 'taken by the echo' : 'let go'}`}
                                    style={`left:${s.leftPct}%;width:${s.widthPct}%`}
                                    onmouseenter={() => (echoHover = { name: lane.name, time: s.time, end: s.end, died: s.died })}
                                    onmouseleave={() => (echoHover = null)}></span>
                            {/each}
                          </span>
                        </div>
                      {/each}
                    </div>
                    <div class="pu-axis">
                      <span></span>
                      <span class="pu-axis-track">
                        {#each echoChart.ticks as t}
                          <span class="pu-tick" style={`left:${t.pct}%;transform:translateX(${t.pct <= 0 ? '0' : t.pct >= 100 ? '-100%' : '-50%'})`}>{t.label}</span>
                        {/each}
                      </span>
                    </div>
                    <div class="pu-detail">
                      {echoHover
                        ? `${fmtTime(echoHover.time)} – ${fmtTime(echoHover.end)} · ${echoHover.name} · held ${(echoHover.end - echoHover.time).toFixed(1)}s · ${echoHover.died ? 'taken by the echo' : 'let go'}`
                        : 'Hover a hold for its details'}
                    </div>
                    <div class="pu-legend">
                      <span><i class="pu-dot pu-dot-survived"></i> let go</span>
                      <span><i class="pu-dot pu-dot-taken"></i> taken by the echo</span>
                    </div>
                  </div>
                {:else}
                  <div class="stat-note">No holds to chart.</div>
                {/if}
              </div>

              <div class="ds-block">
                <div class="ds-block-title">Pick Ups <span class="ds-block-hint">{puEvents.length} holds</span></div>
                <div class="feed">
                  {#each puEvents as e}
                    <div class="feed-row">
                      <span class="feed-time">{fmtTime(e.time)}</span>
                      <img class="enc-icon" src={profIcon(e.profession)} alt={e.profession}
                           onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                      <span class="feed-name" title={e.account}>{e.name}<span class="enc-sub">held {(e.end - e.time).toFixed(1)}s</span></span>
                      {#if e.diedAt !== null}
                        <span class="feed-downs">
                          <span class="feed-down">
                            <span>-</span>
                            <img class="feed-down-icon" src={profIcon(e.profession)} alt={e.profession}
                                 onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                            <span class="feed-down-txt"><b>{e.name}</b> was taken by the echo at <b>{fmtTime(e.diedAt)}</b></span>
                          </span>
                        </span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

          {:else if activeTab === "overrides" && isEyes}
            <!-- STUN OVERRIDES (Statues of Darkness) -->
            {@const ovSummary = mechanics?.eyeSummary}
            {@const ovRows = mechanics?.eyeOverrides ?? []}
            {@const ovPlayers = mechanics?.eyePlayers ?? []}
            {@const ovShown = eyeFilter === "all" ? ovRows : ovRows.filter((o) => o.eye === eyeFilter)}
            {@const ovTeleports = (mechanics?.eyeTeleports ?? []).filter(
              (t) => eyeFilter === "all" || t.eye === eyeFilter,
            )}
            {@const ovFeed = [
              ...ovShown.map((o) => ({ kind: 'cc' as const, time: o.time, cc: o })),
              ...ovTeleports.map((t) => ({ kind: 'tp' as const, time: t.time, tp: t })),
            ].sort((a, b) => a.time - b.time)}
            {@const ovShownSummary = {
              total: ovShown.length,
              players: new Set(ovShown.map((o) => o.name)).size,
              judgment: ovShown.filter((o) => o.eye === "judgment").length,
              fate: ovShown.filter((o) => o.eye === "fate").length,
            }}
            {@const ccIcon = (c: string) => `https://wiki.guildwars2.com/wiki/Special:FilePath/${{ daze: 'Daze', fear: 'Fear', knockdown: 'Knockdown', stun: 'Stun' }[c] ?? 'Daze'}.png`}
            <div class="ds-toolbar">
              <span class="stats-hint">Daze, Fear and Knockdown applied to the eyes — CC that should have been left to the light orb's stun. Stuns are the orb's own Flare, listed so an untimely throw is visible</span>
              <div class="eo-eye-chips">
                <button class="sg-chip" class:active={eyeFilter === "all"} onclick={() => (eyeFilter = "all")}>Both eyes</button>
                <button class="sg-chip" class:active={eyeFilter === "judgment"} onclick={() => (eyeFilter = "judgment")}>Judgment</button>
                <button class="sg-chip" class:active={eyeFilter === "fate"} onclick={() => (eyeFilter = "fate")}>Fate</button>
              </div>
            </div>
            {#if ovSummary}
              <div class="enc-summary">
                <span><strong>{ovShownSummary.total}</strong> override{ovShownSummary.total !== 1 ? 's' : ''}</span>
                <span><strong>{ovShownSummary.players}</strong> player{ovShownSummary.players !== 1 ? 's' : ''}</span>
                {#if eyeFilter !== "fate"}
                  <span><strong>{ovShownSummary.judgment}</strong> on Judgment</span>
                {/if}
                {#if eyeFilter !== "judgment"}
                  <span><strong>{ovShownSummary.fate}</strong> on Fate</span>
                {/if}
              </div>
            {/if}
            {#if ovRows.length === 0}
              <div class="stat-note">No stun overrides recorded — nobody used Daze, Fear or Knockdown on either eye.</div>
            {:else if ovShown.length === 0}
              <div class="stat-note">Nothing on this eye.</div>
            {:else}
              <div class="ds-block">
                <div class="ds-block-title">Players <span class="ds-block-hint">{ovPlayers.filter((p) => (eyeFilter === "fate" ? p.fate : eyeFilter === "judgment" ? p.judgment : p.total) > 0).length} of {ovPlayers.length}</span></div>
                <div class="eo-cols" class:eo-single={eyeFilter !== "all"}>
                  {#if eyeFilter !== "fate"}
                    <div class="eo-col">
                      <div class="eo-col-head"><span>Eye of Judgment</span><span>{ovSummary?.judgment ?? 0}</span></div>
                      <div class="eo-rows">
                        {#each ovPlayers.filter((p) => p.judgment > 0) as p, i}
                          <div class="eo-row">
                            <span class="enc-rank">{i + 1}</span>
                            <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                                 onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                            <span class="enc-name" title={p.account}>{p.name}</span>
                            <span class="enc-num">{p.judgment}</span>
                          </div>
                        {:else}
                          <div class="eo-empty">Nobody overrode this eye.</div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if eyeFilter !== "judgment"}
                    <div class="eo-col">
                      <div class="eo-col-head"><span>Eye of Fate</span><span>{ovSummary?.fate ?? 0}</span></div>
                      <div class="eo-rows">
                        {#each ovPlayers.filter((p) => p.fate > 0) as p, i}
                          <div class="eo-row">
                            <span class="enc-rank">{i + 1}</span>
                            <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                                 onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                            <span class="enc-name" title={p.account}>{p.name}</span>
                            <span class="enc-num">{p.fate}</span>
                          </div>
                        {:else}
                          <div class="eo-empty">Nobody overrode this eye.</div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              </div>

              <div class="ds-block">
              <div class="ds-block-title">Overrides <span class="ds-block-hint">{ovShown.length} applications · {ovTeleports.length} teleports</span></div>
              <div class="feed">
                {#each ovFeed as item}
                  {#if item.kind === 'tp'}
                    <div class="feed-row eo-tp-row">
                      <span class="feed-time">{fmtTime(item.tp.time)}</span>
                      <span class="eo-tp">{item.tp.eyeName} teleports</span>
                    </div>
                  {:else}
                  <div class="feed-row" class:eo-stun={item.cc.category === 'stun'}>
                    <span class="feed-time">{fmtTime(item.cc.time)}</span>
                    <img class="enc-icon" src={profIcon(item.cc.profession)} alt={item.cc.profession}
                         onerror={(ev) => { (ev.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="feed-name" title={item.cc.account}>
                      {item.cc.name}
                      {#each [item.cc.category] as c}
                        <img class="eo-cc" src={ccIcon(c)} alt={c} title={c}
                             onerror={(ev) => { (ev.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                      {/each}
                      <span class="enc-tag">{item.cc.eye === 'fate' ? 'Fate' : 'Judgment'}</span>
                    </span>
                    {#if item.cc.skills.length > 0}
                      <span class="feed-downs">
                        {#each item.cc.skills as s}
                          <span class="feed-down">
                            <img class="eo-skill" src={s.icon} alt="" title={s.name}
                                 onerror={(ev) => { (ev.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                            <span class="feed-down-txt">{s.name}</span>
                            <b>{item.cc.duration}s</b>
                          </span>
                        {/each}
                      </span>
                    {:else if item.cc.unmatched === 'not-a-player-skill'}
                      <span class="feed-downs">
                        <span class="feed-down eo-unknown">
                          <i class="fa-solid fa-circle-question"></i>
                          <span class="feed-down-txt">not a player skill — familiar, trait or relic</span>
                        </span>
                      </span>
                    {:else if item.cc.unmatched === 'no-cast-at-moment'}
                      <span class="feed-downs">
                        <span class="feed-down eo-unknown">
                          <i class="fa-solid fa-circle-question"></i>
                          <span class="feed-down-txt">no matching cast for this moment</span>
                        </span>
                      </span>
                    {/if}
                  </div>
                  {/if}
                {/each}
              </div>
              </div>
            {/if}

          {:else if activeTab === "shards" && isUra}
            <!-- BLOODSTONE SHARDS (Ura, normal / CM / LCM) -->
            {@const urSummary = mechanics?.uraSummary}
            {@const urRows = mechanics?.uraShards ?? []}
            {@const urPlayers = mechanics?.uraPlayers ?? []}
            <div class="ds-toolbar">
              <span class="stats-hint">Every Bloodstone shard pick-up and what it was used on. A use that missed its target means the player stood outside the shard's 180-unit radius.</span>
            </div>
            {#if urSummary}
              <div class="enc-summary">
                <span><strong>{urSummary.pickups}</strong> pick-up{urSummary.pickups !== 1 ? 's' : ''}</span>
                <span><strong>{urSummary.drops}</strong> drop{urSummary.drops !== 1 ? 's' : ''}</span>
                <span><strong>{urSummary.bubbles}</strong> bubble save{urSummary.bubbles !== 1 ? 's' : ''}</span>
                <span><strong>{urSummary.saturated}</strong> while saturated</span>
                <span><strong>{urSummary.doubles}</strong> out of range</span>
                <span><strong>{urSummary.wasted}</strong> wasted</span>
                <span><strong>{urSummary.early}</strong> early</span>
                <span><strong>{urSummary.lostDown}</strong> lost on a down</span>
                <span><strong>{urSummary.lateDrops}</strong> late</span>
                <span>avg float <strong>{urSummary.avgFloatS === null ? '—' : `${urSummary.avgFloatS}s`}</strong></span>
              </div>
            {/if}

            <div class="ds-block">
              <div class="ds-block-title">Shard pick-ups <span class="ds-block-hint">{urPlayers.length} players</span></div>
              <div class="enc-head">
                <span class="enc-cap">#</span><span class="enc-cap"></span><span class="enc-cap">Player</span>
                <span class="enc-cap">Pick-ups</span><span class="enc-cap">Drops</span>
              </div>
              <div class="enc-rows">
                {#each urPlayers as p, i}
                  <div class="enc-row">
                    <span class="enc-rank">{i + 1}</span>
                    <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                         onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="enc-name" title={p.account}>{p.name}</span>
                    <span class="enc-num">{p.pickups}</span>
                    <span class="enc-num enc-sub">{p.drops}</span>
                  </div>
                {:else}
                  <div class="stat-note">Nobody picked up a Bloodstone shard.</div>
                {/each}
              </div>
            </div>

            <div class="ds-block">
              <div class="ds-block-title">Timeline <span class="ds-block-hint">{urRows.length} events</span></div>
              <div class="feed">
                {#each urRows as r}
                  <div class="feed-row ur-row">
                    <span class="feed-time">{fmtTime(r.time)}</span>
                    <img class="enc-icon" src={profIcon(r.profession)} alt={r.profession}
                         onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="feed-name" title={r.account}>
                      <span class="ur-name">{r.name}</span>
                      <span class="ur-kind">
                        {#if r.kind === 'pickup'}picked up the shard
                        {:else if r.kind === 'crust-drop'}Dropped the shard in a {r.target}
                        {:else if r.kind === 'bubble-drop'}Dropped the shard in bubbles
                        {:else if r.kind === 'down-drop'}got downed and dropped the shard
                        {:else}Dropped the shard
                        {/if}
                      </span>
                      {#if r.kind === 'crust-drop'}
                        <img class="ur-icon" src="/mechanics/geyser_icon.png" alt="" title={r.target ?? ''}
                             onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                      {:else}
                        <img class="ur-icon" src="/mechanics/bloodstone_icon.png" alt="" title="Bloodstone shard"
                             onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                      {/if}
                      {#if r.tag === 'saturated'}
                        <span class="enc-tag ur-tag ur-tag-saturated" title="Picked up while Bloodstone Saturation was active">saturated</span>
                      {:else if r.tag === 'out of range'}
                        <span class="enc-tag ur-tag ur-tag-warn">out of range</span>
                      {:else if r.tag === 'wasted'}
                        <span class="enc-tag ur-tag ur-tag-wasted">wasted</span>
                      {/if}
                      {#if r.kind === 'early-drop'}
                        <span class="enc-tag ur-tag ur-tag-warn">early drop on {r.earlyOn ?? 'target'}</span>
                      {/if}
                      {#if r.lateDrop}
                        <span class="enc-tag ur-tag ur-tag-warn">late shard drop</span>
                      {/if}
                    </span>
                    {#if r.kind === 'crust-drop'}
                      <span class="feed-downs">
                        <span class="feed-down">
                          <img class="enc-icon ur-sub-icon" src={profIcon(r.profession)} alt={r.profession}
                               onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                          <span class="feed-down-txt"><span class="ur-sub-name">{r.name}</span> removed a Hardened Crust</span>
                          <img class="ur-icon" src="/mechanics/hardened_crust.png" alt="" title="Hardened Crust"
                               onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                          <span class="feed-down-txt">from a {r.target}.</span>
                        </span>
                      </span>
                    {:else if r.kind === 'bubble-drop'}
                      <span class="feed-downs">
                        {#each r.freed.slice(0, 4) as f}
                          <span class="feed-down ur-freed">
                            <img class="enc-icon ur-sub-icon" src={profIcon(f.profession)} alt={f.profession}
                                 onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                            <span class="feed-down-txt"><span class="ur-sub-name">{f.name}</span> got freed from bubble</span>
                            <img class="ur-icon" src="/mechanics/bubble_icon.png" alt="" title="Pressure Blast bubble"
                                 onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                            <span class="feed-down-txt">and floated for</span>
                            <b>{f.floatS}s</b>
                          </span>
                        {/each}
                        {#if r.freed.length > 4}
                          <span class="feed-down ur-freed">
                            <span class="feed-down-txt">+{r.freed.length - 4} more</span>
                          </span>
                        {/if}
                      </span>
                    {:else if r.kind === 'double-drop' || r.kind === 'wasted-drop'}
                      <span class="feed-downs">
                        {#if r.kind === 'double-drop'}
                          <span class="feed-down">
                            <img class="ur-icon" src="/mechanics/bloodstone_icon.png" alt="" title="Bloodstone shard"
                                 onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                            <span class="feed-down-txt">picked up again at {fmtTime(r.againAt ?? 0)}</span>
                          </span>
                        {/if}
                        {#if r.scooped || r.kind === 'wasted-drop'}
                          <span class="feed-down">
                            <img class="ur-icon" src="/mechanics/bloodstone_icon.png" alt="" title="Bloodstone shard"
                                 onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                            {#if r.scooped}
                              <span class="feed-down-txt">Another player dropped the shard on {r.scooped.kind === 'crust' ? `the ${r.scooped.target}` : 'bubbles'} first.</span>
                            {:else}
                              <span class="feed-down-txt">Nobody broken afterwards</span>
                            {/if}
                          </span>
                        {/if}
                      </span>
                    {/if}
                  </div>
                {:else}
                  <div class="stat-note">No Bloodstone shard activity recorded.</div>
                {/each}
              </div>
            </div>
          {:else if activeTab === "exposed" && isAhCm}
            <!-- EXPOSED (Aetherblade Hideout CM) -->
            {@const ahSummary = mechanics?.ahSummary}
            {@const ahRows = mechanics?.ahExposed ?? []}
            {@const ahPlayers = mechanics?.ahPlayers ?? []}
            <div class="ds-toolbar">
              <span class="stats-hint">Each Exposed stack raises incoming strike and condition damage by 25% for 60 seconds. The attacking skill is named when the application came from a recorded hit.</span>
            </div>
            {#if ahSummary}
              <div class="enc-summary">
                <span><strong>{ahSummary.applications}</strong> applications</span>
                <span><strong>{ahSummary.players}</strong> players affected</span>
                <span><strong>{ahSummary.downs}</strong> downs</span>
              </div>
            {/if}

            <div class="ds-block">
              <div class="ds-block-title">Exposed stacks <span class="ds-block-hint">{ahPlayers.length} players</span></div>
              <div class="enc-head">
                <span class="enc-cap">#</span><span class="enc-cap"></span><span class="enc-cap">Player</span>
                <span class="enc-cap">Exposed</span><span class="enc-cap">Downs</span>
              </div>
              <div class="enc-rows">
                {#each ahPlayers as p, i}
                  <div class="enc-row">
                    <span class="enc-rank">{i + 1}</span>
                    <img class="enc-icon" src={profIcon(p.profession)} alt={p.profession}
                         onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="enc-name" title={p.account}>{p.name}</span>
                    <span class="enc-num">{p.applications}</span>
                    <span class="enc-num enc-sub">{p.downs}</span>
                  </div>
                {:else}
                  <div class="stat-note">Nobody got Exposed in this fight.</div>
                {/each}
              </div>
            </div>

            <div class="ds-block">
              <div class="ds-block-title">Timeline <span class="ds-block-hint">{ahRows.length} events</span></div>
              <div class="feed">
                {#each ahRows as r}
                  <div class="feed-row ah-row">
                    <span class="feed-time">{fmtTime(r.time)}</span>
                    <img class="enc-icon" src={profIcon(r.profession)} alt={r.profession}
                         onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <span class="feed-name ah-name">
                      <span class="ah-actor">{r.name}</span>
                      {#if r.kind === "exposed"}
                        <span class="ah-kind">got Exposed</span>
                        <img class="ah-icon" src="/mechanics/exposed.png" alt="Exposed" title="Exposed"
                             onerror={(e) => { (e.currentTarget as HTMLElement).style.visibility = 'hidden'; }} />
                        <span class="ah-stacks">{r.stacksBefore} <span class="ah-arrow">→</span> {r.stacks}</span>
                      {:else}
                        <span class="ah-kind">got downed while having {r.stacks} Exposed stack{r.stacks === 1 ? '' : 's'}</span>
                      {/if}
                    </span>
                    {#if r.kind === "exposed" && r.source}
                      <span class="feed-downs">
                        <span class="feed-down ah-source"><span class="feed-down-txt">- {r.source}</span></span>
                      </span>
                    {/if}
                  </div>
                {:else}
                  <div class="stat-note">No Exposed activity recorded.</div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- MECHANICS TABS -->
          {#if mechanics && mechanics.boss === "Cerus" && (activeTab === "shadows" || activeTab === "orbs" || activeTab === "empowered")}
            <CerusDashboard report={mechanics} activeTab={activeTab} singleLog={true} durationSec={stats?.duration_sec ?? 0} />
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .stats-modal-overlay {
    position: fixed; inset: 0; z-index: 1400;
    background: rgba(0,0,0,.58); backdrop-filter: blur(5px);
    display: flex; align-items: center; justify-content: center; padding: 36px;
    animation: fadeIn .15s ease;
  }
  .stats-modal {
    width: min(1240px, 96vw); max-height: 90vh; display: flex; flex-direction: column;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 16px; padding: 20px 22px; box-shadow: 0 24px 70px rgba(0,0,0,.6);
    animation: vl-modal-in .22s cubic-bezier(.2,.9,.3,1.2) both;
  }
  .stats-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .stats-modal-title { font-size: 16px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px; }
  .stats-modal-title i { color: var(--accent); }
  .stats-modal-sub { font-size: 11px; color: var(--text-muted); margin-top: 3px; letter-spacing: .02em; }
  /* Vale Guardian teleports */
  .enc-summary {
    display: flex; flex-wrap: wrap; gap: 6px 18px; margin-bottom: 12px;
    padding: 8px 12px; border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    font-size: 11px; color: var(--text-muted);
  }
  .enc-summary strong { color: #fff; font-variant-numeric: tabular-nums; }
  .enc-head, .enc-row { display: grid; grid-template-columns: 18px 20px minmax(0, 1fr) 52px 40px; align-items: center; gap: 2px 8px; }
  .enc-head { padding: 0 8px 4px; }
  .enc-cap { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); }
  .enc-cap:nth-child(4), .enc-cap:nth-child(5) { text-align: right; }
  .enc-rows { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .enc-row {
    padding: 6px 8px; border-radius: 6px;
    background: color-mix(in srgb, #fff 3%, transparent);
    transition: background-color .14s;
  }
  .enc-row:hover { background: color-mix(in srgb, #fff 6%, transparent); }
  .enc-rank { font-size: 9px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .enc-icon { width: 20px; height: 20px; border-radius: 5px; object-fit: cover; background: #0c0c0f; }
  .enc-name { font-size: 11px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .enc-num { font-size: 12px; font-weight: 800; color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
  .enc-sub { display: block; font-size: 9px; font-weight: 600; color: var(--text-muted); }
  /* Event feeds, mirroring the Defense tab's downs feed */
  .feed { display: flex; flex-direction: column; gap: 3px; }
  .feed-row {
    display: grid; grid-template-columns: 38px 20px minmax(0, 1fr);
    align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px;
    background: color-mix(in srgb, #fff 3%, transparent);
    transition: background-color .14s, transform .18s var(--ease-smooth);
  }
  .feed-row:hover { background: color-mix(in srgb, #fff 6%, transparent); transform: translateX(2px); }
  .feed-time { font-size: 10px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
  .feed-name { font-size: 11px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-cause {
    grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 3px 10px;
    font-size: 10px; color: var(--text-muted);
  }
  .feed-cause span { color: var(--text); }
  .feed-downs {
    grid-column: 1 / -1; display: flex; flex-direction: column; gap: 2px;
    font-size: 10px; color: var(--text-muted);
  }
  .feed-down { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--warn); }
  .feed-down-icon { width: 14px; height: 14px; border-radius: 3px; object-fit: cover; flex: none; background: #0c0c0f; }
  .feed-down-txt { min-width: 0; }
  .feed-down b { color: var(--text); font-weight: 700; }
  .enc-tag { margin-left: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); }
  /* Dhuum CM Ender's Echo holds */
  .pu-grid {
    display: grid; grid-template-columns: 18px 20px minmax(0, 1fr) minmax(40px, 110px) 48px 40px;
    align-items: center; gap: 2px 8px; padding-top: 6px;
  }
  .pu-track {
    position: relative; height: 8px; border-radius: 4px; min-width: 0;
    background: color-mix(in srgb, #fff 5%, transparent); overflow: hidden;
  }
  .pu-fill {
    position: absolute; inset: 0 auto 0 0; border-radius: 4px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 60%, transparent), var(--accent));
  }
  .pu-taken { color: var(--warn); font-size: 11px; }
  .pu-chart { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .pu-lanes { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .pu-lane { display: grid; grid-template-columns: 128px minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0; }
  .pu-lane-name { font-size: 10px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pu-lane-track { position: relative; height: 16px; border-radius: 4px; background: color-mix(in srgb, #fff 3%, transparent); min-width: 0; }
  .pu-seg {
    position: absolute; top: 3px; bottom: 3px; border-radius: 3px; background: var(--success);
    /* A 0.4s hold on a 6-minute fight is otherwise a fraction of a pixel. */
    min-width: 6px;
    transition: filter .12s var(--ease-smooth);
  }
  .pu-seg-dead { background: var(--fail); }
  .pu-seg:hover { filter: brightness(1.35); }
  .pu-axis { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 10px; margin-top: 4px; min-width: 0; }
  .pu-axis-track { position: relative; height: 14px; border-top: 1px solid var(--border); min-width: 0; }
  .pu-tick {
    position: absolute; top: 3px; transform: translateX(-50%);
    font-size: 9px; color: var(--text-muted); font-variant-numeric: tabular-nums;
  }
  .pu-detail { margin-top: 6px; font-size: 10px; font-weight: 600; color: var(--text-muted); min-height: 14px; font-variant-numeric: tabular-nums; }
  .pu-legend {
    display: flex; gap: 14px; margin-top: 4px;
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted);
  }
  .pu-dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; }
  .pu-dot-survived { background: var(--success); }
  .pu-dot-taken { background: var(--fail); }
  /* Statues of Darkness stun overrides */
  .eo-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; min-width: 0; }
  /* One eye selected: let that column use the full width. */
  .eo-cols.eo-single { grid-template-columns: minmax(0, 1fr); }
  .eo-eye-chips { display: flex; gap: 6px; margin-left: auto; flex: none; }
  /* An eye blinking away, interleaved with the CC timeline. */
  .eo-tp {
    grid-column: 2 / -1;
    font-size: 11px; font-weight: 700; color: var(--warn);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .eo-tp-row { opacity: 1; }
  /* Ura Bloodstone shards */
  .ur-row .feed-name { color: #fff; font-weight: 700; }
  .ur-row .ur-kind { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-left: 5px; }
  .ur-icon {
    width: 14px; height: 14px; border-radius: 3px; object-fit: cover;
    vertical-align: -2px; flex: none; margin-left: 5px;
  }
  .ur-sub-icon { width: 14px; height: 14px; margin-left: 0; }
  /* Names inside the sub-lines match the white, bold name on the main row. */
  .ur-sub-name { color: #fff; font-weight: 700; }
  .ur-tag { margin-left: 6px; }
  /* Aetherblade Hideout Exposed */
  .ah-actor { color: #fff; font-weight: 700; }
  .ah-kind { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-left: 5px; }
  .ah-icon {
    width: 14px; height: 14px; border-radius: 3px; object-fit: cover;
    vertical-align: -2px; flex: none; margin-left: 5px;
  }
  .ah-source { color: var(--warn); }
  .ah-stacks { margin-left: 7px; font-size: 10px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
  .ah-arrow { color: var(--accent); margin: 0 2px; }
  .ur-tag-saturated, .ur-tag-warn { color: var(--warn); }
  .ur-tag-wasted { color: var(--fail); }
  .eo-col { min-width: 0; }
  .eo-col-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 8px 4px; font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .07em; color: var(--text-muted);
  }
  .eo-col-head span:last-child { color: #fff; font-variant-numeric: tabular-nums; }
  .eo-rows { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .eo-row {
    display: grid; grid-template-columns: 18px 20px minmax(0, 1fr) 40px;
    align-items: center; gap: 2px 8px; padding: 4px 8px; border-radius: 6px;
    background: color-mix(in srgb, #fff 3%, transparent);
  }
  .eo-empty { padding: 6px 8px; font-size: 10px; color: var(--text-muted); }
  .eo-cc { width: 14px; height: 14px; margin-left: 6px; vertical-align: -2px; }
  .eo-skill { width: 14px; height: 14px; border-radius: 3px; object-fit: cover; flex: none; }
  .eo-unknown { color: var(--text-muted); }
  .eo-unknown i { font-size: 10px; }
  /* Light orb stuns are the intended mechanic, so they sit back and let the
     unwanted CC (daze / fear / knockdown) stand out. */
  .eo-stun { opacity: 0.62; }
  .stats-modal-close {
    background: color-mix(in srgb,#fff 6%,transparent); border: 1px solid var(--border);
    color: var(--text-muted); width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 13px;
    flex-shrink: 0; transition: color .15s, background-color .15s;
  }
  .stats-modal-close:hover { color: #fff; background: color-mix(in srgb,#fff 12%,transparent); }

  .stats-loading, .stats-error { padding: 40px 20px; text-align: center; color: var(--text-muted); display: flex; gap: 12px; align-items: center; justify-content: center; }
  .stats-error { color: #fca5a5; flex-direction: column; }
  .stats-error-title { font-weight: 700; color: #fff; margin-bottom: 4px; }
  .stats-error-msg { font-size: 11px; max-width: 460px; }

  /* ── Body: sidebar + content ── */
  .stats-body { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; }
  .stats-tabs {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    border-bottom: 1px solid var(--border); padding-bottom: 10px;
  }
  .tabs-divider { width: 1px; align-self: stretch; background: var(--border); margin: 2px 4px; }
  .top-tab {
    display: inline-flex; align-items: center; gap: 7px; text-align: center;
    background: transparent; border: 1px solid transparent; color: var(--text-muted);
    font: inherit; font-size: 12px; font-weight: 600;
    padding: 7px 13px; cursor: pointer; border-radius: 999px;
    transition: color .15s, background .15s, border-color .15s;
  }
  .top-tab i { width: 14px; text-align: center; }
  .top-icon { width: 15px; height: 15px; border-radius: 4px; object-fit: cover; }
  .top-tab:hover { color: var(--text); background: color-mix(in srgb,#fff 5%,transparent); }
  .top-tab.active {
    color: #fff; background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent);
    box-shadow: 0 0 10px -2px color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .stats-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; padding-right: 4px; }

  /* ── Personalized scrollbar (premium charcoal / indigo) ── */
  .stats-content::-webkit-scrollbar { width: 10px; height: 10px; }
  .stats-content::-webkit-scrollbar-track { background: color-mix(in srgb, #fff 4%, transparent); border-radius: 8px; }
  .stats-content::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #000));
    border-radius: 8px; border: 2px solid var(--bg-card);
  }
  .stats-content::-webkit-scrollbar-thumb:hover { background: var(--accent); }
  .stats-content { scrollbar-width: thin; scrollbar-color: var(--accent) color-mix(in srgb, #fff 4%, transparent); }

  /* ── Stat cards (charcoal / indigo, responsive wrap) ── */
  .stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
  .stat-card {
    background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; display: flex; flex-direction: column; gap: 3px;
  }
  .stat-val { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: .01em; line-height: 1; font-variant-numeric: tabular-nums; }
  .stat-val .stat-unit { font-size: 14px; font-weight: 700; color: var(--text-muted); margin-left: 1px; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
  .stat-sub { font-size: 10px; color: var(--text-muted); opacity: .8; }
  .accent-cyan { color: #22d3ee; }
  .accent-purple { color: #a78bfa; }
  .accent-gold { color: #fbbf24; }
  .accent-red { color: #f87171; }
  .accent-pink { color: #f472b6; }
  .stat-note {
    font-size: 11px; color: var(--text-muted); background: color-mix(in srgb,#fff 4%,transparent);
    border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px;
  }
  .stat-note b { color: var(--text); }
  .revealed-disclaimer {
    font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid var(--accent); border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;
  }

  /* ── Squad Mechanics table ── */
  .squad-mechanics { background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .sm-title { font-size: 11px; font-weight: 700; color: var(--text); margin-bottom: 8px; letter-spacing: .03em; }
  .sm-table { display: flex; flex-direction: column; gap: 2px; }
  .sm-row { display: grid; grid-template-columns: 1fr 120px 120px 120px; align-items: center;
    padding: 6px 8px; border-radius: 8px; transition: background .12s ease; }
  .sm-row:not(.sm-head):hover { background: color-mix(in srgb, #fff 4%, transparent); }
  .sm-head { background: color-mix(in srgb, #fff 3%, transparent); border: 1px solid var(--border); }
  .sm-num.sm-sort { background: transparent; border: none; cursor: pointer; color: var(--text-muted);
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
    transition: color .15s; padding-right: 6px; display: inline-flex; align-items: center; justify-content: flex-end; }
  .sm-num.sm-sort:hover { color: var(--text); }
  .sm-num.sm-sort.active { color: var(--accent); }
  .sm-cell { font-size: 12px; color: var(--text); }
  .sm-player { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .sm-prof { width: 22px; height: 22px; border-radius: 5px; flex: 0 0 auto; background: #0c0d12; }
  .sm-names { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .sm-toon { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sm-acct { font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sm-num { text-align: right; font-variant-numeric: tabular-nums; padding-right: 6px; }
  .sm-num.sm-warn { color: #f472b6; font-weight: 700; }
  @media (prefers-reduced-motion: reduce) {
    .sm-row { transition: none; }
  }
  .tt-time { font-weight: 800; color: #fff; margin-bottom: 3px; }
  .tt-event { font-weight: 700; font-size: 0.72rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 2px; margin-bottom: 2px; }
  .tt-row { display: flex; align-items: center; gap: 5px; }
  .tt-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .tt-dot.lg-cyan { background: #22d3ee; }
  .tt-dot.lg-purple { background: #a78bfa; }
  .tt-dot.lg-gold { background: #fbbf24; }
  .tt-dot.tt-close { background: #ff7a3c; }

  /* ── Shadows tab (premium drill-down) ── */
  .sh-header { background: color-mix(in srgb, var(--accent) 8%, var(--bg-sidebar)); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
  .sh-head-top { display: flex; align-items: center; gap: 14px; }
  .sh-head-icon { width: 46px; height: 46px; border-radius: 11px; }
  .sh-head-titles { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .sh-head-kicker { font-size: 9px; letter-spacing: .14em; color: var(--text-muted); text-transform: uppercase; }
  .sh-head-title { font-size: 17px; font-weight: 800; letter-spacing: .02em; color: #fff; }
  .sh-head-total { display: flex; flex-direction: column; align-items: flex-end; }
  .sh-head-num { font-size: 26px; font-weight: 800; color: #fff; letter-spacing: .01em; }
  .sh-head-sub { font-size: 9px; letter-spacing: .1em; color: var(--text-muted); text-transform: uppercase; }
  .sh-head-sep { color: var(--text-muted); font-weight: 600; }
  .sh-head-subtle { color: var(--text-muted); }
  .hl-orb { color: #3fa9f5; }
  .hl-shadow { color: #b06bff; }
  .hl-enraged { color: #ff8a3c; }
  .sh-bar.leaked { background: linear-gradient(90deg, color-mix(in srgb, var(--warn) 70%, transparent), var(--warn)); }
  .orb-count { font-size: 14px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
  /* ── Orbs per-phase chart ── */
  .orb-chart { background: color-mix(in srgb, var(--accent) 6%, var(--bg-sidebar)); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .orb-chart-label { font-size: 10px; letter-spacing: .12em; color: color-mix(in srgb, var(--accent) 75%, #fff); text-transform: uppercase; }
  .orb-chart-hint { color: var(--text-muted); text-transform: none; letter-spacing: 0; font-size: 10px; }
  .orb-chart-bars { display: flex; flex-direction: column; gap: 6px; }
  .orb-phase-block { display: flex; flex-direction: column; }
  .orb-bar-row.orb-bar-btn { display: grid; grid-template-columns: 14px 92px 1fr 38px; align-items: center; gap: 10px; font-size: 12px; background: none; border: 0; padding: 4px 2px; margin: 0; cursor: pointer; color: inherit; text-align: left; border-radius: 7px; transition: background .15s ease; }
  .orb-bar-row.orb-bar-btn:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .orb-caret { font-size: 8px; color: var(--text-muted); transition: transform .2s ease; }
  .orb-caret.open { transform: rotate(90deg); color: var(--accent); }
  .orb-bar-name { color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .orb-bar-track { height: 10px; border-radius: 5px; background: color-mix(in srgb, #fff 6%, transparent); overflow: hidden; }
  .orb-bar-fill { height: 100%; border-radius: 5px; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, transparent), var(--accent)); transition: width .35s cubic-bezier(.4,0,.2,1); }
  .orb-bar-val { color: var(--accent); font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
  .orb-phase-detail { padding: 6px 4px 8px 26px; display: flex; flex-direction: column; gap: 7px; border-left: 2px solid color-mix(in srgb, var(--accent) 35%, transparent); margin: 2px 0 4px 6px; }
  .orb-phase-meta { display: flex; gap: 16px; font-size: 11px; color: var(--text-muted); }
  .orb-phase-row { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 9px; font-size: 12px; padding: 2px 6px; border-radius: 6px; transition: background .12s ease; }
  .orb-phase-row:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .orb-phase-list { display: flex; flex-direction: column; gap: 2px; }
  .sh-contrib-label { font-size: 10px; letter-spacing: .12em; color: color-mix(in srgb, var(--accent) 75%, #fff); text-transform: uppercase; border-top: 1px solid var(--border); padding-top: 10px; }
  .sh-contrib { display: flex; flex-direction: column; gap: 5px; }
  .sh-contrib-row { display: grid; grid-template-columns: 18px 20px 1fr auto 120px auto; align-items: center; gap: 10px; font-size: 12px; }
  .orb-outcome-row { grid-template-columns: 18px 1fr; gap: 10px; }
  .orb-outcome-text { display: flex; align-items: baseline; gap: 8px; flex-wrap: nowrap; }
  .orb-outcome-dmg { font-size: 16px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
  .orb-outcome-dmg.warn { color: var(--warn); }
  .sh-rank { font-weight: 800; font-size: 12px; text-align: center; }
  .sh-rank-1 { color: #fbbf24; } .sh-rank-2 { color: #cbd5e1; } .sh-rank-3 { color: #d97706; } .sh-rank-4, .sh-rank-5, .sh-rank-6, .sh-rank-7, .sh-rank-8, .sh-rank-9, .sh-rank-10 { color: var(--text-muted); }
  .sh-contrib-dmg { font-weight: 700; color: #fff; } .sh-contrib-pct { color: color-mix(in srgb, var(--accent) 80%, #fff); font-weight: 600; min-width: 44px; text-align: right; }
  .sh-bar-wrap { height: 6px; background: color-mix(in srgb,#fff 8%,transparent); border-radius: 3px; overflow: hidden; }
  .sh-bar { height: 100%; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff)); border-radius: 3px; transition: width .3s ease; }
  .prof-icon.sm { width: 20px; height: 20px; border-radius: 5px; flex: none; }

  .sh-phases-head { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
  .sh-phases-head > span { font-size: 10px; letter-spacing: .12em; color: var(--text-muted); text-transform: uppercase; }
  .sh-expand-btns { display: flex; gap: 6px; }
  .sh-exp-btn { background: color-mix(in srgb,#fff 6%,transparent); border: 1px solid var(--border); color: var(--text); border-radius: 7px; padding: 4px 9px; font-size: 10px; cursor: pointer; transition: background-color .15s, color .15s; }
  .sh-exp-btn:hover { background: color-mix(in srgb,#fff 12%,transparent); color: #fff; }

  .sh-phases { display: flex; flex-direction: column; gap: 8px; }
  .sh-phase { border: 1px solid var(--border); border-radius: 11px; overflow: hidden; background: color-mix(in srgb,#fff 2%,transparent); }
  .sh-phase-head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: transparent; border: none; color: var(--text); cursor: pointer; text-align: left; transition: background .15s; }
  .sh-phase-head:hover { background: color-mix(in srgb,#fff 5%,transparent); }
  .sh-glyph { width: 34px; height: 34px; border-radius: 9px; }
  .sh-phase-titles { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .sh-phase-kicker { font-size: 9px; letter-spacing: .1em; color: var(--text-muted); text-transform: uppercase; }
  .sh-phase-name { font-size: 14px; font-weight: 800; color: #fff; }
  .sh-phase-num { font-size: 18px; font-weight: 800; color: #fff; }
  .sh-chevron { color: var(--text-muted); font-size: 12px; transition: transform .18s ease; flex: none; } .sh-chevron.sm { font-size: 10px; } .sh-chevron.open { transform: rotate(0); }

  .sh-malices { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
  .sh-malice { background: color-mix(in srgb,#fff 1%,transparent); }
  .sh-malice-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 14px 9px 18px; background: transparent; border: none; color: var(--text); cursor: pointer; text-align: left; transition: background .15s; }
  .sh-malice-head:hover { background: color-mix(in srgb,#fff 4%,transparent); }
  .sh-malice-accent { width: 3px; align-self: stretch; border-radius: 2px; background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #000)); flex: none; }
  .sh-malice-name { flex: 1; font-weight: 700; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  .sh-malice-right { display: flex; flex-direction: column; align-items: flex-end; }
  .sh-malice-label { font-size: 8px; letter-spacing: .1em; color: var(--text-muted); text-transform: uppercase; }
  .sh-malice-num { font-size: 15px; font-weight: 800; color: var(--accent); }

  .sh-players { display: flex; flex-direction: column; padding: 2px 0 8px; background: color-mix(in srgb,#000 25%,transparent); }
  .sh-player { display: grid; grid-template-columns: 16px 20px 1fr auto auto auto; align-items: center; gap: 9px; padding: 6px 16px 6px 34px; font-size: 12px; position: relative; }
  .sh-player-rank { color: var(--text-muted); font-weight: 700; font-size: 11px; text-align: center; }
  .sh-player-name { color: var(--text); font-weight: 600; }
  .sh-player-dmg { font-weight: 700; color: #fff; }
  .sh-player-pct { color: var(--accent); font-weight: 600; min-width: 42px; text-align: right; }
  .sh-badges { display: flex; gap: 5px; }
  .sh-badge { border: 1px solid var(--border); border-radius: 6px; padding: 2px 7px; font-size: 9px; font-weight: 700; letter-spacing: .04em; cursor: pointer; transition: background-color .15s, color .15s, border-color .15s; color: var(--text); background: color-mix(in srgb,#fff 5%,transparent); }
  .sh-badge-cc { color: #67e8f9; border-color: color-mix(in srgb,#67e8f9 35%,transparent); }
  .sh-badge-cc:disabled { opacity: .4; cursor: not-allowed; }
  .sh-badge-dmg { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff)); color: #fff; border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .sh-badge-dmg:hover, .sh-badge-dmg.active { background: linear-gradient(90deg, var(--accent-h), color-mix(in srgb, var(--accent) 72%, #fff)); color: #fff; box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 30%, transparent); }
  .sh-badge-detail { grid-column: 1 / -1; margin: 4px 0 2px; padding: 8px 10px; background: color-mix(in srgb,#a78bfa 8%,transparent); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 3px; }
  .sh-detail-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--text); }
  .sh-detail-row.muted { color: var(--text-muted); font-style: italic; font-size: 10px; }
  .sh-skill-list { display: flex; flex-direction: column; gap: 4px; margin-top: 5px; padding-top: 6px; border-top: 1px solid color-mix(in srgb,#fff 6%,transparent); }
  .sh-skill-row { display: grid; grid-template-columns: 16px 1fr 64px 60px 38px; align-items: center; gap: 8px; font-size: 10.5px; }
  .sh-skill-icon { width: 16px; height: 16px; border-radius: 3px; object-fit: cover; background: color-mix(in srgb,#fff 10%,transparent); flex: 0 0 auto; }
  .sh-skill-icon-empty { display: inline-block; }
  .sh-skill-name { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sh-skill-bar-wrap { height: 5px; background: color-mix(in srgb,#fff 8%,transparent); border-radius: 3px; overflow: hidden; }
  .sh-skill-bar { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff)); border-radius: 3px; }
  .sh-skill-dmg { font-weight: 700; color: #fff; text-align: right; }
  .sh-skill-pct { color: var(--accent); font-weight: 600; text-align: right; }

  /* ── Toolbar / boon picker ── */
  .stats-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; position: relative; }
  .stats-hint { font-size: 9px; color: var(--text-muted); font-style: italic; opacity: .8; }
  .stats-boon-toggle {
    margin-left: auto; background: color-mix(in srgb,#fff 6%,transparent); border: 1px solid var(--border);
    color: var(--text); border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; transition: background-color .15s, color .15s;
  }
  .stats-boon-toggle:hover { background: color-mix(in srgb,#fff 12%,transparent); color: #fff; }
  .stats-boon-picker {
    position: absolute; top: 34px; right: 0; z-index: 5; width: 200px;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px; box-shadow: 0 16px 40px rgba(0,0,0,.5);
    max-height: 240px; overflow-y: auto;
  }
  .stats-boon-opt { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text); cursor: pointer; }
  .stats-boon-opt img { width: 16px; height: 16px; }

  /* ── Boon Uptime table card ── */
  .stats-scroll {
    overflow: auto; flex: 1; background: var(--bg-panel);
    border: 1px solid var(--border); border-radius: var(--radius);
    transition: border-color .18s var(--ease-smooth), box-shadow .18s var(--ease-smooth);
  }
  .stats-scroll:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .stats-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 12px; }
  .stats-table thead th {
    position: sticky; top: 0; z-index: 2; background: var(--bg-panel); color: var(--text-muted);
    text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  .stats-table th.col-player { text-align: left; }
  .stats-table th.col-boon { text-align: center; }
  .th-sort {
    background: none; border: none; cursor: pointer; padding: 0; font: inherit;
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
    color: var(--text-muted); transition: color .15s;
  }
  .th-sort:hover { color: var(--text); }
  .col-num { text-align: right; }
  .col-boon { text-align: center; }
  .boon-hd-icon { width: 16px; height: 16px; vertical-align: middle; margin-right: 4px; }
  .boon-hd-label {
    vertical-align: middle; font-size: 9px; font-weight: 800;
    text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted);
  }

  .resizer { position: absolute; right: 0; top: 0; width: 6px; height: 100%; cursor: col-resize; border: 0; padding: 0; background: transparent; user-select: none; }
  .resizer:hover { background: color-mix(in srgb, var(--accent) 50%, transparent); }

  .stats-table tbody td {
    padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    color: var(--text); text-align: right; white-space: nowrap; font-size: 11px;
    transition: background-color .14s;
  }
  .stats-table tbody td.col-player { text-align: left; }
  /* No translateX here: a shifted row extends the scrollable overflow area and
     summons a horizontal scrollbar with nothing to scroll to. */
  .stats-table tbody tr:not(.subtotal-row):not(.total-row):hover td { background: color-mix(in srgb, #fff 5%, transparent); }
  .player-cell { display: flex; align-items: center; gap: 8px; }
  .prof-icon { width: 20px; height: 20px; border-radius: 5px; background: #0c0c0f; flex-shrink: 0; }
  .player-names { display: flex; flex-direction: column; line-height: 1.15; }
  .toon { font-size: 11px; font-weight: 600; color: var(--text); }
  .account { font-size: 9px; font-style: italic; color: var(--text-muted); }
  .sub-badge {
    margin-left: auto; flex-shrink: 0; font-size: 9px; font-weight: 700; letter-spacing: .03em;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 5px; padding: 2px 6px; white-space: nowrap;
  }
  .boon-val { font-weight: 600; font-variant-numeric: tabular-nums; }
  .boon-val .pct { font-size: 9px; color: var(--text-muted); margin-left: 1px; }
  .boon-empty { color: var(--text-muted); opacity: .4; }

  .subtotal-row td { background: color-mix(in srgb, var(--accent) 8%, transparent); font-weight: 600; color: #fff; border-top: 1px solid var(--border); }
  .subtotal-label { color: var(--accent); font-weight: 700; }
  .total-row td { background: color-mix(in srgb, #fff 7%, transparent); font-weight: 800; color: #fff; border-top: 1px solid var(--border); }
  .total-label { font-weight: 800; }

  .stats-targets { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
  .targets-toggle {
    display: flex; align-items: center; gap: 6px;
    background: transparent; border: none; padding: 2px 0; cursor: pointer;
    color: var(--text-muted); font-size: 11px; font-family: inherit;
  }
  .targets-toggle:hover { color: var(--text); }
  .targets-chevron { font-size: 9px; transition: transform 0.15s ease; color: var(--accent, #6366f1); display: inline-block; }
  .targets-chevron.open { transform: rotate(90deg); }
  .targets-label { font-size: 11px; color: inherit; }
  .target-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .target-chip { font-size: 10px; color: var(--text); background: color-mix(in srgb,#fff 5%,transparent); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; }
  .target-chip b { color: #fff; }

  @media (prefers-reduced-motion: reduce) {
    .stats-modal { animation: none !important; }
    .ax-hero-card, .ax-runner-card, .ax-panel, .ax-boon-row, .ds-block, .ax-row, .ax-death-row, .ax-downrecap-row,
    .stats-scroll, .th-sort, .sg-collapse, .targets-chevron, .pu-seg {
      transition: none !important;
      transform: none !important;
    }
  }

  /* ── Mechanic tab summaries (charcoal cards, indigo accent) ── */
  .mech-body { display: flex; flex-direction: column; gap: 12px; }
  .mech-summary { display: flex; gap: 10px; flex-wrap: wrap; }
  .mech-stat {
    flex: 1 1 0; min-width: 120px;
    background: var(--bg-sidebar); border: 1px solid var(--border);
    border-radius: 10px; padding: 10px 14px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .mech-stat-val { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: .01em; }
  .mech-stat-val.warn { color: var(--warn); }
  .mech-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
  .mech-scroll { max-height: 46vh; }

  /* ── Empowered tab — MA-style phase cards ── */
  .emp-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  @media (max-width: 720px) { .emp-cards { grid-template-columns: 1fr; } }
  .emp-card {
    background: color-mix(in srgb, var(--accent) 5%, var(--bg-sidebar));
    border: 1px solid var(--border); border-radius: 12px;
    display: flex; flex-direction: column; overflow: hidden;
    transition: border-color .14s ease, transform .14s ease, box-shadow .14s ease;
  }
  .emp-card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); box-shadow: 0 4px 18px color-mix(in srgb, #000 40%, transparent); }
  .emp-card.final { border-color: color-mix(in srgb, #ff7a3c 35%, var(--border)); }
  .emp-card-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
    width: 100%; text-align: left; background: none; border: none; cursor: pointer;
    padding: 14px 16px 12px; color: var(--text);
    border-bottom: 1px solid color-mix(in srgb, #fff 7%, transparent);
  }
  .emp-card-titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .emp-card-kicker { font-size: 9px; letter-spacing: .08em; color: var(--text-muted); text-transform: uppercase; }
  .emp-card-name { font-size: 16px; font-weight: 800; color: #fff; }
  .emp-flame { width: 14px; height: 14px; margin-right: 4px; display: inline-block; vertical-align: -1px; object-fit: contain; }
  .emp-card-total { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
  .emp-card-tlabel { font-size: 8px; letter-spacing: .08em; color: var(--text-muted); }
  .emp-card-tnum { font-size: 22px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
  .emp-card-cerus { width: 22px; height: 22px; border-radius: 6px; margin-top: 2px; opacity: .9; }
  .emp-card-body { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 8px; }
  .emp-stacks-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .emp-stacks-label { font-size: 11px; color: var(--text-muted); }
  .emp-stacks-val { font-size: 14px; font-weight: 800; color: #c08bff; letter-spacing: .02em; }
  .emp-sources { display: flex; flex-direction: column; gap: 5px; }
  .emp-no-src { font-size: 11px; font-style: italic; color: var(--text-muted); padding: 2px 0; }
  .emp-source { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 8px; font-size: 12px; }
  .emp-source-label { color: var(--text); }
  .emp-source-val { display: inline-flex; align-items: center; gap: 7px; }
  .emp-count { color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }
  .emp-source-sub { color: var(--text-muted); font-weight: 500; }
  .emp-stack-badge {
    font-size: 10.5px; font-weight: 800; color: #fff;
    border-radius: 5px; padding: 1px 7px; font-variant-numeric: tabular-nums;
    letter-spacing: .02em; white-space: nowrap;
  }
  .badge-orb   { background: color-mix(in srgb, #3fa9f5 30%, #000 55%); border: 1px solid color-mix(in srgb, #3fa9f5 55%, transparent); }
  .badge-shadow{ background: color-mix(in srgb, #b06bff 30%, #000 55%); border: 1px solid color-mix(in srgb, #b06bff 55%, transparent); }
  .badge-slam  { background: color-mix(in srgb, #ff8a3c 30%, #000 55%); border: 1px solid color-mix(in srgb, #ff8a3c 55%, transparent); }
  .badge-rage  { background: color-mix(in srgb, #ffb27a 30%, #000 55%); border: 1px solid color-mix(in srgb, #ffb27a 55%, transparent); }
  .dot-orb { background: #3fa9f5; box-shadow: 0 0 6px #3fa9f588; }
  .dot-shadow { background: #b06bff; box-shadow: 0 0 6px #b06bff88; }
  .dot-slam { background: #ff8a3c; box-shadow: 0 0 6px #ff8a3c88; }
  .dot-rage { background: #ffb27a; box-shadow: 0 0 6px #ffb27a88; }
  .emp-tl-btn {
    width: 100%; text-align: center; background: color-mix(in srgb, var(--accent) 8%, transparent);
    border: none; border-top: 1px solid var(--border); color: var(--text-muted);
    font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 8px; cursor: pointer;
    transition: background .14s ease, color .14s ease;
  }
  .emp-tl-btn:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); color: #fff; }
  .emp-timeline { padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
  .emp-tl-row { display: grid; grid-template-columns: 36px 12px auto 1fr auto; align-items: center; gap: 8px; font-size: 11px; padding: 3px 6px; border-radius: 6px; transition: background .1s ease; }
  .emp-tl-row:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .emp-tl-time { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 10px; }
  .emp-tl-dot { width: 8px; height: 8px; border-radius: 50%; }
  .emp-tl-label { color: var(--text); font-weight: 600; white-space: nowrap; }
  .emp-tl-detail { color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .emp-tl-stacks { font-weight: 800; font-variant-numeric: tabular-nums; }

  /* ── Dev phase inspector (only visible in DEV builds) ── */
  .dev-phase-inspector { padding: 10px 12px 14px; }
  .dev-phase-panel {
    background: color-mix(in srgb, #000 18%, transparent);
    border: 1px solid color-mix(in srgb, #ff3b3b55, transparent);
    border-radius: 12px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dev-phase-heading {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .08em;
    color: #ff8a8a;
    text-transform: uppercase;
  }
  .dev-phase-input {
    width: 100%;
    background: #0c0c11;
    color: #fff;
    border: 1px solid #2a2a33;
    border-radius: 8px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }
  .dev-phase-input:focus { border-color: #ff5b5b; }
  .dev-phase-btn {
    align-self: flex-start;
    background: color-mix(in srgb, #ff5b5b 18%, transparent);
    color: #ffcccc;
    border: 1px solid color-mix(in srgb, #ff5b5b 45%, transparent);
    border-radius: 8px;
    padding: 6px 10px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  .dev-phase-btn:disabled { opacity: .7; cursor: not-allowed; }
  .dev-phase-error { color: #ff9b9b; font-size: 11px; }
  .dev-phase-meta { color: #cfcfcf; font-size: 11px; }
  .dev-phase-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
  .dev-phase-table th { text-align: left; color: #8a8a9a; font-weight: 700; padding: 6px 8px; border-bottom: 1px solid #2a2a33; white-space: nowrap; }
  .dev-phase-table td { padding: 6px 8px; border-bottom: 1px solid #1f1f28; color: #e8e8ef; white-space: nowrap; }
  .dev-phase-table tr.dev-phase-failed td { color: #ffb6b6; }
  .dev-phase-empty { color: #8a8a9a; font-style: italic; }

  /* ── Boon uptime color thresholds (subtle green→red) ── */
  .boon-good { color: #6ee7a8; }
  .boon-ok   { color: #c4e86a; }
  .boon-warn { color: #fcd34d; }
  .boon-bad  { color: #f08888; }

  /* ── Subgroup filter chips + per-group collapse ── */
  .subgroup-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .phase-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 8px; }
  .phase-chip {
    font-size: 10px; font-weight: 700; letter-spacing: .03em; font-family: inherit;
    color: var(--text-muted); background: color-mix(in srgb,#fff 5%,transparent);
    border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; cursor: pointer;
    transition: background-color .14s, color .14s, border-color .14s;
  }
  .phase-chip:hover { color: var(--text); }
  .phase-chip.active {
    color: #fff; background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .phase-brk {
    display: inline-flex; align-items: center; gap: 4px; margin-left: 4px;
    font-size: 10px; font-weight: 700; letter-spacing: .03em; color: var(--text-muted);
    cursor: pointer; user-select: none;
  }
  .phase-fallback {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 8px; font-size: 11px; color: var(--text-muted);
  }
  .phase-fallback-note { font-style: italic; }
  .phase-parse {
    font-size: 10px; font-weight: 700; letter-spacing: .03em; font-family: inherit;
    color: #fff; background: color-mix(in srgb, var(--accent) 22%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: 6px; padding: 3px 8px; cursor: pointer;
  }
  .phase-parse:disabled { opacity: .6; cursor: default; }
  .stat-phase-note { margin: 8px 0 0; font-size: 11px; color: var(--text-muted); }
  .stat-phase-note b { color: var(--text); }

  /* ── Defense / Support tabs ── */
  .ds-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ds-rate {
    display: inline-flex; align-items: center; gap: 4px; margin-left: auto;
    font-size: 10px; font-weight: 700; letter-spacing: .03em; color: var(--text-muted);
    cursor: pointer; user-select: none;
  }
  /* ── MVP hero + runner-up cards ── */
  .ax-heroes { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; }
  .ax-hero-card {
    background: var(--bg-panel); border: 1px solid var(--border);
    border-top: 2px solid var(--gold); border-radius: var(--radius);
    padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
    transition: transform .18s var(--ease-smooth), border-color .18s, box-shadow .18s;
  }
  .ax-hero-card.gold { border-color: color-mix(in srgb, var(--gold) 55%, var(--border)); }
  .ax-hero-card:hover {
    transform: translateY(-2px);
    border-color: var(--gold);
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .ax-hero-pill {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 5px;
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em;
    padding: 3px 8px; border-radius: 6px;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .ax-hero-pill.gold {
    color: var(--gold); background: color-mix(in srgb, var(--gold) 14%, transparent);
    border-color: color-mix(in srgb, var(--gold) 40%, transparent);
  }
  .ax-hero-main { display: flex; align-items: center; gap: 10px; }
  .ax-hero-crown {
    display: grid; place-items: center; width: 34px; height: 34px; flex: none;
    border-radius: 9px; font-size: 15px; color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .ax-hero-crown.gold {
    color: var(--gold); background: color-mix(in srgb, var(--gold) 14%, transparent);
    border-color: color-mix(in srgb, var(--gold) 38%, transparent);
  }
  .ax-hero-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ax-hero-name {
    font-size: 16px; font-weight: 800; color: #fff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ax-hero-prof { font-size: 10px; color: var(--text-muted); }
  .ax-hero-score { margin-left: auto; text-align: right; flex: none; }
  .ax-hero-score b { display: block; font-size: 20px; font-weight: 800; color: var(--accent); line-height: 1; font-variant-numeric: tabular-nums; }
  .ax-hero-score span { font-size: 8px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
  .ax-hero-quote { font-size: 11px; font-style: italic; color: var(--text-muted); }
  .ax-hero-row {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 11px; padding: 5px 8px; border-radius: 6px;
    background: color-mix(in srgb, #fff 3%, transparent);
  }
  .ax-hero-row span { color: var(--text-muted); }
  .ax-hero-row b { color: var(--text); font-variant-numeric: tabular-nums; }

  .ax-runner-card {
    background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 12px; display: flex; flex-direction: column; gap: 6px;
    transition: transform .18s var(--ease-smooth), border-color .18s, box-shadow .18s;
  }
  .ax-runner-card.silver { border-color: color-mix(in srgb, var(--silver) 50%, var(--border)); }
  .ax-runner-card.bronze { border-color: color-mix(in srgb, var(--bronze) 50%, var(--border)); }
  .ax-runner-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .ax-runner-card.silver:hover { border-color: var(--silver); }
  .ax-runner-card.bronze:hover { border-color: var(--bronze); }
  .ax-runner-top { display: flex; align-items: center; justify-content: space-between; }
  .ax-runner-tier {
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em;
    padding: 2px 6px; border-radius: 5px;
  }
  .ax-runner-tier.silver { color: var(--silver); background: color-mix(in srgb, var(--silver) 14%, transparent); }
  .ax-runner-tier.bronze { color: var(--bronze); background: color-mix(in srgb, var(--bronze) 14%, transparent); }
  .ax-runner-top b { font-size: 16px; color: #fff; font-variant-numeric: tabular-nums; }
  .ax-runner-name {
    display: flex; align-items: center; gap: 6px;
    font-size: 13px; font-weight: 700; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ax-runner-crown { font-size: 11px; flex: none; }
  .ax-runner-crown.silver { color: var(--silver); }
  .ax-runner-crown.bronze { color: var(--bronze); }
  .ax-runner-prof { font-size: 10px; color: var(--text-muted); margin-top: -3px; }
  .ax-runner-row { display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: var(--text-muted); }
  .ax-runner-row b { color: var(--text); font-variant-numeric: tabular-nums; }

  /* ── Metric panels ── */
  .ax-panels {
    display: grid; gap: 10px;
    /* auto-fit collapses the tracks of hidden panels so the survivors stretch. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  }
  .ax-panel {
    background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; min-width: 0;
    transition: transform .18s var(--ease-smooth), border-color .18s, box-shadow .18s;
  }
  .ax-panel:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .ax-panel-head { display: flex; align-items: center; gap: 6px; color: var(--accent); }
  .ax-panel-head i { font-size: 11px; }
  .ax-panel-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); }
  .ax-panel-total { font-size: 22px; font-weight: 800; color: #fff; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .ax-panel-top {
    font-size: 11px; font-weight: 700; color: var(--accent);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ax-panel-hint { font-size: 9px; color: var(--text-muted); opacity: .8; margin-bottom: 6px; }
  .ax-panel-rows { display: flex; flex-direction: column; gap: 1px; }
  .ax-row {
    display: grid; grid-template-columns: 16px 16px 1fr auto 10px; align-items: center;
    gap: 5px; padding: 2px 4px; border-radius: 4px;
    transition: background-color .14s, transform .18s var(--ease-smooth);
  }
  .ax-row:hover { background: color-mix(in srgb, #fff 5%, transparent); transform: translateX(2px); }
  .ax-row-rank { font-size: 9px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .ax-row-icon { width: 14px; height: 14px; border-radius: 4px; object-fit: cover; background: #0c0c0f; }
  .ax-row-name { font-size: 10px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ax-row-val { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .ax-row-bar {
    position: relative; width: 3px; height: 18px; border-radius: 2px;
    background: color-mix(in srgb, #fff 7%, transparent); overflow: hidden;
  }
  .ax-row-bar i {
    position: absolute; bottom: 0; left: 0; right: 0; display: block;
    background: var(--accent); border-radius: 2px;
    transition: height .5s var(--ease-smooth);
  }

  .ds-block {
    background: var(--bg-panel); border: 1px solid var(--border); border-left: 2px solid var(--accent);
    border-radius: 10px; padding: 12px 14px;
    transition: transform .18s var(--ease-smooth), border-color .18s, box-shadow .18s;
  }
  .ds-block:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .ds-block-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
    color: var(--text); margin-bottom: 10px;
  }
  .ds-block-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--text-muted); }
  .ds-legend {
    display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 8px;
    font-size: 10px; color: var(--text-muted);
  }
  .ds-legend span { display: inline-flex; align-items: center; gap: 5px; }

  .ds-heat { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; }
  .ds-heat th {
    text-align: right; font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--text-muted); font-weight: 700; padding: 4px 6px;
  }
  .ds-heat th:first-child { text-align: left; }
  .ds-heat-row { cursor: pointer; }
  .ds-heat-row td { padding: 4px 6px; border-top: 1px solid var(--border); transition: background-color .14s; }
  .ds-heat-row:hover td { background: color-mix(in srgb, #fff 4%, transparent); }
  .ds-heat-row.open td { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .ds-heat-name { display: flex; align-items: center; gap: 6px; color: var(--text); }
  .ds-heat-name .prof-icon { width: 16px; height: 16px; border-radius: 4px; }
  .ds-heat-cell { text-align: right; font-variant-numeric: tabular-nums; color: var(--text); }
  .ds-detail-row td { padding: 0 6px 8px; }
  .ds-detail {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
    gap: 10px 12px; padding: 10px 2px 6px;
  }
  .ds-detail-item { display: flex; flex-direction: column; gap: 2px; }
  .ds-detail-label { font-size: 10px; color: var(--text-muted); }
  .ds-detail-item b { font-size: 13px; color: var(--text); font-variant-numeric: tabular-nums; }

  /* ── Down recap ── */
  .ax-downrecap { display: flex; gap: 14px; align-items: flex-start; }
  .ax-downrecap-icon { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 76px; flex: none; }
  .ax-downrecap-icon img { width: 60px; height: 60px; border-radius: 12px; object-fit: cover; border: 1px solid var(--border); }
  .ax-downrecap-icon span { font-size: 10px; color: var(--text-muted); text-align: center; line-height: 1.25; }
  .ax-downrecap-body { flex: 1; min-width: 0; }
  .ax-downrecap-row {
    display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 1px 12px; padding: 5px 6px; border-radius: 6px;
    transition: background-color .14s;
  }
  .ax-downrecap-row:hover { background: color-mix(in srgb, #fff 4%, transparent); }
  .ax-downrecap-name { font-size: 12px; font-weight: 700; color: var(--text); }
  .ax-downrecap-val { grid-column: 1; font-size: 10px; color: var(--text-muted); }
  .ax-downrecap-dmg { grid-column: 2; grid-row: 1 / span 2; font-size: 11px; font-weight: 700; color: var(--fail); font-variant-numeric: tabular-nums; }

  /* ── Death feed ── */
  .ax-death-feed { display: flex; flex-direction: column; gap: 3px; }
  .ax-death-row {
    display: grid; grid-template-columns: 38px 16px 1fr; align-items: center;
    gap: 6px; padding: 4px 8px; border-radius: 6px;
    background: color-mix(in srgb, #fff 3%, transparent);
    transition: background-color .14s, transform .18s var(--ease-smooth);
  }
  .ax-death-row:hover { background: color-mix(in srgb, #fff 6%, transparent); transform: translateX(2px); }
  .ax-death-time { font-size: 10px; font-weight: 700; color: var(--fail); font-variant-numeric: tabular-nums; }
  .ax-death-time-down { color: var(--warn); }
  .ax-death-name { font-size: 11px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ax-death-cause {
    grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 3px 10px;
    font-size: 10px; color: var(--text-muted);
  }
  .ax-death-cause span { color: var(--text); font-variant-numeric: tabular-nums; }
  .ax-death-cond { color: var(--warn); }

  /* ── Support: boons generated + detail table ── */
  .ax-boon-rows { display: flex; flex-direction: column; gap: 4px; }
  .ax-boon-row {
    display: grid; grid-template-columns: 16px 16px 1fr auto; align-items: center;
    gap: 6px; padding: 5px 8px; border-radius: 6px;
    background: color-mix(in srgb, #fff 3%, transparent);
    transition: background-color .14s, transform .18s var(--ease-smooth), box-shadow .18s;
  }
  .ax-boon-row:hover {
    background: color-mix(in srgb, #fff 6%, transparent);
    transform: translateX(2px);
    box-shadow: 0 4px 12px -8px rgba(0, 0, 0, .8);
  }
  .ax-boon-name { font-size: 11px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ax-boon-total { font-size: 11px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
  .ax-boon-list { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; }
  .ax-boon-chip {
    font-size: 9px; padding: 2px 6px; border-radius: 5px;
    color: var(--text-muted); background: color-mix(in srgb, #fff 5%, transparent);
    border: 1px solid var(--border); font-variant-numeric: tabular-nums;
  }
  .ax-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; }
  .ax-table th {
    text-align: right; font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--text-muted); font-weight: 700; padding: 4px 6px;
  }
  .ax-table th:nth-child(2) { text-align: left; }
  .ax-table td { padding: 5px 6px; border-top: 1px solid var(--border); text-align: right; font-variant-numeric: tabular-nums; color: var(--text); }
  .ax-table-rank { color: var(--text-muted) !important; }
  .ax-table-score { color: var(--accent) !important; font-weight: 700; }
  .ax-table-name { display: flex; align-items: center; gap: 6px; text-align: left !important; }
  .ax-table .ax-row-icon { width: 16px; height: 16px; }
  .sg-chip {
    font-size: 10px; font-weight: 700; letter-spacing: .03em; font-family: inherit;
    color: var(--text-muted); background: color-mix(in srgb,#fff 5%,transparent);
    border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; cursor: pointer;
    transition: background-color .14s, color .14s;
  }
  .sg-chip:hover { color: var(--text); }
  .sg-chip.active {
    color: #fff; background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .sg-collapse {
    margin-right: 6px; cursor: pointer; color: var(--accent); font-size: 9px;
    background: none; border: none; padding: 0; display: inline-block;
    transition: transform .15s ease; vertical-align: middle;
  }
  .sg-collapse.open { transform: rotate(90deg); }
</style>