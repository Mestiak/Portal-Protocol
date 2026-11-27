<!-- External logs: paste a supported log link, analyze it, keep notes. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  interface ExtPlayer { name: string; account: string; profession: string; }
  interface ExtNote { id: string; text: string; createdAt: string; }
  interface ExtLog {
    id: string; source: string; linkId: string; url: string; bossName: string;
    success: boolean | null; isCm: boolean; isLcm: boolean; durationSec: number;
    groupDps: number; hpLeft: number | null; multiBoss: boolean; numPlayers: number;
    players: ExtPlayer[]; notes: ExtNote[]; createdAt: string; lastChecked: string;
  }
  interface CouncilPhase { key: string; name: string; icon: string | null; kind: string; cleared: boolean; order: number; raw: string; }
  interface CouncilHp { key: string; name: string; hp_left: number; died: boolean; order: number; icon: string | null; }
  interface ExternalCouncil { phases: CouncilPhase[]; hp: CouncilHp[]; }
  interface CouncilRow { key: string; name: string; icon: string; kind: string; cleared: boolean; hp: number | null; died: boolean; }
  interface TargetRow { label: string; hp: number | null; icon: string; iconColor?: string | null; }
  interface ExternalTargets { rows: TargetRow[]; }
  interface ServiceStatus { dpsReport: string; wingman: string; }

  // dps.report link fetching is disabled; Wingman links are supported.
  const ENABLE_DPS_REPORT_LINKS = false;

  let {
    onCheckStats,
    onToast,
    bossIcon,
  }: {
    onCheckStats: (log: ExtLog) => void;
    onToast: (message: string, kind?: "default" | "success" | "offline" | "online") => void;
    bossIcon: (name: string | undefined, players?: number) => string;
  } = $props();

  interface WingmanLookup { found: boolean; inQueue: boolean; targetURL?: string; linkId?: string; }

  let logs = $state<ExtLog[]>([]);
  let actionMode = $state<"add" | "find">("add");
  let linkInput = $state("");
  let lookupInput = $state("");
  let lookupBusy = $state(false);
  let lookupResult = $state<WingmanLookup | null>(null);
  let busy = $state(false);
  let checking = $state(false);
  let error = $state("");
  let status = $state<ServiceStatus>({ dpsReport: "unknown", wingman: "unknown" });
  let confirmDelete = $state<string | null>(null);
  let notesOpen = $state<Record<string, boolean>>({});
  let noteDraft = $state<Record<string, string>>({});
  let statsBusyId = $state<string | null>(null);
  let addNotice = $state("");
  let councilByLog = $state<Record<string, ExternalCouncil>>({});
  let targetsByLog = $state<Record<string, ExternalTargets>>({});

  onMount(() => {
    void loadLogs();
    void loadStatus(false);
  });

  async function loadLogs() {
    try {
      logs = await invoke<ExtLog[]>("list_external_logs");
      for (const log of logs) if (log.multiBoss) void loadBreakdowns(log.id);
    } catch (e) {
      error = `Could not load saved logs: ${String(e)}`;
    }
  }

  async function loadBreakdowns(id: string) {
    if (!councilByLog[id]) {
      try {
        const council = await invoke<ExternalCouncil | null>("get_external_multi_boss", { id });
        if (council) councilByLog = { ...councilByLog, [id]: council };
      } catch {
        // Council data is optional; the card still shows its other details.
      }
    }
    if (!targetsByLog[id]) {
      try {
        const targets = await invoke<ExternalTargets | null>("get_external_multi_targets", { id });
        if (targets) targetsByLog = { ...targetsByLog, [id]: targets };
      } catch {
        // Target data is optional; the card still shows its other details.
      }
    }
  }

  function councilRows(log: ExtLog): CouncilRow[] {
    const council = councilByLog[log.id];
    if (!council) return [];
    const hpByKey = new Map(council.hp.map((h) => [h.key, h]));
    return council.phases.map((p) => {
      const hp = hpByKey.get(p.key) ?? null;
      const isDragon = p.kind === "dragon";
      const died = isDragon ? p.cleared : hp?.died ?? false;
      const hpLeft = isDragon ? (p.cleared ? 0 : hp?.hp_left ?? 100) : hp?.hp_left ?? null;
      return {
        key: p.key,
        name: p.name,
        icon: p.icon ? `/bosses/${p.icon}.png` : `/bosses/the${p.key}void.png`,
        kind: p.kind,
        cleared: p.cleared,
        hp: hpLeft,
        died,
      };
    });
  }

  async function loadStatus(probe: boolean) {
    try {
      status = await invoke<ServiceStatus>(probe ? "check_external_services" : "external_service_status");
    } catch {
      // The banner is informational; a failed probe must not block the tab.
    }
  }

  async function probeStatus() {
    checking = true;
    await loadStatus(true);
    const down = [status.dpsReport === "offline" && "dps.report", status.wingman === "offline" && "GW2 Wingman"].filter(Boolean);
    if (down.length) onToast(`${down.join(" and ")} appear${down.length > 1 ? "" : "s"} down. Saved logs still open from cache.`, "offline");
    else if (status.dpsReport === "online" || status.wingman === "online") onToast("External services checked — links are available.", "success");
    else onToast("Could not check the external services.", "default");
    checking = false;
  }

  function statusLabel(): string {
    if (!ENABLE_DPS_REPORT_LINKS) {
      return status.wingman === "offline" ? "Wingman down · dps.report links disabled" : "dps.report links disabled · Wingman available";
    }
    if (status.dpsReport === "offline" && status.wingman === "offline") return "Both services down";
    if (status.dpsReport === "offline") return "dps.report down · Wingman available";
    if (status.wingman === "offline") return "Wingman down · dps.report available";
    if (status.dpsReport === "online" && status.wingman === "online") return "Both services available";
    return "Status not checked yet";
  }

  function openStats(log: ExtLog) {
    if (statsBusyId) return;
    statsBusyId = log.id;
    onToast(`Opening stats for ${log.bossName || "this log"}…`, "success");
    onCheckStats(log);
    setTimeout(() => { if (statsBusyId === log.id) statsBusyId = null; }, 900);
  }

  function dpsLinkId(input: string): string | null {
    try {
      const url = new URL(input.trim());
      const host = url.hostname.toLowerCase();
      if (!["dps.report", "b.dps.report", "a.dps.report"].includes(host)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "getJson") return url.searchParams.get("permalink") || null;
      return parts[0]?.split("_")[0] || null;
    } catch {
      return null;
    }
  }

  async function fetchDpsJson(id: string): Promise<any> {
    try {
      const value = await invoke<any>("fetch_dps_report_json", { linkId: id });
      status = { ...status, dpsReport: "online" };
      return value;
    } catch (e) {
      // The WebView is a secondary path; the command already tried every domain.
    }
    const failures: string[] = [];
    for (const base of ["https://dps.report", "https://b.dps.report", "http://a.dps.report"]) {
      try {
        const res = await fetch(`${base}/getJson?permalink=${encodeURIComponent(id)}`);
        const text = await res.text();
        if (!res.ok) { failures.push(`${base}: HTTP ${res.status}`); continue; }
        const value = JSON.parse(text);
        if (value?.error) { failures.push(`${base}: ${value.error}`); continue; }
        status = { ...status, dpsReport: "online" };
        return value;
      } catch (e) {
        failures.push(`${base}: ${String(e)}`);
      }
    }
    status = { ...status, dpsReport: "offline" };
    throw new Error(failures.join(" | "));
  }

  async function addLog() {
    const url = linkInput.trim();
    if (!url || busy) return;
    if (dpsLinkId(url) && !ENABLE_DPS_REPORT_LINKS) {
      error = "dps.report links are temporarily disabled in this build. Use a GW2 Wingman log link.";
      onToast(error, "default");
      return;
    }
    busy = true;
    error = "";
    try {
      const dpsId = dpsLinkId(url);
      let rec: ExtLog;
      if (dpsId) {
        const raw = await fetchDpsJson(dpsId);
        rec = await invoke<ExtLog>("store_external_raw", {
          source: "dpsreport",
          linkId: dpsId,
          url: `https://dps.report/${dpsId}`,
          raw,
        });
      } else {
        rec = await invoke<ExtLog>("add_external_log", { url });
      }
      logs = [rec, ...logs.filter((l) => l.id !== rec.id)];
      if (rec.multiBoss) void loadBreakdowns(rec.id);
      linkInput = "";
      addNotice = `Added ${rec.bossName || "log"} — ready to analyze.`;
      setTimeout(() => { addNotice = ""; }, 2600);
      onToast(`Added ${rec.bossName || "log"} to External logs.`, "success");
      await loadStatus(false);
    } catch (e) {
      error = String(e);
      onToast(`Could not add that link: ${String(e)}`, "default");
      await loadStatus(false);
    } finally {
      busy = false;
    }
  }

  async function findWingmanLog() {
    const link = lookupInput.trim();
    if (!link || lookupBusy) return;
    if (!dpsLinkId(link)) {
      error = "Paste a dps.report log link to find it on Wingman.";
      onToast(error, "default");
      return;
    }
    lookupBusy = true;
    error = "";
    try {
      const result = await invoke<WingmanLookup>("find_wingman_log_for_dps", { link });
      lookupResult = result;
      if (result.found && result.targetURL) {
        const rec = await invoke<ExtLog>("add_external_log", { url: result.targetURL });
        logs = [rec, ...logs.filter((l) => l.id !== rec.id)];
        if (rec.multiBoss) void loadBreakdowns(rec.id);
        lookupInput = "";
        onToast(`Found and added ${rec.bossName || "log"} from Wingman.`, "success");
      } else if (result.inQueue) {
        onToast("That log is already queued on Wingman. Check again in a few minutes.", "default");
      } else {
        onToast("That log is not on Wingman yet.", "default");
      }
    } catch (e) {
      error = String(e);
      onToast(`Could not find that log: ${String(e)}`, "default");
    } finally {
      lookupBusy = false;
      await loadStatus(false);
    }
  }

  async function importWingmanLog() {
    const link = lookupInput.trim();
    if (!link || lookupBusy) return;
    lookupBusy = true;
    try {
      await invoke("import_wingman_log_from_dps", { link });
      lookupResult = { found: false, inQueue: true };
      onToast("Queued for import on Wingman. Check again in a few minutes.", "success");
    } catch (e) {
      error = String(e);
      onToast(`Could not queue the import: ${String(e)}`, "default");
    } finally {
      lookupBusy = false;
    }
  }

  async function refreshLog(log: ExtLog) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      if (log.source === "dpsreport" && !ENABLE_DPS_REPORT_LINKS) {
        error = "dps.report links are temporarily disabled in this build.";
        onToast(error, "default");
        return;
      }
      let rec: ExtLog;
      if (log.source === "dpsreport") {
        const raw = await fetchDpsJson(log.linkId);
        rec = await invoke<ExtLog>("store_external_raw", {
          source: "dpsreport",
          linkId: log.linkId,
          url: log.url,
          raw,
        });
      } else {
        rec = await invoke<ExtLog>("refresh_external_log", { id: log.id });
      }
      logs = logs.map((l) => (l.id === rec.id ? rec : l));
      if (rec.multiBoss) void loadBreakdowns(rec.id);
      onToast(`Refreshed ${rec.bossName || "log"}.`, "success");
      await loadStatus(false);
    } catch (e) {
      error = String(e);
      onToast(`Could not refresh: ${String(e)}`, "default");
      await loadStatus(false);
    } finally {
      busy = false;
    }
  }

  async function removeLog(log: ExtLog) {
    try {
      await invoke("delete_external_log", { id: log.id });
      logs = logs.filter((l) => l.id !== log.id);
      confirmDelete = null;
      onToast(`Removed ${log.bossName || "log"} from External logs.`, "success");
    } catch (e) {
      error = String(e);
      onToast(`Could not remove: ${String(e)}`, "default");
    }
  }

  async function addNote(log: ExtLog) {
    const text = (noteDraft[log.id] ?? "").trim();
    if (!text) return;
    try {
      await invoke("add_external_note", { id: log.id, text });
      noteDraft = { ...noteDraft, [log.id]: "" };
      await loadLogs();
      onToast("Note saved.", "success");
    } catch (e) {
      error = String(e);
      onToast(`Could not save note: ${String(e)}`, "default");
    }
  }

  async function removeNote(log: ExtLog, note: ExtNote) {
    try {
      await invoke("delete_external_note", { id: log.id, noteId: note.id });
      await loadLogs();
      onToast("Note removed.", "success");
    } catch (e) {
      error = String(e);
      onToast(`Could not remove note: ${String(e)}`, "default");
    }
  }

  function fmtDuration(sec: number): string {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function fmtChecked(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
  function sourceLabel(source: string): string {
    return source === "wingman" ? "GW2 Wingman" : "dps.report";
  }
</script>

<div class="ext-tab">
  <div class="ext-intro">
    <div>
      <h2>External logs</h2>
      <p class="ext-hint">Paste a GW2 Wingman log link to read it here. dps.report links are temporarily disabled in this build. Saved logs stay in this tab with their notes — they are not added to your upload history or analytics.</p>
    </div>
    <div class="ext-intro-actions">
      <span class="ext-status-text">{statusLabel()}</span>
      <button class="ext-status-btn" onclick={() => void probeStatus()} disabled={checking}>
        <i class="fa-solid {checking ? 'fa-spinner fa-spin' : 'fa-rotate-right'}"></i> Check status
      </button>
    </div>
  </div>

  {#if (ENABLE_DPS_REPORT_LINKS && status.dpsReport === "offline") || status.wingman === "offline"}
    <div class="ext-outage" role="status">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        {#if status.dpsReport === "offline" && status.wingman === "offline"}
          <strong>Both dps.report and GW2 Wingman appear to be down.</strong> New links cannot be read right now. Logs you already opened still work from the local cache.
        {:else if status.dpsReport === "offline"}
          <strong>dps.report appears to be down.</strong> Wingman links still work; dps.report links will fail until it recovers. Already-cached logs still open.
        {:else}
          <strong>GW2 Wingman appears to be down.</strong> {ENABLE_DPS_REPORT_LINKS ? "dps.report links still work; " : ""}Wingman links will fail until it recovers. Already-cached logs still open.
        {/if}
      </div>
    </div>
  {/if}

  <div class="ext-mode-row">
    <button class="ext-btn" class:ext-primary={actionMode === "add"} onclick={() => { actionMode = "add"; error = ""; }}>
      <i class="fa-solid fa-plus"></i> Add Log
    </button>
    <button class="ext-btn" class:ext-primary={actionMode === "find"} onclick={() => { actionMode = "find"; error = ""; }}>
      <i class="fa-solid fa-magnifying-glass"></i> Find on Wingman
    </button>
  </div>

  {#if actionMode === "find"}
    <div class="ext-paste card">
      <label class="ext-label" for="wingman-lookup">dps.report link</label>
      <p class="ext-hint">Look up its Wingman copy, then open it with Check Stats.</p>
      <div class="ext-paste-row">
        <input id="wingman-lookup" class="ext-input" placeholder="https://dps.report/…"
               value={lookupInput}
               oninput={(e) => { lookupInput = e.currentTarget.value; lookupResult = null; }}
               onkeydown={(e) => { if (e.key === "Enter") void findWingmanLog(); }} />
        <button class="ext-btn ext-primary" onclick={() => void findWingmanLog()} disabled={lookupBusy || busy}>
          <i class="fa-solid {lookupBusy ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}"></i> {lookupBusy ? "Searching…" : "Find Wingman log"}
        </button>
      </div>
      {#if lookupResult && !lookupResult.found}
        <div class="ext-lookup-result">
          <span class={lookupResult.inQueue ? "ext-strong-text" : "ext-warn-text"}>{lookupResult.inQueue ? "Already queued on Wingman — check again in a few minutes." : "Not on Wingman yet."}</span>
          {#if !lookupResult.inQueue}
            <button class="ext-btn" onclick={() => void importWingmanLog()} disabled={lookupBusy}>Import to Wingman</button>
          {/if}
          <button class="ext-btn" onclick={() => void findWingmanLog()} disabled={lookupBusy}>Check again</button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="ext-paste card">
      <label class="ext-label" for="ext-link">Wingman log link</label>
      <div class="ext-paste-row">
        <input id="ext-link" class="ext-input" placeholder="https://gw2wingman.nevermindcreations.de/log/…"
               value={linkInput}
               oninput={(e) => { linkInput = e.currentTarget.value; }}
               onkeydown={(e) => { if (e.key === "Enter") void addLog(); }} />
        <button class="ext-btn ext-primary" onclick={() => void addLog()} disabled={busy || !linkInput.trim()}>
          <i class="fa-solid {busy ? 'fa-spinner fa-spin' : 'fa-plus'}"></i> Add log
        </button>
      </div>
      {#if addNotice}<div class="ext-added" role="status"><i class="fa-solid fa-circle-check"></i> {addNotice}</div>{/if}
    </div>
  {/if}
  {#if error}<div class="ext-error" role="alert">{error}</div>{/if}

  {#if logs.length === 0}
    <div class="ext-empty card">No external logs yet. Paste a link above to analyze one.</div>
  {:else}
    <div class="ext-list">
      {#each logs as log (log.id)}
        {@const councilChips = log.multiBoss ? councilRows(log) : []}
        {@const targetRows = log.multiBoss ? (targetsByLog[log.id]?.rows ?? []) : []}
        <div class="log-card card ext-card">
          <div class="ext-head">
            <img class="ext-icon" src={bossIcon(log.bossName, log.numPlayers)} alt={log.bossName} />
            <div class="ext-body">
              <div class="boss-title-row">
                <span class="ext-name">{log.bossName || "Unknown encounter"}</span>
                {#if log.isLcm}
                  <span class="cm-badge lcm-badge">Legendary CM</span>
                {:else if log.isCm}
                  <span class="cm-badge">Challenge Mode</span>
                {:else}
                  <span class="cm-badge nm-badge">Normal Mode</span>
                {/if}
                {#if log.success === true}
                  <span class="status-pill sp-success">✓ Success</span>
                {:else if log.success === false}
                  <span class="status-pill sp-failed">✗ Failed</span>
                {:else}
                  <span class="status-pill sp-unknown">? Unknown</span>
                {/if}
              </div>
              <div class="ext-meta-line">
                {#if log.success === false && log.hpLeft != null && !log.multiBoss}
                  <span class="ext-detail" style="color:#f87171; font-weight:700;"><i class="fa-solid fa-heart-crack" style="margin-right: 4px; font-size: 11px;"></i> {log.hpLeft.toFixed(2)}% HP Left</span>
                {/if}
                <span class="ext-detail"><i class="fa-solid fa-stopwatch" style="margin-right: 4px; font-size: 11px;"></i> {fmtDuration(log.durationSec)}</span>
                <span class="ext-detail"><i class="fa-solid fa-users" style="margin-right: 4px; font-size: 11px;"></i> {log.numPlayers} players</span>
              </div>
              {#if councilChips.length}
                <div class="dragon-council merged" aria-label="Dragon Council">
                  {#each councilChips as chip, i (chip.key)}
                    <div
                      class="dragon-chip tk-{chip.kind}"
                      class:cleared={chip.cleared}
                      class:wiped={!chip.cleared}
                      style="--i:{i}"
                      title="{chip.name}: {chip.cleared ? 'Cleared' : 'Not cleared'}{chip.hp != null ? ' · ' + (chip.died ? 'Defeated' : chip.hp.toFixed(1) + '% HP left') : ''}"
                    >
                      <img class="dragon-icon" src={chip.icon} alt={chip.name} onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                      {#if chip.hp != null}
                        <span class="dragon-hp-text">{chip.died ? 'Defeated' : chip.hp.toFixed(1) + '% left'}</span>
                      {/if}
                      <span class="dragon-name">{chip.name}</span>
                      <span class="phase-mark"><i class="fa-solid {chip.cleared ? 'fa-check' : 'fa-xmark'}"></i></span>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if targetRows.length}
                <div class="ext-target-rows">
                  {#each targetRows as row}
                    <span class="meta-item" style="color:#d1d5db; font-weight:700;">
                      <i class="fa-solid {row.icon}" style="margin-right:4px; font-size:11px;{row.iconColor ? ` color:${row.iconColor};` : ''}"></i>
                      {row.label}
                      {#if row.hp != null}
                        <span style={row.hp <= 1 ? 'color:#4ade80; margin-left:6px;' : 'color:#f87171; margin-left:6px;'}>
                          {row.hp <= 1 ? 'Killed' : `${row.hp.toFixed(2)}% HP Left`}
                        </span>
                      {/if}
                    </span>
                  {/each}
                </div>
              {/if}
              <div class="ext-source">
                <span>{sourceLabel(log.source)}</span>
                <span class="ext-dot">·</span>
                <a href={log.url} target="_blank" rel="noopener noreferrer">{log.linkId}</a>
                <span class="ext-dot">·</span>
                <span>checked {fmtChecked(log.lastChecked)}</span>
              </div>
            </div>
          </div>

          <div class="ext-actions">
            <button class="ext-btn ext-primary" onclick={() => openStats(log)} disabled={statsBusyId === log.id || busy}>
              <i class="fa-solid {statsBusyId === log.id ? 'fa-spinner fa-spin' : 'fa-chart-line'}"></i> {statsBusyId === log.id ? "Opening stats…" : "Check Stats"}
            </button>
            <button class="ext-btn" onclick={() => void refreshLog(log)} disabled={busy}>Refresh</button>
            <button class="ext-btn" class:ext-active={notesOpen[log.id]} onclick={() => { notesOpen = { ...notesOpen, [log.id]: !notesOpen[log.id] }; }}>
              Notes ({log.notes.length})
            </button>
            <button class="ext-btn ext-danger" onclick={() => { confirmDelete = confirmDelete === log.id ? null : log.id; }}>Delete</button>
          </div>

          {#if confirmDelete === log.id}
            <div class="ext-confirm">
              Remove this saved log and its notes? The original link is unaffected.
              <button class="ext-btn" onclick={() => { confirmDelete = null; }}>Cancel</button>
              <button class="ext-btn ext-danger" onclick={() => void removeLog(log)}>Remove</button>
            </div>
          {/if}

          {#if notesOpen[log.id]}
            <div class="ext-notes">
              {#each log.notes as note (note.id)}
                <div class="ext-note">
                  <span class="ext-note-text">{note.text}</span>
                  <button class="ext-note-del" aria-label="Delete note" onclick={() => void removeNote(log, note)}><i class="fa-solid fa-xmark"></i></button>
                </div>
              {:else}
                <div class="ext-note-empty">No notes for this log yet.</div>
              {/each}
              <div class="ext-note-row">
                <input class="ext-input" aria-label="New note" placeholder="Add a note…"
                       value={noteDraft[log.id] ?? ""}
                       oninput={(e) => { noteDraft = { ...noteDraft, [log.id]: e.currentTarget.value }; }}
                       onkeydown={(e) => { if (e.key === "Enter") void addNote(log); }} />
                <button class="ext-btn" onclick={() => void addNote(log)}>Add</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ext-tab { display: flex; flex-direction: column; gap: 14px; padding: 16px; overflow-y: auto; height: 100%; box-sizing: border-box; }
  .ext-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .ext-intro h2 { margin: 0 0 4px; font-size: 16px; font-weight: 800; }
  .ext-hint { margin: 0; max-width: 720px; font-size: 11px; color: var(--text-muted); line-height: 1.5; }
  .ext-intro-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex: none; }
  .ext-status-text { font-size: 10px; color: var(--text-muted); }
  .ext-status-btn, .ext-btn {
    background: #ffffff0d; color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 700;
    cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
    transition: background-color .14s ease, border-color .14s ease, transform .12s cubic-bezier(.2,.8,.2,1), box-shadow .14s ease;
  }
  .ext-status-btn:hover:not(:disabled), .ext-btn:hover:not(:disabled) { background: #ffffff18; transform: translateY(-1px); }
  .ext-btn:active:not(:disabled) { transform: scale(.96); }
  .ext-btn:focus-visible, .ext-status-btn:focus-visible, .ext-input:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  .ext-btn:disabled, .ext-status-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
  .ext-primary { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); }
  .ext-danger { color: var(--fail); }
  .ext-active { background: #ffffff18; }
  .ext-outage {
    display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px;
    border: 1px solid var(--warn); border-radius: 8px; background: color-mix(in srgb, var(--warn) 12%, transparent);
    font-size: 11px; line-height: 1.5; color: var(--text);
    animation: ext-reveal 180ms cubic-bezier(.2,.8,.2,1) backwards;
  }
  .ext-outage i { color: var(--warn); margin-top: 2px; }
  .ext-paste { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .ext-mode-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .ext-warn-text { color: var(--warn); font-weight: 800; }
  .ext-strong-text { color: #fff; font-weight: 800; }
  .ext-lookup-result { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 10px; color: var(--text-muted); animation: ext-reveal 160ms cubic-bezier(.2,.8,.2,1) backwards; }
  .ext-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); font-weight: 800; }
  .ext-paste-row, .ext-note-row { display: flex; gap: 8px; }
  .ext-input {
    flex: 1; min-width: 0; background: #0c0c0f; border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); padding: 7px 9px; font-size: 11px;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  .ext-input:hover { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
  .ext-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent); outline: none; }
  .ext-input::placeholder { color: var(--text-muted); }
  .ext-error { font-size: 11px; color: var(--fail); }
  .ext-added { font-size: 11px; color: var(--success); display: flex; align-items: center; gap: 6px; animation: ext-reveal 180ms cubic-bezier(.2,.8,.2,1) backwards; }
  .ext-empty { padding: 20px; text-align: center; font-size: 12px; color: var(--text-muted); }
  .ext-list { display: flex; flex-direction: column; gap: 10px; }
  .ext-card {
    padding: 12px; display: flex; flex-direction: column; gap: 10px;
    animation: ext-reveal 220ms cubic-bezier(.2,.8,.2,1) backwards;
    transition: border-color .18s ease, box-shadow .18s ease, transform .18s cubic-bezier(.2,.8,.2,1);
  }
  .ext-card:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); box-shadow: 0 6px 18px #0004; }
  .ext-head { display: flex; align-items: flex-start; gap: 10px; }
  .ext-icon { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; background: #0c0c0f; flex: none; }
  .ext-body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .ext-name { font-size: 14px; font-weight: 800; color: #fff; }
  .ext-meta-line { display: flex; flex-wrap: wrap; gap: 8px; }
  .ext-target-rows { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
  .ext-detail { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .ext-source { display: flex; flex-wrap: wrap; gap: 5px; font-size: 10px; color: var(--text-muted); }
  .ext-source a { color: var(--accent); text-decoration: none; }
  .ext-source a:hover { text-decoration: underline; }
  .ext-dot { opacity: .5; }
  .ext-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .ext-confirm {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    font-size: 11px; color: var(--text-muted);
    animation: ext-reveal 160ms cubic-bezier(.2,.8,.2,1) backwards;
  }
  .ext-notes {
    display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); padding-top: 8px;
    animation: ext-reveal 160ms cubic-bezier(.2,.8,.2,1) backwards;
  }
  .ext-note { display: flex; align-items: center; gap: 8px; font-size: 11px; background: #ffffff08; border-radius: 6px; padding: 5px 8px; }
  .ext-note-text { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
  .ext-note-del { background: none; border: none; color: var(--text-muted); cursor: pointer; transition: color .14s ease; }
  .ext-note-del:hover { color: var(--fail); }
  .ext-note-empty { font-size: 10px; color: var(--text-muted); }

  @keyframes ext-reveal {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ext-card, .ext-outage, .ext-added, .ext-confirm, .ext-notes, .ext-lookup-result { animation: none; }
    .ext-status-btn, .ext-btn, .ext-card, .ext-input, .ext-note-del { transition: none; }
    .ext-status-btn:hover:not(:disabled), .ext-btn:hover:not(:disabled), .ext-card:hover, .ext-btn:active:not(:disabled) { transform: none; }
  }
</style>
