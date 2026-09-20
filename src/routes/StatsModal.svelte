<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { extractMechanics, type MechanicReport } from "$lib/mechanicParser";
  import { fmt, fmtPct, fmtTime } from "$lib/format";
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

  let { permalink, bossName = "", localPath, onClose }: {
    permalink: string;
    bossName?: string;
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
  type Tab = "statistics" | "boon" | "revealed" | "shadows" | "orbs" | "empowered";
  let activeTab = $state<Tab>("statistics");
  let openOrbPhase = $state<string | null>(null); // Orbs tab: expanded per-phase leaderboard

  // Revealed feature flag: hide the tab + table until the feature is complete.
  let revealFeatureReady = $state(false);

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

  // Players sorted by the active sort key (default DPS desc).
  let sortedPlayers = $derived.by(() => {
    if (!stats) return [];
    const arr = [...stats.players];
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
    for (const p of stats.players) {
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

  // Module-level guard so a re-triggered effect (or double-open) can't stack
  // concurrent fetches to dps.report — on a flaky WiFi link a burst of large
  // (30MB+) responses can saturate the link and drop the connection.
  let inflight: Promise<unknown> | null = null;
  $effect(() => {
    if (!permalink && !localPath) return;
    if (inflight) return;
    loading = true; error = null; stats = null; mechanics = null;
    activeTab = "statistics";
    inflight = (async () => {
      try {
        let res: LogFull;
        if (permalink) {
          res = await invoke("get_log_full", { permalink }) as LogFull;
        } else if (localPath) {
          res = await invoke("get_local_log_full", { filePath: localPath }) as LogFull;
        } else {
          return;
        }
        stats = res.stats;
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
                  const skillMap: Record<string, { name?: string }> =
                    ((res as any)?.raw?.skillMap as Record<string, { name?: string }>) || {};
                  const skillName =
                    typeof src.skill_id === "number" && src.skill_id > 0
                      ? skillMap["s" + src.skill_id]?.name || ""
                      : "";
                  const source = [skillName]
                    .filter(Boolean)
                    .join(" | ");
                  const fallback =
                    skillName
                      ? ev.source
                      : `${ev.source}${typeof src.skill_id === "number" && src.skill_id > 0 ? ` (skill:${src.skill_id})` : ""}`;
                  return {
                    ...ev,
                    source: source || fallback,
                    sourceId: src.skill_id ?? ev.sourceId,
                  };
                }),
              };
            }
          } catch (e: any) {
            console.warn("[Revealed] local parse failed:", e?.message || e);
          }
        } else {
          console.warn("[Revealed] local merge skipped; localPath=", localPath, "mech=", mech ? "yes" : "no");
        }
        mechanics = mech;
        // Non-Cerus fights only get the Boon Uptime tab — skip Statistics.
        // Harvest Temple defaults to Revealed if break data is present.
        const isHT = mechanics && /harvest temple/i.test(res.stats.boss_name);
        activeTab = (mechanics && mechanics.boss === "Cerus")
          ? "statistics"
          : (isHT && revealFeatureReady && (mechanics?.revealedBreakers.length ?? 0) > 0 ? "revealed" : "boon");
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
        </nav>

        <!-- ── Content ── -->
        <div class="stats-content">
          {#if activeTab === "statistics"}
            <!-- STATISTICS -->
            {#if mechanics && mechanics.boss === "Cerus"}
              <CerusDashboard report={mechanics} activeTab="statistics" singleLog={true} durationSec={stats?.duration_sec ?? 0} />
            {:else}
              <!-- Generic combat summary (non-Cerus) -->
              <div class="stat-cards">
                <div class="stat-card">
                  <span class="stat-val">{fmt(mechanics ? mechanics.summary.totalDps : (stats ? stats.total_dps : 0))}</span>
                  <span class="stat-label">Total DPS</span>
                </div>
                <div class="stat-card">
                  <span class="stat-val">{fmt(stats ? stats.duration_sec : 0)}<span class="stat-unit">s</span></span>
                  <span class="stat-label">Fight Duration</span>
                </div>
                <div class="stat-card">
                  <span class="stat-val">{stats ? stats.players.length : 0}</span>
                  <span class="stat-label">Players</span>
                </div>
                <div class="stat-card">
                  <span class="stat-val">{fmtPct(mechanics ? mechanics.summary.avgBoonPct : 0)}<span class="stat-unit">%</span></span>
                  <span class="stat-label">Avg Boon Uptime</span>
                </div>
              </div>
              <div class="stat-note">No encounter-specific mechanics for this boss. See <b>Boon Uptime</b> for the per-player table.</div>
            {/if}

          {:else if activeTab === "revealed"}
                <!-- REVEALED (Harvest Temple) -->
                {#if revealFeatureReady}
                  {#if !mechanics || mechanics.revealedBreakers.length === 0}
                    <div class="stat-note">No Revealed breaks detected for this log.</div>
                  {:else}
                    <div class="revealed-wrap">
                      <table class="revealed-table">
                        <thead>
                          <tr>
                            <th class="col-player-reveal">Player</th>
                            <th class="col-time-reveal">Revealed</th>
                            <th class="col-phase-reveal">Phase</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each mechanics.revealedBreakers as r}
                            <tr>
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
                              <td class="col-phase-reveal">{r.phaseName}</td>
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

  /* ── Timeline chart ── */
  .timeline { background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .timeline-title { font-size: 11px; font-weight: 700; color: var(--text); margin-bottom: 6px; letter-spacing: .03em; }
  .timeline-chart-wrap { position: relative; }
  .timeline-svg { width: 100%; height: 220px; display: block; }
  .tl-grid { stroke: color-mix(in srgb, var(--border) 60%, transparent); stroke-width: 1.2; }
  .tl-axis { fill: var(--text-muted); font-size: 9px; }
  .tl-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .tl-cyan { stroke: #22d3ee; }
  .tl-purple { stroke: #a78bfa; }
  .tl-gold { stroke: #fbbf24; }
  .tl-hover-line { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 3; opacity: 0.65; }
  /* Event dots: HTML overlay => always circular (SVG stretched via preserveAspectRatio="none" would oval them) */
  .tl-dots { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
  .tl-dot {
    position: absolute; width: 9px; height: 9px; border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 1.5px solid #050403; box-shadow: 0 0 0 1px rgba(0,0,0,.4);
    transition: transform .12s ease, box-shadow .12s ease;
  }
  /* emphasized hovered dot (CSS :hover can't fire — dots are pointer-events:none) */
  .tl-dot.active {
    transform: translate(-50%, -50%) scale(1.7);
    box-shadow: 0 0 0 2px #fff, 0 0 8px 1px currentColor;
  }
  .timeline-legend { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
  .lg { font-size: 10px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }
  .lg::before { content: ""; width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  .lg-cyan::before { background: #22d3ee; }
  .lg-purple::before { background: #a78bfa; }
  .lg-gold::before { background: #fbbf24; }
  .timeline-tip {
    position: absolute; transform: translateY(-50%);
    background: #101015; border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 9px; font-size: 10px; color: var(--text); pointer-events: none;
    box-shadow: 0 8px 22px rgba(0,0,0,.5); white-space: nowrap; z-index: 5;
    max-width: 220px;
    transition: opacity 0.15s ease-out;
  }
  /* place beside the dot, never on top of it; flip near the right edge */
  .timeline-tip.right { transform: translate(14px, -50%); }
  .timeline-tip.left  { transform: translate(calc(-100% - 14px), -50%); }

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
    .sm-row, .tl-dot { transition: none; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .timeline-tip { transition: top 0.12s var(--ease-spring), left 0.12s var(--ease-spring), opacity 0.15s ease-out; }
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
  .stats-hint { font-size: 10px; color: var(--text-muted); font-style: italic; }
  .stats-boon-toggle {
    margin-left: auto; background: color-mix(in srgb,#fff 6%,transparent); border: 1px solid var(--border);
    color: var(--text); border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; transition: background-color .15s, color .15s;
  }
  .stats-boon-toggle:hover { background: color-mix(in srgb,#fff 12%,transparent); color: #fff; }
  .stats-boon-picker {
    position: absolute; top: 34px; right: 0; z-index: 5; width: 200px;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 10px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px; box-shadow: 0 16px 40px rgba(0,0,0,.5);
    max-height: 240px; overflow-y: auto;
  }
  .stats-boon-opt { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text); cursor: pointer; }
  .stats-boon-opt img { width: 16px; height: 16px; }

  .stats-scroll { overflow: auto; flex: 1; border: 1px solid var(--border); border-radius: 10px; }
  .stats-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 12px; }
  .stats-table thead th {
    position: sticky; top: 0; z-index: 2; background: #15151a; color: var(--text-muted);
    text-align: right; padding: 8px 10px; font-weight: 600; border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  .stats-table th.col-player { text-align: left; }
  .stats-table th.col-boon { text-align: center; }
  .th-sort { background: none; border: none; color: inherit; cursor: pointer; font: inherit; padding: 0; }
  .th-sort:hover { color: #fff; }
  .col-num { text-align: right; }
  .col-boon { text-align: center; }
  .boon-hd-icon { width: 18px; height: 18px; vertical-align: middle; margin-right: 4px; }
  .boon-hd-label { vertical-align: middle; }

  .resizer { position: absolute; right: 0; top: 0; width: 6px; height: 100%; cursor: col-resize; border: 0; padding: 0; background: transparent; user-select: none; }
  .resizer:hover { background: color-mix(in srgb, var(--accent) 50%, transparent); }

  .stats-table tbody td {
    padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    color: var(--text); text-align: right; white-space: nowrap;
  }
  .stats-table tbody td.col-player { text-align: left; }
  .player-cell { display: flex; align-items: center; gap: 8px; }
  .prof-icon { width: 24px; height: 24px; border-radius: 6px; background: #0c0c0f; flex-shrink: 0; }
  .player-names { display: flex; flex-direction: column; line-height: 1.15; }
  .toon { font-weight: 700; color: #fff; }
  .account { font-size: 10px; font-style: italic; color: var(--text-muted); }
  .sub-badge {
    margin-left: auto; flex-shrink: 0; font-size: 9px; font-weight: 700; letter-spacing: .03em;
    color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 6px; padding: 2px 6px; white-space: nowrap;
  }
  .boon-val { font-weight: 600; }
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
  .target-chip { font-size: 11px; color: var(--text); background: color-mix(in srgb,#fff 5%,transparent); border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px; }
  .target-chip b { color: #fff; }

  @media (prefers-reduced-motion: reduce) {
    .stats-modal { animation: none !important; }
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