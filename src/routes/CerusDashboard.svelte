<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  // Cerus mechanic dashboard — shared renderer for BOTH the per-log StatsModal
  // (singleLog=true) and the multi-log Mechanics tab (singleLog=false).
  // Extracted verbatim from StatsModal.svelte so the two surfaces never drift.
  // Interaction state (accordions, hover, sort) lives HERE so each context gets
  // its own independent UI state. `activeTab` is controlled by the parent
  // (StatsModal sidebar, or the Mechanics tab's own sub-tab pills).
  import { fmt, fmtPct, fmtTime } from "#lib/format";
  import { slide } from "svelte/transition";
  import { cubicInOut } from "svelte/easing";
  import type { MechanicReport } from "#lib/mechanicParser";

  let {
    report,
    activeTab,
    singleLog = true,
    durationSec = 0,
    phaseSummary = null,
  }: {
    report: MechanicReport;
    activeTab: "statistics" | "shadows" | "orbs" | "empowered";
    singleLog?: boolean;
    durationSec?: number;
    phaseSummary?: {
      label: string;
      isFullFight: boolean;
      dps: number;
      cleave: number;
      durationSec: number;
    } | null;
  } = $props();

  // ── Accordion / badge interaction state (per-instance) ──
  let shadowAllOpen = $state(false);
  let shadowOpen = $state<Map<string, boolean>>(new Map());
  let shadowMaliceOpen = $state<Map<number, boolean>>(new Map());
  let badgeOpen = $state<string | null>(null);
  let empOpen = $state<Map<string, boolean>>(new Map());
  let openOrbPhase = $state<string | null>(null);
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
  function toggleEmp(name: string) {
    const m = new Map(empOpen);
    m.set(name, !m.get(name));
    empOpen = m;
  }

  // ── Squad Mechanics table sort ──
  let smSort = $state<{ key: "orbs" | "cryRage" | "envyStrip" | null; dir: 1 | -1 }>({ key: null, dir: 1 });
  function smSortBy(key: "orbs" | "cryRage" | "envyStrip") {
    if (smSort.key === key) { smSort = { key, dir: smSort.dir === 1 ? -1 : 1 }; }
    else { smSort = { key, dir: -1 }; }
  }

  import { profIcon } from '../lib/analyticsEngine';

  // profIcon is now shared from analyticsEngine (lowercases + strips spaces,
  // matches the lowercase static/professions/*.png filenames).
  // ── Fight timeline (single-log only) ──
  // One lane per mechanic, each event a dot at its true timestamp. Counts are
  // never drawn as lines — only orb-block efficiency is, and it gets its own
  // 0-100% axis. Dots are CSS circles, so they stay circular at any width.
  const LANES = [
    { id: "orb_blocked",    label: "Orbs blocked", cls: "tl-dot-orb",   size: "sm" },
    { id: "orb_leaked",     label: "Orbs leaked",  cls: "tl-dot-leak",  size: "lg" },
    { id: "shadow_close",   label: "Close spawn",  cls: "tl-dot-close", size: "lg" },
    { id: "shadow_reached", label: "Walk-in",      cls: "tl-dot-walk",  size: "lg" },
    { id: "rage_hit",       label: "Cry of Rage",  cls: "tl-dot-rage",  size: "lg" },
  ] as const;
  const DOT_COLOR: Record<string, string> = {
    orb_blocked: "#22d3ee", orb_leaked: "#ef4444", shadow_close: "#ff7a3c",
    shadow_reached: "#a78bfa", rage_hit: "#fbbf24",
  };
  const LANE_CLUSTER_PX = 10;   // same-lane events closer than this merge into one dot
  const TL_LABEL_W = 96, TL_TOTAL_W = 34, TL_GAP = 8;
  const TL_EFF_H = 28;
  const EFF_BUCKETS = 100;

  type TlMember = { t: number; label: string };
  type TlDot = {
    lane: string; xPct: number; t: number; label: string; color: string;
    cls: string; size: string; count: number; members: TlMember[];
    closeName?: string; closeDist?: number;
    eff: number; shad: number; rage: number;
  };
  type TlLane = { id: string; label: string; total: number; dots: TlDot[] };

  function fmtClock(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  }
  function dotLabel(e: any): string {
    if (e.type === "orb_blocked") return `Orb blocked by ${e.actor || "Unknown"}`;
    if (e.type === "orb_leaked") return `Orb leaked (+${e.orbLeaked})`;
    if (e.type === "shadow_close") return e.closeName ? `Malice dropped by ${e.closeName}` : "Malice dropped near boss";
    if (e.type === "shadow_reached") return "Shadow reached boss";
    if (e.type === "rage_hit") return `Cry of Rage — ${e.actor || "Unknown"}`;
    return "";
  }

  // The cluster rule is defined in pixels, so the track width has to be measured
  // rather than assumed from the modal's maximum.
  let lanesWrap = $state<HTMLElement | null>(null);
  let trackW = $state(1160 - TL_LABEL_W - TL_TOTAL_W - TL_GAP * 2);
  $effect(() => {
    const el = lanesWrap;
    if (!el) return;
    const measure = () => { trackW = el.clientWidth - TL_LABEL_W - TL_TOTAL_W - TL_GAP * 2; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  let timeline = $derived.by(() => {
    if (!singleLog || !report.timeline || report.timeline.length === 0) return null;
    const dur = durationSec * 1000;
    if (!dur || dur <= 0) return null;
    const pct = (t: number) => Math.max(0, Math.min(100, (t / dur) * 100));

    // Efficiency sparkline — cumulative blocked / (blocked + leaked).
    const bBlk = new Array(EFF_BUCKETS).fill(0);
    const bLk = new Array(EFF_BUCKETS).fill(0);
    for (const e of report.timeline) {
      let bi = Math.floor((e.t / dur) * EFF_BUCKETS);
      if (bi < 0) bi = 0; if (bi >= EFF_BUCKETS) bi = EFF_BUCKETS - 1;
      bBlk[bi] += e.orbBlocked; bLk[bi] += e.orbLeaked;
    }
    let cBlk = 0, cLk = 0;
    const effPts: { x: number; y: number }[] = [];
    for (let i = 0; i < EFF_BUCKETS; i++) {
      cBlk += bBlk[i]; cLk += bLk[i];
      effPts.push({ x: (i + 0.5) / EFF_BUCKETS, y: (cBlk + cLk) > 0 ? (cBlk / (cBlk + cLk)) * 100 : 100 });
    }
    const effLine = effPts.map((p) => `${(p.x * 100).toFixed(2)},${(TL_EFF_H - (p.y / 100) * TL_EFF_H).toFixed(2)}`).join(" ");
    const effArea = `0,${TL_EFF_H} ${effLine} 100,${TL_EFF_H}`;

    // Dots, each carrying the running counters the tooltip reports.
    let rBlk = 0, rLk = 0, rShad = 0, rRage = 0;
    const dots: TlDot[] = [];
    for (const e of report.timeline) {
      if (e.type === "orb_blocked" || e.type === "orb_leaked") {
        if (e.orbBlocked) rBlk += e.orbBlocked;
        if (e.orbLeaked) rLk += e.orbLeaked;
      } else if (e.type === "shadow_close" || e.type === "shadow_reached") rShad += e.shadowReached;
      else if (e.type === "rage_hit") rRage += e.rageHit;
      if (!e.type) continue;
      const lane = LANES.find((l) => l.id === e.type);
      if (!lane) continue;
      const total = rBlk + rLk;
      dots.push({
        lane: lane.id, xPct: pct(e.t), t: e.t, label: dotLabel(e),
        color: DOT_COLOR[e.type] || "#22d3ee", cls: lane.cls, size: lane.size,
        count: 1, members: [{ t: e.t, label: dotLabel(e) }],
        closeName: e.closeName, closeDist: e.closeDist,
        eff: total > 0 ? Math.round((rBlk / total) * 1000) / 10 : 100,
        shad: rShad, rage: rRage,
      });
    }

    const clusterPct = trackW > 0 ? (LANE_CLUSTER_PX / trackW) * 100 : 0.9;
    const lanes: TlLane[] = LANES.map((l) => ({ id: l.id, label: l.label, total: 0, dots: [] }));
    for (const lane of lanes) {
      const mine = dots.filter((d) => d.lane === lane.id).sort((a, b) => a.xPct - b.xPct);
      lane.total = mine.length;
      let cluster: TlDot[] = [];
      const flush = () => {
        if (!cluster.length) return;
        const first = cluster[0];
        lane.dots.push(cluster.length === 1
          ? first
          : {
              ...first,
              xPct: cluster.reduce((s, d) => s + d.xPct, 0) / cluster.length,
              count: cluster.length,
              label: `${cluster.length} events`,
              members: cluster.map((d) => ({ t: d.t, label: d.label })),
            });
        cluster = [];
      };
      for (const d of mine) {
        // Anchor-based: a cluster spans at most LANE_CLUSTER_PX from its first
        // event, so a dense stretch cannot chain into one enormous dot.
        if (cluster.length && d.xPct - cluster[0].xPct > clusterPct) flush();
        cluster.push(d);
      }
      flush();
    }

    const phases = (report.phases || []).map((p: any, i: number) => ({
      name: p.phaseName, xPct: pct(p.start),
      wPct: Math.max(0.6, pct(p.end) - pct(p.start)), alt: i % 2 === 1,
    }));

    return {
      lanes, phases, dur, effLine, effArea,
      effFinal: effPts.length ? Math.round(effPts[effPts.length - 1].y * 10) / 10 : 0,
    };
  });

  let hover = $state<{
    lane: string; xPct: number; color: string; label: string; t: number;
    count: number; members: TlMember[]; closeName?: string; closeDist?: number;
    eff: number; shad: number; rage: number;
  } | null>(null);
  function onDotEnter(lane: string, d: TlDot) {
    hover = {
      lane, xPct: d.xPct, color: d.color, label: d.label, t: d.t, count: d.count,
      members: d.members, closeName: d.closeName, closeDist: d.closeDist,
      eff: d.eff, shad: d.shad, rage: d.rage,
    };
  }
  function onDotLeave() { hover = null; }

  /** Friendly labels for the empowered history timeline. The parser emits
   *  internal type names (ShadowClose / ShadowWalk) that must not reach the UI. */
  const EMP_LABEL: Record<string, string> = {
    Orb: "Orb leaked",
    ShadowClose: "Close Spawn",
    ShadowWalk: "Walk-in",
    Slam: "Slam",
    "Rage Hit": "Cry of Rage",
    Shadow: "Shadow reached",
  };
  function empLabel(type: string): string {
    return EMP_LABEL[type] || type;
  }

  /** Timeline rows carry internal type names; map them to the CSS variants. */
  function empRowClass(type: string): string {
    if (type === "Orb") return "emp-tl-orb";
    if (type === "Slam") return "emp-tl-slam";
    if (type === "Rage Hit") return "emp-tl-rage";
    return "emp-tl-shadow";
  }
  function empDot(type: string): string {
    if (type === "Orb") return "dot-orb";
    if (type === "Slam") return "dot-slam";
    if (type === "Rage Hit") return "dot-rage";
    return "dot-shadow";
  }
  function empBadge(type: string): string {
    if (type === "Orb") return "badge-orb";
    if (type === "Slam") return "badge-slam";
    if (type === "Rage Hit") return "badge-rage";
    return "badge-shadow";
  }

  /** Close-spawn rows carry the player and distance as fields, so no markup
   *  travels through the timeline; other rows show their detail as-is. Caches
   *  written before those fields existed have the name inside `detail`, so fall
   *  back to parsing it. */
  function empDetail(ev: { type: string; detail: string; closeName?: string; closeDist?: number }): string {
    if (ev.type === "ShadowClose") {
      if (ev.closeName) return `${ev.closeName} (${ev.closeDist}u)`;
      const m = (ev.detail || "").match(/\*\*([^*]+)\*\*\s*\((\d+)u\)/);
      if (m) return `${m[1]} (${m[2]}u)`;
      return "";
    }
    return ev.detail || "";
  }

  /** Stack sources for one empowered phase: orbs, shadows, slams and Cry of Rage. */
  function empSources(p: any): { dot: string; bc: string; label: string; inst: number; stacks: number }[] {
    const rows = [
      p.orbsEaten > 0 ? { dot: "dot-orb", bc: "badge-orb", label: "Orbs Absorbed", inst: p.orbsEaten, stacks: p.orbsEaten } : null,
      p.shadowCount > 0 ? { dot: "dot-shadow", bc: "badge-shadow", label: "Malicious Shadows", inst: p.shadowCount, stacks: p.maliceHits } : null,
      p.smashStacks > 0 ? { dot: "dot-slam", bc: "badge-slam", label: "Enraged Smash Slams", inst: p.smashCount, stacks: p.smashStacks } : null,
      p.rageHits > 0 ? { dot: "dot-rage", bc: "badge-rage", label: "Cry of Rage", inst: p.rageHits, stacks: p.rageHits } : null,
    ];
    return rows.filter((r): r is { dot: string; bc: string; label: string; inst: number; stacks: number } => r !== null);
  }
</script>

{#if activeTab === "statistics"}
  <!-- STATISTICS (Cerus) -->
  <div class="stat-cards">
    <div class="stat-card">
      <span class="stat-val accent-cyan">{fmtPct(report.orbEfficiency)}<span class="stat-unit">%</span></span>
      <span class="stat-label">Orb Block Efficiency</span>
      <span class="stat-sub">{fmt(report.totalOrbs)} / {fmt(report.totalOrbs + report.totalOrbsLeaked)} intercepted</span>
    </div>
    <div class="stat-card">
      <span class="stat-val accent-purple">{fmt(report.shadowsReached)}</span>
      <span class="stat-label">Shadows Reached Cerus</span>
      <span class="stat-sub">Shadows Gained Stacks</span>
    </div>
    <div class="stat-card">
      <span class="stat-val accent-red">{fmt(report.empoweredGained)}</span>
      <span class="stat-label">Empowered Stacks</span>
      <span class="stat-sub">Total Stacks Gained</span>
    </div>
    <div class="stat-card">
      <span class="stat-val accent-gold">{fmt(report.rageHits)}</span>
      <span class="stat-label">Squad Rage Hits</span>
      <span class="stat-sub">True Dome Failures</span>
    </div>
    <div class="stat-card">
      <span class="stat-val accent-pink">{fmt(report.totalEnvyStrips)}</span>
      <span class="stat-label">Total of Boon Stripped</span>
      <span class="stat-sub">Sum of Envy Wall Touches</span>
    </div>
  </div>
  {#if phaseSummary}
    <div class="phase-strip">
      <span class="phase-strip-label">Phase <b>{phaseSummary.label}</b></span>
      <span class="phase-strip-item">Squad DPS <b>{fmt(phaseSummary.dps)}</b></span>
      <span class="phase-strip-item">Cleave <b>{fmt(phaseSummary.cleave)}</b></span>
      <span class="phase-strip-item">Duration <b>{fmt(phaseSummary.durationSec)}s</b></span>
    </div>
  {/if}
  {#if timeline}
    <div class="tl-card">
      <div class="tl-head">
        <div class="tl-title"><i class="fa-solid fa-timeline"></i> Fight Timeline</div>
        <div class="tl-hint">one row per mechanic — each dot is the moment it happened</div>
      </div>

      <div class="tl-eff">
        <div class="tl-eff-label">Orb block efficiency</div>
        <div class="tl-eff-track">
          {#each [0, 50, 100] as g}
            <span class="tl-eff-grid" style="left:{g}%"></span>
            <span class="tl-eff-tick" style="left:{g}%">{g}%</span>
          {/each}
          <svg class="tl-eff-svg" viewBox="0 0 100 {TL_EFF_H}" preserveAspectRatio="none" aria-hidden="true">
            <polygon class="tl-eff-area" points={timeline.effArea} />
            <polyline class="tl-eff-line" points={timeline.effLine} vector-effect="non-scaling-stroke" />
          </svg>
          <div class="tl-eff-val">{timeline.effFinal.toFixed(1)}%</div>
        </div>
      </div>

      <div class="tl-axis-row">
        <div class="tl-lane-label"></div>
        <div class="tl-axis-track">
          {#each [0, 0.25, 0.5, 0.75, 1] as g}
            <span class="tl-axis-tick" style="left:{(g * 100).toFixed(2)}%">{fmtClock(g * timeline.dur)}</span>
          {/each}
        </div>
        <div class="tl-lane-total"></div>
      </div>

      <div class="tl-lanes" bind:this={lanesWrap}>
        {#each timeline.lanes as lane}
          <div class="tl-lane" class:tl-lane-empty={lane.dots.length === 0}>
            <div class="tl-lane-label">{lane.label}</div>
            <div class="tl-track">
              {#each timeline.phases as ph}
                <div class="tl-band" class:tl-band-alt={ph.alt} style="left:{ph.xPct}%;width:{ph.wPct}%">
                  <span class="tl-band-name">{ph.name}</span>
                </div>
              {/each}
              {#each lane.dots as dot}
                <button type="button" class="tl-dot {dot.size} {dot.cls}" style="left:{dot.xPct}%"
                        aria-label={dot.label}
                        onmouseenter={() => onDotEnter(lane.id, dot)} onmouseleave={onDotLeave}
                        onfocus={() => onDotEnter(lane.id, dot)} onblur={onDotLeave}>
                  {#if dot.count > 1}<span class="tl-dot-badge">{dot.count}×</span>{/if}
                </button>
              {/each}
            </div>
            <div class="tl-lane-total">{lane.total}</div>
          </div>
        {/each}
      </div>

      <!-- Reserved detail strip: a floating tooltip grew to 126 px tall and
           covered the lanes below, so the hovered moment is shown here instead. -->
      <div class="tl-detail">
        {#if hover}
          <div class="tl-detail-top">
            <span class="tl-detail-time">{fmtClock(hover.t)}</span>
            <span class="tl-detail-event" style="color:{hover.color}">{hover.label}</span>
            {#if hover.closeName}
              <span class="tl-detail-chip">close spawn <b>{hover.closeName}</b> · {hover.closeDist}u</span>
            {/if}
          </div>
          {#if hover.members.length > 1}
            <div class="tl-detail-members">
              {#each hover.members.slice(0, 8) as m}
                <span class="tl-detail-member">{m.label}</span>
              {/each}
              {#if hover.members.length > 8}
                <span class="tl-detail-member tl-detail-more">+{hover.members.length - 8} more</span>
              {/if}
            </div>
          {:else}
            <div class="tl-detail-stats">
              <span>Orb block eff <b>{hover.eff}%</b></span>
              <span>Shadows reached <b>{hover.shad}</b></span>
              <span>Rage hits <b>{hover.rage}</b></span>
            </div>
          {/if}
        {:else}
          <div class="tl-detail-hint">Hover a dot to see what happened at that moment</div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="tl-empty">No mechanic events were recorded for this log.</div>
  {/if}
  {#if report.squadLedger && report.squadLedger.length > 0}
    <div class="sm-card">
      <div class="sm-head">
        <div class="sm-title">Squad Mechanics</div>
        <div class="sm-hint">orbs collected · Cry of Rage dome failures · Envy Wall strips — click a column to sort</div>
      </div>
      <div class="sm-table">
        <div class="sm-row sm-cols">
          <span class="sm-rank">#</span>
          <span class="sm-proc"></span>
          <span class="sm-col-label">Player</span>
          <button class="sm-num sm-sort" class:active={smSort.key === "orbs"} onclick={() => smSortBy("orbs")}>
            Orbs
            {#if smSort.key === "orbs"}<i class="fa-solid {smSort.dir === 1 ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>{/if}
          </button>
          <button class="sm-num sm-sort" class:active={smSort.key === "cryRage"} onclick={() => smSortBy("cryRage")}>
            Cry of Rage
            {#if smSort.key === "cryRage"}<i class="fa-solid {smSort.dir === 1 ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>{/if}
          </button>
          <button class="sm-num sm-sort" class:active={smSort.key === "envyStrip"} onclick={() => smSortBy("envyStrip")}>
            Envy Strips
            {#if smSort.key === "envyStrip"}<i class="fa-solid {smSort.dir === 1 ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>{/if}
          </button>
        </div>
        {#each (smSort.key
          ? report.squadLedger.slice().sort((a, b) => (a[smSort.key!] - b[smSort.key!]) * smSort.dir)
          : report.squadLedger.slice().sort((a, b) => b.orbs - a.orbs)) as p, i}
          <div class="sm-row">
            <span class="sm-rank">{i + 1}</span>
            <img class="sm-prof" src={profIcon(p.profession)} alt={p.profession} onerror={(e) => ((e.currentTarget as HTMLImageElement).src = "/professions/guardian.png")} />
            <span class="sm-player"><span class="sm-names"><span class="sm-toon">{p.name}</span><span class="sm-acct">{p.account}</span></span></span>
            <span class="sm-num">{fmt(p.orbs)}</span>
            <span class="sm-num">{fmt(p.cryRage)}</span>
            <span class="sm-num" class:sm-warn={p.envyStrip > 0}>{fmt(p.envyStrip)}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{:else if activeTab === "shadows" || activeTab === "orbs" || activeTab === "empowered"}
  <!-- MECHANICS TABS (Cerus) -->
  <div class="mech-body">
    {#if activeTab === "shadows"}
      <div class="sh-header">
        <div class="sh-head-top">
          <img class="sh-head-icon" src="/mechanics/cerus_avatar.png" alt="" />
          <div class="sh-head-titles">
            <span class="sh-head-kicker">{report.isLCM ? "LEGENDARY CHALLENGE MODE" : "CHALLENGE MODE"}</span>
            <span class="sh-head-title">MALICIOUS SHADOW DAMAGE</span>
          </div>
          <div class="sh-head-total">
            <span class="sh-head-num">{fmt(report.totalMaliceDamage)}</span>
            <span class="sh-head-sub">ACROSS {fmt(report.maliceTargetCount)} SHADOWS</span>
          </div>
        </div>
        <div class="sh-contrib-label">SQUAD OVERALL CONTRIBUTION</div>
        <div class="sh-contrib">
          {#each report.malicePlayers.slice(0, 10) as p, i}
            <div class="sh-contrib-row">
              <span class="sh-rank sh-rank-{i + 1}">{i + 1}</span>
              <img class="prof-icon sm" src={profIcon(p.profession)} alt={p.profession} onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
              <div class="player-names"><span class="toon">{p.name}</span><span class="account">{p.account}</span></div>
              <span class="sh-contrib-dmg">{fmt(p.damage)}</span>
              <div class="sh-bar-wrap"><div class="sh-bar" style="width:{p.percent}%"></div></div>
              <span class="sh-contrib-pct">{fmtPct(p.percent)}%</span>
            </div>
          {/each}
        </div>
      </div>
      <div class="sh-phases-head">
        <span>CLEAVE BREAKDOWN BY PHASE</span>
        <div class="sh-expand-btns">
          <button class="sh-exp-btn" onclick={() => (shadowAllOpen = true)}>Expand All</button>
          <button class="sh-exp-btn" onclick={() => (shadowAllOpen = false)}>Collapse All</button>
        </div>
      </div>
      <div class="sh-phases">
        {#each report.shadowPhases as ph, pi}
          {@const open = shadowOpen.has(ph.phaseName) ? shadowOpen.get(ph.phaseName) : shadowAllOpen}
          <div class="sh-phase">
            <button class="sh-phase-head" onclick={() => toggleShadow(ph.phaseName)}>
              <img class="sh-glyph" src="/mechanics/cerus_avatar.png" alt="" />
              <div class="sh-phase-titles">
                <span class="sh-phase-kicker">{ph.phaseName}</span>
                <span class="sh-phase-name">MALICIOUS SHADOWS ({ph.maliceCount})</span>
              </div>
              <span class="sh-phase-num">{fmt(ph.totalDamage)}</span>
              <span class="sh-chevron" class:open>{open ? "▾" : "▸"}</span>
            </button>
            {#if open}
              <div class="sh-malices" transition:slide={{ duration: 220, easing: cubicInOut }}>
                {#each ph.shadows as ms, mi}
                  {@const mOpen = shadowMaliceOpen.has(ms.index) ? shadowMaliceOpen.get(ms.index) : false}
                  <div class="sh-malice">
                    <button class="sh-malice-head" onclick={() => toggleMalice(ms.index)}>
                      <span class="sh-malice-accent"></span>
                      <span class="sh-chevron sm" class:open>{mOpen ? "▾" : "▸"}</span>
                      <span class="sh-malice-name">Malicious Shadow {mi + 1}</span>
                      <div class="sh-malice-right">
                        <span class="sh-malice-label">CLEAVE DMG</span>
                        <span class="sh-malice-num">{fmt(ms.totalDamage)}</span>
                      </div>
                    </button>
                    {#if mOpen}
                      <div class="sh-players" transition:slide={{ duration: 180 }}>
                        {#each ms.players as pl, pj}
                          <div class="sh-player">
                            <span class="sh-player-rank">{pj + 1}</span>
                            <img class="prof-icon sm" src={profIcon(pl.profession)} alt={pl.profession} onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                            <span class="sh-player-name">{pl.name}</span>
                            <div class="sh-badges">
                              <button class="sh-badge sh-badge-cc" disabled title="CC data coming soon">CC</button>
                              <button class="sh-badge sh-badge-dmg" onclick={() => toggleBadge(ph.phaseName + ":" + ms.index + ":" + pl.account + ":dmg")} class:active={badgeOpen === ph.phaseName + ":" + ms.index + ":" + pl.account + ":dmg"}>DMG</button>
                            </div>
                            <span class="sh-player-dmg">{fmt(pl.damage)}</span>
                            <span class="sh-player-pct">{fmtPct(pl.percent)}%</span>
                            {#if badgeOpen === ph.phaseName + ":" + ms.index + ":" + pl.account + ":dmg"}
                              <div class="sh-badge-detail" transition:slide={{ duration: 160 }}>
                                <div class="sh-detail-row"><span>Damage to this Malice</span><b>{fmt(pl.damage)}</b></div>
                                <div class="sh-detail-row"><span>Share of Malice</span><b>{fmtPct(pl.percent)}%</b></div>
                                {#if pl.skills && pl.skills.length}
                                  <div class="sh-skill-list">
                                    {#each pl.skills as sk}
                                      <div class="sh-skill-row">
                                        {#if sk.icon}<img class="sh-skill-icon" src={sk.icon} alt="" loading="lazy" />{:else}<span class="sh-skill-icon sh-skill-icon-empty"></span>{/if}
                                        <span class="sh-skill-name" title={sk.name}>{sk.name}</span>
                                        <span class="sh-skill-bar-wrap"><span class="sh-skill-bar" style="width:{sk.percent}%"></span></span>
                                        <span class="sh-skill-dmg">{fmt(sk.damage)}</span>
                                        <span class="sh-skill-pct">{fmtPct(sk.percent)}%</span>
                                      </div>
                                    {/each}
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else if activeTab === "orbs"}
      <div class="sh-header">
        <div class="sh-head-top">
          <img class="sh-head-icon" src="/mechanics/insatiable_fanart.png" alt="" />
          <div class="sh-head-titles">
            <span class="sh-head-kicker">{report.isLCM ? "LEGENDARY CHALLENGE MODE" : "CHALLENGE MODE"}</span>
            <span class="sh-head-title">ORB COLLECTION</span>
          </div>
          <div class="sh-head-total">
            <span class="sh-head-num">{fmt(report.totalOrbs)}<span class="sh-head-sep"> / </span><span class="sh-head-subtle">{fmt(report.totalOrbsSpawned)}</span></span>
            <span class="sh-head-sub">COLLECTED / SPAWNED</span>
          </div>
        </div>
        <div class="sh-contrib-label">ORB OUTCOME</div>
        <div class="sh-contrib">
          <div class="sh-contrib-row orb-outcome-row">
            <img class="prof-icon sm" src="/mechanics/insatiable_fanart.png" alt="" />
            <div class="orb-outcome-text">
              <span class="toon">Leaked Orbs</span>
              <span class="orb-outcome-dmg warn">{fmt(report.totalOrbsLeaked)}</span>
              <span class="account">eaten by Cerus</span>
            </div>
          </div>
          <div class="sh-contrib-row orb-outcome-row">
            <img class="prof-icon sm" src="/mechanics/insatiable_fanart.png" alt="" />
            <div class="orb-outcome-text">
              <span class="toon">Collected Orbs</span>
              <span class="orb-outcome-dmg">{fmt(report.totalOrbs)}</span>
              <span class="account">intercepted</span>
            </div>
          </div>
        </div>
      </div>
      {#if report.orbPhaseLeaders.length}
        {@const maxOrb = Math.max(1, ...report.orbPhaseLeaders.map((o) => o.collected))}
        <div class="orb-chart">
          <div class="orb-chart-label">ORBS COLLECTED PER PHASE <span class="orb-chart-hint">— click a phase</span></div>
          <div class="orb-chart-bars">
            {#each report.orbPhaseLeaders as o}
              <div class="orb-phase-block">
                <button class="orb-bar-row orb-bar-btn" onclick={() => openOrbPhase = openOrbPhase === o.phaseName ? null : o.phaseName} title={`${o.phaseName}: ${o.collected} orbs`}>
                  <span class="orb-caret" class:open={openOrbPhase === o.phaseName}>▶</span>
                  <span class="orb-bar-name">{o.phaseName}</span>
                  <div class="orb-bar-track"><div class="orb-bar-fill" style="width:{(o.collected / maxOrb) * 100}%"></div></div>
                  <span class="orb-bar-val">{fmt(o.collected)}</span>
                </button>
                {#if openOrbPhase === o.phaseName}
                  <div class="orb-phase-detail">
                    <div class="orb-phase-meta">
                      <span><b class="ok">{fmt(o.collected)}</b> collected</span>
                      <span><b class="warn">{fmt(o.leaked)}</b> leaked</span>
                    </div>
                    {#if o.players.length}
                      <div class="orb-phase-list">
                        {#each o.players as pl}
                          <div class="orb-phase-row">
                            <img class="prof-icon sm" src={profIcon(pl.profession)} alt={pl.profession} onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                            <div class="player-names"><span class="toon">{pl.name}</span><span class="account">{pl.account}</span></div>
                            <span class="orb-count sm">{fmt(pl.orbs)}</span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <div class="orb-phase-empty">No players collected orbs this phase.</div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
      <div class="mech-scroll stats-scroll">
        <table class="stats-table">
          <thead><tr><th class="col-player">Player</th><th class="col-num">Orbs taken</th></tr></thead>
          <tbody>
            {#each report.orbLeaderboard as p}
              <tr>
                <td class="col-player">
                  <div class="player-cell">
                    <img class="prof-icon" src={profIcon(p.profession)} alt={p.profession} onerror={(e) => { (e.currentTarget as HTMLImageElement).src = "/professions/guardian.png"; }} />
                    <div class="player-names"><span class="toon">{p.name}</span><span class="account">{p.account}</span></div>
                  </div>
                </td>
                <td class="col-num"><span class="orb-count">{fmt(p.damage)}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if activeTab === "empowered"}
      <div class="sh-header">
        <div class="sh-head-top">
          <img class="sh-head-icon" src="/mechanics/empowered.png" alt="" />
          <div class="sh-head-titles">
            <span class="sh-head-kicker">{report.isLCM ? "LEGENDARY CHALLENGE MODE" : "CHALLENGE MODE"}</span>
            <span class="sh-head-title">EMPOWERED STACKS</span>
          </div>
          <div class="sh-head-total">
            <span class="sh-head-num"><span class="hl-orb">{fmt(report.phases.reduce((s, p) => s + p.orbsEaten, 0))}</span><span class="sh-head-sep"> / </span><span class="hl-shadow">{fmt(report.phases.reduce((s, p) => s + p.maliceHits, 0))}</span><span class="sh-head-sep"> / </span><span class="hl-enraged">{fmt(report.phases.reduce((s, p) => s + p.smashStacks, 0))}</span><span class="sh-head-sep"> / </span><span class="hl-rage">{fmt(report.phases.reduce((s, p) => s + p.rageHits, 0))}</span></span>
            <span class="sh-head-sub">FROM ORBS / SHADOWS / ENRAGED / RAGE</span>
          </div>
        </div>
        <div class="sh-contrib-label">EMPOWERED GAINED</div>
        <div class="sh-contrib">
          <div class="sh-contrib-row orb-outcome-row">
            <img class="prof-icon sm" src="/mechanics/empowered.png" alt="" />
            <div class="orb-outcome-text">
              <span class="toon">Cerus Empowered</span>
              <span class="orb-outcome-dmg warn">{fmt(report.empoweredGained)}</span>
              <span class="account">total stacks gained</span>
            </div>
          </div>
        </div>
      </div>
      <div class="emp-cards">
        {#each report.phases as p}
          {@const open = empOpen.has(p.phaseName) ? empOpen.get(p.phaseName) : false}
          {@const sources = empSources(p)}
          {@const maxStacks = Math.max(1, ...sources.map((s) => s.stacks))}
          <div class="emp-card" class:final={p.phaseName === "Enraged Smash"}>
            <button class="emp-card-head" onclick={() => toggleEmp(p.phaseName)}>
              <div class="emp-card-titles">
                {#if p.phaseName === "Enraged Smash"}<img class="emp-flame" src="/mechanics/enraged.png" alt="" />{/if}
                <span class="emp-card-kicker">{'P' + (report.phases.indexOf(p) + 1)} · ENCOUNTER STAGE</span>
                <span class="emp-card-name" title={p.phaseName}>{p.phaseName}</span>
              </div>
              <div class="emp-card-total">
                <span class="emp-card-tlabel">CERUS TOTAL</span>
                <span class="emp-card-tnum accent-red">{fmt(p.empEnd)}</span>
                <img class="emp-card-cerus" src="/mechanics/empowered.png" alt="" />
              </div>
            </button>
            <div class="emp-card-body">
              <div class="emp-stacks-row">
                <span class="emp-stacks-label">Phase Stacks:</span>
                <span class="emp-stacks-val">+{fmt(p.empGained)} STACKS</span>
              </div>
              {#if sources.length}
                <div class="emp-sources">
                  {#each sources as src}
                    <div class="emp-source">
                      <span class="emp-dot {src.dot}"></span>
                      <span class="emp-source-label">{src.label}</span>
                      <span class="emp-bar"><i style="height:{Math.round((src.stacks / maxStacks) * 100)}%"></i></span>
                      <span class="emp-source-val">
                        <span class="emp-count">{fmt(src.inst)}</span>
                        <span class="emp-stack-badge {src.bc}">+{fmt(src.stacks)} Stacks</span>
                      </span>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="emp-no-src">No stacks gained</div>
              {/if}
            </div>
            {#if p.timeline.length}
              <button class="emp-tl-btn" onclick={() => toggleEmp(p.phaseName)}>
                {open ? "HIDE HISTORY TIMELINE" : "VIEW HISTORY TIMELINE"}
              </button>
              {#if open}
                <div class="emp-timeline" transition:slide={{ duration: 200, easing: cubicInOut }}>
                  {#each p.timeline as ev}
                    <div class="emp-tl-row {empRowClass(ev.type)}">
                      <span class="emp-tl-time">{fmtTime(ev.rawTime / 1000)}</span>
                      <span class="emp-tl-dot emp-dot {empDot(ev.type)}"></span>
                      <span class="emp-tl-label" title={empLabel(ev.type)}>{empLabel(ev.type)}</span>
                      <span class="emp-tl-detail" title={empDetail(ev) || undefined}>{empDetail(ev)}</span>
                      <span class="emp-tl-stacks emp-stack-badge {empBadge(ev.type)}">+{fmt(ev.stacks)} Stacks</span>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
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
  .phase-strip {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    margin-top: 10px; padding: 6px 10px;
    border-left: 2px solid var(--accent);
    font-size: 11px; color: var(--text-muted);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .phase-strip b { color: var(--text); font-variant-numeric: tabular-nums; }
  .accent-cyan { color: #22d3ee; }
  .accent-purple { color: #a78bfa; }
  .accent-gold { color: #fbbf24; }
  .accent-red { color: #f87171; }
  .accent-pink { color: #f472b6; }

  /* ── Fight timeline: event lanes ── */
  .tl-card {
    background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
    transition: transform .18s var(--ease-smooth), border-color .18s, box-shadow .18s;
  }
  .tl-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .tl-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .tl-title { font-size: 11px; font-weight: 700; color: var(--text); letter-spacing: .03em; }
  .tl-title i { color: var(--accent); font-size: 10px; }
  .tl-hint { font-size: 9px; color: var(--text-muted); opacity: .8; }

  .tl-eff { display: flex; align-items: center; gap: 8px; }
  .tl-eff-label {
    flex: none; width: 96px; font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .07em; color: var(--text-muted);
  }
  .tl-eff-track { position: relative; flex: 1; height: 28px; min-width: 0; }
  .tl-eff-svg { position: absolute; inset: 0; width: 100%; height: 28px; display: block; }
  .tl-eff-line { fill: none; stroke: #22d3ee; stroke-width: 1.6; }
  .tl-eff-area { fill: color-mix(in srgb, #22d3ee 16%, transparent); }
  .tl-eff-grid { position: absolute; top: 0; bottom: 0; width: 1px; background: color-mix(in srgb, var(--border) 70%, transparent); }
  .tl-eff-tick { position: absolute; top: -1px; transform: translateX(-50%); font-size: 8px; color: var(--text-muted); }
  .tl-eff-val { flex: none; font-size: 12px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }

  .tl-axis-row, .tl-lane { display: grid; grid-template-columns: 96px 1fr 34px; gap: 8px; align-items: center; }
  .tl-axis-track { position: relative; height: 12px; min-width: 0; }
  .tl-axis-tick {
    position: absolute; top: 0; transform: translateX(-50%); font-size: 8px; color: var(--text-muted);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .tl-lanes { display: flex; flex-direction: column; gap: 1px; }
  .tl-lane { padding: 2px 4px; border-radius: 4px; transition: background-color .14s, transform .18s var(--ease-smooth); }
  .tl-lane:hover { background: color-mix(in srgb, #fff 5%, transparent); transform: translateX(2px); }
  .tl-lane-label {
    font-size: 9px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;
    letter-spacing: .05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tl-lane-total { font-size: 11px; font-weight: 800; color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
  .tl-lane-empty .tl-lane-total { color: var(--text-muted); opacity: .5; }

  .tl-track { position: relative; height: 22px; min-width: 0; overflow: visible; }
  .tl-band { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, #fff 2.5%, transparent); }
  .tl-band-alt { background: color-mix(in srgb, #fff 5%, transparent); }
  .tl-band-name {
    position: absolute; top: 0; left: 3px; font-size: 7px; letter-spacing: .04em;
    color: var(--text-muted); white-space: nowrap; overflow: hidden; opacity: .75;
  }
  .tl-dot {
    position: absolute; top: 50%; width: 9px; height: 9px; padding: 0;
    border: 1.5px solid #050403; border-radius: 50%; cursor: pointer;
    transform: translate(-50%, -50%);
    transition: transform .18s var(--ease-spring), box-shadow .18s var(--ease-smooth);
  }
  .tl-dot.lg { width: 12px; height: 12px; }
  .tl-dot:hover, .tl-dot:focus-visible {
    transform: translate(-50%, -50%) scale(1.7);
    box-shadow: 0 0 0 2px #fff, 0 0 8px 1px currentColor;
    z-index: 3;
  }
  .tl-dot:focus-visible { outline: none; }
  .tl-dot-orb   { background: #22d3ee; color: #22d3ee; }
  .tl-dot-leak  { background: #ef4444; color: #ef4444; }
  .tl-dot-close { background: #ff7a3c; color: #ff7a3c; }
  .tl-dot-walk  { background: #a78bfa; color: #a78bfa; }
  .tl-dot-rage  { background: #fbbf24; color: #fbbf24; }
  .tl-dot-badge {
    position: absolute; top: -7px; right: -9px; font-size: 7px; font-weight: 800; line-height: 1.3;
    color: #fff; background: #0c0c0f; border: 1px solid var(--border); border-radius: 4px; padding: 0 2px;
  }

  .tl-detail {
    border-top: 1px solid var(--border); padding-top: 8px;
    min-height: 46px; display: flex; flex-direction: column; gap: 6px;
  }
  .tl-detail-hint { font-size: 10px; color: var(--text-muted); opacity: .7; padding: 4px 0; }
  .tl-detail-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .tl-detail-time { font-size: 11px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
  .tl-detail-event { font-size: 11px; font-weight: 700; }
  .tl-detail-chip {
    font-size: 9px; color: var(--text-muted); background: color-mix(in srgb, #fff 4%, transparent);
    border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px;
  }
  .tl-detail-chip b { color: var(--text); }
  .tl-detail-stats { display: flex; gap: 14px; flex-wrap: wrap; font-size: 10px; color: var(--text-muted); }
  .tl-detail-stats b { color: var(--text); font-variant-numeric: tabular-nums; }
  .tl-detail-members { display: flex; gap: 5px; flex-wrap: wrap; }
  .tl-detail-member {
    font-size: 9px; color: var(--text); background: color-mix(in srgb, #fff 4%, transparent);
    border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px;
  }
  .tl-detail-more { color: var(--text-muted); }

  .tl-empty {
    background: var(--bg-panel); border: 1px dashed var(--border); border-radius: var(--radius);
    padding: 22px; text-align: center; font-size: 11px; color: var(--text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .tl-card, .tl-lane, .tl-dot, .sm-card, .sm-row { transition: none !important; transform: none !important; }
  }

  /* ── Squad Mechanics table ── */
  .sm-card {
    background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
    transition: transform .18s var(--ease-smooth), border-color .18s, box-shadow .18s;
  }
  .sm-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .85);
  }
  .sm-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .sm-title { font-size: 11px; font-weight: 700; color: var(--text); letter-spacing: .03em; }
  .sm-hint { font-size: 9px; color: var(--text-muted); opacity: .8; }
  .sm-table { display: flex; flex-direction: column; gap: 1px; }
  .sm-row {
    display: grid; grid-template-columns: 18px 24px 1fr 92px 92px 92px; align-items: center;
    gap: 6px; padding: 3px 4px; border-radius: 6px;
    transition: background-color .14s, transform .18s var(--ease-smooth);
  }
  .sm-row:not(.sm-cols):hover { background: color-mix(in srgb, #fff 5%, transparent); transform: translateX(2px); }
  .sm-cols { padding: 0 4px 5px; border-bottom: 1px solid var(--border); border-radius: 0; }
  .sm-cols .sm-col-label, .sm-cols .sm-rank, .sm-cols .sm-proc {
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted);
  }
  .sm-rank { font-size: 9px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .sm-proc { width: 20px; height: 20px; flex: none; }
  .sm-num { font-size: 11px; text-align: right; color: var(--text); font-variant-numeric: tabular-nums; }
  .sm-num.sm-warn { color: #f472b6; font-weight: 700; }
  .sm-num.sm-sort {
    background: transparent; border: none; cursor: pointer; color: var(--text-muted); padding: 0;
    display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px;
    font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
    transition: color .15s;
  }
  .sm-num.sm-sort:hover { color: var(--text); }
  .sm-num.sm-sort.active { color: var(--accent); }
  .sm-num.sm-sort i { font-size: 8px; }
  .sm-player { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sm-prof { width: 20px; height: 20px; border-radius: 5px; flex: 0 0 auto; background: #0c0d12; }
  .sm-names { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .sm-toon { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sm-acct { font-size: 9px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
  .hl-rage { color: #ffb27a; }
  .orb-count { font-size: 14px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
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
  .orb-phase-meta .ok { color: var(--accent); }
  .orb-phase-meta .warn { color: var(--warn); }
  .orb-phase-row { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 9px; font-size: 12px; padding: 2px 6px; border-radius: 6px; transition: background .12s ease; }
  .orb-phase-row:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .orb-phase-list { display: flex; flex-direction: column; gap: 2px; }
  .sh-contrib-label { font-size: 10px; letter-spacing: .12em; color: color-mix(in srgb, var(--accent) 75%, #fff); text-transform: uppercase; border-top: 1px solid var(--border); padding-top: 10px; }
  .sh-contrib { display: flex; flex-direction: column; gap: 5px; }
  .sh-contrib-row { display: grid; grid-template-columns: 18px 20px 1fr auto 120px auto; align-items: center; gap: 10px; font-size: 12px; }
  .orb-outcome-row { grid-template-columns: 18px 1fr; gap: 10px; }
  .orb-outcome-text { display: flex; align-items: baseline; gap: 8px; flex-wrap: nowrap; }
  .orb-outcome-text .toon { white-space: nowrap; font-weight: 700; color: #fff; }
  .orb-outcome-dmg { font-size: 16px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
  .orb-outcome-dmg.warn { color: var(--warn); }
  .orb-outcome-text .account { font-size: 11px; font-style: italic; color: var(--text-muted); white-space: nowrap; }
  .sh-rank { font-weight: 800; font-size: 12px; text-align: center; }
  .sh-rank-1 { color: #fbbf24; } .sh-rank-2 { color: #cbd5e1; } .sh-rank-3 { color: #d97706; } .sh-rank-4, .sh-rank-5, .sh-rank-6, .sh-rank-7, .sh-rank-8, .sh-rank-9, .sh-rank-10 { color: var(--text-muted); }
  .sh-contrib-dmg { font-weight: 700; color: #fff; } .sh-contrib-pct { color: color-mix(in srgb, var(--accent) 80%, #fff); font-weight: 600; min-width: 44px; text-align: right; }
  .sh-bar-wrap { height: 6px; background: color-mix(in srgb,#fff 8%,transparent); border-radius: 3px; overflow: hidden; }
  .sh-bar { height: 100%; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff)); border-radius: 3px; transition: width .3s ease; }
  .prof-icon.sm { width: 20px; height: 20px; border-radius: 5px; flex: none; }

  .sh-phases-head { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
  .sh-phases-head > span { font-size: 10px; letter-spacing: .12em; color: var(--text-muted); text-transform: uppercase; }
  .sh-expand-btns { display: flex; gap: 6px; }
  .sh-exp-btn { background: color-mix(in srgb,#fff 6%,transparent); border: 1px solid var(--border); color: var(--text); border-radius: 7px; padding: 4px 9px; font-size: 10px; cursor: pointer; transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
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
  .sh-malice + .sh-malice { border-top: 1px solid color-mix(in srgb,#fff 6%,transparent); }
  .sh-malice-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 14px 9px 18px; background: transparent; border: none; color: var(--text); cursor: pointer; text-align: left; transition: background .15s; }
  .sh-malice-head:hover { background: color-mix(in srgb,#fff 4%,transparent); }
  .sh-malice-accent { width: 3px; align-self: stretch; border-radius: 2px; background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #000)); flex: none; }
  .sh-malice-name { flex: 1; font-weight: 700; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  .sh-malice-right { display: flex; flex-direction: column; align-items: flex-end; }
  .sh-malice-label { font-size: 8px; letter-spacing: .1em; color: var(--text-muted); text-transform: uppercase; }
  .sh-malice-num { font-size: 15px; font-weight: 800; color: var(--accent); }

  .sh-players { display: flex; flex-direction: column; padding: 2px 0 8px; background: color-mix(in srgb,#000 25%,transparent); }
  .sh-player { display: grid; grid-template-columns: 16px 20px 1fr auto auto auto; align-items: center; gap: 9px; padding: 6px 16px 6px 34px; font-size: 12px; position: relative; }
  .sh-player + .sh-player { border-top: 1px solid color-mix(in srgb,#fff 4%,transparent); }
  .sh-player-rank { color: var(--text-muted); font-weight: 700; font-size: 11px; text-align: center; }
  .sh-player-name { color: var(--text); font-weight: 600; }
  .sh-player-dmg { font-weight: 700; color: #fff; }
  .sh-player-pct { color: var(--accent); font-weight: 600; min-width: 42px; text-align: right; }
  .sh-badges { display: flex; gap: 5px; }
  .sh-badge { border: 1px solid var(--border); border-radius: 6px; padding: 2px 7px; font-size: 9px; font-weight: 700; letter-spacing: .04em; cursor: pointer; transition: background-color .15s ease, color .15s ease, border-color .15s ease; color: var(--text); background: color-mix(in srgb,#fff 5%,transparent); }
  .sh-badge-cc { color: #67e8f9; border-color: color-mix(in srgb,#67e8f9 35%,transparent); }
  .sh-badge-cc:disabled { opacity: .4; cursor: not-allowed; }
  .sh-badge-dmg { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff)); color: #fff; border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .sh-badge-dmg:hover, .sh-badge-dmg.active { background: linear-gradient(90deg, var(--accent-h), color-mix(in srgb, var(--accent) 72%, #fff)); color: #fff; box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 30%, transparent); }
  .sh-badge-detail { grid-column: 1 / -1; margin: 4px 0 2px; padding: 8px 10px; background: color-mix(in srgb,#a78bfa 8%,transparent); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 3px; }
  .sh-detail-row { display: flex; justify-content: space-between; font-size: 11px; color: var(--text); }
  .sh-skill-list { display: flex; flex-direction: column; gap: 4px; margin-top: 5px; padding-top: 6px; border-top: 1px solid color-mix(in srgb,#fff 6%,transparent); }
  .sh-skill-row { display: grid; grid-template-columns: 16px 1fr 64px 60px 38px; align-items: center; gap: 8px; font-size: 10.5px; }
  .sh-skill-icon { width: 16px; height: 16px; border-radius: 3px; object-fit: cover; background: color-mix(in srgb,#fff 10%,transparent); flex: 0 0 auto; }
  .sh-skill-icon-empty { display: inline-block; }
  .sh-skill-name { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sh-skill-bar-wrap { height: 5px; background: color-mix(in srgb,#fff 8%,transparent); border-radius: 3px; overflow: hidden; }
  .sh-skill-bar { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff)); border-radius: 3px; }
  .sh-skill-dmg { font-weight: 700; color: #fff; text-align: right; }
  .sh-skill-pct { color: var(--accent); font-weight: 600; text-align: right; }

  .mech-scroll { max-height: 46vh; border: 1px solid var(--border); border-radius: 10px; overflow: auto; }
  .stats-scroll { overflow: auto; flex: 1; }
  .stats-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 12px; }
  .stats-table thead th { position: sticky; top: 0; z-index: 2; background: #15151a; color: var(--text-muted); text-align: right; padding: 8px 10px; font-weight: 600; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .stats-table th.col-player { text-align: left; }
  .stats-table tbody td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); color: var(--text); text-align: right; white-space: nowrap; }
  .stats-table tbody td.col-player { text-align: left; }
  .player-cell { display: flex; align-items: center; gap: 8px; }
  .prof-icon { width: 24px; height: 24px; border-radius: 6px; background: #0c0c0f; flex-shrink: 0; }
  .player-names { display: flex; flex-direction: column; line-height: 1.15; }
  .toon { font-weight: 700; color: #fff; }
  .account { font-size: 10px; font-style: italic; color: var(--text-muted); }

  /* ── Mechanic tab summaries ── */
  .mech-body { display: flex; flex-direction: column; gap: 12px; }

  /* ── Empowered tab — MA-style phase cards ── */
  .emp-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  @media (max-width: 720px) { .emp-cards { grid-template-columns: 1fr; } }
  .emp-card {
    background: color-mix(in srgb, var(--accent) 5%, var(--bg-sidebar));
    border: 1px solid var(--border); border-radius: 12px;
    display: flex; flex-direction: column; overflow: hidden;
    transition: border-color .18s var(--ease-smooth), transform .18s var(--ease-smooth), box-shadow .18s var(--ease-smooth);
  }
  .emp-card:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); box-shadow: 0 4px 18px color-mix(in srgb, #000 40%, transparent); }
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
  .emp-source { display: grid; grid-template-columns: 12px 1fr 3px auto; align-items: center; gap: 8px; font-size: 12px; }
  .emp-bar { position: relative; width: 3px; height: 16px; border-radius: 2px; background: color-mix(in srgb, #fff 7%, transparent); overflow: hidden; }
  .emp-bar i { position: absolute; bottom: 0; left: 0; right: 0; display: block; background: var(--accent); border-radius: 2px; transition: height .5s var(--ease-smooth); }
  .emp-source-label { color: var(--text); }
  .emp-source-val { display: inline-flex; align-items: center; gap: 7px; }
  .emp-count { color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }
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
  .emp-tl-row { display: grid; grid-template-columns: 36px 12px auto 1fr auto; align-items: center; gap: 8px; font-size: 11px; padding: 3px 6px; border-radius: 6px; transition: background .14s ease, transform .18s var(--ease-smooth); }
  .emp-tl-row:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); transform: translateX(2px); }
  .emp-tl-time { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 10px; }
  .emp-tl-dot { width: 8px; height: 8px; border-radius: 50%; }
  .emp-tl-label { color: var(--text); font-weight: 600; white-space: nowrap; }
  .emp-tl-detail { color: var(--text-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .emp-tl-stacks { font-weight: 800; font-variant-numeric: tabular-nums; }
  .emp-tl-shadow .emp-tl-label, .emp-tl-slam .emp-tl-label { color: #ffe; }
  .emp-tl-shadow .emp-tl-detail { color: #ffd0d0; }
</style>
