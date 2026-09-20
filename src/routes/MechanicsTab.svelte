<!-- Portal Protocol - Log Uploader & Log Manager Suite -->
<!-- Copyright (C) 2026 Mestiak -->
<!-- Licensed under MIT License -->

<script lang="ts">
  // Mechanics tab — boss rail + multi-log Cerus analysis.
  //   • Left rail lists the 6 raid bosses, each with its history count.
  //   • Cerus → selector: check logs from history + paste extra dps.report links
  //     → "Analyze" → ONE CerusDashboard with numbers summed across all logs.
  //   • Non-Cerus bosses → "Coming Soon" panel with a link to MA for multi-log today.
  // Reuses the exact per-log render (CerusDashboard) so the two surfaces never drift.
  import { invoke } from "@tauri-apps/api/core";
  import { extractMechanics, mergeCerusReports, countCerusLogs, MAX_AGGREGATE_LOGS, type MechanicReport } from "$lib/mechanicParser";
  import { fmt, fmtPct } from "$lib/format";
  import CerusDashboard from "./CerusDashboard.svelte";

  interface LogFull { stats: { boss_name: string; duration_sec: number; [k: string]: any }; raw: any; }
  interface UploadRecordLike { url?: string | null; boss_name?: string | null; file_path?: string; [k: string]: any; }

  let { records, preselectPermalink = null }: { records: UploadRecordLike[]; preselectPermalink?: string | null } = $props();

  const BOSSES = [
    { id: "cerus", name: "Cerus", sub: "Temple of Febe", icon: "/mechanics/cerus_avatar.png" },
    { id: "vg", name: "Vale Guardian", sub: "Spirit Vale", icon: "/mechanics/guardian.png" },
    { id: "sh", name: "Soulless Horror", sub: "Mythwright Gambit", icon: "/mechanics/soulless.png" },
    { id: "eyes", name: "Eyes of Fate", sub: "The Key of Ahdashim", icon: "/mechanics/eyes.png" },
    { id: "ska", name: "Sabetha", sub: "Spirit Vale", icon: "/mechanics/sabetha.png" },
    { id: "ca", name: "Cairn", sub: "The Bastion of the Penitent", icon: "/mechanics/cairn.png" },
  ] as const;
  type BossId = typeof BOSSES[number]["id"];

  let activeBoss = $state<BossId>("cerus");
  let mechSubTab = $state<"statistics" | "shadows" | "orbs" | "empowered">("statistics");

  // Cerus history logs (from the passed records).
  let cerusLogs = $derived(records.filter((r) => (r.boss_name || "").toLowerCase().includes("cerus") && r.url));

  // Selection state.
  let selected = $state<Set<string>>(new Set());
  let pasted = $state(""); // newline-separated dps.report links
  let analyzing = $state(false);
  let analyzeError = $state<string | null>(null);
  let report = $state<MechanicReport | null>(null);
  let analyzedCount = $state(0);
  let cohortWarning = $state<string | null>(null);

  function toggleSelect(url: string) {
    const s = new Set(selected);
    if (s.has(url)) s.delete(url); else s.add(url);
    selected = s;
  }

  function parsePasted(): string[] {
    return pasted.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  }

  async function analyze() {
    analyzeError = null;
    cohortWarning = null;
    const links = parsePasted();
    const all = [...selected, ...links];
    if (all.length === 0) { analyzeError = "Select at least one log (check a history log or paste a link)."; return; }
    if (all.length > MAX_AGGREGATE_LOGS) {
      cohortWarning = `Analyzing ${all.length} logs — over ${MAX_AGGREGATE_LOGS}, so the per-player averages may be skewed by a large cohort.`;
    }
    analyzing = true;
    try {
      const reports: MechanicReport[] = [];
      let fetched = 0;
      for (const link of all) {
        try {
          const res = await invoke("get_log_full", { permalink: link }) as LogFull;
          const mech = extractMechanics(res.raw, res.stats.boss_name);
          if (mech && mech.boss === "Cerus") reports.push(mech);
          fetched++;
        } catch (e: any) {
          analyzeError = `Failed to load ${link}: ${typeof e === "string" ? e : (e?.message || "error")}`;
        }
      }
      analyzedCount = fetched;
      report = mergeCerusReports(reports);
      if (!report) analyzeError = analyzeError || "No Cerus logs found in the selected set.";
    } finally {
      analyzing = false;
    }
  }

  // Auto-route: when invoked from a History/Uploads log card with a permalink.
  $effect(() => {
    if (preselectPermalink) {
      activeBoss = "cerus";
      selected = new Set([preselectPermalink]);
      // kick off immediately
      if (!report) analyze();
    }
  });
</script>

