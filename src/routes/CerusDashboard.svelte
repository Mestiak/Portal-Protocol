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
  import { fmt, fmtPct, fmtTime } from "$lib/format";
  import { slide } from "svelte/transition";
  import { cubicInOut } from "svelte/easing";
  import type { MechanicReport } from "$lib/mechanicParser";

  let {
    report,
    activeTab,
    singleLog = true,
    durationSec = 0,
  }: {
    report: MechanicReport;
    activeTab: "statistics" | "shadows" | "orbs" | "empowered";
    singleLog?: boolean;
    durationSec?: number;
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
  // ── Timeline chart (single-log only; aggregate omits offset math) ──
  const TL_BUCKETS = 60;
  let timeline = $derived.by(() => {
    if (!singleLog || !report.timeline || report.timeline.length === 0) return null;
    const dur = durationSec * 1000 || 1;
    const totalOrbs = report.totalOrbs + report.totalOrbsLeaked || 1;
    const bBlk = new Array(TL_BUCKETS).fill(0);
    const bLk = new Array(TL_BUCKETS).fill(0);
    const bShad = new Array(TL_BUCKETS).fill(0);
    const bRage = new Array(TL_BUCKETS).fill(0);
    for (const e of report.timeline) {
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
    let rBlk = 0, rLk = 0, rSh = 0, rRage = 0;
    const events: { x: number; y: number; color: string; label: string; t: number; eff: number; shad: number; rage: number; type: string; closeSpawn?: RegExpMatchArray | null }[] = [];
    for (const e of report.timeline) {
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

  const TL_W = 640, TL_H = 220, TL_L = 54, TL_R = 580, TL_T = 18, TL_B = 202;
  const tlX = (i: number) => TL_L + (i / (TL_BUCKETS - 1)) * (TL_R - TL_L);
  const tlYpct = (p: number) => TL_B - (p / 100) * (TL_B - TL_T);
  const tlYcnt = (v: number, max: number) => TL_B - (v / max) * (TL_B - TL_T);
  function fmtClock(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  }
  let hover = $state<{ x: number; y: number; eff: number; shad: number; rage: number; t: number; label?: string; color?: string; idx: number; dotY: number; side: 'left' | 'right'; closeSpawn?: RegExpMatchArray | null } | null>(null);
  function onTlMove(ev: MouseEvent) {
    if (!timeline) return;
    const svg = ev.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const sx = ((ev.clientX - rect.left) / rect.width) * TL_W;
    const sy = ((ev.clientY - rect.top) / rect.height) * TL_H;
    let near = null as any;
    let nearIdx = -1;
    let best = 18;
    const evs = timeline.events || [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      const d = Math.hypot(tlX(e.x) - sx, e.y - sy);
      if (d <= best) { best = d; near = e; nearIdx = i; }
    }
    if (!near) { hover = null; return; }
    const bi = near.x;
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
  {#if timeline}
    <div class="timeline">
      <div class="timeline-title">Fight Timeline Chart</div>
      <div class="timeline-chart-wrap">
        <svg class="timeline-svg" viewBox={`0 0 ${TL_W} ${TL_H}`} preserveAspectRatio="none" role="img" aria-label="Fight timeline chart" onmousemove={onTlMove} onmouseleave={onTlLeave}>
          {#each [0, 25, 50, 75, 100] as p}
            <line x1={TL_L} x2={TL_R} y1={tlYpct(p)} y2={tlYpct(p)} class="tl-grid" />
            <text x={TL_L - 8} y={tlYpct(p) + 3} class="tl-axis" text-anchor="end">{p}%</text>
          {/each}
          {#each [0, 0.25, 0.5, 0.75, 1] as g}
            <text x={tlX(Math.round(g * (TL_BUCKETS - 1)))} y={TL_B + 16} class="tl-axis" text-anchor="middle">{fmtClock(g * (durationSec * 1000))}</text>
          {/each}
          <polyline class="tl-line tl-cyan" points={timeline.effPts.map(pt => `${tlX(pt.x)},${tlYpct(pt.y)}`).join(" ")} />
          <polyline class="tl-line tl-purple" points={timeline.shadPts.map(pt => `${tlX(pt.x)},${tlYcnt(pt.y, timeline.shadMax)}`).join(" ")} />
          <polyline class="tl-line tl-gold" points={timeline.ragePts.map(pt => `${tlX(pt.x)},${tlYcnt(pt.y, timeline.rageMax)}`).join(" ")} />
          {#each timeline.events as e, i}
            <circle cx={tlX(e.x)} cy={e.y} r={hover && hover.idx === i ? 5.5 : 4} fill={e.color} class="tl-dot-svg" class:active={hover && hover.idx === i} />
          {/each}
          {#if hover}<line x1={hover.x} x2={hover.x} y1={TL_T} y2={TL_B} class="tl-hover-line" />{/if}
        </svg>
        {#if hover}
          <div class="timeline-tip" class:right={hover.side === 'right'} class:left={hover.side === 'left'}
            style={`left:${(hover.x / TL_W) * 100}%; top:${(hover.dotY / TL_H) * 100}%;`}>
            <div class="tt-time">{fmtClock(hover.t)}</div>
            {#if hover.label}<div class="tt-event" style={`color:${hover.color};`}>{hover.label}</div>{/if}
            {#if hover.closeSpawn}
              <div class="tt-row"><span class="tt-dot tt-close"></span>Close Spawn: <b>{hover.closeSpawn[1]}</b> ({hover.closeSpawn[2]}u)</div>
            {/if}
            <div class="tt-row"><span class="tt-dot lg-cyan"></span>Orb Block Eff: <b>{hover.eff}%</b></div>
            <div class="tt-row"><span class="tt-dot lg-purple"></span>Shadows Reached: <b>{hover.shad}</b></div>
            <div class="tt-row"><span class="tt-dot lg-gold"></span>Rage Hits: <b>{hover.rage}</b></div>
          </div>
        {/if}
      </div>
      <div class="timeline-legend">
        <span class="lg lg-cyan">Orb Block Efficiency (%)</span>
        <span class="lg lg-orange">Malice Dropped Near Boss</span>
        <span class="lg lg-purple">Shadow Reached Cerus (walk-in)</span>
        <span class="lg lg-gold">Rage Hits (Count)</span>
      </div>
    </div>
  {/if}
  {#if report.squadLedger && report.squadLedger.length > 0}
    <div class="squad-mechanics">
      <div class="sm-title">Squad Mechanics</div>
      <div class="sm-table">
        <div class="sm-row sm-head">
          <span class="sm-cell sm-player">Player</span>
          <button class="sm-cell sm-num sm-sort" class:active={smSort.key === "orbs"} onclick={() => smSortBy("orbs")}>
            Orbs Collected
            {#if smSort.key === "orbs"}<i class="fa-solid {smSort.dir === 1 ? 'fa-chevron-up' : 'fa-chevron-down'}" style="margin-left: 4px; font-size: 8px;"></i>{/if}
          </button>
          <button class="sm-cell sm-num sm-sort" class:active={smSort.key === "cryRage"} onclick={() => smSortBy("cryRage")}>
            Cry of Rage Hits
            {#if smSort.key === "cryRage"}<i class="fa-solid {smSort.dir === 1 ? 'fa-chevron-up' : 'fa-chevron-down'}" style="margin-left: 4px; font-size: 8px;"></i>{/if}
          </button>
          <button class="sm-cell sm-num sm-sort" class:active={smSort.key === "envyStrip"} onclick={() => smSortBy("envyStrip")}>
            Envy Wall Strips
            {#if smSort.key === "envyStrip"}<i class="fa-solid {smSort.dir === 1 ? 'fa-chevron-up' : 'fa-chevron-down'}" style="margin-left: 4px; font-size: 8px;"></i>{/if}
          </button>
        </div>
        {#each (smSort.key
          ? report.squadLedger.slice().sort((a, b) => (a[smSort.key!] - b[smSort.key!]) * smSort.dir)
          : report.squadLedger.slice().sort((a, b) => b.orbs - a.orbs)) as p}
          <div class="sm-row">
            <span class="sm-cell sm-player">
              <img class="sm-prof" src={profIcon(p.profession)} alt={p.profession} onerror={(e) => ((e.currentTarget as HTMLImageElement).src = "/professions/guardian.png")} />
              <span class="sm-names"><span class="sm-toon">{p.name}</span><span class="sm-acct">{p.account}</span></span>
            </span>
            <span class="sm-cell sm-num">{fmt(p.orbs)}</span>
            <span class="sm-cell sm-num">{fmt(p.cryRage)}</span>
            <span class="sm-cell sm-num" class:sm-warn={p.envyStrip > 0}>{fmt(p.envyStrip)}</span>
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
            <span class="sh-head-num"><span class="hl-orb">{fmt(report.phases.reduce((s, p) => s + p.orbsEaten, 0))}</span><span class="sh-head-sep"> / </span><span class="hl-shadow">{fmt(report.phases.reduce((s, p) => s + p.maliceHits, 0))}</span><span class="sh-head-sep"> / </span><span class="hl-enraged">{fmt(report.phases.reduce((s, p) => s + p.smashStacks, 0))}</span></span>
            <span class="sh-head-sub">FROM ORBS / SHADOWS / ENRAGED</span>
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
          {@const sources = ([
            p.orbsEaten > 0 ? { dot: "dot-orb", bc: "badge-orb", label: "Orbs Absorbed", inst: p.orbsEaten, stacks: p.orbsEaten } : null,
            p.shadowCount > 0 ? { dot: "dot-shadow", bc: "badge-shadow", label: "Malicious Shadows", inst: p.shadowCount, stacks: p.maliceHits } : null,
            p.smashStacks > 0 ? { dot: "dot-slam", bc: "badge-slam", label: "Enraged Smash Slams", inst: p.smashCount, stacks: p.smashStacks } : null,
          ]).filter((s): s is { dot: string; bc: string; label: string; inst: number; stacks: number } => s !== null)}
          <div class="emp-card" class:final={p.phaseName === "Enraged Smash"}>
            <button class="emp-card-head" onclick={() => toggleEmp(p.phaseName)}>
              <div class="emp-card-titles">
                {#if p.phaseName === "Enraged Smash"}<img class="emp-flame" src="/mechanics/enraged.png" alt="" />{/if}
                <span class="emp-card-kicker">{'P' + (report.phases.indexOf(p) + 1)} · ENCOUNTER STAGE</span>
                <span class="emp-card-name">{p.phaseName === "50%-10%" ? "50%-10%" : p.phaseName}</span>
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
              {#if p.rageHits > 0}
                <div class="emp-source">
                  <span class="emp-dot dot-rage"></span>
                  <span class="emp-source-label">Cry of Rage</span>
                  <span class="emp-source-val">
                    <span class="emp-count">{fmt(p.rageHits)}</span>
                    <span class="emp-stack-badge badge-rage">+{fmt(p.rageHits)} Stacks</span>
                  </span>
                </div>
              {/if}
            </div>
            {#if p.timeline.length}
              <button class="emp-tl-btn" onclick={() => toggleEmp(p.phaseName)}>
                {open ? "HIDE HISTORY TIMELINE" : "VIEW HISTORY TIMELINE"}
              </button>
              {#if open}
                <div class="emp-timeline" transition:slide={{ duration: 200, easing: cubicInOut }}>
                  {#each p.timeline as ev}
                    <div class="emp-tl-row emp-tl-{ev.type.toLowerCase().replace(' ', '-')}">
                      <span class="emp-tl-time">{fmtTime(ev.rawTime / 1000)}</span>
                      <span class="emp-tl-dot emp-dot {ev.type === 'Orb' ? 'dot-orb' : ev.type === 'Shadow' ? 'dot-shadow' : ev.type === 'Slam' ? 'dot-slam' : 'dot-rage'}"></span>
                      <span class="emp-tl-label">
                        {#if ev.type === 'Orb'}Orb leaked
                        {:else if ev.type === 'Shadow'}Shadow reached
                        {:else if ev.type === 'Slam'}Slam
                        {:else if ev.type === 'Rage Hit'}Cry of Rage
                        {:else}{ev.type}{/if}
                      </span>
                      <span class="emp-tl-detail">
                        {#if ev.type === 'Rage Hit' && ev.detail}{ev.detail}{:else if ev.type === 'Shadow'}{@html ev.detail.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}{:else}{ev.detail}{/if}
                      </span>
                      <span class="emp-tl-stacks emp-stack-badge {ev.type === 'Orb' ? 'badge-orb' : ev.type === 'Shadow' ? 'badge-shadow' : ev.type === 'Slam' ? 'badge-slam' : 'badge-rage'}">+{fmt(ev.stacks)} Stacks</span>
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
  .accent-cyan { color: #22d3ee; }
  .accent-purple { color: #a78bfa; }
  .accent-gold { color: #fbbf24; }
  .accent-red { color: #f87171; }
  .accent-pink { color: #f472b6; }

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
  .tl-dot-svg { stroke: #050403; stroke-width: 1.3; pointer-events: none; transition: r .12s ease; }
  .tl-dot-svg.active { stroke: #fff; stroke-width: 2; filter: drop-shadow(0 0 4px currentColor); }
  .timeline-legend { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
  .lg { font-size: 10px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }
  .lg::before { content: ""; width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  .lg-cyan::before { background: #22d3ee; }
  .lg-purple::before { background: #a78bfa; }
  .lg-orange::before { background: #ff7a3c; }
  .lg-gold::before { background: #fbbf24; }
  .timeline-tip {
    position: absolute; transform: translateY(-50%);
    background: #101015; border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 9px; font-size: 10px; color: var(--text); pointer-events: none;
    box-shadow: 0 8px 22px rgba(0,0,0,.5); white-space: nowrap; z-index: 5;
  }
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
  .sm-head .sm-cell { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); font-weight: 600; }
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
  .tt-time { font-weight: 800; color: #fff; margin-bottom: 3px; }
  .tt-event { font-weight: 700; font-size: 0.72rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 2px; margin-bottom: 2px; }
  .tt-row { display: flex; align-items: center; gap: 5px; }
  .tt-row b { color: #fff; }
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
  .emp-tl-shadow .emp-tl-label, .emp-tl-slam .emp-tl-label { color: #ffe; }
  .emp-tl-shadow .emp-tl-detail { color: #ffd0d0; }
</style>