<div class="mech-layout">
  <!-- Left boss rail -->
  <aside class="mech-rail">
    <div class="mech-rail-title">BOSSES</div>
    {#each BOSSES as b}
      {@const count = b.id === "cerus" ? countCerusLogs(records) : 0}
      <button class="mech-rail-item {activeBoss === b.id ? 'active' : ''}" onclick={() => { activeBoss = b.id; report = null; analyzeError = null; cohortWarning = null; }}>
        <img class="mech-rail-icon" src={b.icon} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).src = "/professions/guardian.png")} />
        <span class="mech-rail-text">
          <span class="mech-rail-name">{b.name}</span>
          <span class="mech-rail-sub">{b.sub}</span>
        </span>
        {#if b.id === "cerus" && count > 0}
          <span class="mech-rail-count">{count}</span>
        {/if}
      </button>
    {/each}
  </aside>

  <!-- Content panel -->
  <section class="mech-content">
    {#if activeBoss === "cerus"}
      {#if !report}
        <div class="mech-selector">
          <div class="mech-sel-head">
            <img class="mech-sel-icon" src="/mechanics/cerus_avatar.png" alt="" />
            <div>
              <div class="mech-sel-title">Cerus — Multi-Log Analysis</div>
              <div class="mech-sel-sub">Pick logs from your history and/or paste extra dps.report links, then Analyze. Numbers are summed across every selected log.</div>
            </div>
          </div>

          {#if cerusLogs.length > 0}
            <div class="mech-sel-section">Your Cerus logs ({cerusLogs.length})</div>
            <div class="mech-sel-list">
              {#each cerusLogs as log}
                <label class="mech-sel-row">
                  <input type="checkbox" checked={selected.has(log.url!)} onchange={() => toggleSelect(log.url!)} />
                  <span class="mech-sel-row-name">{log.boss_name || "Cerus"}</span>
                  <span class="mech-sel-row-meta">{log.file_path ? log.file_path.split(/[\\/]/).pop() : (log.url || "")}</span>
                </label>
              {/each}
            </div>
          {:else}
            <div class="mech-sel-empty">No Cerus logs in your history yet. Paste links below to analyze.</div>
          {/if}

          <div class="mech-sel-section">Paste extra dps.report links (one per line, optional)</div>
          <textarea class="mech-sel-textarea" rows="3" placeholder="https://dps.report/xxxx&#10;https://dps.report/yyyy" bind:value={pasted}></textarea>

          {#if analyzeError}<div class="mech-sel-err">{analyzeError}</div>{/if}
          {#if cohortWarning}<div class="mech-sel-warn">{cohortWarning}</div>{/if}

          <button class="mech-sel-btn" disabled={analyzing} onclick={analyze}>
            {analyzing ? "Analyzing…" : `Analyze${selected.size + parsePasted().length > 0 ? ` (${selected.size + parsePasted().length})` : ""}`}
          </button>
        </div>
      {:else}
        <div class="mech-result-head">
          <div class="mech-result-title">
            Cerus · {analyzedCount} log{analyzedCount === 1 ? "" : "s"} aggregated
          </div>
          <div class="mech-result-actions">
            <button class="mech-pill {mechSubTab === 'statistics' ? 'active' : ''}" onclick={() => mechSubTab = 'statistics'}>Statistics</button>
            <button class="mech-pill {mechSubTab === 'shadows' ? 'active' : ''}" onclick={() => mechSubTab = 'shadows'}>Shadows</button>
            <button class="mech-pill {mechSubTab === 'orbs' ? 'active' : ''}" onclick={() => mechSubTab = 'orbs'}>Orbs</button>
            <button class="mech-pill {mechSubTab === 'empowered' ? 'active' : ''}" onclick={() => mechSubTab = 'empowered'}>Empowered</button>
            <button class="mech-pill ghost" onclick={() => { report = null; selected = new Set(); pasted = ""; }}>← New Selection</button>
          </div>
        </div>
        {#if cohortWarning}<div class="mech-sel-warn mech-sel-warn-inline">{cohortWarning}</div>{/if}
        <CerusDashboard report={report} activeTab={mechSubTab} singleLog={analyzedCount === 1} durationSec={report.summary?.durationSec ?? 0} />
      {/if}
    {:else}
      <!-- Coming Soon for non-Cerus bosses -->
      <div class="mech-coming">
        <img class="mech-coming-icon" src={BOSSES.find(b => b.id === activeBoss)?.icon} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).src = "/professions/guardian.png")} />
        <div class="mech-coming-title">{BOSSES.find(b => b.id === activeBoss)?.name} — Coming Soon</div>
        <div class="mech-coming-sub">Boss-specific mechanic breakdowns aren't in Portal Protocol yet. Use the Mechanic Analyzer for full multi-log analysis today:</div>
        <a class="mech-coming-link" href="https://mechanic-analyzer.pages.dev" target="_blank" rel="noopener">mechanic-analyzer.pages.dev ↗</a>
        <div class="mech-coming-note">We'll keep adding bosses here — Cerus is the first because it has the deepest data.</div>
      </div>
    {/if}
  </section>
</div>

<style>
  .mech-layout { display: grid; grid-template-columns: 220px 1fr; gap: 16px; height: 100%; min-height: 0; }
  @media (max-width: 720px) { .mech-layout { grid-template-columns: 1fr; } }

  .mech-rail { display: flex; flex-direction: column; gap: 6px; border-right: 1px solid var(--border); padding-right: 12px; overflow-y: auto; }
  .mech-rail-title { font-size: 10px; letter-spacing: .12em; color: var(--text-muted); text-transform: uppercase; padding: 4px 8px; }
  .mech-rail-item {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    background: transparent; border: 1px solid transparent; border-radius: 10px;
    padding: 9px 10px; cursor: pointer; color: var(--text); transition: background .14s ease, border-color .14s ease;
  }
  .mech-rail-item:hover { background: color-mix(in srgb, #fff 5%, transparent); }
  .mech-rail-item.active { background: color-mix(in srgb, var(--accent) 12%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .mech-rail-icon { width: 30px; height: 30px; border-radius: 8px; flex: none; }
  .mech-rail-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .mech-rail-name { font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mech-rail-sub { font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mech-rail-count {
    font-size: 11px; font-weight: 800; color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 8px; padding: 2px 7px; flex: none;
  }

  .mech-content { min-width: 0; overflow-y: auto; }

  /* ── Selector ── */
  .mech-selector { max-width: 720px; display: flex; flex-direction: column; gap: 12px; }
  .mech-sel-head { display: flex; align-items: center; gap: 12px; }
  .mech-sel-icon { width: 44px; height: 44px; border-radius: 10px; }
  .mech-sel-title { font-size: 16px; font-weight: 800; color: #fff; }
  .mech-sel-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .mech-sel-section { font-size: 10px; letter-spacing: .1em; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; }
  .mech-sel-list { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 6px; }
  .mech-sel-row { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 7px; cursor: pointer; transition: background .12s ease; }
  .mech-sel-row:hover { background: color-mix(in srgb, #fff 4%, transparent); }
  .mech-sel-row-name { font-size: 12px; font-weight: 600; color: var(--text); }
  .mech-sel-row-meta { font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  .mech-sel-empty { font-size: 12px; color: var(--text-muted); font-style: italic; padding: 8px 0; }
  .mech-sel-textarea {
    width: 100%; resize: vertical; background: #0c0c11; color: #fff;
    border: 1px solid var(--border); border-radius: 10px; padding: 10px;
    font-family: inherit; font-size: 12px; outline: none;
  }
  .mech-sel-textarea:focus { border-color: var(--accent); }
  .mech-sel-err { font-size: 11px; color: var(--warn); }
  .mech-sel-warn { font-size: 11px; color: #fbbf24; background: color-mix(in srgb, #fbbf24 10%, transparent); border: 1px solid color-mix(in srgb, #fbbf24 30%, transparent); border-radius: 8px; padding: 6px 10px; }
  .mech-sel-warn-inline { margin-bottom: 10px; }
  .mech-sel-btn {
    align-self: flex-start; background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #fff));
    color: #fff; border: none; border-radius: 10px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer;
    transition: filter .14s ease, opacity .14s ease;
  }
  .mech-sel-btn:hover:not(:disabled) { filter: brightness(1.08); }
  .mech-sel-btn:disabled { opacity: .6; cursor: not-allowed; }

  /* ── Result head ── */
  .mech-result-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .mech-result-title { font-size: 14px; font-weight: 800; color: #fff; }
  .mech-result-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .mech-pill {
    background: color-mix(in srgb, #fff 6%, transparent); border: 1px solid var(--border);
    color: var(--text); border-radius: 8px; padding: 5px 11px; font-size: 11px; font-weight: 600; cursor: pointer;
    transition: background .14s ease, color .14s ease, border-color .14s ease;
  }
  .mech-pill:hover { background: color-mix(in srgb, #fff 12%, transparent); color: #fff; }
  .mech-pill.active { background: color-mix(in srgb, var(--accent) 18%, transparent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); color: #fff; }
  .mech-pill.ghost { background: transparent; color: var(--text-muted); }

  /* ── Coming Soon ── */
  .mech-coming { max-width: 520px; margin: 40px auto; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .mech-coming-icon { width: 56px; height: 56px; border-radius: 12px; opacity: .8; }
  .mech-coming-title { font-size: 18px; font-weight: 800; color: #fff; }
  .mech-coming-sub { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
  .mech-coming-link { color: var(--accent); font-weight: 700; font-size: 13px; text-decoration: none; border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); border-radius: 9px; padding: 8px 14px; transition: background .14s ease; }
  .mech-coming-link:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .mech-coming-note { font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 4px; }
</style>
